## 🤖 Assistant

好的，使用 1Panel 这种图形化界面来部署这个复杂的全站反向代理是完全可行的。不过，由于这个代理的逻辑（特别是动态域名映射和响应体修改）超出了 1Panel 标准“反向代理”功能的范畴，我们不能简单地填几个表单。

**核心思路是：**

1. 在 1Panel 中创建一个**静态网站**，作为我们配置的载体。
2. 利用这个网站的**“配置文件”**功能，手动写入我们定制化的 OpenResty (Nginx + Lua) 配置代码。
3. 1Panel 的 OpenResty 应用已经内置了 Lua 环境，所以我们不需要额外安装任何东西。

下面是详细的、一步一步的操作指南。

---

### 第一步：准备工作（域名和证书）

1. **域名解析**：
 * 确保你有一个主域名，例如 `your-domain.com`。
 * 在你的 DNS 提供商处，添加一个**通配符 A 记录 (Wildcard Record)**，将 `*.your-domain.com` 指向你 1Panel 服务器的 IP 地址。这样，任何子域名（如 `git.your-domain.com`, `api-github-com.your-domain.com` 等）都会指向你的服务器。

2. **SSL 证书**：
 * 你需要为你的通配符域名 `*.your-domain.com` 申请一个 SSL 证书。
 * 你可以在 1Panel 的 **证书管理** 中，使用 DNS 验证（比如 DNSPod、阿里云DNS等）来申请一个免费的 Let's Encrypt 通配符证书。这是最推荐的方式。

### 第二步：在 1Panel 中创建网站

1. 登录 1Panel，进入左侧菜单的 **"网站"**。
2. 点击 **"创建网站"** 按钮。
3. 在弹出的窗口中，选择 **"静态网站"**。
4. **填写主域名**：这里填写你的主域名，比如 `proxy.your-domain.com`。
5. **添加其他域名**：点击"添加更多域名"，添加你需要代理的所有子域名，例如：
   - `git.your-domain.com`
   - `api-github-com.your-domain.com`
   - `raw-githubusercontent-com.your-domain.com`
   - 其他你需要代理的域名
   
   > **重要**：所有需要代理的域名都必须在这里添加，否则Nginx将无法识别这些域名的请求。
6. 点击 **"确认"** 创建网站。



### 第三步：配置 SSL 和强制 HTTPS

1. 网站创建成功后，在网站列表中找到你刚创建的 `proxy.your-domain.com`，点击右侧的 **“设置”**。
2. 进入 **“SSL”** 标签页。
3. 在 **“选择证书”** 下拉菜单中，选择你之前申请好的那个 `*.your-domain.com` 的通配符证书。
4. 勾选 **“强制 HTTPS”** 开关。这个开关会自动帮你处理 HTTP到HTTPS的跳转，我们就不需要在配置文件里再写一遍了。
5. 点击 **“保存”**。



### 第四步：注入核心 Nginx 配置

这是最关键的一步。我们需要将之前讨论的 OpenResty 配置代码，适配并粘贴到 1Panel 的配置文件编辑器中。配置分为两部分。

#### 第 4.1 部分：添加全局 Lua 配置到 `nginx.conf`

这部分的配置（`lua_shared_dict`）需要在 `http` 上下文中，而 1Panel 的网站配置编辑器只能修改 `server` 上下文。所以我们需要手动修改主配置文件。

1. 在 1Panel 左侧菜单中选择 **"主机"** -> **"文件"**。
2. 导航到 OpenResty 的主配置文件路径：
 `/opt/1panel/apps/openresty/openresty/conf/nginx.conf`
3. 双击打开 `nginx.conf` 文件进行编辑。
4. 找到 `http { ... }` 代码块。在 `http` 块的**内部**，`include` 指令的**上方**，粘贴以下代码：

```nginx
    # =================== START: 自定义全局配置 ===================
    # 定义域名映射关系的 Lua 共享字典
    lua_shared_dict domain_mappings 1m;
    # ==================== END: 自定义全局配置 ====================
```

> **注意**：我们只添加了共享字典的定义，而不添加任何`init_worker_by_lua_file`或`init_worker_by_lua_block`指令，因为1Panel的WAF配置中已经有了`init_worker_by_lua_file`指令，会导致冲突。域名映射的初始化将在网站配置的`content_by_lua_block`中完成。
5.  点击右上角的 **“保存”** 按钮。

#### 第 4.2 部分：修改网站的 `server` 配置

