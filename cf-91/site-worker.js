// 视频模式配置 (优先使用环境变量，否则使用默认值)
// 在 Cloudflare Dashboard -> Settings -> Variables 中设置 VIDEO_MODE
// direct: 官方直连 (最低成本)
// cdn: 外部反代/EdgeOne (主力模式, 推荐)
// worker: Worker 兜底 (救急用)
let VIDEO_MODE = 'direct'; 
if (typeof globalThis.VIDEO_MODE !== 'undefined') {
  VIDEO_MODE = globalThis.VIDEO_MODE;
} else if (typeof VIDEO_MODE !== 'undefined') {
  // 兼容某些环境
}
// 默认回退
if (!['direct', 'cdn', 'worker', 'external'].includes(VIDEO_MODE)) {
  VIDEO_MODE = 'direct';
}

// 视频网站域名表
const video_domains = [
  'cdn.xvideos.com',
  'img-hw.xvideos-cdn.com',
  'phncdn.com',
  'cv.phncdn.com',
  'ev.phncdn.com'
];

// 域名映射配置 (请根据实际情况修改)
const domain_mappings = {
  // Pornhub Domains
  'pornhub.com': 'ph.',
  'www.pornhub.com': 'www-pornhub-com-',
  'phncdn.com': 'phncdn-com-',
  'ci.phncdn.com': 'ci-phncdn-com-',
  'di.phncdn.com': 'di-phncdn-com-',
  'ei.phncdn.com': 'ei-phncdn-com-',
  'es.phncdn.com': 'es-phncdn-com-',
  
  // Xvideos Domains
  'xvideos.com': 'xv.',
  'www.xvideos.com': 'www-xvideos-com-',
  'cdn.xvideos.com': 'cdn-xvideos-com-',
  'xvideos-cdn.com': 'xvideos-cdn-com-',
  'static-hw.xvideos-cdn.com': 'static-hw-xvideos-cdn-com-',
  'img-hw.xvideos-cdn.com': 'img-hw-xvideos-cdn-com-',
  'video-hw.xvideos-cdn.com': 'video-hw-xvideos-cdn-com-',
  'v-static.xvideos-cdn.com': 'v-static-xvideos-cdn-com-',

  // Github (Legacy - Optional)
  'github.com': 'gh.',
  'avatars.githubusercontent.com': 'avatars-githubusercontent-com-',
  'github.githubassets.com': 'github-githubassets-com-',
  'collector.github.com': 'collector-github-com-',
  'api.github.com': 'api-github-com-',
  'raw.githubusercontent.com': 'raw-githubusercontent-com-',
  'gist.githubusercontent.com': 'gist-githubusercontent-com-',
  'github.io': 'github-io-',
  'assets-cdn.github.com': 'assets-cdn-github-com-',
  'cdn.jsdelivr.net': 'cdn.jsdelivr-net-',
  'securitylab.github.com': 'securitylab-github-com-',
  'www.githubstatus.com': 'www-githubstatus-com-',
  'npmjs.com': 'npmjs-com-',
  'git-lfs.github.com': 'git-lfs-github-com-',
  'githubusercontent.com': 'githubusercontent-com-',
  'github.global.ssl.fastly.net': 'github-global-ssl-fastly-net-',
  'api.npms.io': 'api-npms-io-',
  'github.community': 'github-community-'
};

// 需要重定向的路径
const redirect_paths = ['/', '/login', '/signup', '/copilot'];

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));    
});

