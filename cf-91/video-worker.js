addEventListener('fetch', event => {
  event.respondWith(handle(event.request));
});

async function handle(req) {
  const url = new URL(req.url);

  // v.xxx.com/cdn.xvideos.com/xxxx.mp4
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) {
    return new Response('Bad video path', { status: 400 });
  }

  const targetHost = parts.shift();
  const targetPath = '/' + parts.join('/');

  const targetUrl = `https://${targetHost}${targetPath}${url.search}`;

  const headers = new Headers(req.headers);
  headers.set('Host', targetHost);
  
  // ⚠️ Referer 增强
  let referer = `https://${targetHost}/`;
  if (targetHost.includes('phncdn') || targetHost.includes('pornhub')) {
    referer = 'https://www.pornhub.com/';
  } else if (targetHost.includes('xvideos')) {
    referer = 'https://www.xvideos.com/';
  }
  headers.set('Referer', referer);
  // Origin 也是个好习惯，虽然 GET 请求通常不强制
  if (targetHost.includes('phncdn') || targetHost.includes('pornhub')) {
    headers.set('Origin', 'https://www.pornhub.com');
  } else if (targetHost.includes('xvideos')) {
    headers.set('Origin', 'https://www.xvideos.com');
  }

  // ⚠️ Range 是生命线 & 防刷保护
  // 限制单次请求最大 20MB，防止恶意刷流量
  const MAX_CHUNK_SIZE = 20 * 1024 * 1024; 
  let range = req.headers.get('Range');
  
  if (range) {
    const parts = range.match(/bytes=(\d+)-(\d*)/);
    if (parts) {
      let start = parseInt(parts[1], 10);
      let end = parts[2] ? parseInt(parts[2], 10) : null;
      
      // 如果没有结束位置，或者请求范围过大，强制限制
      if (!end || (end - start + 1) > MAX_CHUNK_SIZE) {
        end = start + MAX_CHUNK_SIZE - 1;
        range = `bytes=${start}-${end}`;
      }
    }
    headers.set('Range', range);
  }

  const response = await fetch(targetUrl, {
    method: req.method,
    headers
  });

  // ⚠️ 3️⃣ m3u8 处理：ts 不进 Worker
  // 如果是 m3u8，我们需要重写其中的 ts 路径为绝对路径（指向源站），
  // 这样客户端会直接请求源站，不消耗 Worker 流量。
  // 🟡 支持 ?force_worker=1 参数跳过此优化 (用于客户端降级)
  const shouldForceWorker = url.searchParams.get('force_worker') === '1';
  const contentType = response.headers.get('Content-Type');
  
  // 📊 可观测性: 添加 X-Proxy-Source 头
  const finalHeaders = new Headers(response.headers);
  finalHeaders.set('X-Proxy-Source', 'worker');

  if (!shouldForceWorker && response.status === 200 && 
      (targetUrl.endsWith('.m3u8') || 
       (contentType && (contentType.includes('application/vnd.apple.mpegurl') || contentType.includes('application/x-mpegurl'))))) {
    
    let text = await response.text();
    
    // 获取 m3u8 的基础路径 (用于拼接相对路径)
    // targetPath 如 /path/to/video.mp4 (虽然 m3u8 不会是 mp4 结尾)
    // 假设 targetUrl 是 https://cdn.example.com/videos/hls/index.m3u8
    // baseUrl 应该是 https://cdn.example.com/videos/hls/
    const baseUrl = `https://${targetHost}${targetPath.substring(0, targetPath.lastIndexOf('/') + 1)}`;
    
    // 替换所有非注释且非 http 开头的行 (即相对路径的 ts 片段)
    text = text.replace(/^(?!#)(?!(http|https):\/\/)(.+)$/gm, (match) => {
       return `${baseUrl}${match}`;
    });

    return new Response(text, {
      status: response.status,
      headers: finalHeaders
    });
  }

  return new Response(response.body, {
    status: response.status,
    headers: finalHeaders
  });
}