1.  回到 **“网站”** 列表，再次进入 `proxy.your-domain.com` 的 **“设置”**。
2.  这次进入 **“配置文件”** 标签页。
3.  你会看到 1Panel 已经为你生成了一些配置。我们需要大幅修改它。
4.  将编辑器里**所有内容清空**，然后粘贴下面的代码。

    **注意：**
    *   将代码中的 `your-domain.com` **替换为你自己的真实域名**。
    *   1Panel 会自动管理 `listen` 和 `ssl_certificate` 等指令，所以我们提供的模板会更简洁。你粘贴进去后，1Panel 会自动合并这些必需的指令。

```nginx
# 1Panel会自动添加server块的开始部分，包括listen指令和server_name指令
# 不要在这里添加server_name指令，而是在1Panel的网站设置中添加域名
# 你需要在server块内添加以下配置

# 使用正则表达式匹配通配符域名
# ！！！请将下面的 your-domain\\.com 替换为你自己的真实域名（注意点号需要转义）
# 注意：此行仅作为参考，实际配置时应在1Panel的网站设置中设置域名，而不是在配置文件中添加server_name指令
# server_name ~^(?<prefix>[-a-z0-9\.]+\.)(?<domain_suffix>your-domain\.com)$;

# 1Panel会帮你添加 access_log 和 error_log, 无需手动添加

# DNS 解析器，必须设置
resolver 8.8.8.8 1.1.1.1 valid=300s;

# 根目录设置，对于代理网站来说不重要，但最好保留
root /opt/1panel/apps/openresty/openresty/html;
index index.html index.htm;

# ----- 核心代理逻辑 -----
location / {
 content_by_lua_block {
 -- 初始化域名映射（只在第一次请求时执行）
 if not ngx.shared.domain_mappings:get('git.') then
 local shared_dict = ngx.shared.domain_mappings
 local mappings = {
 ['git.'] = 'github.com',
 ['avatars-githubusercontent-com.'] = 'avatars.githubusercontent.com',
 ['github-githubassets-com.'] = 'github.githubassets.com',
 ['collector-github-com.'] = 'collector.github.com',
 ['api-github-com.'] = 'api.github.com',
 ['raw-githubusercontent-com.'] = 'raw.githubusercontent.com',
 ['gist-githubusercontent-com.'] = 'gist.githubusercontent.com',
 ['github-io.'] = 'github.io',
 ['assets-cdn-github-com.'] = 'assets-cdn.github.com',
 ['cdn.jsdelivr-net.'] = 'cdn.jsdelivr.net',
 ['securitylab-github-com.'] = 'securitylab.github.com',
 ['www-githubstatus-com.'] = 'www.githubstatus.com',
 ['npmjs-com.'] = 'npmjs.com',
 ['git-lfs-github-com.'] = 'git-lfs.github.com',
 ['githubusercontent-com.'] = 'githubusercontent.com',
 ['github-global-ssl-fastly-net.'] = 'github.global.ssl.fastly.net',
 ['api-npms-io.'] = 'api.npms.io',
 ['github-community.'] = 'github.community',
 ['wj.'] = 'zh.wikipedia.org',
 ['upload.'] = 'upload.wikimedia.org',
 ['meta.'] = 'meta.wikimedia.org'
 }
 for prefix, original_domain in pairs(mappings) do
 shared_dict:set(prefix, original_domain)
 end
 end

 -- 1. 鉴权与特殊路径处理
 if ngx.var.uri == '/' then
 ngx.status = 404
 ngx.say('Access Forbidden')
 return
 end

 if ngx.var.uri == '/peroe' then
 ngx.var.uri = '/'
 end

 -- 2. 特殊路径重定向
 local redirect_paths = {['/login'] = true, ['/signup'] = true, ['/copilot'] = true}
 if redirect_paths[ngx.var.uri] then
 return ngx.redirect('https://www.gov.cn', 302)
 end

 -- 3. 查找目标主机
 -- 注意：这里使用的prefix和domain_suffix变量需要在server_name指令中定义
 -- 确保在1Panel的网站设置中添加了所有需要代理的域名，并且域名格式与mappings表中的前缀匹配
 local prefix = ngx.var.host:match("^([^.]+%.).*$") -- 提取域名前缀，如从git.example.com提取git.
 if not prefix then
  ngx.status = 404
  ngx.say('Invalid domain format')
  return
 end

 local domain_suffix = ngx.var.host:match("^[^.]+%.(.*)$") -- 提取域名后缀
 local shared_dict = ngx.shared.domain_mappings
 local target_host = shared_dict:get(prefix)

 if not target_host then
 ngx.status = 404
 ngx.say('Domain not configured for proxy: ' .. prefix)
 return
 end

 -- 4. 修复特定的嵌套URL
 local uri = ngx.var.uri
 uri = ngx.re.sub(uri, "(/[^/]+/[^/]+/(?:latest-commit|tree-commit-info)/[^/]+)/https%3A//[^/]+/.+", "$1", "jo")
 uri = ngx.re.sub(uri, "(/[^/]+/[^/]+/(?:latest-commit|tree-commit-info)/[^/]+)/https://[^/]+/.+", "$1", "jo")

 -- 5. 发起代理请求
 local proxy_url = 'https://' .. target_host .. uri

 if ngx.var.is_args == "?" then
 proxy_url = proxy_url .. '?' .. ngx.var.args
 end

 local res = ngx.location.capture(
 '/internal_proxy',
 {
 method = ngx.req.get_method(),
 body = ngx.req.get_body_data(),
 vars = {
 proxy_target_url = proxy_url,
 proxy_target_host = target_host
 }
 }
 )

 -- 6. 设置响应头
 ngx.header['access-control-allow-origin'] = '*'
 ngx.header['access-control-allow-credentials'] = 'true'
 ngx.header['cache-control'] = 'public, max-age=14400'
 ngx.header.content_security_policy = nil
 ngx.header['content-security-policy-report-only'] = nil
 ngx.header['clear-site-data'] = nil

 -- 7. 替换响应体中的域名
 local content_type = res.header['Content-Type'] or ''
 if string.find(content_type, "text/") or
 string.find(content_type, "application/json") or
 string.find(content_type, "application/javascript") or
 string.find(content_type, "application/xml") then

 local body = res.body
 -- 如果domain_suffix为nil，重新从host中提取
 if not domain_suffix then
  domain_suffix = ngx.var.host:match("^[^.]+%.(.*)$") -- 提取域名后缀
 end
 for p, original_domain in shared_dict:pairs() do
 local escaped_domain = string.gsub(original_domain, "%.", "\\.") 
 local full_proxy_domain = p .. domain_suffix
 body = ngx.re.gsub(body, "(https?://)" .. escaped_domain, "https://" .. full_proxy_domain, "gi")
 body = ngx.re.gsub(body, "(//)" .. escaped_domain, "//" .. full_proxy_domain, "gi")
 end

 ngx.status = res.status
 for k, v in pairs(res.header) do ngx.header[k] = v end
 ngx.say(body)
 else
 ngx.status = res.status
 for k, v in pairs(res.header) do ngx.header[k] = v end
 ngx.print(res.body)
 end
 }
}

# 内部代理 location, 不对外暴露
location /internal_proxy {
 internal;
 set $proxy_target_url $arg_proxy_target_url;
 set $proxy_target_host $arg_proxy_target_host;
 proxy_pass $proxy_target_url;
 proxy_set_header Host $proxy_target_host;
 proxy_set_header Referer $proxy_target_url;
 proxy_set_header X-Real-IP $remote_addr;
 proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
 proxy_set_header X-Forwarded-Proto https;
 proxy_pass_request_body on;
 proxy_pass_request_headers on;
 proxy_http_version 1.1;
 proxy_ssl_server_name on;
 # 增加超时时间
 proxy_connect_timeout 60s;
 proxy_read_timeout 600s;
 proxy_send_timeout 600s;
}
```

