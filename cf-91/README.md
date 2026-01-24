# Pornhub / Xvideos 反代体系 (Cloudflare Workers)

这是一套专为 Pornhub 和 Xvideos 设计的高性能、高可用反向代理解决方案，基于 Cloudflare Workers 构建。

## 🌟 核心特性

*   **双 Worker 架构**：页面与视频流逻辑分离，互不干扰，性能最优。
*   **三种视频模式**：支持直连、EdgeOne (CDN)、Worker 兜底三种模式，灵活应对网络封锁。
*   **EdgeOne 加速**：专为 EdgeOne 等外部 CDN 优化，实现“原样回源”的高速视频分发。
*   **智能 M3U8 分流**：自动解析 m3u8，仅代理索引文件，TS 切片直连源站，极大节省 Worker 流量与费用。
*   **安全防刷**：内置 Referer/Origin 伪造（过防盗链）、Range 请求限制（防恶意消耗）。
*   **无缝鉴权**：完整保留视频 URL 的 Token 参数，解决鉴权失效问题。
*   **独立部署**：通过 `site-worker.js` 和 `video-worker.js` 分别部署，职责清晰。
*   **可观测性**：响应头包含 `X-Video-Mode` 和 `X-Proxy-Source`，便于调试和监控。


## 🏗️ 架构设计

系统由两个逻辑角色的 Worker 组成：

1.  **Site Worker** (`site-worker.js`)
    *   负责处理 HTML/JS/CSS 等页面内容。
    *   执行域名重写、文本替换。
    *   根据配置生成视频播放地址。
    *   **不处理**视频流量。

2.  **Video Worker** (`video-worker.js`)
    *   负责处理视频流（MP4/M3U8）。
    *   处理 Range 请求，支持视频拖拽。
    *   伪造请求头，绕过源站限制。
    *   M3U8 动态优化。

## 🔧 环境变量配置 (Environment Variables)

所有环境变量均在 **Cloudflare Dashboard -> Workers -> [Your Service] -> Settings -> Variables** 中设置。

### 1. Site Worker (`pornhub-site`)

| 变量名 | 必填 | 默认值 | 可选值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `VIDEO_MODE` | 否 | `direct` | `direct` | **直连模式**：页面代理，视频直连源站（低成本/调试） |
| | | | `cdn` | **CDN 模式**：视频通过 EdgeOne 等外部 CDN 加速（推荐主力模式） |
| | | | `worker` | **Worker 模式**：视频流量全部经过 Video Worker（救急/兜底） |

> **注意**：
> *   修改 `VIDEO_MODE` 后，新生成的页面链接会立即生效。
> *   推荐生产环境默认使用 `cdn`，备用 `worker`。

### 2. Video Worker (`pornhub-video`)

目前 Video Worker **不需要**任何环境变量配置。它通过代码内置逻辑自动处理：
*   自动识别目标域名
*   自动伪造 Referer/Origin
*   自动处理 M3U8 分流

## 🚀 部署指南

### 1. 准备工作
确保你拥有一个 Cloudflare 账号，并准备好两个域名（或子域名），例如：
*   主站域名: `www.your-proxy.com`
*   视频域名: `v.your-proxy.com`

### 2. 代码配置 (重要)
在部署之前，你需要修改代码中的配置部分：
*   **`site-worker.js`**: 修改 `domain_mappings`，将默认的 Github 映射替换为目标网站（Pornhub/Xvideos）的真实域名映射。
*   **`site-worker.js`**: 确认 `video_domains` 列表是否包含你需要代理的目标（默认已包含常见域名）。

### 3. 创建 Workers

#### 服务 A：主站 (Site)
1.  创建一个新的 Worker 服务，命名为 `pornhub-site`。
2.  将 `site-worker.js` 的内容复制进去并部署。
3.  绑定域名：`www.your-proxy.com`。
4.  **配置环境变量** (Settings -> Variables):
    *   `VIDEO_MODE`: `cdn` (主力推荐) 或 `worker` (兜底)

#### 服务 B：视频 (Video)
1.  创建一个新的 Worker 服务，命名为 `pornhub-video`。
2.  将 `video-worker.js` 的内容复制进去并部署。
3.  绑定域名：`v.your-proxy.com`。

## ⚙️ 视频模式配置 (`VIDEO_MODE`)

在 **Site Worker** 的环境变量中设置 `VIDEO_MODE`，决定用户如何加载视频：

