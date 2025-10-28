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
      headers: { 
        'Access-Control-Allow-Origin': '*', 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ error: 'GEMINI_API_KEY is not set.' })
    };
  }

  // 使用新的 API 基础地址 [3](@ref)
  const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  
  // 修正路径处理，确保指向正确的 API 版本
  let apiPath = event.path.replace('/.netlify/functions/gemini-proxy', '');
  if (!apiPath.startsWith('/v1beta')) {
    apiPath = '/v1beta' + (apiPath || '/models');
  }
  
  const queryString = event.rawQuery ? `?${event.rawQuery}` : '';
  const url = `${baseUrl}${apiPath}${queryString}&key=${GEMINI_API_KEY}`;

  console.log('Proxying request to:', url);

  try {
    // 准备 fetch 选项
    const fetchOptions = {
      method: event.httpMethod,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    // 只有非 GET/HEAD 请求且有 body 时才添加 body
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD' && event.body) {
      fetchOptions.body = event.body;
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    return {
      statusCode: 200,
      headers: { 
        'Access-Control-Allow-Origin': '*', 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify(data)
    };
  } catch (error) {
    console.error('Proxy error:', error);
    
    return {
      statusCode: 500,
      headers: { 
        'Access-Control-Allow-Origin': '*', 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ 
        error: 'Proxy Function Error',
        details: error.message
      })
    };
  }
};