5. 粘贴完成后，点击 **“保存”**。1Panel 会自动检查语法并应用配置。

### 第五步：重启 OpenResty 并测试

尽管 1Panel 在保存时会尝试重载配置，但由于我们修改了主配置文件 `nginx.conf`，最稳妥的方式是重启整个 OpenResty 应用。

1. 在 1Panel左侧菜单进入 **“应用”** -> **“已安装”**。
2. 找到 `openresty`，点击右侧的三个点，选择 **“重启”**。
3. 等待应用重启完成。

现在，你可以打开浏览器进行测试了。访问 `https://git.your-domain.com`，它应该会反向代理到 `https://github.com`，并且页面上的链接也应该被正确替换了。

### 注意事项和问题排查

* **域名配置**：
  * 确保在1Panel创建网站时添加了所有需要代理的域名（如 `git.your-domain.com`, `api-github-com.your-domain.com` 等）
  * 不要在网站配置文件中手动添加 `server_name` 指令，这会导致错误
  * 域名必须与Lua代码中的映射表前缀对应，例如映射表中有 `['git.']`，则必须添加 `git.your-domain.com` 域名

* **配置错误**：如果在保存配置文件或重启 OpenResty 时出错，请检查你粘贴的代码，特别是 `your-domain.com` 是否已正确替换。

