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

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error.' }) };
  }

  const path = event.path.replace('/.netlify/functions/gemini-proxy', '');
  const queryString = event.rawQuery ? `?${event.rawQuery}` : '';
  const url = `https://generativelanguage.googleapis.com${path}${queryString}&key=${GEMINI_API_KEY}`;

  try {
    const response = await fetch(url, {
      method: event.httpMethod,
      headers: {
        'Content-Type': 'application/json',
      },
      body: event.body,
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    };
  } catch (error) {
  console.error('Proxy Error Details:', error.message); //在Netlify日志中记录详细错误
  return {
    statusCode: 500,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ 
      error: 'Proxy Function Error',
      details: error.message,        // 将具体的错误信息返回给客户端
      url: url                        // 返回当时请求的URL，有助于诊断
    }), // <-- 注意，这个右括号后面现在有一个逗号了！
  }; // <-- 这是return语句的结束
} // <-- 这是catch块的结束
