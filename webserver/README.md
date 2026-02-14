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
cd webserver

# 安装依赖
pnpm install

# 启动前端 (http://localhost:5173，代理 /api 到 3001)
pnpm --filter neutab-web-client dev

# 启动后端 (http://localhost:3001)
pnpm --filter neutab-web-server dev
```

**注意**：`better-sqlite3` 是原生模块，如果 pnpm 禁用了构建脚本：

```bash
pnpm -w approve-builds
pnpm -w rebuild better-sqlite3
```

---

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `AUTH_CODE` | **是** | - | 登录认证码 |
| `JWT_SECRET` | **是**¹ | - | JWT 签名密钥 |
| `PORT` | 否 | `3001` | 服务端口 |
| `DATA_DIR` | 否 | `/app/data` | 数据目录（SQLite、图标、缓存） |
| `CORS_ORIGIN` | 否 | `*` | CORS 白名单，逗号分隔² |
| `TRUST_PROXY` | 否 | `false` | 反向代理模式，设为 `1` 启用 |
| `FAVICON_CACHE_TTL_SECONDS` | 否 | `2592000` | Favicon 缓存时间（秒） |
| `FAVICON_NEGATIVE_CACHE_TTL_SECONDS` | 否 | `3600` | Favicon 负缓存时间（上游 404，秒） |
| `FAVICON_UPSTREAM_TIMEOUT_MS` | 否 | `8000` | Favicon 请求超时（毫秒） |
| `MAX_ICON_BYTES` | 否 | `1048576` | 图标最大字节数 |
| `MAX_SYNC_KEYS` | 否 | `200` | 同步 payload 最大 key 数 |
| `MAX_SYNC_VALUE_BYTES` | 否 | `2097152` | 同步单个 value 最大字节数 |

¹ 生产环境必填
² 支持前缀通配：`chrome-extension://*`

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

### better-sqlite3 构建失败

```bash
pnpm -w approve-builds
pnpm -w rebuild better-sqlite3
```

### 登录返回 429

触发了限流保护，等待 `Retry-After` 头指示的秒数后重试。

### Docker 构建慢

使用预构建镜像：

```bash
docker pull ghcr.io/li88iioo/neutab:latest
```
