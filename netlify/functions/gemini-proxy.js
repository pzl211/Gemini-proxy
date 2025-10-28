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
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

    const fetchOptions = {
      method: event.httpMethod,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Netlify-Gemini-Proxy/1.0',
        'X-Request-ID': requestId
      },
      signal: controller.signal
    };

    // 处理请求体
    if (event.body && !['GET', 'HEAD'].includes(event.httpMethod)) {
      try {
        // 验证并解析JSON
        const parsedBody = JSON.parse(event.body);
        
        // 🔧 可选：添加请求内容安全检查
        if (isRequestSafe(parsedBody)) {
          fetchOptions.body = JSON.stringify(parsedBody);
        } else {
          throw new Error('请求内容包含潜在安全问题');
        }
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
    
    // 记录成功请求
    console.log(`[${requestId}] 请求完成: ${responseTime}ms`);
    
    return {
      statusCode: 200,
      headers: { 
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'X-Proxy-Version': '1.2',
        'X-Request-ID': requestId,
        'X-Response-Time': `${responseTime}ms`
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

// 🔧 可选：请求安全检查
function isRequestSafe(body) {
  // 检查请求体大小
  const bodySize = JSON.stringify(body).length;
  if (bodySize > 1024 * 1024) { // 1MB限制
    console.warn('请求体过大:', bodySize);
    return false;
  }
  
  // 可以在这里添加更多安全检查
  // 例如：检查prompt长度、内容等
  
  return true;
}
