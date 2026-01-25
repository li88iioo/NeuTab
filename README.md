# NeuTab

<p align="center">
  <img src="assets/icon.png" alt="NeuTab" width="128" height="128">
</p>

<p align="center">
  <strong>NeuTab browser new tab extension</strong>
</p>

<p align="center">
  NeuTab is a lightweight browser new tab extension with search and quick launch.
</p>

<p align="center">
  <a href="#installation">Installation</a> •
  <a href="#development">Development</a> •
  <a href="LICENSE">License</a> •
  <a href="#neutab-1">中文文档</a>
</p>

<p align="center">
  <img src="assets/Interface%20Demo.png" alt="NeuTab interface preview" width="900">
</p>

---

## Installation

### From Web Store
*(Pending launch)*

### Manual Installation (Chrome / Edge / Brave)

1. **Download**: Clone this repository or download the latest release.
2. **Install Dependencies**:
   ```bash
   pnpm install
   ```
3. **Build**:
   ```bash
   pnpm build
   ```
4. **Load Extension**:
   - Open `chrome://extensions/`
   - Enable **Developer mode** (top right).
   - Click **Load unpacked**.
   - Select the `build/chrome-mv3-prod` folder.

### Manual Installation (Firefox)

Firefox does not support loading unpacked extensions permanently during development.

1. **Build for Firefox**:
   ```bash
   pnpm build:firefox
   ```
2. **Temporary Load**:
   - Open `about:debugging#/runtime/this-firefox`
   - Click **Load Temporary Add-on...**
   - Select `build/firefox-mv3-prod/manifest.json`.

---

## Development

### Prerequisites
- Node.js 18+
- pnpm (recommended)

### Setup

```bash
# Install dependencies
pnpm install

# Start development server (HMR supported)
pnpm dev

# Build for production
pnpm build

# Package for distribution (zip)
pnpm package
```

### Firefox Development
Plasmo supports specific targets for cross-browser compatibility.

```bash
# Dev for Firefox
pnpm dev:firefox

# Build for Firefox
pnpm build:firefox
```

### Project Structure
```
NeuTab/
├── components/
│   ├── header/             # Clock & Greetings
│   ├── quick-launch/       # App grids, Groups, Drag & Drop logic
│   ├── search/             # Search bar, Engines, Suggestions
│   ├── settings/           # Settings panel, Layout preview
│   └── common/             # Shared UI components
├── assets/                 # Static assets & Icons
├── bootstrap/              # Theme restoration & Storage sync
├── pages/                  # Extension pages (NewTab)
├── styles/                 # Global CSS & Theme definitions
│   └── themes/             # Specific theme styles (e.g., liquid-glass.css)
└── utils/                  # Helpers (Storage, I18n, Favicons)
```

---

# NeuTab

<p align="center">
  <strong>NeuTab 浏览器新标签页扩展</strong>
</p>

<p align="center">
  NeuTab 是一款轻量的浏览器新标签页插件，提供搜索与快捷启动。
</p>

<p align="center">
  <a href="#安装方法">安装方法</a> •
  <a href="#开发指南">开发指南</a> •
  <a href="LICENSE">许可证</a>
</p>

## 安装方法

### 从插件商店
*（待上线）*

### 手动安装 (Chrome / Edge / Brave)

1. **下载**：克隆本仓库或下载最新 Release 包。
2. **安装依赖**：
   ```bash
   pnpm install
   ```
3. **构建**：
   ```bash
   pnpm build
   ```
4. **加载扩展**：
   - 打开浏览器扩展管理页 `chrome://extensions/`
   - 开启右上角的 **开发者模式**。
   - 点击 **加载已解压的扩展程序**。
   - 选择 `build/chrome-mv3-prod` 目录。

### 手动安装 (Firefox)

Firefox 在开发模式下不支持永久加载未签名的已解压扩展。

1. **构建 Firefox 版本**：
   ```bash
   pnpm build:firefox
   ```
2. **临时加载**：
   - 打开 `about:debugging#/runtime/this-firefox`
   - 点击 **临时载入附加组件...**
   - 选择 `build/firefox-mv3-prod/manifest.json` 文件。

---

## 开发指南

### 环境要求
- Node.js 18+
- pnpm (推荐)

### 快速开始

```bash
# 安装项目依赖
pnpm install

# 启动开发服务器 (支持热更新)
pnpm dev

# 构建生产版本
pnpm build

# 打包发布 (生成 zip)
pnpm package
```

### Firefox 开发
Plasmo 提供了针对不同浏览器的构建目标。

```bash
# Firefox 开发模式
pnpm dev:firefox

# Firefox 生产构建
pnpm build:firefox
```

### 项目结构
```
NeuTab/
├── components/
│   ├── header/             # 顶部时钟与问候
│   ├── quick-launch/       # 快捷启动网格、分组、拖拽逻辑
│   ├── search/             # 搜索框、引擎管理、联想建议
│   ├── settings/           # 设置面板、实时布局预览
│   └── common/             # 通用 UI 组件
├── assets/                 # 静态资源与构建补丁
├── bootstrap/              # 主题恢复与存储同步脚本
├── pages/                  # 扩展页面入口 (NewTab)
├── styles/                 # 全局样式与主题定义
│   └── themes/             # 特定主题样式 (如 liquid-glass.css)
└── utils/                  # 工具库 (存储封装、多语言、Favicon)
```
