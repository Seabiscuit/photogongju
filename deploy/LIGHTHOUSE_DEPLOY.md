# PhotoGongju — 腾讯云轻量应用服务器部署指南

## 一、购买与初始配置

### 1.1 选购轻量服务器

1. 登录 [腾讯云轻量应用服务器控制台](https://console.cloud.tencent.com/lighthouse)
2. 点击「新建」→ 选择配置：

| 配置项 | 推荐值 | 说明 |
|--------|--------|------|
| 地域 | 与用户最近的区域 | 国内选北上广 |
| 镜像 | **Ubuntu 22.04** 或 **宝塔面板 9.x** | 若选宝塔镜像则第3步可跳过 |
| 套餐 | **2核4G** 及以上 | AI模型推理需要内存 |
| 磁盘 | 60GB+（系统盘即可） | u2net.onnx 模型 176MB |
| 时长 | 1月起 | 建议年付更优惠 |

3. 完成支付，等待实例创建（约1-2分钟）

### 1.2 防火墙配置

轻量服务器控制台 → 实例详情 → **防火墙** → 添加规则：

| 端口 | 协议 | 说明 |
|------|------|------|
| **80** | TCP | HTTP 网站访问 |
| **443** | TCP | HTTPS 加密访问 |
| **22** | TCP | SSH 远程管理 |
| **8888** | TCP | 宝塔面板（如使用宝塔镜像） |
| **3000** | TCP | Node.js 直接访问（可选，建议仅通过Nginx代理） |

> 注意：`3000` 和 `8001` 端口**不需要**对外开放，Nginx 代理 80→3000 即可。

---

## 二、连接服务器

### 2.1 方式一：轻量控制台一键登录

1. 轻量控制台 → 实例 → 点击「登录」
2. 选择「免密登录」（OrcaTerm）→ 直接进入终端

### 2.2 方式二：SSH 本地登录

```bash
# 在轻量控制台 → 密钥对 → 下载密钥，或使用密码
ssh -i your-key.pem ubuntu@你的服务器IP
# 或
ssh root@你的服务器IP
# 输入轻量控制台设置的密码
```

---

## 三、环境部署

### 路线A：宝塔面板（推荐新手）

若选购了宝塔镜像，跳过 3.1；否则手动安装：

```bash
# 安装宝塔面板
wget -O install.sh https://download.bt.cn/install/install-ubuntu_6.0.sh
sudo bash install.sh

# 安装完成后会显示面板地址、用户名、密码，务必保存
# 登录地址: http://你的IP:8888/xxxxxxxx
```

宝塔面板登录后 → 软件商店 → 安装：
- **Nginx** 1.24+
- **Node.js版本管理器** → 安装 Node 18 LTS
- **进程守护管理器**（Supervisor）

然后参考 [宝塔部署指南](./BAOTA_DEPLOY.md) 完成后续步骤。

### 路线B：全命令行部署（适合熟练用户）

```bash
# 1. 更新系统 & 安装依赖
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx supervisor python3 python3-pip python3-venv python3-dev build-essential curl git

# 2. 安装 Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
sudo apt install -y nodejs

# 3. 克隆项目
sudo mkdir -p /opt/photogongju
cd /opt/photogongju
git clone https://github.com/Seabiscuit/photogongju.git .

# 4. 安装依赖
cd node_web
npm config set registry https://registry.npmmirror.com
npm install

cd ../python_ai
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
deactivate

# 5. 下载 AI 模型
cd weights
wget -O u2net.onnx "https://github.com/danielgatis/rembg/releases/download/v0.1.4/rembg.onnx"

# 6. 创建必要目录
sudo mkdir -p /opt/photogongju/logs
sudo mkdir -p /opt/photogongju/python_ai/uploads
sudo mkdir -p /opt/photogongju/python_ai/outputs

# 7. 配置 Supervisor（进程守护）
sudo cp /opt/photogongju/deploy/supervisor/photogongju-node.conf /etc/supervisor/conf.d/
sudo cp /opt/photogongju/deploy/supervisor/photogongju-python.conf /etc/supervisor/conf.d/
sudo supervisorctl reread && sudo supervisorctl update
sudo supervisorctl start photogongju-node photogongju-python

# 8. 配置 Nginx
sudo cp /opt/photogongju/deploy/nginx/photogongju.conf /etc/nginx/sites-available/photogongju
sudo sed -i 's/photogongju\.example\.com/你的域名或IP/g' /etc/nginx/sites-available/photogongju
sudo ln -s /etc/nginx/sites-available/photogongju /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

---

## 四、配置域名与 SSL

### 4.1 域名解析

1. 腾讯云控制台 → **DNS 解析**（或你的域名注册商）
2. 添加 A 记录：

| 主机记录 | 记录类型 | 记录值 |
|----------|----------|--------|
| `@`（或 www） | A | 轻量服务器公网 IP |

3. 等待 DNS 生效（通常几分钟）

### 4.2 SSL 证书（宝塔一键申请）

宝塔面板 → 网站 → 站点设置 → **SSL** → 选择「Let's Encrypt」→ 一键申请。

### 4.3 SSL 证书（手动/Nginx 配置）

```bash
# 使用 certbot 申请免费 HTTPS 证书
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 你的域名.com
# 按提示操作，证书自动配置并续期
```

---

## 五、配置环境变量（生产支付等）

```bash
# 创建环境变量文件
sudo nano /etc/environment

# 添加以下内容（按需配置）
NODE_ENV=production
# 易宝支付配置（获取方式见会员页面 UI 提示）
YEEPAY_APP_KEY=your_app_key
YEEPAY_MERCHANT_NO=your_merchant_no
YEEPAY_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...(商户私钥)...
-----END RSA PRIVATE KEY-----"
YEEPAY_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----
...(易宝公钥)...
-----END PUBLIC KEY-----"
```

重启服务使环境变量生效：

```bash
sudo supervisorctl restart photogongju-node photogongju-python
```

---

## 六、验证部署

```bash
# 1. 健康检查
curl http://localhost:3000/api/health
curl http://localhost:8001/api/v1/health

# 2. 通过域名访问
curl https://你的域名.com/
# 应返回完整 HTML 页面

# 3. 查看服务状态
sudo supervisorctl status
# photogongju-node    RUNNING
# photogongju-python  RUNNING

# 4. 查看日志
tail -f /opt/photogongju/logs/node_web.log
tail -f /opt/photogongju/logs/python_ai.log
```

---

## 七、轻量服务器特色功能

### 7.1 对象存储 COS

轻量服务器通常赠送 COS 存储包，可将用户上传文件存储到 COS：

1. 腾讯云控制台 → 对象存储 COS → 创建存储桶
2. 参考 `deploy/cos/` 目录中的集成代码
3. 修改 `node_web/services/aiService.js` 连接 COS

### 7.2 快照备份

轻量控制台 → 实例 → **快照** → 创建快照，可随时回滚。

### 7.3 监控与告警

轻量控制台 → 实例详情 → **监控** 页可查看 CPU、内存、带宽使用情况。

### 7.4 自动续费

轻量控制台 → 实例 → 更多 → **自动续费**，避免服务到期中断。

---

## 八、常见问题

| 问题 | 解决 |
|------|------|
| 访问 IP 无法打开 | 检查轻量防火墙是否开放 80 端口 |
| `Cannot find module 'express'` | 未执行 `npm install`，在 `node_web/` 目录执行 |
| AI 抠图失败 | 确认 `u2net.onnx` 在 `python_ai/weights/` 目录 |
| 502 Bad Gateway | `supervisorctl status` 检查后端进程 |
| 内存不足 | 升级轻量套餐至 4G+ 或增加 swap |
| HTTPS 证书到期 | certbot 自动续期；宝塔面板 SSL 自动续期 |
