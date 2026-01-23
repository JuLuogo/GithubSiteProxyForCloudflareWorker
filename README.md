# GitHub代理服务

## 项目概述

这是一个基于Cloudflare Workers的GitHub代理服务，允许通过替代域名访问GitHub资源，解决某些网络环境下GitHub访问受限的问题。代理服务通过域名映射和资源转发，提供无缝的GitHub浏览体验。

## 特性

- **灵活的域名映射系统**：
  - **前缀映射**：支持使用 `gh.` 等前缀批量映射所有 GitHub 子域名。
  - **独立域名映射**：支持将特定的 GitHub 域名（如 `avatars.githubusercontent.com`）映射到完全独立的自定义域名（如 `api.example.com`）。
- **外部反代支持**：支持混合使用本 Worker 和外部已有的反代服务。
- **流媒体与视频支持**：
  - **智能重定向**：自动处理视频网站（如 YouTube）的 302 跳转，确保 CDN 流量也经过代理。
  - **二进制保护**：自动识别并保护视频、音频文件，避免因文本替换导致的文件损坏。
- **完整的资源映射**：支持GitHub相关的所有主要域名。
- **内容替换**：自动替换响应中的所有域名引用，确保链接正常工作。
- **路径修复**：解决嵌套URL路径问题。
- **HTTPS强制**：自动将HTTP请求升级为HTTPS。

## 域名映射配置指南

### 1. 标准前缀映射（默认）
使用 `domain_mappings` 配置前缀。例如 `github.com` 映射为 `gh.your-domain.com`。

```javascript
const domain_mappings = {
  'github.com': 'gh.',
  // ... 其他映射
};
```

### 2. 独立自定义域名（新功能）
使用 `custom_domains` 配置特定的独立域名。这优先级高于前缀映射。

**场景 A：使用本 Worker 代理**
如果您想用 `img.example.com` 来代理 `avatars.githubusercontent.com`：
1. 在 Cloudflare 解析 `img.example.com` 到本 Worker。
2. 配置：
```javascript
const custom_domains = {
  'avatars.githubusercontent.com': 'img.example.com',
};
```

**场景 B：使用外部反代服务**
如果您已经有一个外部搭建好的反代（例如 `api.external.com` 已经反代了 `raw.githubusercontent.com`）：
1. 不需要修改 Cloudflare 解析。
2. 配置：
```javascript
const custom_domains = {
  'raw.githubusercontent.com': 'api.external.com',
};
```
Worker 会自动将页面中的相关链接替换为您的外部域名。

### 3. 视频/流媒体网站支持
要支持视频网站（如 YouTube），需要在 `custom_domains` 中添加相关域名映射。

```javascript
const custom_domains = {
  'www.youtube.com': 'yt.example.com',
  'googlevideo.com': 'video.example.com', // 必须映射 CDN 域名
};
```
Worker 会自动处理：
- 视频文件的透传（不修改内容）。
- 302 跳转的重写（防止跳回原站）。

## 部署指南

### 前提条件

- Cloudflare账户
- 已配置的域名（托管在Cloudflare上）
- 基本的DNS配置知识

### 部署步骤

1. **登录Cloudflare控制台**
   - 进入Workers部分

2. **创建新的Worker**
   - 点击"创建Worker"
   - 将提供的代码粘贴到代码编辑器中
   - 给Worker命名并保存

3. **配置DNS**
   - 为每个代理域名前缀创建CNAME记录，指向您的Worker
   - 例如：创建 `gh.您的域名` 的CNAME记录，指向您的Worker路由

4. **配置Worker路由**
   - 添加路由模式如 `gh.您的域名/*` 指向您的Worker
   - 对其他代理子域重复此操作

## 使用方法

### 基本访问

部署成功后，只需将原始GitHub URL中的域名部分替换为对应的代理域名：

```
# 原始URL
https://github.com/用户名/仓库名

# 代理URL
https://gh.您的域名/用户名/仓库名
```

### 根路径访问

由于安全考虑，直接访问根路径会被禁止：

```
# 直接访问根路径（被禁止）
https://gh.您的域名/
# 返回：Access Forbidden (403)

# 通过特殊路径访问根路径
https://gh.您的域名/peroe
```

## 技术说明

### 工作原理

1. **请求处理**：
   - 检查 `custom_domains`：如果匹配，直接代理到对应原站。
   - 检查 `domain_mappings`：如果匹配前缀，代理到对应原站。
2. **响应处理**：
   - **MIME 检查**：如果是视频/音频，直接返回，不修改。
   - **重定向处理**：拦截 3xx 跳转，重写 Location 头。
   - **内容替换**：先替换 `custom_domains` 中的域名，再替换 `domain_mappings` 中的域名。

### 特殊路径处理

代码包含专门的逻辑来处理特殊路径，特别是用于仓库提交信息的路径，解决了嵌套URL问题：

```
/用户名/仓库名/latest-commit/分支名/https://gh.域名/...
```

这类路径会被正确截断并转发到GitHub。

## 免责声明

此代理服务仅用于教育和研究目的。使用者应确保遵守GitHub的服务条款和当地法律法规。
