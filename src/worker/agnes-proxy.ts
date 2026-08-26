/**
 * Cloudflare Worker: Agnes API Proxy
 *
 * Proxies requests to Agnes 2.5 Flash API with security restrictions.
 * API Key stored in Worker Secret (not in code).
 *
 * Environment Variables:
 *   AGNES_BASE_URL - Base URL for Agnes API (default: https://api.agnes-ai.cn/v1)
 *   AGNES_MODEL    - Model name (default: agnes-2.5-flash)
 *
 * Secrets:
 *   AGNES_API_KEY  - Agnes API Key (required, stored in Cloudflare)
 */

// ── Config ───────────────────────────────────────────────────────────────────
const DEFAULT_BASE_URL = 'https://api.agnes-ai.cn/v1';
const DEFAULT_MODEL = 'agnes-2.5-flash';
const BODY_LIMIT = 64 * 1024; // 64 KB
const REQUEST_TIMEOUT_MS = 30_000;

// Allowed origins (GitHub Pages production + local dev)
const ALLOWED_ORIGINS = [
  'https://lixinjiang-ai.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    ...extraHeaders,
  });
  return new Response(JSON.stringify(body), { status, headers });
}

function corsHeaders(origin: string): Record<string, string> {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : '*';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function fail(code: string, message: string, hint?: string): Record<string, unknown> {
  const error: Record<string, unknown> = { code, message };
  if (hint) error.hint = hint;
  return { ok: false, error };
}

// ── Request Validation ───────────────────────────────────────────────────────
function validateRequest(req: Request): { valid: boolean; error?: Response } {
  // POST only
  if (req.method !== 'POST') {
    return {
      valid: false,
      error: jsonResponse(405, fail('METHOD_NOT_ALLOWED', `Method ${req.method} not allowed. Use POST.`), corsHeaders(req.headers.get('Origin') || '')),
    };
  }

  // Parse body
  const contentType = req.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    return {
      valid: false,
      error: jsonResponse(400, fail('INVALID_CONTENT_TYPE', 'Content-Type must be application/json'), corsHeaders(req.headers.get('Origin') || '')),
    };
  }

  return { valid: true };
}

// ── Main Handler ─────────────────────────────────────────────────────────────
async function handleRequest(req: Request, env: WorkerEnv): Promise<Response> {
  const origin = req.headers.get('Origin') || '';
  const baseCORS = corsHeaders(origin);

  // Validate request
  const validation = validateRequest(req);
  if (!validation.valid) {
    return validation.error!;
  }

  // Check API Key
  const apiKey = env.AGNES_API_KEY;
  if (!apiKey) {
    return jsonResponse(500, fail('MISSING_CONFIG', 'Agnes API Key not configured. Contact administrator.'), baseCORS);
  }

  // Read and parse body
  let requestBody: { messages?: Array<{ role: string; content: string }> };
  try {
    const text = await req.text();
    if (text.length > BODY_LIMIT) {
      return jsonResponse(413, fail('PAYLOAD_TOO_LARGE', `Request body exceeds ${BODY_LIMIT} bytes limit.`), baseCORS);
    }
    requestBody = JSON.parse(text);
  } catch (e) {
    return jsonResponse(400, fail('INVALID_JSON', 'Request body must be valid JSON'), baseCORS);
  }

  // Validate messages
  if (!requestBody.messages || !Array.isArray(requestBody.messages) || requestBody.messages.length === 0) {
    return jsonResponse(400, fail('MISSING_MESSAGES', 'messages array is required and cannot be empty'), baseCORS);
  }

  // Build proxy request
  const baseUrl = env.AGNES_BASE_URL || DEFAULT_BASE_URL;
  const model = env.AGNES_MODEL || DEFAULT_MODEL;

  const proxyRequest = new Request(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: requestBody.messages,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  // Forward to Agnes API
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(proxyRequest);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : 'Unknown error';
    return jsonResponse(502, fail('UPSTREAM_ERROR', `Failed to reach Agnes API: ${errorMessage}`), baseCORS);
  }

  // Handle upstream errors
  if (!upstreamResponse.ok) {
    const status = upstreamResponse.status;
    let errorCode = 'UPSTREAM_ERROR';
    let errorMsg = `Agnes API returned status ${status}`;

    if (status === 429) {
      errorCode = 'RATE_LIMITED';
      errorMsg = 'Rate limit exceeded. Please try again later.';
    } else if (status === 401 || status === 403) {
      errorCode = 'AUTH_ERROR';
      errorMsg = 'Authentication failed. Contact administrator.';
    } else if (status >= 500) {
      errorCode = 'SERVER_ERROR';
      errorMsg = `Agnes API server error: ${status}`;
    }

    return jsonResponse(status, fail(errorCode, errorMsg), baseCORS);
  }

  // Parse and return upstream response
  try {
    const upstreamBody = await upstreamResponse.json();
    return jsonResponse(200, { ok: true, data: upstreamBody }, baseCORS);
  } catch (e) {
    return jsonResponse(502, fail('INVALID_UPSTREAM_RESPONSE', 'Failed to parse Agnes API response'), baseCORS);
  }
}

// ── CORS Preflight ───────────────────────────────────────────────────────────
function handleOptions(req: Request): Response {
  if (req.method === 'OPTIONS') {
    const origin = req.headers.get('Origin') || '';
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }
  return new Response(null, { status: 405 });
}

// ── Type Definitions ─────────────────────────────────────────────────────────
interface WorkerEnv {
  AGNES_API_KEY?: string;
  AGNES_BASE_URL?: string;
  AGNES_MODEL?: string;
}

// ── Export Handler ───────────────────────────────────────────────────────────
export default {
  async fetch(req: Request, env: WorkerEnv, _ctx: ExecutionContext): Promise<Response> {
    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
      return handleOptions(req);
    }

    // Handle all other requests
    return handleRequest(req, env);
  },
};
