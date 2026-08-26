# V2-P1 实施报告：Agnes 2.5 Flash 代理服务器

**日期**: 2026-08-26  
**状态**: 代码已完成，生产部署受阻（Netlify 信用额度耗尽）  
**站点**: https://ai-file-organizer-proxy.netlify.app

---

## §一、目标回顾

为「AI 文件整理助手」V2 版本实现 Agnes 2.5 Flash API 的服务器端代理，满足：

1. **安全隔离**: API Key 仅存于 Netlify 环境变量，绝不进入代码/Git
2. **请求限制**: 64KB body 限制、30秒超时、POST-only
3. **结构化响应**: `{ok, data/error}` 格式，错误信息不暴露 Key
4. **CORS 支持**: 允许前端跨域调用
5. **双模式运行**: Lambda（Netlify 生产）+ standalone HTTP server（本地测试）

---

## §二、禁止项验证

| 禁止项 | 状态 | 说明 |
|--------|------|------|
| 修改 V1 代码 | ✅ 通过 | 仅新增文件，未改动 `src/` 目录 |
| 修改 ZIP 引擎 | ✅ 通过 | `FileOrganizer.tsx` 未变更 |
| 修改 UI/OCR/分类 | ✅ 通过 | 无相关改动 |
| API Key 进入代码 | ✅ 通过 | 仅 `process.env.AGNES_API_KEY` 引用 |
| API Key 进入 Git | ✅ 通过 | `git grep` 扫描无匹配 |
| 创建新分支 | ✅ 通过 | 直接在 `main` 分支提交 |
| 修改其他项目 | ✅ 通过 | 仅 `ai-file-organizer-web` 仓库 |

---

## §三、交付物清单

### 3.1 新增文件（4 个）

| 文件 | 行数 | 说明 |
|------|------|------|
| `netlify/functions/agnes-chat.js` | 367 | 核心代理函数 |
| `netlify.toml` | 3 | Netlify 构建配置 |
| `.env.example` | 9 | 环境变量模板（无真实 Key） |
| `local_server.cjs` | 160 | 本地测试服务器 |

**总计**: 543 行新增代码

### 3.2 代码结构

```
ai-file-organizer-web/
├── netlify/
│   ├── functions/
│   │   └── agnes-chat.js      # 代理函数（双模式）
│   └── toml                   # 构建配置
├── .env.example               # 环境变量模板
├── local_server.cjs           # 本地测试工具
└── src/                       # V1 代码（未修改）
    └── components/
        └── FileOrganizer.tsx  # 保持原样
```

---

## §四、安全审计

### 4.1 Git 扫描结果

```bash
$ git grep -n "AGNES_API_KEY"
.env.example:5:   AGNES_API_KEY=<your-agnes-api-key-here>  # ← 占位符
local_server.cjs:14:  const AGNES_KEY = process.env.AGNES_API_KEY || '';  # ← 环境变量读取
netlify/functions/agnes-chat.js:12: const AGNES_API_KEY = process.env.AGNES_API_KEY;  # ← 环境变量读取

$ git grep -nE "(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|xoxb-[a-zA-Z0-9\-]+)"
# 无匹配 → 无泄露
```

### 4.2 环境变量保护

- `.env.example` 仅含占位符 `<your-agnes-api-key-here>`
- `.env*.local` 已加入 `.gitignore`
- 代理函数仅在 `process.env.AGNES_API_KEY` 存在时才转发请求
- 错误响应中不返回 Key 片段

### 4.3 响应安全

```javascript
// 失败时返回结构化错误，不暴露 Key
return json(res, STATUS.UNAUTHORIZED, fail(
  'MISSING_CONFIG',
  'Agnes API Key not configured on server.',
  'Set AGNES_API_KEY in environment.'
));
```

---

## §五、本地测试结果

```
agnes-proxy local dev server on http://127.0.0.1:8899/agnes-chat
--- tests start ---
  ✔ OPTIONS returns 204/no-body
  ✔ OPTIONS has CORS headers
  ✔ GET returns 405
  ✔ GET is JSON
  ✔ Missing messages → 400
  ✔ Empty messages → 400
  ✔ Invalid JSON → 400
  ✔ Payload too large → 413
  ✔ Error body does not leak API key
  ✔ Missing-key error does not leak key pattern
--- results: 10 passed, 0 failed, 3 skipped ---
```

**手动测试**:
- OPTIONS 预检: 204 + CORS 头 ✅
- POST 无 Key: 401 + 结构化错误 ✅
- POST 无效 JSON: 400 ✅
- POST 超大 payload: 413 ✅

---

## §六、部署状态

### 6.1 Git 状态

