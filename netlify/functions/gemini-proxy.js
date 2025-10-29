// netlify/functions/gemini-proxy.js
/**
 * Gemini 2.5 Flash 反向代理（Netlify Function）
 * 用法：把任何 Gemini REST 路径挂到
 * https://你的域名/.netlify/functions/gemini-proxy/...
 * 例如
 * POST /.netlify/functions/gemini-proxy/v1beta/models/gemini-2.5-flash:generateContent
 */

/* ---------- 小工具 ---------- */
const generateRequestId = () =>
  Math.random().toString(36).slice(2) + Date.now().toString(36);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400'
};

/* ---------- 主入口 ---------- */
exports.handler = async (event, context) => {
  const requestId = generateRequestId();
  const start = Date.now();

  console.log(`[${requestId}] ↓ ${event.httpMethod} ${event.path}`);

  /* 1. 预检请求直接返回 */
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  /* 2. 检查密钥 */
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    console.error(`[${requestId}] GEMINI_API_KEY 未配置`);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: '服务器配置错误', requestId })
    };
  }

  /* 3. 拼装目标 URL */
  const upstreamBase = 'https://generativelanguage.googleapis.com';
  let path = event.path.replace(/^\/\.netlify\/functions\/gemini-proxy/, '');

  // 必须以 /v1beta 开头
  if (!path.startsWith('/v1beta')) path = '/v1beta' + (path || '/models');

  // 模型别名统一映射到官方最新名
  path = path.replace(
    /gemini-pro|gemini-2\.0-pro|gemini-2\.5-flash-latest/g,
    'gemini-2.5-flash'
  );

  const qs = new URLSearchParams(event.rawQuery || '');
  qs.set('key', GEMINI_API_KEY);          // 强制使用服务端密钥
  const targetUrl = `${upstreamBase}${path}?${qs.toString()}`;

  console.log(`[${requestId}] → ${targetUrl.replace(GEMINI_API_KEY, '***')}`);

  /* 4. 准备发给 Google 的请求 */
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  const fetchOpts = {
    method: event.httpMethod,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Netlify-Gemini-Proxy/2.5',
      'X-Request-ID': requestId
    },
    signal: controller.signal
  };

  // 带 body 的非 GET/HEAD 请求
  if (event.body && !['GET', 'HEAD'].includes(event.httpMethod)) {
    fetchOpts.body = event.body;
  }

  /* 5. 发起代理请求 */
  try {
    const res = await fetch(targetUrl, fetchOpts);
    clearTimeout(timeout);

    const bodyText = await res.text();

    // 把 Google 的响应原样返回（含 4xx/5xx）
    return {
      statusCode: res.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': res.headers.get('content-type') || 'application/json'
      },
      body: bodyText
    };
  } catch (err) {
    clearTimeout(timeout);
    console.error(`[${requestId}] 代理失败:`, err);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: '代理请求失败', requestId })
    };
  }
};
