#!/usr/bin/env node
// v2-p1: Agnes 2.5 Flash proxy (Netlify Function)
// Static export (Next.js) forbids app-level API routes; key stays in server env only.
'use strict';

const { createServer, request } = require('http');
const { URL } = require('url');

// ── config (env) ───────────────────────────────────────────────────────────
const AGNES_BASE_URL = (process.env.AGNES_BASE_URL || 'https://api.agnes-ai.cn/v1').replace(/\/$/, '');
const AGNES_MODEL    = process.env.AGNES_MODEL    || 'agnes-2.5-flash';
const AGNES_API_KEY  = process.env.AGNES_API_KEY;

const BODY_LIMIT = 64 * 1024; // 64 KB — sufficient for file-name + text excerpts
const REQUEST_TIMEOUT_MS = 30_000;

// ── helpers ─────────────────────────────────────────────────────────────────
const STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401, // key missing/mismatch
  PAYLOAD_TOO_LARGE: 413,
  TIMEOUT: 408,
  API_ERROR: 502,   // downstream Agnes error (wrapped, never leak key)
  UNEXPECTED: 500,
};

function json(res, status, body) {
  const s = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Access-Control-Max-Age': '86400',
    'Content-Length': Buffer.byteLength(s),
  });
  res.end(s);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        req.destroy();
        return reject(new Error('payload_too_large'));
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseBody(raw) {
  try { return JSON.parse(raw); } catch { throw new Error('invalid_json'); }
}

function ok(data) { return { ok: true, data }; }
function fail(code, message, hint) {
  return { ok: false, error: { code, message, ...(hint ? { hint } : {}) } };
}

// ── handlers ────────────────────────────────────────────────────────────────
async function handlePost(req, res) {
  if (!AGNES_API_KEY) {
    return json(res, STATUS.UNAUTHORIZED, fail('MISSING_CONFIG', 'Agnes API Key not configured on server. Contact administrator.', 'Set AGNES_API_KEY in environment.'));
  }

  let body;
  try {
    const raw = await readBody(req);
    body = parseBody(raw);
  } catch (err) {
    if (err.message === 'payload_too_large') return json(res, STATUS.PAYLOAD_TOO_LARGE, fail('PAYLOAD_TOO_LARGE', 'Request body too large (max 64 KB).'));
    if (err.message === 'invalid_json') return json(res, STATUS.BAD_REQUEST, fail('INVALID_JSON', 'Request body must be valid JSON.'));
    return json(res, STATUS.UNEXPECTED, fail('READ_ERROR', 'Failed to read request body.'));
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return json(res, STATUS.BAD_REQUEST, fail('INVALID_REQUEST', 'Request must include a non-empty "messages" array.', 'Example: {"messages":[{"role":"user","content":"hello"}]}'));
  }

  // Build Agnes payload
  const agnesBody = {
    model: AGNES_MODEL,
    messages: body.messages,
  };
  if (body.stream === true) agnesBody.stream = true;

  // Call Agnes
  const url = new URL('/chat/completions', AGNES_BASE_URL);
  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AGNES_API_KEY}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify(agnesBody),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    // Forward status with a friendly wrapper
    if (!response.ok) {
      let detail = `Upstream returned ${response.status}`;
      try {
        const t = await response.text();
        if (t && t.length > 0) detail += `: ${t.slice(0, 300)}`;
      } catch { /* ignore */ }
      const code = response.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR';
      return json(res, STATUS.API_ERROR, fail(code, detail, 'Please retry with exponential backoff for rate limits.'));
    }

    // Stream responses are forwarded as-is; non-stream already a complete JSON
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      // Stream: pipe raw SSE from Agnes
      res.writeHead(response.status, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Expose-Headers': 'Content-Type',
      });
      response.body.pipeTo(new WritableStream({
        write(chunk) { res.write(chunk); },
        close() { res.end(); },
        abort(err) { res.destroy(err); },
      }));
      return;
    }

    const agnesData = await response.json();
    return json(res, STATUS.OK, ok(agnesData));
  } catch (err) {
    if (err.name === 'AbortError') {
      return json(res, STATUS.TIMEOUT, fail('UPSTREAM_TIMEOUT', 'Agnes request timed out. Please retry.', 'Add retry with exponential backoff.'));
    }
    return json(res, STATUS.API_ERROR, fail('UPSTREAM_NETWORK', `Network or protocol error: ${err.message || 'unknown'}`));
  }
}