* **常见错误**：
  * `"server_name" directive is not allowed here` - 这表示你在配置文件中手动添加了server_name指令。解决方法：删除server_name行，在1Panel网站设置中添加域名。
  * `"location" directive is not allowed here` - 这表示你可能在server块外部添加了location指令，或者自己添加了server { 标记。解决方法：确保不要自己添加server { 或 } 标记，让1Panel自动添加这些标记。
  * `unknown directive "```"` - 这表示你复制了Markdown代码块的结束标记。解决方法：删除这些非Nginx语法的标记。

* **查看日志**：如果代理不工作，可以在 1Panel 的 **应用** -> **openresty** 设置 -> **查看日志** 中，检查 `error.log`，看看有没有 Lua 脚本执行错误或其他 Nginx 错误。

* **1Panel 更新**：升级 1Panel 或 OpenResty 应用时，主配置文件 `nginx.conf` **有可能会被覆盖**。请务必备份你在 `nginx.conf` 中添加的 Lua 全局配置，以便在升级后恢复。

* **浏览器缓存**：测试时，请使用浏览器的隐身模式或禁用缓存，以避免旧的 DNS 记录或页面缓存造成影响。

### 终极解决方案：直接编辑配置文件

如果你在使用1Panel的网站配置编辑器时遇到持续的错误（如 `"location" directive is not allowed here`），可能是因为1Panel在后台自动将你的配置包裹在了一个额外的location块中。这种情况下，你可以尝试直接编辑原始配置文件：

1. **准备网站壳**：
   * 在1Panel中创建一个静态网站，配置好所有域名和SSL证书
   * **不要**使用网站设置中的"配置文件"编辑器

2. **直接编辑配置文件**：
   * 在1Panel左侧菜单中，点击**"主机"** -> **"文件"**
   * 进入路径：`/usr/local/openresty/nginx/conf/conf.d/`
   * 找到你的网站配置文件（如`your-domain.com.conf`）并打开
   * 删除所有内容，粘贴完整的server块配置

3. **完整配置示例**：

```nginx
# 直接编辑配置文件，绕开1Panel的图形编辑器
# 这必须是一个完整、独立的server配置块

server {
    # 监听端口和SSL设置
    listen 80;
    listen 443 ssl http2;

    # 填写你的所有域名，用空格隔开
    server_name git.your-domain.com api-github-com.your-domain.com raw-githubusercontent-com.your-domain.com;

    # SSL证书路径
    ssl_certificate /usr/local/openresty/nginx/conf/ssl/your-domain.com/fullchain.pem;
    ssl_certificate_key /usr/local/openresty/nginx/conf/ssl/your-domain.com/privkey.pem;
   
    # SSL基础配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
   
    # 核心代理逻辑
    resolver 8.8.8.8 1.1.1.1 valid=300s;
    resolver_timeout 5s;

    location / {
        content_by_lua_block {
            local host = ngx.var.host
            local shared_data = ngx.shared.domain_mappings

            local mappings = {
                 ['git.your-domain.com'] = 'github.com',
                 ['api-github-com.your-domain.com'] = 'api.github.com',
                 ['raw-githubusercontent-com.your-domain.com'] = 'raw.githubusercontent.com'
            }

            local target_host = mappings[host]

            if not target_host then
                ngx.status = 404
                ngx.say("404 Not Found: Domain mapping does not exist for " .. host)
                return
            }

            shared_data:set("target_host_for_" .. host, target_host)
            ngx.exec("/internal_proxy" .. ngx.var.request_uri)
        }
    }

    location /internal_proxy {
        internal;
       
        set_by_lua_block $r_host {
            local host = ngx.var.host
            local shared_data = ngx.shared.domain_mappings
            return shared_data:get("target_host_for_" .. host)
        }
   
        set $r_uri $request_uri;
        if ($r_uri ~* "^/internal_proxy/(.*)") {
            set $r_uri /$1;
        }

        proxy_pass https://$r_host$r_uri;
        proxy_ssl_server_name on;
        proxy_set_header Host $r_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_http_version 1.1;
    }
}
```

4. **保存并重启**：
   * 保存修改后的配置文件
   * 在1Panel的**"应用"**列表中找到**OpenResty**，点击**"重启"**
