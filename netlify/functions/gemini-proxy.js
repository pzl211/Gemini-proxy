async function handleGeminiRequest(requestBody, apiPath, timeout = 10000) {
  const requestId = generateRequestId();
  const startTime = Date.now();
  
  try {
    // 创建AbortController用于超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    // 发送API请求
    const response = await fetch(apiPath, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': requestId
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    // 检查响应状态
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    // 解析响应数据
    const data = await response.json();
    const responseTime = Date.now() - startTime;
    
    // 处理不同类型的API响应
    let resultData = data;
    if (apiPath.includes('generateContent')) {
      resultData = safeExtractContent(data, requestId);
    }
    
    console.log(`[${requestId}] 请求成功: ${responseTime}ms`);
    
    return {
      statusCode: 200,
      headers: { 
        'Access-Control-Allow-Origin': '*', 
        'Content-Type': 'application/json',
        'X-Request-ID': requestId
      },
      body: JSON.stringify(resultData)
    };
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error(`[${requestId}] 请求异常:`, error.message);
    
    // 处理不同类型的错误
    if (error.name === 'AbortError') {
      return {
        statusCode: 504,
        headers: { 
          'Access-Control-Allow-Origin': '*', 
          'Content-Type': 'application/json',
          'X-Request-ID': requestId
        },
        body: JSON.stringify({ 
          error: '请求超时',
          requestId: requestId
        })
      };
    }
    
    return {
      statusCode: 500,
      headers: { 
        'Access-Control-Allow-Origin': '*', 
        'Content-Type': 'application/json',
        'X-Request-ID': requestId
      },
      body: JSON.stringify({ 
        error: '服务器内部错误',
        details: error.message,
        requestId: requestId
      })
    };
  }
}

// 辅助函数：生成唯一请求ID
function generateRequestId() {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

// 辅助函数：安全提取API响应内容
function safeExtractContent(data, requestId) {
  try {
    if (data.candidates && data.candidates.length > 0) {
      return {
        ...data,
        extractedContent: data.candidates[0].content
      };
    }
    return data;
  } catch (error) {
    console.error(`[${requestId}] 内容提取错误:`, error.message);
    return data;
  }
}