async function handleRequest(request) {
  const url = new URL(request.url);
  
  // 3️⃣ site-worker 必须绕过视频请求
  if (url.hostname.startsWith('v.')) {
    return fetch(request);
  }

  // 统一转小写
  const current_host = url.host.toLowerCase();        
  const host_header = request.headers.get('Host');    
  const effective_host = (host_header || current_host).toLowerCase();

  // 特殊路径 /peroe 允许访问
  let is_peroe = false;
  if (url.pathname === '/peroe') {
    // 重写路径为根路径以便正常处理
    url.pathname = '/';
    is_peroe = true;
  }

  // 检查特殊路径重定向
  if (!is_peroe && redirect_paths.includes(url.pathname)) {        
    return Response.redirect('https://www.gov.cn', 302);
  }

  // 强制使用 HTTPS
  if (url.protocol === 'http:') {
    url.protocol = 'https:';
    return Response.redirect(url.href);
  }

  // 从有效主机名中提取前缀
  const host_prefix = getProxyPrefix(effective_host); 
  if (!host_prefix) {
    return new Response(`Domain not configured for proxy. Host: ${effective_host}, Prefix check failed`, { status: 404 });
  }

  // 根据前缀找到对应的原始域名
  let target_host = null;

  // 解析 *-gh. 模式
  if (host_prefix && host_prefix.endsWith('-gh.')) {  
    const prefix_part = host_prefix.slice(0, -4); //  移除 -gh.
    // 尝试找到对应的原始域名
    for (const original of Object.keys(domain_mappings)) {
      const normalized_original = original.trim().toLowerCase();
      if (normalized_original.replace(/\./g, '-') === prefix_part) {
        target_host = original;
        break;
      }
    }
  }

  if (!target_host) {
    // 再次检查 github.com 的情况，防止漏网
    if (host_prefix === 'gh.') {
        target_host = 'github.com';
    } else if (host_prefix === 'ph.') {
        target_host = 'pornhub.com';
    } else if (host_prefix === 'xv.') {
        target_host = 'xvideos.com';
    } else {
        return new Response(`Domain not configured for proxy. Host: ${effective_host}, Prefix: ${host_prefix}, Target lookup failed`, { status: 404 });
    }
  }

  // 直接使用正则表达式处理最常见的嵌套URL问题        
  let pathname = url.pathname;

  // 修复特定的嵌套URL模式 - 直接移除嵌套URL部分      
  // 匹配 /xxx/xxx/latest-commit/main/https%3A//gh.xxx.xxx/ 或 /xxx/xxx/tree-commit-info/main/https%3A//gh.xxx.xxx/
  pathname = pathname.replace(/(\/[^\/]+\/[^\/]+\/(?:latest-commit|tree-commit-info)\/[^\/]+)\/https%3A\/\/[^\/]+\/.*/, '$1');

  // 同样处理非编码版本
  pathname = pathname.replace(/(\/[^\/]+\/[^\/]+\/(?:latest-commit|tree-commit-info)\/[^\/]+)\/https:\/\/[^\/]+\/.*/, '$1');

  // 构建新的请求URL
  const new_url = new URL(url);
  new_url.host = target_host;
  new_url.pathname = pathname;
  new_url.protocol = 'https:';

  // 设置新的请求头
  const new_headers = new Headers(request.headers);   
  new_headers.set('Host', target_host);
  new_headers.set('Referer', new_url.href);

  try {
    // 发起请求
    const response = await fetch(new_url.href, {      
      method: request.method,
      headers: new_headers,
      body: request.method !== 'GET' ? request.body : undefined
    });

    // 克隆响应以便处理内容
    const response_clone = response.clone();

    // 设置新的响应头
    const new_response_headers = new Headers(response.headers);
    new_response_headers.set('access-control-allow-origin', '*');
    new_response_headers.set('access-control-allow-credentials', 'true');
    new_response_headers.set('cache-control', 'public, max-age=14400');
    new_response_headers.delete('content-security-policy');
    new_response_headers.delete('content-security-policy-report-only');
    new_response_headers.delete('clear-site-data');   

    // 处理响应内容，替换域名引用，使用有效主机名来决 定域名后缀
    const modified_body = await modifyResponse(response_clone, host_prefix, effective_host);

    const final_response = new Response(modified_body, {
      status: response.status,
      headers: new_response_headers
    });
    // 📊 可观测性: 添加 X-Video-Mode 头
    final_response.headers.set('X-Video-Mode', VIDEO_MODE);
    
    return final_response;
  } catch (err) {
    return new Response(`Proxy Error: ${err.message}`, { status: 502 });
  }
}

