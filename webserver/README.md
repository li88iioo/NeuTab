# NeuTab Web Server

自托管的 NeuTab Web 版本与云同步服务。

## 功能

- **Web 访问** — 无需安装浏览器扩展即可使用 NeuTab
- **云同步** — 为浏览器扩展提供配置同步服务
- **数据持久化** — SQLite 存储，支持图标、Favicon 缓存
- **轻量部署** — Docker 镜像约 200MB，支持 amd64/arm64

---

## 快速开始

### Docker Compose（推荐）

```bash
cd webserver
cp .env.example .env
# 生成随机 JWT_SECRET 并写入 .env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -base64 32)/" .env
# 编辑 .env 设置 AUTH_CODE
docker compose up -d --build
```

访问 `http://localhost:3001`，使用 `AUTH_CODE` 登录。

### 使用预构建镜像

```bash
# 拉取镜像
docker pull ghcr.io/li88iioo/neutab:latest

# 使用 docker-compose.ghcr.yml
cd webserver
cp .env.example .env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -base64 32)/" .env
docker compose -f docker-compose.ghcr.yml up -d

# 或直接运行
docker run -d -p 3001:3001 \
  -e AUTH_CODE=your_code \
  -e JWT_SECRET=$(openssl rand -base64 32) \
  -v ./data:/app/data \
  ghcr.io/li88iioo/neutab:latest
```

---

## 本地开发

```bash
# 从仓库根目录执行
pnpm install
cp webserver/.env.example webserver/.env
# 编辑 webserver/.env 设置 AUTH_CODE 和 JWT_SECRET
pnpm --dir webserver dev
```

本地开发会同时启动：
- 前端：`http://localhost:5173`
- 后端：`http://localhost:3001`

前端 Vite 会把 `/api` 代理到 `localhost:3001`。如果只启动 `neutab-web-client`，登录接口没有后端可用，会出现登录失败或服务端配置错误。

也可以分开启动：

```bash
# 终端 1：后端 API
pnpm --filter neutab-web-server dev

# 终端 2：前端 Vite
pnpm --filter neutab-web-client dev
```

本地 `.env` 默认放在 `webserver/.env`。后端支持从仓库根目录、`webserver/` 或 `webserver/server/` 启动时自动读取该文件。

**注意**：`better-sqlite3` 是原生模块，如果 pnpm 禁用了构建脚本：

```bash
pnpm -w approve-builds
pnpm -w rebuild better-sqlite3
```

如果切换过 Node 版本后仍报 `NODE_MODULE_VERSION` 不匹配，请按当前 Node 版本重编译：

```bash
npm run build-release --prefix node_modules/.pnpm/better-sqlite3@12.6.2/node_modules/better-sqlite3
```

---

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `AUTH_CODE` | **是** | - | 登录认证码 |
| `JWT_SECRET` | **是**¹ | - | JWT 签名密钥 |
| `PORT` | 否 | `3001` | 服务端口 |
| `DATA_DIR` | 否 | `/app/data` | 数据目录（SQLite、图标、缓存） |
| `CORS_ORIGIN` | 否 | 本机开发源 | CORS 白名单，逗号分隔² |
| `TRUST_PROXY` | 否 | `false` | 反向代理模式，设为 `1` 启用 |
| `FAVICON_CACHE_TTL_SECONDS` | 否 | `2592000` | Favicon 缓存时间（秒） |
| `FAVICON_NEGATIVE_CACHE_TTL_SECONDS` | 否 | `3600` | Favicon 负缓存时间（上游 404，秒） |
| `FAVICON_UPSTREAM_TIMEOUT_MS` | 否 | `8000` | Favicon 请求超时（毫秒） |
| `MAX_ICON_BYTES` | 否 | `1048576` | 图标最大字节数 |
| `MAX_SYNC_KEYS` | 否 | `200` | 同步 payload 最大 key 数 |
| `MAX_SYNC_VALUE_BYTES` | 否 | `2097152` | 同步单个 value 最大字节数 |

¹ 生产环境必填
² 普通 Web origin 只支持精确匹配；自用未上架扩展可使用 `chrome-extension://*` 或 `moz-extension://*` 适配随机扩展 ID。

---

## 认证方式

