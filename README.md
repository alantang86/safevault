# 🛡️ SafeVault - 轻量安全免安装密码管理器

SafeVault 是一款专为个人打造的**轻量级、免安装、零知识加密（Zero-Knowledge）**的安全密码管理器。
支持本地微型数据库存储（SQLite）、单文件便携运行，以及通过 Docker 一键部署至家庭 NAS（群晖、威联通、极空间、绿联、Unraid 等），结合 Cloudflare Tunnel 实现免公网 IPv4 的全球安全访问。

---

## ✨ 核心特性

- 🔒 **零知识端到端加密**：客户端直接采用现代浏览器底层 **Web Crypto API**，通过 **PBKDF2（100,000次迭代）+ AES-GCM-256** 加密。主密码永远不会离开浏览器，服务端只存储加密密文，无主密码任何人（包括服务器运维人员）都无法解密。
- 📦 **微型数据库**：基于轻量级单文件 **SQLite 3** 数据库，体积仅数十 KB，零配置、易备份、便携可随身携带。
- ⚡ **真正的免安装与零依赖**：服务端 100% 采用 Python 原生标准库，前端纯原生 HTML5/JS/CSS，**无需 `pip install` 或 `npm install` 任何第三方依赖**。
- 📱 **多种账号与凭证分类**：内置支持网站 Web、客户端 APP、服务器/SSH/DB、银行卡/支付、Wi-Fi 密码、加密备忘录/API Key 等。
- 🔑 **强密码生成器**：支持自定义长度（8~64位）、大小写、数字、符号及易混淆字符过滤。
- 💾 **安全备份与迁移**：支持一键导出/导入加密的 JSON 备份文件。
- 🚀 **NAS & 远程友好**：提供开箱即用的 Docker 镜像与 `docker-compose.yml`，原生支持接入 Cloudflare Tunnel，全自动配置 HTTPS 并转为 IPv4 站点。

---

## 💻 快速开始（本地免安装使用）

### Windows 用户
1. 下载/克隆本项目到本地任意文件夹。
2. 双击运行根目录下的 `启动SafeVault.bat`。
3. 系统将自动启动本地极简微服务，并拉起 Edge 桌面独立无边框应用窗口。
4. 首次使用请设置主密码（请牢记，不可找回），进入后即可使用。

### macOS / Linux 用户
```bash
python3 server.py --open
```
在浏览器中打开 `http://127.0.0.1:19527` 即可。

---

## 🏠 NAS 部署详细指南 (Docker Compose)

本应用内存占用极低（**< 20MB**），非常适合 7x24 小时运行在群晖 Synology、威联通 QTS、极空间、绿联 UGOS、Unraid 等 NAS 设备上。

### 第一步：准备文件
在 NAS 的 Docker 共享目录下创建文件夹（例如 `/docker/safevault`），将本项目的文件复制进去：
```text
/docker/safevault/
├── docker-compose.yml
├── server.py
├── web/
│   ├── index.html
│   ├── style.css
│   ├── crypto.js
│   └── app.js
└── data/             # 用于持久化存放 SQLite 数据库，无则自动生成
```

### 第二步：启动容器
在终端进入该目录执行：
```bash
docker compose up -d
```
或在群晖的 **Container Manager** / 极空间 Docker 中选择“项目”导入 `docker-compose.yml` 启动。

启动后局域网访问：`http://<NAS局域网IP>:19527`

---

## 🌐 配合 Cloudflare Tunnel 实现国内公网 IPv4 访问

由于大部分家庭宽带没有公网 IPv4 且封锁了 80/443 端口，通过 **Cloudflare Tunnel** 可以实现：
1. **无需公网 IPv4 / 端口映射**，只要 NAS 能联网即可打通。
2. **免费自动配置 HTTPS 证书**（Web Crypto API 必须在 HTTPS 或 localhost 才能运行）。
3. **Cloudflare 自动提供全球 IPv4 双栈 CDN**，国内手机流量秒级访问。

### 具体配置步骤：

1. **登录 Cloudflare Zero Trust**：
   访问 [Cloudflare Zero Trust 控制台](https://one.dash.cloudflare.com/)。
2. **创建隧道（Tunnel）**：
   - 点击左侧导航栏 **Networks** -> **Tunnels** -> **Create a tunnel**。
   - 选择 **Cloudflared** 连接器，自定义隧道名称（如 `nas-safevault`）。
3. **获取 Tunnel Token 并接入 NAS**：
   - 方式 A（推荐，一体化编排）：在 NAS 的 `docker-compose.yml` 同级目录下创建 `.env` 文件：
     ```text
     TUNNEL_TOKEN=eyJhIj...你复制的Token字符串...
     ```
     重新运行 `docker compose up -d` 即可。
   - 方式 B（单容器运行）：
     ```bash
     docker run -d --name cloudflared --restart=always cloudflare/cloudflared:latest tunnel --no-autoupdate run --token <你的Token>
     ```
4. **配置公共主机名（Public Hostname）**：
   - 在 Tunnel 配置页面切换到 **Public Hostname**，点击 **Add a public hostname**。
   - **Subdomain**：填入子域名前缀（例如 `vault`）。
   - **Domain**：选择你在 Cloudflare 托管的域名（例如 `yourdomain.com`）。
   - **Service Type**：选择 `HTTP`。
   - **URL**：
     - 若同在一个 compose 网络中填：`safevault:19527`
     - 或直接填 NAS 局域网地址：`192.168.x.x:19527`
5. **保存并访问**：
   外网使用手机或电脑浏览器打开：`https://vault.yourdomain.com` 即可使用。

### 进阶安全建议（Zero Trust 访问白名单）
为了防止未授权访客嗅探你的域名，强烈建议在 Cloudflare 控制台添加 **Access Policy**：
- 在 **Access** -> **Applications** 中添加该域名。
- 设置策略为：**仅向你的私人邮箱发送 6 位验证码**。
- 这样能达到 **外层邮箱 2FA 防火墙 + 内层 AES-GCM 零知识密码库** 的企业级双重防护！

---

## 📖 使用说明

1. **首次初始化**：首次打开系统时，会提示设置主密码（Master Password）。由于采用端到端零知识加密，**没有任何管理员能协助重置密码**，请务必牢记。
2. **添加条目**：点击右上角「➕ 新建密码条目」，选择分类（网站、服务器、银行卡等），填写对应信息。可以点击「⚡生成」快速创建高强度随机密码。
3. **解密查看与复制**：列表默认脱敏隐藏密码。点击「复制密码」会直接解密并写入剪贴板；点击卡片可查看完整详细信息及自定义备忘录。
4. **备份导出与导入**：
   - 定期点击侧边栏「💾 导出备份 (JSON)」，数据将以加密格式离线保存至你的电脑。
   - 更换设备或重装系统时，点击「📥 导入备份」即可瞬间还原全部记录。

---

## 📄 License

MIT License
