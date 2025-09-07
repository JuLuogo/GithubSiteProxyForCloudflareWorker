# 1Panel GitHub 全站反向代理配置指南

本文档详细介绍如何使用 1Panel 的 OpenResty 环境搭建 GitHub 全站反向代理，实现与 Cloudflare Worker 相同的功能。

## 目录

- [准备工作](#准备工作)
- [创建网站](#创建网站)
- [配置SSL](#配置ssl)
- [核心配置](#核心配置)
- [测试验证](#测试验证)
- [故障排除](#故障排除)
- [维护说明](#维护说明)

## 准备工作

### 域名配置

1. **主域名准备**
   - 确保拥有一个主域名，例如：`your-domain.com`
   - 将在此基础上创建各种子域名进行代理

2. **DNS 解析设置**
   ```
   类型: A记录 (通配符)
   主机记录: *
   记录值: 您的服务器IP地址
   TTL: 600
   ```
   
   这样配置后，所有 `*.your-domain.com` 的子域名都会指向您的服务器。

### SSL 证书申请

1. 登录 1Panel 管理面板
2. 进入「证书管理」
3. 点击「申请证书」
4. 选择「Let's Encrypt」
5. 域名填写：`*.your-domain.com`
6. 验证方式选择「DNS验证」
7. 根据提示在DNS服务商处添加TXT记录
8. 完成验证并获取通配符证书

## 创建网站

### 步骤说明

1. **创建静态网站**
   - 进入 1Panel → 「网站」→ 「创建网站」
   - 选择「静态网站」类型
   - 主域名填写：`proxy.your-domain.com`（这只是占位符）
   - 点击「确认」创建

2. **基础设置**
   - 网站创建成功后会自动生成基础配置
   - 后续我们会完全替换这些配置

## 配置SSL

### SSL 绑定步骤

1. 在网站列表中找到 `proxy.your-domain.com`
2. 点击右侧的「设置」按钮
3. 进入「SSL」标签页
4. 在「选择证书」下拉菜单中选择之前申请的 `*.your-domain.com` 证书
5. 勾选「强制 HTTPS」选项
6. 点击「保存」

## 核心配置

### 第一部分：全局 Lua 配置

需要修改 OpenResty 的主配置文件来添加全局设置。

**文件路径：** `/opt/1panel/apps/openresty/openresty/conf/nginx.conf`

**操作步骤：**
1. 1Panel 左侧菜单：「主机」→「文件」
2. 导航到上述路径
3. 双击打开 `nginx.conf` 文件
4. 找到 `http { ... }` 代码块
5. 在 `http` 块内部，所有 `include` 指令的上方添加以下代码：

```nginx
# =================== START: GitHub代理全局配置 ===================
# 定义域名映射关系的 Lua 共享字典
lua_shared_dict domain_mappings 1m;

# 在 Nginx 启动时初始化共享字典
init_worker_by_lua_block {
    if ngx.worker.id() == 0 then
        local shared_dict = ngx.shared.domain_mappings
        local mappings = {
            -- GitHub 主要域名
            ['git.'] = 'github.com',
            ['www-github-com.'] = 'www.github.com',
            
            -- GitHub 静态资源域名
            ['avatars-githubusercontent-com.'] = 'avatars.githubusercontent.com',
            ['github-githubassets-com.'] = 'github.githubassets.com',
            ['assets-cdn-github-com.'] = 'assets-cdn.github.com',
            ['githubusercontent-com.'] = 'githubusercontent.com',
            ['raw-githubusercontent-com.'] = 'raw.githubusercontent.com',
            ['gist-githubusercontent-com.'] = 'gist.githubusercontent.com',
            ['github-global-ssl-fastly-net.'] = 'github.global.ssl.fastly.net',
            
            -- GitHub API 和服务域名
            ['api-github-com.'] = 'api.github.com',
            ['collector-github-com.'] = 'collector.github.com',
            ['git-lfs-github-com.'] = 'git-lfs.github.com',
            
            -- GitHub 相关服务
            ['github-io.'] = 'github.io',
            ['securitylab-github-com.'] = 'securitylab.github.com',
            ['www-githubstatus-com.'] = 'www.githubstatus.com',
            ['github-community.'] = 'github.community',
            
            -- NPM 和 CDN 相关
            ['npmjs-com.'] = 'npmjs.com',
            ['cdn-jsdelivr-net.'] = 'cdn.jsdelivr.net',
            ['api-npms-io.'] = 'api.npms.io'
        }
        
        -- 将映射关系存储到共享字典中
        for prefix, original_domain in pairs(mappings) do
            shared_dict:set(prefix, original_domain)
        end
        
        ngx.log(ngx.INFO, "GitHub代理域名映射初始化完成，共 " .. #mappings .. " 个映射")
    end
}
# ==================== END: GitHub代理全局配置 ====================
```

6. 保存文件

### 第二部分：网站 Server 配置

**操作步骤：**
1. 回到「网站」列表
2. 点击 `proxy.your-domain.com` 的「设置」
3. 进入「配置文件」标签页
4. **清空所有现有内容**
5. 粘贴以下完整配置（**记得将 `your-domain.com` 替换为您的实际域名**）：

```nginx
# 使用正则表达式匹配所有子域名
# 捕获子域名部分用于后续处理
server_name ~^(?<subdomain>.+)\.your-domain\.com$;

# 根路径访问控制 - 返回404避免直接访问
location = / {
    return 404 "Access Forbidden";
}

# 特殊路径 /peroe 允许访问（管理入口）
location = /peroe {
    access_by_lua_block {
        -- 将路径重写为根路径以便正常处理
        ngx.var.uri = "/"
    }
}

# 主要的代理逻辑处理
location / {
    # 设置客户端请求体大小限制
    client_max_body_size 100m;
    
    access_by_lua_block {
        -- 1. 获取域名映射共享字典
        local shared_dict = ngx.shared.domain_mappings
        if not shared_dict then
            ngx.log(ngx.ERR, "域名映射共享字典未初始化")
            ngx.status = 500
            ngx.say("Internal Server Error: 共享字典未初始化")
            ngx.exit(500)
        end
        
        -- 2. 解析当前请求的域名信息
        local current_host = ngx.var.host
        local subdomain = ngx.var.subdomain
        
        if not subdomain or subdomain == "" then
            ngx.log(ngx.ERR, "无法解析子域名: " .. (current_host or "unknown"))
            ngx.status = 404
            ngx.say("Domain not configured for proxy")
            ngx.exit(404)
        end
        
        -- 3. 提取域名后缀（用于构建完整的代理域名）
        local domain_suffix = string.match(current_host, subdomain .. "%.(.+)")
        if not domain_suffix then
            ngx.log(ngx.ERR, "无法提取域名后缀: " .. current_host)
            ngx.status = 404
            ngx.say("Invalid domain format")
            ngx.exit(404)
        end
        
        -- 4. 查找对应的原始域名
        local target_host = nil
        local matched_prefix = nil
        
        -- 遍历所有映射关系寻找匹配
        for prefix, original_domain in shared_dict:pairs() do
            -- 检查子域名是否以某个前缀开头
            if string.find(subdomain .. ".", "^" .. string.gsub(prefix, "%.", "\\."))) then
                target_host = original_domain
                matched_prefix = prefix
                break
            end
        end
        
        if not target_host then
            ngx.log(ngx.ERR, "未找到域名映射: " .. subdomain)
            ngx.status = 404
            ngx.say("Domain not configured for proxy: " .. subdomain)
            ngx.exit(404)
        end
        
        ngx.log(ngx.INFO, "域名映射: " .. current_host .. " -> " .. target_host)
        
        -- 5. 检查特殊路径重定向
        local redirect_paths = {"/login", "/signup", "/copilot"}
        for _, path in ipairs(redirect_paths) do
            if ngx.var.uri == path then
                ngx.log(ngx.INFO, "重定向特殊路径: " .. path)
                ngx.redirect("https://www.gov.cn", 302)
                return
            end
        end
        
        -- 6. 处理嵌套URL问题（修复GitHub特定的URL嵌套问题）
        local uri = ngx.var.uri
        local original_uri = uri
        
        -- 修复特定的嵌套URL模式
        uri = ngx.re.gsub(uri, "(/[^/]+/[^/]+/(?:latest-commit|tree-commit-info)/[^/]+)/https%3A//[^/]+/.*", "$1", "i")
        uri = ngx.re.gsub(uri, "(/[^/]+/[^/]+/(?:latest-commit|tree-commit-info)/[^/]+)/https://[^/]+/.*", "$1", "i")
        
        if uri ~= original_uri then
            ngx.log(ngx.INFO, "URL重写: " .. original_uri .. " -> " .. uri)
        end
        
        -- 7. 构建完整的代理URL
        local proxy_url = "https://" .. target_host .. uri
        if ngx.var.args then
            proxy_url = proxy_url .. "?" .. ngx.var.args
        end
        
        ngx.log(ngx.INFO, "代理请求: " .. proxy_url)
        
        -- 8. 发起内部代理请求
        local res = ngx.location.capture(
            "/internal_proxy",
            {
                method = ngx.var.request_method,
                body = ngx.var.request_body,
                args = {
                    proxy_target_url = proxy_url,
                    proxy_target_host = target_host
                },
                vars = {
                    proxy_target_url = proxy_url,
                    proxy_target_host = target_host
                }
            }
        )
        
        -- 9. 检查代理请求结果
        if res.status >= 400 then
            ngx.log(ngx.ERR, "代理请求失败: " .. res.status .. ", URL: " .. proxy_url)
        end
        
        -- 10. 设置响应头
        ngx.header['Access-Control-Allow-Origin'] = '*'
        ngx.header['Access-Control-Allow-Credentials'] = 'true'
        ngx.header['Cache-Control'] = 'public, max-age=14400'
        
        -- 移除可能导致问题的安全头
        ngx.header['Content-Security-Policy'] = nil
        ngx.header['Content-Security-Policy-Report-Only'] = nil
        ngx.header['Clear-Site-Data'] = nil
        ngx.header['X-Frame-Options'] = nil
        
        -- 11. 处理响应体中的域名替换
        local content_type = res.header['Content-Type'] or ''
        local should_replace_content = (
            string.find(content_type, "text/") or
            string.find(content_type, "application/json") or
            string.find(content_type, "application/javascript") or
            string.find(content_type, "application/xml") or
            string.find(content_type, "text/css")
        )
        
        if should_replace_content and res.body then
            local body = res.body
            local replacements = 0
            
            -- 遍历所有域名映射进行替换
            for prefix, original_domain in shared_dict:pairs() do
                local escaped_domain = string.gsub(original_domain, "%.", "\\.")
                local full_proxy_domain = prefix .. domain_suffix
                
                -- 替换 HTTPS URLs
                local new_body, count1 = ngx.re.gsub(body, "https://" .. escaped_domain .. "(?=/|\"|\'|\\s|$)", "https://" .. full_proxy_domain, "gi")
                body = new_body
                replacements = replacements + count1
                
                -- 替换协议相对 URLs
                local new_body2, count2 = ngx.re.gsub(body, "//" .. escaped_domain .. "(?=/|\"|\'|\\s|$)", "//" .. full_proxy_domain, "gi")
                body = new_body2
                replacements = replacements + count2
            end
            
            if replacements > 0 then
                ngx.log(ngx.INFO, "内容替换完成，共替换 " .. replacements .. " 处")
            end
            
            -- 设置响应状态和头部
            ngx.status = res.status
            for k, v in pairs(res.header) do 
                if k ~= "Content-Length" then  -- 内容长度会自动计算
                    ngx.header[k] = v 
                end
            end
            
            ngx.say(body)
        else
            -- 对于非文本内容，直接返回原始响应
            ngx.status = res.status
            for k, v in pairs(res.header) do 
                ngx.header[k] = v 
            end
            ngx.print(res.body)
        end
    }
}

# 内部代理 location，不对外暴露
location /internal_proxy {
    internal;  # 只允许内部调用
    
    # 从参数中获取代理目标
    set $proxy_target_url $arg_proxy_target_url;
    set $proxy_target_host $arg_proxy_target_host;
    
    # 代理到目标服务器
    proxy_pass $proxy_target_url;
    
    # 设置代理请求头
    proxy_set_header Host $proxy_target_host;
    proxy_set_header Referer $proxy_target_url;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header User-Agent $http_user_agent;
    proxy_set_header Accept $http_accept;
    proxy_set_header Accept-Language $http_accept_language;
    proxy_set_header Accept-Encoding $http_accept_encoding;
    
    # 传递请求体
    proxy_pass_request_body on;
    proxy_pass_request_headers on;
    
    # 代理超时设置
    proxy_connect_timeout 30s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
    
    # 缓冲设置
    proxy_buffering on;
    proxy_buffer_size 64k;
    proxy_buffers 32 64k;
    proxy_busy_buffers_size 128k;
    
    # SSL 设置
    proxy_ssl_verify off;
    proxy_ssl_server_name on;
}

# 错误页面处理
error_page 404 /404.html;
error_page 500 502 503 504 /50x.html;

location = /404.html {
    return 404 "Page Not Found";
}

location = /50x.html {
    return 500 "Internal Server Error";
}
```

6. **重要：** 将配置中的 `your-domain.com` 替换为您的实际域名
7. 点击「保存」

## 测试验证

### 重启服务

1. 进入 1Panel → 「应用商店」→ 「已安装」
2. 找到「OpenResty」应用
3. 点击「重启」按钮
4. 等待重启完成

### 功能测试

**测试域名列表：**
```
https://git.your-domain.com                    # GitHub 主站
https://api-github-com.your-domain.com         # GitHub API
https://raw-githubusercontent-com.your-domain.com  # 原始文件
https://avatars-githubusercontent-com.your-domain.com  # 头像
```

**测试步骤：**
1. 在浏览器中访问 `https://git.your-domain.com`
2. 检查页面是否正常加载
3. 检查页面中的链接是否正确指向代理域名
4. 测试登录、搜索等功能
5. 检查开发者工具中的网络请求

### 日志检查

**查看访问日志：**
```bash
tail -f /opt/1panel/apps/openresty/openresty/logs/access.log
```

**查看错误日志：**
```bash
tail -f /opt/1panel/apps/openresty/openresty/logs/error.log
```

## 故障排除

### 常见问题

**1. 域名解析失败**
- 检查DNS解析是否生效：`nslookup git.your-domain.com`
- 确认通配符记录配置正确
- 等待DNS传播（可能需要几分钟到几小时）

**2. SSL证书问题**
- 确认通配符证书包含所有子域名
- 检查证书是否过期
- 重新申请证书如果有问题

**3. 代理请求失败**
- 检查服务器网络连接
- 确认目标域名可访问
- 查看错误日志获取详细信息

**4. 内容替换不完整**
- 检查域名映射配置是否完整
- 查看日志中的替换统计信息
- 根据需要添加新的域名映射

### 调试技巧

**1. 启用详细日志**
在 nginx.conf 的 http 块中添加：
```nginx
error_log /opt/1panel/apps/openresty/openresty/logs/error.log debug;
```

**2. 添加调试输出**
在 Lua 代码中添加调试信息：
```lua
ngx.log(ngx.ERR, "调试信息: " .. tostring(variable))
```

**3. 测试单个域名**
临时修改配置只处理一个域名，逐步排查问题。

## 维护说明

### 定期维护任务

**1. 证书续期**
- Let's Encrypt 证书有效期90天
- 1Panel 通常会自动续期
- 建议每月检查一次证书状态

**2. 日志清理**
- 定期清理访问日志和错误日志
- 可以设置日志轮转避免磁盘空间不足

**3. 性能监控**
- 监控服务器CPU、内存、带宽使用情况
- 关注代理请求的响应时间
- 必要时优化配置或升级服务器

### 配置更新

**添加新的域名映射：**
1. 修改 nginx.conf 中的域名映射表
2. 重启 OpenResty 服务
3. 测试新域名是否正常工作

**修改代理逻辑：**
1. 备份当前配置
2. 在测试环境验证修改
3. 应用到生产环境
4. 监控运行状态

### 备份策略

**配置文件备份：**
- nginx.conf
- 网站配置文件
- SSL 证书文件

**建议备份频率：**
- 每次修改配置后立即备份
- 每周定期备份
- 重要更新前备份

## 性能优化建议

### 缓存优化

```nginx
# 在 server 块中添加缓存配置
location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
    access_by_lua_block {
        -- 静态资源也需要代理处理
        -- 这里可以复用主要的代理逻辑
    }
}
```

### 连接池优化

```nginx
# 在 http 块中添加
upstream github_backend {
    server github.com:443;
    keepalive 32;
}
```

### 压缩优化

```nginx
# 启用 gzip 压缩
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;
```

---

## 总结

通过以上配置，您可以成功将 Cloudflare Worker 的 GitHub 代理功能迁移到 1Panel 环境中。这个方案提供了：

- ✅ 完整的域名映射和代理功能
- ✅ 自动的内容替换和URL重写
- ✅ 灵活的配置管理
- ✅ 详细的日志和调试支持
- ✅ 良好的性能和稳定性

如果在配置过程中遇到任何问题，请参考故障排除部分或查看相关日志文件获取更多信息。

---

**文档版本：** 1.0  
**最后更新：** 2024年  
**适用版本：** 1Panel v1.8+ / OpenResty 1.19+