### 1. JWT Token（推荐）

```bash
# 登录获取 token
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"authCode": "your_auth_code"}'

# 使用 token
curl http://localhost:3001/api/storage/all \
  -H "Authorization: Bearer <token>"
```

### 2. X-Auth-Code 头

```bash
curl http://localhost:3001/api/storage/all \
  -H "X-Auth-Code: your_auth_code"
```

---

## API 参考

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/auth/login` | 登录获取 JWT |

请求体：`{ "authCode": "<AUTH_CODE>" }`
返回：`{ "token": "..." }`

### 同步（推荐 v3）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/sync/pull?v=3` | 拉取配置 |
| `POST` | `/api/sync/push` | 推送配置 |

**v3 协议**：图标单独上传，同步 payload 更轻量

```bash
# 拉取
GET /api/sync/pull?v=3
# 返回: { data: { settings, iconIds } }

# 推送
POST /api/sync/push
# Body: { version: 3, data: { settings } }

# 图标上传
POST /api/icons/uploadRaw/:id
# Content-Type: image/png
```

### 存储

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/storage/get/:key` | 获取单个键值 |
| `GET` | `/api/storage/all` | 获取所有键值 |
| `POST` | `/api/storage/set` | 设置单个键值 |
| `POST` | `/api/storage/setMany` | 批量设置 |
| `POST` | `/api/storage/getMany` | 批量获取 |
| `POST` | `/api/storage/remove` | 删除键值 |

### 图标

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/icons/upload` | 上传图标（JSON Base64） |
| `POST` | `/api/icons/uploadRaw/:id` | 上传图标（二进制） |
| `GET` | `/api/icons/:id` | 获取图标（公开） |
| `DELETE` | `/api/icons/:id` | 删除图标 |

### Favicon 代理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/favicon?domain=example.com` | 获取网站 Favicon |

---

## 浏览器扩展云同步

1. 打开扩展设置 → **备份** → 启用 **云同步**
2. 填写服务器地址（如 `https://neutab.example.com`）
3. 填写 `AUTH_CODE`
4. 点击 **拉取配置** / **推送配置**

---

## 反向代理配置

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name neutab.example.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

设置 `TRUST_PROXY=1` 以正确获取客户端 IP。

### Caddy

```caddyfile
neutab.example.com {
    reverse_proxy localhost:3001
}
```

---

## 数据目录结构

```
/app/data/
├── neutab.db           # SQLite 数据库
├── icons/              # 用户上传的图标
└── favicon-cache/      # Favicon 缓存
```

Docker 部署时挂载 `./data:/app/data` 实现数据持久化。

---

## 故障排查

### 登录提示“服务端未配置访问码（AUTH_CODE）”

优先检查三件事：

1. 确认 `webserver/.env` 存在，并且已设置非空 `AUTH_CODE`。
2. 确认后端正在监听 `http://localhost:3001`，不要只启动前端 Vite。
3. 本地开发建议直接运行 `pnpm --dir webserver dev`，它会同时启动前端和后端。

如果后端启动失败，先查看终端日志；常见原因是 `better-sqlite3` 原生模块 ABI 与当前 Node 版本不匹配。

### 启动时报 `EADDRINUSE: address already in use :::3001`

说明已有进程占用了后端端口 `3001`，通常是上一次启动的 `neutab-web-server` 还在运行，或 Docker 容器已经占用了该端口。

处理方式：

```bash
# 查看占用 3001 的进程
ss -ltnp | grep ':3001'

# 停掉旧进程，或改用其他端口
PORT=3002 pnpm --dir webserver dev
```

如果改端口，本地前端代理也需要同步改到相同端口，默认推荐还是释放 `3001`。

### better-sqlite3 构建失败

```bash
pnpm -w approve-builds
pnpm -w rebuild better-sqlite3
```

切换 Node 版本后如仍失败：

```bash
npm run build-release --prefix node_modules/.pnpm/better-sqlite3@12.6.2/node_modules/better-sqlite3
```

### 登录返回 429

触发了限流保护，等待 `Retry-After` 头指示的秒数后重试。

### Docker 构建慢

使用预构建镜像：

```bash
docker pull ghcr.io/li88iioo/neutab:<version>
```