// 获取当前主机名的前缀，用于匹配反向映射
function getProxyPrefix(host) {
  // 检查是否正好是 gh. 开头（对应 github.com）       
  if (host.startsWith('gh.') || host.startsWith('ph.') || host.startsWith('xv.')) {
    return host.substring(0, 3);
  }

  // 检查 *-gh. 模式
  const ghMatch = host.match(/^([a-z0-9-]+-gh\.)/);   
  if (ghMatch) {
    return ghMatch[1];
  }

  return null;
}

// 获取视频URL
function getVideoURL(originUrl, effective_hostname, host_prefix) {
  if (VIDEO_MODE === 'direct') {
    return originUrl;
  }

  if (VIDEO_MODE === 'external') {
    return `https://proxy.example.com/${originUrl.hostname}${originUrl.pathname}`;
  }

  // 动态构建视频 Worker 域名 (假设为 v. + 域名后缀)
  // host_prefix 如 "gh."
  // effective_hostname 如 "gh.example.com"
  // domain_suffix 为 "example.com"
  const domain_suffix = effective_hostname.substring(host_prefix.length);
  // 去掉开头的点 (如果 domain_suffix 是 .example.com)
  const base_domain = domain_suffix.startsWith('.') ? domain_suffix.substring(1) : domain_suffix;
  
  const video_host = `v.${base_domain}`;
  
  if (VIDEO_MODE === 'cdn') {
    // 模式 B: 外部反代/EdgeOne (主力)
    // 逻辑: v.example.com/original-host/path?token=xxx
    // EdgeOne 只需配置回源规则，不做任何内容修改
    return `https://${video_host}/${originUrl.hostname}${originUrl.pathname}`;
  }
  
  // 模式 C: Worker 兜底
  // 格式: https://v.xxx.com/cdn.xvideos.com/video.mp4?token=...
  // 注意: originUrl.pathname 在这里已经包含了 query string (如果有的话)
  // 因为在正则替换时，捕获组 ([^"'\\s]*) 包含了路径和参数
  return `https://${video_host}/${originUrl.hostname}${originUrl.pathname}`;
}

async function modifyResponse(response, host_prefix, effective_hostname) {
  // 只处理文本内容
  const content_type = response.headers.get('content-type') || '';
  if (!content_type.includes('text/') && !content_type.includes('application/json') &&
      !content_type.includes('application/javascript') && !content_type.includes('application/xml')) {      
    return response.body;
  }

  let text = await response.text();

  // 使用有效主机名获取域名后缀部分（用于构建完整的代 理域名）
  const domain_suffix = effective_hostname.substring(host_prefix.length);

  // 2️⃣ modifyResponse：只改 URL，不代理视频
  for (const vd of video_domains) {
    const escaped = vd.replace(/\./g, '\\.');
    
    // 替换 https://video.domain.com/...
    text = text.replace(
      new RegExp(`https?://${escaped}([^"'\\s]*)`, 'g'),
      (match, path) => {
         // 构建原始 URL 对象
         const originUrl = {
             hostname: vd,
             pathname: path
         };
         return getVideoURL(originUrl, effective_hostname, host_prefix);
      }
    );
  }

  // 替换所有域名引用
  for (const [original_domain, _] of Object.entries(domain_mappings)) {
    const escaped_domain = original_domain.replace(/\./g, '\\.');

    // 强制把所有域名的前缀都改成 *-gh. 格式
    let current_prefix = original_domain.replace(/\./g, '-') + '-gh.';

    // 特殊处理主域名
    if (original_domain === 'github.com') {
      current_prefix = 'gh.';
    } else if (original_domain === 'pornhub.com') {
      current_prefix = 'ph.';
    } else if (original_domain === 'xvideos.com') {
      current_prefix = 'xv.';
    }

    const full_proxy_domain = `${current_prefix}${domain_suffix}`;

    // 替换完整URLs
    text = text.replace(
      new RegExp(`https?://${escaped_domain}(?=/|"|'|\\s|$)`, 'g'),
      `https://${full_proxy_domain}`
    );

    // 替换协议相对URLs
    text = text.replace(
      new RegExp(`//${escaped_domain}(?=/|"|'|\\s|$)`, 'g'),
      `//${full_proxy_domain}`
    );
  }

  return text;
}