// ── CORS preflight ─────────────────────────────────────────────────────────
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*'; // for dev use; tighten in prod if needed
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

// ── entry point (Next + Netlify compatible) ────────────────────────────────
module.exports.handler = async (event, context) => {
  // Netlify/Edge runtime fallback — treat as Lambda handler
  const method = (event.httpMethod || event.requestContext?.http?.method || 'GET').toUpperCase();
  const path = event.path || '/.netlify/functions/agnes-chat';

  // Normalize for local dev via `netlify dev` (path may include function prefix)
  if (path !== '/.netlify/functions/agnes-chat' && !path.endsWith('/agnes-chat')) {
    return { statusCode: 404, body: JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found.' } }) };
  }

  // Simple HTTP-like handling for static-export local dev server (node _local_server.cjs ...)
  // In production Netlify, the real Lambda harness calls this directly.
  return new Promise((resolve) => {
    // For Netlify Lambda: event is LambdaProxyTriggerEvent; for static server: we emulate a small http.IncomingMessage
    const isLambda = !!event.headers;
    if (!isLambda) {
      // Static-export local proxy: construct minimal req/res
      const req = /** @type {import('http').IncomingMessage} */ ({});
      req.method = method;
      req.url = path;
      req.headers = event.headers || {};
      req.on = () => {}; // stub; won't reach POST handler in static server mode since we route via the small server
      resolve({ statusCode: 405, body: 'Use netlify dev --offline or deploy to Netlify.' });
      return;
    }

    // Lambda mode — delegate to same handler logic
    (async () => {
      if (method === 'OPTIONS') {
        return resolve({ statusCode: 204, headers: corsHeaders(), body: '' });
      }
      if (method !== 'POST') {
        return resolve({ statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fail('METHOD_NOT_ALLOWED', `Method ${method} not allowed.`)) });
      }
      const raw = event.body || '';
      // Lambda base64 handling
      const decoded = event.isBase64Encoded ? Buffer.from(raw, 'base64').toString() : raw;
      let body;
      try { body = JSON.parse(decoded); } catch { body = null; }

      // Reuse the same promise chain as handlePost but adapt to Lambda return shape
      if (!AGNES_API_KEY) {
        return resolve({ statusCode: STATUS.UNAUTHORIZED, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fail('MISSING_CONFIG', 'Agnes API Key not configured on server.', 'Set AGNES_API_KEY in Netlify env vars.')) });
      }
      if (!Array.isArray(body?.messages) || body.messages.length === 0) {
        const hint = 'Example: {"messages":[{"role":"user","content":"hello"}]}';
        return resolve({ statusCode: STATUS.BAD_REQUEST, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fail('INVALID_REQUEST', 'Request must include a non-empty "messages" array.', hint)) });
      }

      const agnesBody = { model: AGNES_MODEL, messages: body.messages };
      if (body.stream === true) agnesBody.stream = true;

      const url = new URL('/chat/completions', AGNES_BASE_URL);
      try {
        const response = await fetch(url.toString(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${AGNES_API_KEY}`,
            'Accept': 'application/json',
          },
          body: JSON.stringify(agnesBody),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          let detail = `Upstream returned ${response.status}`;
          try { const t = await response.text(); if (t) detail += `: ${t.slice(0, 300)}`; } catch {}
          const code = response.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR';
          return resolve({ statusCode: STATUS.API_ERROR, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fail(code, detail, 'Please retry with exponential backoff.')) });
        }

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/event-stream')) {
          // Stream: forward as base64 SSE chunks; client handles SSE
          const reader = response.body.getReader();
          const chunks = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          const full = Buffer.concat(chunks).toString('base64');
          return resolve({
            statusCode: 200,
            headers: {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache',
              'Access-Control-Expose-Headers': 'Content-Type',
              'Access-Control-Allow-Origin': CORS_ORIGIN,
              'Access-Control-Allow-Methods': 'POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            },
            isBase64Encoded: true,
            body: full,
          });
        }

        const agnesData = await response.json();
        return resolve({ statusCode: STATUS.OK, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ok(agnesData)) });
      } catch (err) {
        if (err.name === 'AbortError') {
          return resolve({ statusCode: STATUS.TIMEOUT, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fail('UPSTREAM_TIMEOUT', 'Agnes request timed out. Please retry.', 'Add retry with exponential backoff.')) });
        }
        return resolve({ statusCode: STATUS.API_ERROR, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fail('UPSTREAM_NETWORK', `Network or protocol error: ${err.message || 'unknown'}`)) });
      }
    })();
  });
};

// ── local dev server (for `node local_server.cjs` when no Netlify CLI) ─────
// This is a separate entry, kept for debugging without Netlify CLI.
if (require.main === module) {
  const PORT = parseInt(process.env.PORT, 10) || 8899;
  const server = createServer(async (req, res) => {
    const method = req.method?.toUpperCase() || 'GET';
    const urlObj = new URL(req.url || '/', `http://localhost:${PORT}`);

    if (urlObj.pathname !== '/agnes-chat' && urlObj.pathname !== '/.netlify/functions/agnes-chat') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found.' } }));
    }

    const headers = { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' };

    if (method === 'OPTIONS') {
      res.writeHead(204, headers);
      return res.end();
    }
    if (method !== 'POST') {
      res.writeHead(405, headers);
      return res.end(JSON.stringify(fail('METHOD_NOT_ALLOWED', `Method ${method} not allowed.`)));
    }

    let body;
    try {
      const raw = await readBody(req);
      body = parseBody(raw);
    } catch (err) {
      if (err.message === 'payload_too_large') { res.writeHead(STATUS.PAYLOAD_TOO_LARGE, headers); return res.end(JSON.stringify(fail('PAYLOAD_TOO_LARGE', 'Request body too large (max 64 KB).'))); }
      if (err.message === 'invalid_json') { res.writeHead(STATUS.BAD_REQUEST, headers); return res.end(JSON.stringify(fail('INVALID_JSON', 'Request body must be valid JSON.'))); }
      res.writeHead(STATUS.UNEXPECTED, headers);
      return res.end(JSON.stringify(fail('READ_ERROR', 'Failed to read request body.')));
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      const hint1 = 'Example: {"messages":[{"role":"user","content":"hello"}]}';
      res.writeHead(STATUS.BAD_REQUEST, headers);
      return res.end(JSON.stringify(fail('INVALID_REQUEST', 'Request must include a non-empty "messages" array.', hint1)));
    }

    if (!AGNES_API_KEY) {
      res.writeHead(STATUS.UNAUTHORIZED, headers);
      return res.end(JSON.stringify(fail('MISSING_CONFIG', 'Agnes API Key not configured on server.', 'Set AGNES_API_KEY in environment.')));
    }

    const agnesBody = { model: AGNES_MODEL, messages: body.messages };
    if (body.stream === true) agnesBody.stream = true;

    const url = new URL('/chat/completions', AGNES_BASE_URL);
    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AGNES_API_KEY}`,
          'Accept': 'application/json',
        },
        body: JSON.stringify(agnesBody),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        let detail = `Upstream returned ${response.status}`;
        try { const t = await response.text(); if (t) detail += `: ${t.slice(0, 300)}`; } catch {}
        const code = response.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR';
        res.writeHead(STATUS.API_ERROR, headers);
        return res.end(JSON.stringify(fail(code, detail, 'Please retry with exponential backoff.')));
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
        const reader = response.body.getReader();
        const pump = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(value);
            }
          } catch (e) { res.destroy(e); }
          res.end();
        };
        pump();
        return;
      }

      const agnesData = await response.json();
      res.writeHead(STATUS.OK, headers);
      return res.end(JSON.stringify(ok(agnesData)));
    } catch (err) {
      if (err.name === 'AbortError') {
        res.writeHead(STATUS.TIMEOUT, headers);
        return res.end(JSON.stringify(fail('UPSTREAM_TIMEOUT', 'Agnes request timed out. Please retry.', 'Add retry with exponential backoff.')));
      }
      res.writeHead(STATUS.API_ERROR, headers);
      return res.end(JSON.stringify(fail('UPSTREAM_NETWORK', `Network or protocol error: ${err.message || 'unknown'}`)));
    }
  });
  server.listen(PORT, '127.0.0.1', () => console.log(`agnes-proxy local dev server on http://127.0.0.1:${PORT}/agnes-chat`));
}
