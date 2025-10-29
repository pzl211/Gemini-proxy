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

    // 🔥 关键修复：使用正确的模型名称 gemini-2.5-flash
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
    
    // 🔥 关键修复：安全地处理响应数据，避免 Cannot read properties of undefined
    console.log(`[${requestId}] 原始响应数据:`, JSON.stringify(data, null, 2));
    
    let resultData = data;
    
    // 如果是生成内容的响应，安全提取文本
    if (apiPath.includes('generateContent')) {
      resultData = safeExtractContent(data, requestId);
    }
    
    console.log(`[${requestId}] 请求成功: ${responseTime}ms`);
    
    return {
      statusCode: 200,
      headers: { 
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'X-Proxy-Version': '2.5',
        'X-Request-ID': requestId,
        'X-Response-Time': `${responseTime}ms`,
        'X-Model-Used': 'gemini-2.5-flash'
      },
      body: JSON.stringify(resultData)
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

// 🔥 关键修复：安全地提取内容，避免 Cannot read properties of undefined (reading '0') 错误
function safeExtractContent(data, requestId) {
  try {
    console.log(`[${requestId}] 开始安全提取内容`);
    
    // 检查数据结构是否存在
    if (!data) {
      console.warn(`[${requestId}] 响应数据为空`);
      return {
        success: false,
        error: 'API返回空响应',
        rawData: data
      };
    }
    
    // 检查是否有错误信息
    if (data.error) {
      console.warn(`[${requestId}] API返回错误:`, data.error);
      return {
        success: false,
        error: data.error.message || 'API返回错误',
        rawData: data
      };
    }
    
    // 安全地检查 candidates 数组 - 这是导致错误的根源！
    if (!data.candidates || !Array.isArray(data.candidates) || data.candidates.length === 0) {
      console.warn(`[${requestId}] 无有效candidates数据`);
      return {
        success: false,
        error: 'API响应格式异常：无candidates数据',
        rawData: data
      };
    }
    
    const candidate = data.candidates[0];
    
    // 安全地检查 content
    if (!candidate || !candidate.content) {
      console.warn(`[${requestId}] candidate或content为空`);
      return {
        success: false,
        error: 'API响应格式异常：candidate内容为空',
        rawData: data
      };
    }
    
    // 安全地检查 parts
    if (!candidate.content.parts || !Array.isArray(candidate.content.parts) || candidate.content.parts.length === 0) {
      console.warn(`[${requestId}] parts数据异常`);
      return {
        success: false,
        error: 'API响应格式异常：无parts数据',
        rawData: data
      };
    }
    
    const part = candidate.content.parts[0];
    
    // 安全地检查 text
    if (!part || part.text === undefined || part.text === null) {
      console.warn(`[${requestId}] text内容为空`);
      return {
        success: false,
        error: 'API响应格式异常：无text内容',
        rawData: data
      };
    }
    
    // 成功提取内容
    console.log(`[${requestId}] 成功提取文本内容，长度: ${part.text.length}`);
    
    return {
      success: true,
      text: part.text,
      fullResponse: data,
      usageMetadata: data.usageMetadata || null
    };
    
  } catch (error) {
    console.error(`[${requestId}] 内容提取错误:`, error.message);
    return {
      success: false,
      error: `内容提取失败: ${error.message}`,
      rawData: data,
      stack: error.stack
    };
  }
}
