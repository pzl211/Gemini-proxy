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
    
    // 更健壮的路径处理 - 专门适配 gemini-2.5-flash-latest
    let apiPath = event.path.replace('/.netlify/functions/gemini-proxy', '');
    
    // 确保路径以 /v1beta 开头
    if (!apiPath.startsWith('/v1beta')) {
      apiPath = '/v1beta' + (apiPath || '/models');
    }

    // 🔥 关键修复：自动映射所有旧模型名称到正确的 gemini-2.5-flash-latest
    if (apiPath.includes('gemini-pro') || apiPath.includes('gemini-2.0') || apiPath.includes('gemini-2.5flash')) {
      apiPath = apiPath.replace(/gemini-pro|gemini-2\.0|gemini-2\.5flash/g, 'gemini-2.5-flash-latest');
      console.log(`[${requestId}] 自动映射模型到: gemini-2.5-flash-latest`);
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

    // 准备fetch选项 - 使用AbortController实现超时
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
        
        // 为 gemini-2.5-flash-latest 优化请求体
        const optimizedBody = optimizeForGemini25Flash(parsedBody);
        fetchOptions.body = JSON.stringify(optimizedBody);
        
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
      
      // 提供更友好的错误信息
      let userFriendlyError = `API请求失败: ${response.status}`;
      if (response.status === 404) {
        userFriendlyError = '模型未找到，请检查模型名称是否正确';
      } else if (response.status === 400) {
        userFriendlyError = '请求参数错误，请检查模型名称和请求格式';
      }
      
      return {
        statusCode: response.status,
        headers: { 
          'Access-Control-Allow-Origin': '*', 
          'Content-Type': 'application/json',
          'X-Request-ID': requestId
        },
        body: JSON.stringify({
          error: userFriendlyError,
          details: errorText.substring(0, 500),
          requestId: requestId,
          suggestion: '当前使用模型: gemini-2.5-flash-latest'
        })
      };
    }

    const data = await response.json();
    
    console.log(`[${requestId}] 请求成功: ${responseTime}ms`);
    
    return {
      statusCode: 200,
      headers: { 
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'X-Proxy-Version': '2.5',
        'X-Request-ID': requestId,
        'X-Response-Time': `${responseTime}ms`,
        'X-Model-Used': 'gemini-2.5-flash-latest'
      },
      body: JSON.stringify(data)
    };
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error(`[${requestId}] 代理函数错误:`, error.message);
    
    let statusCode = 500;
    let errorMessage = '代理服务器内部错误';
    
    if (error.name === 'AbortError') {
      statusCode = 504;
      errorMessage = '请求超时';
    } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
      statusCode = 502;
      errorMessage = '网络连接错误';
    }
    
    return {
      statusCode: statusCode,
      headers: { 
        'Access-Control-Allow-Origin': '*', 
        'Content-Type': 'application/json',
        'X-Request-ID': requestId
      },
      body: JSON.stringify({ 
        error: errorMessage,
        details: error.message,
        requestId: requestId,
        timestamp: new Date().toISOString(),
        responseTime: `${responseTime}ms`
      })
    };
  }
};

// 生成请求ID
function generateRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 8)}`;
}

// 🔧 为 gemini-2.5-flash-latest 优化请求体
function optimizeForGemini25Flash(body) {
  // 确保使用适合 2.5-flash-latest 模型的参数
  if (body.contents && Array.isArray(body.contents)) {
    console.log('使用 gemini-2.5-flash-latest 模型优化请求');
    
    // 可以在这里添加针对 2.5-flash-latest 的特殊优化
    // 例如设置合适的温度、最大token数等
    if (!body.generationConfig) {
      body.generationConfig = {};
    }
    
    // 为 gemini-2.5-flash-latest 设置合理的默认值
    if (body.generationConfig.temperature === undefined) {
      body.generationConfig.temperature = 0.7;
    }
    
    if (body.generationConfig.maxOutputTokens === undefined) {
      body.generationConfig.maxOutputTokens = 2048;
    }
  }
  return body;
}
