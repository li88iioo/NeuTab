<p align="center">
  <img src="assets/icon.png" alt="NeuTab" width="128" height="128">
</p>

<h1 align="center">NeuTab</h1>

<p align="center">
  <strong>一个简单的浏览器新标签页</strong><br>
  <em>A Simple Browser New Tab Page</em>
</p>

<p align="center">
  <a href="#特性">特性</a> •
  <a href="#安装">安装</a> •
  <a href="#web-版本">Web 版本</a> •
  <a href="#开发">开发</a> •
  <a href="#english">English</a>
</p>

<p align="center">
  <img src="assets/Interface%20Demo.png" alt="NeuTab 界面预览" width="900">
</p>

---

## 特性

### 视觉体验
- **双视觉主题** — 新拟态 (Neumorphic) / 液态玻璃 (Liquid Glass - 采用 Aero Prism 设计)
- **智能主题切换** — 浅色 / 深色 / 跟随系统
- **高度可定制布局** — 最大宽度、边距、卡片尺寸、圆角均可调节

### 快捷启动
- **分组管理** — 自由创建、重命名、排序分组
- **拖拽排序** — 直观的拖放操作调整快捷方式顺序
- **多图标模式** — 自动获取网站图标 / 自定义 URL / 本地上传 / 文字头像
- **内网地址** — 同一快捷方式可配置公网 + 内网双地址

### 搜索功能
- **多引擎切换** — 内置 Google、Bing 等
- **自定义引擎** — 添加任意搜索引擎

### 更多组件
- **时钟** — 可选显示秒数
- **经常访问** — 展示浏览器最常访问的站点
- **最近历史** — 展示最近浏览记录

### 数据管理
- **本地备份** — JSON 导入/导出，包含完整配置与图标
- **云同步** — 自建服务器同步配置（可选）
- **多语言** — 中文 / English

### 多端支持
- **浏览器扩展** — Chrome / Edge / Brave / Firefox
- **Web 版本** — 自托管，无需安装扩展即可使用
- **移动端优化** — 针对触摸屏设计的流畅交互体验

---

## 快速开始

```bash
# 克隆仓库
git clone https://github.com/li88iioo/NeuTab.git
cd NeuTab

# 安装依赖
pnpm install

# 开发模式（浏览器扩展）
pnpm dev

# 或启动 Web 版本
cd webserver && cp .env.example .env && docker compose up -d --build
```

---

## 安装

### 从应用商店安装
*（即将上线）*

### 手动安装

#### Chrome / Edge / Brave

1. **下载**：克隆本仓库或下载 [Release](https://github.com/li88iioo/NeuTab/releases) 包
2. **安装依赖并构建**：
   ```bash
   pnpm install
   pnpm build
   ```
3. **加载扩展**：
   - 打开 `chrome://extensions/`（或 `edge://extensions/`）
   - 开启右上角 **开发者模式**
   - 点击 **加载已解压的扩展程序**
   - 选择 `build/chrome-mv3-prod` 目录

#### Firefox

Firefox 开发模式下只能临时加载扩展。

1. **构建 Firefox 版本**：
   ```bash
   pnpm build:firefox
   ```
2. **临时加载**：
   - 打开 `about:debugging#/runtime/this-firefox`
   - 点击 **临时载入附加组件...**
   - 选择 `build/firefox-mv3-prod/manifest.json`

---

## Web 版本

`webserver/` 目录提供自托管的 Web 版本，功能包括：
- 无需安装扩展即可使用 NeuTab
- 为浏览器扩展提供云同步服务

### Docker 快速部署

```bash
cd webserver
cp .env.example .env
# 编辑 .env 设置 AUTH_CODE 和 JWT_SECRET
docker compose up -d --build
```

访问 `http://localhost:3001`，使用配置的 `AUTH_CODE` 登录。

### 使用预构建镜像

```bash
docker pull ghcr.io/li88iioo/neutab:latest

docker run -d -p 3001:3001 \
  -e AUTH_CODE=your_code \
  -e JWT_SECRET=your_secret \
  -v ./data:/app/data \
  ghcr.io/li88iioo/neutab:latest
```

详细配置请参考 [webserver/README.md](webserver/README.md)。

---

## 开发

### 环境要求
- Node.js 20+
- pnpm 8+

### 项目结构

```
NeuTab/
├── packages/
│   ├── shared/          # 共享工具库/类型定义 (Web + 扩展)
│   └── ui/              # 共享 UI 组件/样式/资源
├── components/          # 扩展端组件 (注入存储/后端实现)
├── pages/               # 扩展页面入口
├── utils/               # 扩展端工具函数
├── assets/              # 静态资源 (图标、演示图)
└── webserver/           # Web 应用 + API 服务
    ├── client/          # Vite + React 前端
    └── server/          # Express + SQLite 后端
```

### 常用命令

```bash
# 安装依赖
pnpm install

# 开发模式（扩展）
pnpm dev

# 开发模式（Firefox）
pnpm dev:firefox

# 构建生产版本
pnpm build
pnpm build:firefox

# 打包发布
pnpm package
pnpm package:firefox
```

### pnpm 原生模块提示

如果安装时提示 `Ignored build scripts: better-sqlite3`，请执行：

```bash
pnpm -w approve-builds
pnpm -w rebuild better-sqlite3
```

---

## 反馈与贡献

如果在使用过程中遇到任何问题，或有新的功能建议，欢迎提交 [Issue](https://github.com/li88iioo/NeuTab/issues)，或 fork 进行开发。

---

## 许可证

[MIT License](LICENSE)

---

<h2 id="english">English</h2>

### Features

- **Dual Visual Themes** — Neumorphic / Liquid Glass (Aero Prism Design)
- **Smart Theme Switching** — Light / Dark / Auto
- **Customizable Layout** — Max width, padding, card size, border radius
- **Quick Launch** — Groups, drag-and-drop, custom icons, internal URLs
- **Search** — Multiple engines, custom engines
- **Widgets** — Clock, Top Sites, Recent History
- **Data Management** — Local backup, cloud sync, i18n (Chinese/English)
- **Multi-platform** — Browser extension (Chrome/Edge/Firefox) + Self-hosted web
- **Mobile Optimized** — Smooth touch interactions for touchscreens

### Quick Start

```bash
pnpm install

# Extension development
pnpm dev

# Web version (Docker)
cd webserver && cp .env.example .env && docker compose up -d --build
```

### Installation

#### Chrome / Edge / Brave

1. Clone and build:
   ```bash
   pnpm install && pnpm build
   ```
2. Open `chrome://extensions/`, enable **Developer mode**
3. Click **Load unpacked**, select `build/chrome-mv3-prod`

#### Firefox

```bash
pnpm build:firefox
```
Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, select `build/firefox-mv3-prod/manifest.json`

### Web Version (Self-hosted)

```bash
cd webserver
cp .env.example .env
docker compose up -d --build
```

Access `http://localhost:3001` and login with your `AUTH_CODE`.

See [webserver/README.md](webserver/README.md) for detailed configuration.

### Feedback & Contribution

If you encounter any issues or have feature suggestions, please feel free to submit an [Issue](https://github.com/li88iioo/NeuTab/issues).

### License

[MIT License](LICENSE)

---

<p align="center">
  Built with ❤️ for photography lovers.
</p>
