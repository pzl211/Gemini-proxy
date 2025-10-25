// netlify/functions/gemini-proxy.js
exports.handler = async (event, context) => {
  // 处理 CORS (跨域资源共享)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
      },
      body: ''
    };
  }

  // 从环境变量读取 API 密钥
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'GEMINI_API_KEY is not set.' })
    };
  }

  // 构建请求到 Gemini API 的 URL
  const path = event.path.replace('/.netlify/functions/gemini-proxy', '');
  const queryString = event.rawQuery ? `?${event.rawQuery}` : '';
  const url = `https://generativelanguage.googleapis.com${path}${queryString}&key=${GEMINI_API_KEY}`;

  console.log('Proxying request to:', url); // 帮助调试的日志

  try {
    const response = await fetch(url, {
      method: event.httpMethod,
      headers: { 'Content-Type': 'application/json' },
      body: event.body
    });

    if (!response.ok) {
      // 如果 Gemini API 返回错误，直接返回错误状态和消息
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: `Gemini API error: ${response.status}` })
      };
    }

    const data = await response.json();
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch (error) {
    // 简单的错误处理，避免复杂结构导致语法错误
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
