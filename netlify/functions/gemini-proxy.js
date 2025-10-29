// netlify/functions/gemini-proxy.js
exports.handler = async (event, context) => {
  const requestId = generateRequestId();
  const startTime = Date.now();
  
  console.log(`[${requestId}] 收到请求: ${event.httpMethod} ${event.path}`);
  
  // CORS处理
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Max-Age': '86400'
      },
      body: ''
    };
  }

  // 从环境变量获取API密钥
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    console.error(`[${requestId}] GEMINI_API_KEY 未设置`);
    return {
      statusCode: 500,
      headers: { 
        'Access-Control-Allow-Origin': '*', 
        'Content-Type': 'application/json',
        'X-Request-ID': requestId
      },
      body: JSON.stringify({ 
        error: '服务器配置错误',
        requestId: requestId
      })
    };
  }

  try {
    // 构建基础URL
    const apiBaseUrl = 'https://generativelanguage.googleapis.com';
    
    // 更健壮的路径处理
    let apiPath = event.path.replace('/.netlify/functions/gemini-proxy', '');
    
    // 确保路径以 /v1beta 开头
    if (!apiPath.startsWith('/v1beta')) {
      apiPath = '/v1beta' + (apiPath || '/models');
    }

    // 自动映射模型名称
    if (apiPath.includes('gemini-pro') || apiPath.includes('gemini-2.0') || apiPath.includes('gemini-2.5flash')) {
      apiPath = apiPath.replace(/gemini-pro|gemini-2\.0|gemini-2\.5flash|gemini-2\.5-flash-latest/g, 'gemini-2.5-flash');
      console.log(`[${requestId}] 自动映射模型到: gemini-2.5-flash`);
    }

    // 处理查询参数
    const queryParams = new URLSearchParams();
    queryParams.append('key', GEMINI_API_KEY);
    
    // 保留原始查询参数（除了key）
    if (event.rawQuery) {
      const originalParams = new URLSearchParams(event.rawQuery);
      for (const [key, value] of originalParams) {
        if (key !== 'key') {
          queryParams.append(key, value);
        }
      }
    }

    const queryString = queryParams.toString();
    const url = `${apiBaseUrl}${apiPath}${queryString ? `?${queryString}` : ''}`;

    console.log(`[${requestId}] 请求URL: ${url.replace(GEMINI_API_KEY, '***')}`);

    // 准备fetch选项
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const fetchOptions = {
      method: event.httpMethod,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Netlify-Gemini-Proxy/2.5',
        'X-Request-ID': requestId
      },
      signal: controller.signal
    };

    // 处理请求体
    if (event.body && !['GET', 'HEAD'].includes(event.httpMethod)) {
      try {
        const parsedBody = JSON.parse(event.body);
        fetchOptions.body = JSON.stringify(parsedBody);
      } catch (e) {
        console.error(`[${requestId}] 请求体解析错误:`, e.message);
        return {
          statusCode: 400,
          headers: { 
            'Access-Control-Allow-Origin': '*', 
            'Content-Type': 'application/json',
            'X-Request-ID': requestId
          },
          body: JSON.stringify({ 
            error: '无效的请求格式',
            details: e.message,
            requestId: requestId
          })
        };
      }
    }

    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);
    
    const responseTime = Date.now() - startTime;
    console.log(`[${requestId}] Gemini API响应: ${response.status} (${responseTime}ms)`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[${requestId}] Gemini API错误:`, response.status, errorText);
      
      return {
        statusCode: response.status,
        headers: { 
          'Access-Control-Allow-Origin': '*', 
          'Content-Type': 'application/json',
          'X-Request-ID': requestId
        },
        body: JSON.stringify({
          error: `API请求失败: ${response.status}`,
          details: errorText.substring(0, 500),
          requestId: requestId
        })
      };
    }

    const data = await response.json();
    
    // 🔥 关键修复：正确处理 Gemini API 响应格式
    console.log(`[${requestId}] 原始响应数据:`, JSON.stringify(data, null, 2));
    
    let resultData = data;
    
    // 如果是生成内容的响应，安全提取文本
    if (apiPath.includes('generateContent')) {
      resultData = safeExtractContent(data, requestId);
    }
    
    console.log(`[${requestId}] 请求成功: ${resp
