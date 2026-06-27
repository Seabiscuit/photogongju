# 🚀 PhotoGongju — Ubuntu 服务器部署指南

## 📁 部署目录结构

```
deploy/
├── install.sh                          # ★ 一键部署脚本（系统更新→环境→代码→模型→Supervisor→Nginx）
├── supervisor/
│   ├── photogongju-node.conf           # Node.js Express 主站进程守护
│   └── photogongju-python.conf         # Python FastAPI AI 服务进程守护
├── nginx/
│   └── photogongju.conf                # 宝塔面板 / 原生 Nginx 完整配置
├── scripts/
│   └── cleanup_temp.sh                 # 定时清理脚本（人脸隐私合规）
├── cos/
│   ├── cosStorage.js                   # 腾讯 COS 对象存储集成模块
│   └── integration-guide.js            # COS 改造指南 + .env 模板
└── README.md                           # 本文件
```

---

## ⚡ 快速部署（推荐）

```bash
# 1. 上传项目到服务器
scp -r photogongju/ root@你的服务器IP:/opt/

# 2. 赋予执行权限
cd /opt/photogongju/deploy
chmod +x install.sh scripts/cleanup_temp.sh

# 3. 设置环境变量（可选，不设置则使用默认值）
export DOMAIN="photogongju.yourdomain.com"
export USE_CN_MIRROR=1

# 4. 一键部署
sudo bash install.sh
```

---

## 📋 分步部署

```bash
# 仅安装系统环境和 Node/Python
sudo bash install.sh --step=env

# 仅部署应用代码和依赖
sudo bash install.sh --step=app

# 仅下载 AI 模型
sudo bash install.sh --step=models

# 仅配置 Supervisor 守护
sudo bash install.sh --step=supervisor

# 仅配置 Nginx 反向代理
sudo bash install.sh --step=nginx
```

---

## 🔧 Supervisor 进程管理

```bash
# 查看所有进程状态
supervisorctl status

# 重启 Node 主站
supervisorctl restart photogongju-node

# 重启 Python AI 服务
supervisorctl restart photogongju-python

# 查看实时日志
supervisorctl tail -f photogongju-node
supervisorctl tail -f photogongju-python

# 停止服务
supervisorctl stop photogongju-node photogongju-python

# 启动服务
supervisorctl start photogongju-node photogongju-python

# 查看日志文件
tail -f /opt/photogongju/logs/node_web.log
tail -f /opt/photogongju/logs/python_ai.log
```

---

## 🌐 Nginx 配置（宝塔面板）

### 宝塔面板方式

1. 进入宝塔面板 → 网站 → 添加站点
2. 填写域名，创建站点
3. 进入站点设置 → 配置文件
4. 复制 [nginx/photogongju.conf](nginx/photogongju.conf) 的全部内容，粘贴替换
5. 保存 → 重载 Nginx

### 原生 Nginx 方式

```bash
sudo cp deploy/nginx/photogongju.conf /etc/nginx/sites-available/photogongju
sudo ln -sf /etc/nginx/sites-available/photogongju /etc/nginx/sites-enabled/photogongju
sudo nginx -t && sudo systemctl reload nginx
```

### SSL 证书配置（HTTPS）

```bash
# 使用 Let's Encrypt 免费证书
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d photogongju.yourdomain.com

# 然后在 Nginx 配置中取消 HTTPS server 块的注释
```

---

## 🔒 隐私合规 — 定时清理

```bash
# 安装定时任务（每天凌晨 3:00 执行）
sudo crontab -e
# 添加以下行：
0 3 * * * /opt/photogongju/deploy/scripts/cleanup_temp.sh >> /var/log/photogongju_cleanup.log 2>&1

# 手动执行一次测试
sudo bash /opt/photogongju/deploy/scripts/cleanup_temp.sh
```

清理策略（可自定义）：
- 用户上传原图：**7 天后安全擦除**（shred 覆写）
- 处理结果图片：**7 天后自动删除**
- 日志文件：**30 天后压缩归档**，90 天后删除
- 所有操作记录审计日志至 `/var/log/photogongju_cleanup.log`

---

## ☁️ 腾讯 COS 对象存储 (可选)

### 配置步骤

1. 腾讯云控制台创建 COS 存储桶
2. 获取 SecretId / SecretKey（建议使用子账号，权限最小化）
3. 在 `node_web/.env` 中配置：

```env
COS_REGION=ap-guangzhou
COS_BUCKET=photogongju-1234567890
COS_SECRET_ID=你的SecretId
COS_SECRET_KEY=你的SecretKey
COS_CDN_DOMAIN=cdn.yourdomain.com
```

4. 安装 SDK：
```bash
cd /opt/photogongju/node_web
npm install cos-nodejs-sdk-v5
```

5. 按 [cos/integration-guide.js](cos/integration-guide.js) 的指引改造上传路由

### COS 生命周期规则（推荐在控制台配置）

| 前缀 | 规则 | 说明 |
|------|------|------|
| `uploads/` | 7天后自动删除 | 用户上传原图 |
| `outputs/` | 7天后自动删除 | 处理结果图片 |
| `temp/` | 1天后自动删除 | 临时文件 |

---

## 📝 部署后检查清单

- [ ] Node 服务运行: `supervisorctl status photogongju-node` → RUNNING
- [ ] Python AI 运行: `supervisorctl status photogongju-python` → RUNNING
- [ ] Nginx 代理正常: `curl -I http://localhost` → 200 OK
- [ ] AI 健康检查: `curl http://localhost/api/v1/health` → {"status":"ok"}
- [ ] AI 模型就绪: 检查 `/opt/photogongju/python_ai/weights/` 目录
- [ ] 定时清理配置: `crontab -l` 包含清理脚本
- [ ] 防火墙开放端口: `ufw allow 80/tcp && ufw allow 443/tcp`
- [ ] 日志正常输出: `tail -f /opt/photogongju/logs/node_web.log`

---

## 🛟 故障排查

```bash
# Node 服务无法启动
cat /opt/photogongju/logs/node_web.log | tail -50

# Python AI 服务崩溃
cat /opt/photogongju/logs/python_ai.log | tail -50

# 端口被占用
lsof -i :3000
lsof -i :8001

# Nginx 配置测试
nginx -t

# 手动启动测试
cd /opt/photogongju/node_web && node app.js
cd /opt/photogongju/python_ai && source venv/bin/activate && python main.py
```