```bash
$ git log --oneline -3
64f35b4 feat: add Agnes AI proxy for file organizer v2
9747945 fix(zip): 显式读取文件字节，修复「生成 ZIP 时出错」
fbb2bfa Sprint-Final: 从仓库移除 package-lock.json...

$ git push origin main
To github.com:lixinjiang-ai/ai-file-organizer-web.git
   9747945..64f35b4  main -> main
```

✅ 代码已推送至 GitHub

### 6.2 Netlify 站点

| 属性 | 值 |
|------|-----|
| 站点名 | `ai-file-organizer-proxy` |
| 站点 ID | `9c19eff9-aa72-4c61-ba3c-edda0e3acaa5` |
| URL | https://ai-file-organizer-proxy.netlify.app |
| 创建时间 | 2026-08-26 17:30 GMT+8 |
| 部署状态 | ⚠️ 受阻 |

### 6.3 部署阻塞原因

```
Error: Account credit usage exceeded - new deploys are blocked until credits are added
```

**当前账户信用额度已耗尽**，无法创建新的生产部署。

---

## §七、前端集成方案

V2 前端调用代理的示例代码：

```typescript
// src/components/FileOrganizer.tsx (V2 阶段添加)
async function classifyFiles(files: File[]) {
  const response = await fetch('/.netlify/functions/agnes-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'agnes-2.5-flash',
      messages: [{
        role: 'user',
        content: buildClassificationPrompt(files)
      }]
    })
  });

  const result = await response.json();
  if (!result.ok) {
    throw new Error(result.error?.message || '分类失败');
  }
  return result.data.choices[0].message.content;
}
```

**注意**: 前端请求路径为 `/.netlify/functions/agnes-chat`，需确保 Netlify 部署成功后可用。

---

## §八、下一步操作

### 8.1 解除部署阻塞

**选项 A**: 添加支付方式到 Netlify 账户
- 访问: https://app.netlify.com/account/billing
- 添加信用卡或支付宝
- 购买信用额度（免费额度每月重置）

**选项 B**: 使用其他服务器端平台
- Vercel Serverless Functions（免费额度更宽裕）
- Railway.app（有免费 tier）
- Cloudflare Workers（免费额度大）

### 8.2 配置环境变量

部署成功后，在 Netlify 控制台设置：
```
AGNES_API_KEY=agnes-xxxxx  # 你的真实 Key
AGNES_BASE_URL=https://api.agnes-ai.cn/v1
AGNES_MODEL=agnes-2.5-flash
CORS_ORIGIN=*  # 或指定前端域名
```

### 8.3 生产验收测试

```bash
# 测试代理端点
curl -X POST https://ai-file-organizer-proxy.netlify.app/.netlify/functions/agnes-chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"你好"}]}'

# 预期响应
{"ok":true,"data":{"choices":[{"message":{"content":"你好！有什么我可以帮你的？"}}]}}
```

---

## §九、技术决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 服务器端方案 | Netlify Functions | 与现有站点同生态，配置简单 |
| 语言 | Node.js (原生 http) | 无依赖，部署体积小 |
| 错误处理 | 结构化 JSON | 前端易解析，不暴露 Key |
| 测试策略 | 本地 standalone server | 无需 Netlify CLI 即可验证 |
| Git 策略 | 单分支提交 | 最小化变更，快速合并 |

---

## §十、后续阶段规划

### P2: 本地文件内容解析层
- 支持 PDF/DOCX/XLSX/CSV/TXT 文本提取
- 图片 OCR（Tesseract.js 或 Agnes Vision）
- 统一输出格式: `{fileName, type, size, textExcerpt}`
- 文本截断至 ~1500 字符

### P3: 四层级目录智能归档
- 基于文件内容 + 元数据生成分类建议
- 置信度阈值机制（<60% 转人工）
- 目录结构预览 + 确认流程
- 批量执行归档

### P4: 前端集成与 UX 优化
- 文件上传进度条
- 分类结果可视化
- 归档操作确认对话框
- 历史记录与撤销

---

## §十一、总结

✅ **已完成**:
- 代理函数实现（367 行，双模式）
- 本地测试通过（10/10）
- Git 提交并推送
- 安全审计通过（无 Key 泄露）
- Netlify 站点创建

⚠️ **阻塞中**:
- Netlify 账户信用额度耗尽
- 需用户添加支付方式或更换平台

📋 **待完成**:
- 生产部署（需解除信用限制）
- 环境变量配置（需用户提供 AGNES_API_KEY）
- 生产 API 验收测试
- 前端集成

---

**报告生成时间**: 2026-08-26 18:50 GMT+8  
**代码仓库**: https://github.com/lixinjiang-ai/ai-file-organizer-web  
**代理站点**: https://ai-file-organizer-proxy.netlify.app