| 模式 | 值 | 描述 | 适用场景 | 流量消耗 |
| :--- | :--- | :--- | :--- | :--- |
| **直连** | `direct` | 页面代理，视频直接从源站加载 | 日常使用，源站未被墙 | 🟢 低 |
| **EdgeOne** | `cdn` | 视频通过 EdgeOne/外部反代加载 | **主力模式**，高速稳定 | 🟢 低 |
| **Worker** | `worker` | 视频流量全部经过 Video Worker | 源站被墙，作为兜底方案 | 🔴 高 |

## 📐 EdgeOne 配置指南 (CDN 模式)

当使用 `VIDEO_MODE = cdn` 时，你需要配置 EdgeOne（或类似 CDN）接管 `v.your-proxy.com`：

1.  **域名**: `v.your-proxy.com`
2.  **回源策略**:
    *   Origin Protocol: HTTPS
    *   Origin Host: 跟随请求 (Follow Request) 或不修改
3.  **规则配置**:
    *   **路径**: `/*` (或针对 `.mp4`, `.m3u8`, `.ts` 配置)
    *   **行为**:
        *   ✅ 允许 Range 请求 (Slice Loading)
        *   ❌ 不修改 URL / Header / Body
        *   🟡 缓存策略：
            *   `.m3u8`: No-Cache 或极短缓存
            *   `.ts` / `.mp4`: 按需缓存
4.  **核心目标**: EdgeOne 应作为一个纯粹的“管道”，将 `v.your-proxy.com/domain/path` 原样映射回源站。

## ✅ 测试流程

部署完成后，建议按以下顺序验证系统的稳定性：

### 1. 基础链路测试 (`VIDEO_MODE = direct`)
*   访问 `www.your-proxy.com`，检查页面加载是否正常。
*   点击任意视频播放，打开 Chrome DevTools -> Network。
*   确认视频请求（mp4/m3u8）是**直接连接**官方 CDN（无 `v.` 前缀）。

### 2. Worker 转发测试 (`VIDEO_MODE = worker`)
*   修改 Site Worker 的环境变量 `VIDEO_MODE` 为 `worker`。
*   刷新页面播放视频。
*   **检查点**:
    *   视频请求 URL 应指向 `v.your-proxy.com`。
    *   URL 尾部必须带有 `?token=...` 参数。
    *   拖拽进度条，确认响应状态码为 `206 Partial Content`。

### 3. M3U8 分流测试
*   找到一个使用 M3U8 的视频。
*   查看 Network 请求，确认 `.m3u8` 文件由 `v.your-proxy.com` 返回。
*   查看 `.ts` 分片请求，确认其 URL 指向**源站域名**（非 `v.your-proxy.com`）。
*   *注：如果 TS 直连失败（被墙），可测试降级参数 `?force_worker=1`。*

## 🛠️ 高级功能说明

### M3U8 智能分流 (Split Tunneling)
当 `VIDEO_MODE=worker` 时，Video Worker 会智能处理 m3u8 请求：
*   **索引文件 (.m3u8)**: 由 Worker 代理返回，但会将内部的 `.ts` 切片路径重写为**源站绝对路径**。
*   **效果**: 客户端解析索引后，直接向源站请求视频数据，Worker 仅消耗极少的文本处理流量。

**降级机制**:
如果客户端无法直连源站（如源站被墙），可以在请求中添加 `?force_worker=1` 参数（需要前端播放器配合修改），强制 Worker 代理所有 TS 切片。
> URL 示例: `https://v.your-proxy.com/path/to/index.m3u8?force_worker=1`

### 防刷保护 (Anti-Abuse)
Video Worker 内置了安全策略：
*   **Referer/Origin 伪造**: 针对 Pornhub/Xvideos 自动设置正确的 Referer，防止 403 Forbidden。
*   **Max Chunk Size**: 强制限制单次 Range 请求最大为 20MB。如果客户端尝试请求整个大文件，Worker 会自动截断，防止恶意刷流量或内存溢出。

## 📝 代码结构

*   `cf-91/site-worker.js`: **[核心]** Site 逻辑代码。
*   `cf-91/video-worker.js`: **[核心]** Video 逻辑代码。

## ⚠️ 注意事项

1.  **内容合规**: 请确保你的使用符合当地法律法规及 Cloudflare 使用条款。
2.  **资源消耗**: 使用 `worker` 模式代理视频会消耗大量 Cloudflare Workers 额度，请注意监控用量。
