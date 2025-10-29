async function handleApiRequest(requestBody, apiPath) {
  const requestId = generateRequestId();
  const startTime = Date.now();
  
  try {
    // 创建AbortController用于超时控制
    const controller = new AbortController();
    const timeout = 10000;
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

    // 正确处理日志输出
    console.log(`[${requestId}] 请求成功 (${responseTime}ms)`);
    
    return {
      statusCode: 200,
      headers: { 
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'X-Request-ID': requestId
      },
      body: JSON.stringify(data)
    };
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error(`[${requestId}] 请求失败 (${responseTime}ms): ${error.message}`);
    
    return {
      statusCode: error.name === 'AbortError' ? 504 : 500,
      headers: { 
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'X-Request-ID': requestId
      },
      body: JSON.stringify({
        error: error.name === 'AbortError' ? '请求超时' : '服务器内部错误',
        message: error.message,
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
