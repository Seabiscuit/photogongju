#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════╗
# ║  PhotoGongju 远程部署脚本 — 在腾讯云服务器 Web SSH 中直接执行          ║
# ║  使用方式:                                                           ║
# ║    1. 腾讯云控制台 → CVM → 登录 → 标准登录                            ║
# ║    2. 复制本脚本全部内容，粘贴到 Web SSH 终端中执行                      ║
# ║    3. 等待 5-10 分钟安装完成                                          ║
# ╚══════════════════════════════════════════════════════════════════════╝
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'
log() { echo -e "${GREEN}[OK]${NC}  $1"; }
step() { echo -e "\n${CYAN}${BOLD}>>> $1${NC}"; }

# ═══════════════════════════════════════════════════════════
# Step 0: 创建项目目录 & 写入代码
# ═══════════════════════════════════════════════════════════
step "Step 0: 创建项目结构"
sudo mkdir -p /opt/photogongju/{node_web/{public/{css,js,uploads},views,routes,services,data,middleware,models},python_ai/{api,services,models,utils,weights,uploads,outputs},deploy/{supervisor,nginx,scripts,cos},scripts}
sudo chown -R ubuntu:ubuntu /opt/photogongju
log "目录结构已创建"

# ═══════════════════════════════════════════════════════════
# Step 1: 系统更新
# ═══════════════════════════════════════════════════════════
step "Step 1: 系统更新 & 基础依赖"
sudo apt update -y && sudo apt upgrade -y
sudo apt install -y curl wget git unzip nginx supervisor cron rsync \
    build-essential libssl-dev python3-pip python3-venv
log "系统更新完成"

# ═══════════════════════════════════════════════════════════
# Step 2: Node.js 18 安装
# ═══════════════════════════════════════════════════════════
step "Step 2: 安装 Node.js 18"
if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt install -y nodejs
fi
log "Node.js $(node -v)"
log "npm $(npm -v)"

# ═══════════════════════════════════════════════════════════
# Step 3: Python 环境
# ═══════════════════════════════════════════════════════════
step "Step 3: Python 环境检查"
PY_VER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
log "Python $PY_VER"
pip3 install --upgrade pip -q
log "pip 升级完成"

# ═══════════════════════════════════════════════════════════
# Step 4: 从本地上传代码
# ═══════════════════════════════════════════════════════════
step "Step 4: 代码部署"

# ★★★ 重要 ★★★
# 请先通过腾讯云控制台上传项目文件，或使用以下方式之一：
#
# 方式1 — 使用腾讯云文件上传功能（推荐）:
#   在 Web SSH 终端顶部点击「文件上传」按钮
#   将本地 f:\photogongju\ 目录下的 node_web/ 和 python_ai/ 上传到 /opt/photogongju/
#
# 方式2 — 使用 SCP（需要在安全组开放 22 端口）:
#   在本地执行:
#   scp -r f:/photogongju/node_web ubuntu@124.221.182.124:/opt/photogongju/
#   scp -r f:/photogongju/python_ai ubuntu@124.221.182.124:/opt/photogongju/
#   scp -r f:/photogongju/scripts ubuntu@124.221.182.124:/opt/photogongju/
#   scp -r f:/photogongju/deploy ubuntu@124.221.182.124:/opt/photogongju/
#
# 方式3 — 使用 Git（如果代码已推送到仓库）:
#   cd /opt/photogongju
#   git clone https://your-repo-url.git .

# 上传完成后，继续执行下面的命令
echo ""
echo -e "${YELLOW}=============================================${NC}"
echo -e "${YELLOW}请先上传代码文件，完成后按 Enter 继续...${NC}"
echo -e "${YELLOW}=============================================${NC}"
# read -p ""

# ═══════════════════════════════════════════════════════════
# Step 5: 安装依赖
# ═══════════════════════════════════════════════════════════
step "Step 5: 安装项目依赖"
cd /opt/photogongju/node_web
npm install --production 2>&1 | tail -5
log "Node.js 依赖安装完成"

cd /opt/photogongju/python_ai
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple 2>&1 | tail -5
deactivate
log "Python 依赖安装完成"

# ═══════════════════════════════════════════════════════════
# Step 6: Supervisor 进程守护
# ═══════════════════════════════════════════════════════════
step "Step 6: 配置 Supervisor 进程守护"

# Node.js 主站
sudo tee /etc/supervisor/conf.d/photogongju-node.conf > /dev/null << 'SUPNODE'
[program:photogongju-node]
process_name=photogongju-node
command=/usr/bin/node /opt/photogongju/node_web/app.js
directory=/opt/photogongju/node_web
user=ubuntu
autostart=true
autorestart=true
startsecs=5
startretries=10
exitcodes=0,2
stopsignal=TERM
stopwaitsecs=10
redirect_stderr=true
stdout_logfile=/opt/photogongju/logs/node_web.log
stdout_logfile_maxbytes=50MB
stdout_logfile_backups=10
environment=NODE_ENV="production",PORT="3000",AI_SERVICE_URL="http://127.0.0.1:8001"
priority=10
SUPNODE

# Python AI 服务
sudo tee /etc/supervisor/conf.d/photogongju-python.conf > /dev/null << 'SUPPY'
[program:photogongju-python]
process_name=photogongju-python
command=/opt/photogongju/python_ai/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8001 --workers 2 --log-level info
directory=/opt/photogongju/python_ai
user=ubuntu
autostart=true
autorestart=true
startsecs=10
startretries=10
exitcodes=0,2
stopsignal=TERM
stopwaitsecs=15
redirect_stderr=true
stdout_logfile=/opt/photogongju/logs/python_ai.log
stdout_logfile_maxbytes=50MB
stdout_logfile_backups=10
environment=AI_SERVICE_HOST="127.0.0.1",AI_SERVICE_PORT="8001"
priority=20
SUPPY

sudo mkdir -p /opt/photogongju/logs
sudo chown -R ubuntu:ubuntu /opt/photogongju/logs

sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl start photogongju-node photogongju-python
sleep 3
sudo supervisorctl status

log "Supervisor 配置完成"

# ═══════════════════════════════════════════════════════════
# Step 7: Nginx 反向代理
# ═══════════════════════════════════════════════════════════
step "Step 7: 配置 Nginx"

sudo tee /etc/nginx/sites-available/photogongju > /dev/null << 'NGINXCONF'
upstream node_backend { server 127.0.0.1:3000 weight=1 max_fails=3 fail_timeout=30s; keepalive 32; }
upstream python_backend { server 127.0.0.1:8001 weight=1 max_fails=3 fail_timeout=60s; keepalive 16; }

server {
    listen 80;
    listen [::]:80;
    server_name _;
    charset utf-8;
    client_max_body_size 50m;

    gzip on;
    gzip_vary on;
    gzip_min_length 256;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/javascript application/json application/javascript image/svg+xml font/ttf font/woff font/woff2;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    access_log /var/log/nginx/photogongju_access.log;
    error_log /var/log/nginx/photogongju_error.log;

    location ~* ^/(css|js|images|fonts|img)/.*\.(css|js|jpg|jpeg|png|gif|webp|svg|ico|woff|woff2|ttf|eot)$ {
        root /opt/photogongju/node_web/public;
        expires 30d;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    location /api/v1/ {
        proxy_pass http://python_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30s;
        proxy_send_timeout 180s;
        proxy_read_timeout 180s;
        proxy_buffering off;
        client_max_body_size 50m;
    }

    location ~* ^/(docs|redoc|openapi\.json) {
        proxy_pass http://python_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        proxy_pass http://node_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_connect_timeout 10s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        proxy_buffering off;
    }

    location ~ /\. { deny all; access_log off; }
    location ~* /(node_modules|__pycache__|\.git|\.env) { deny all; return 403; }
}
NGINXCONF

sudo ln -sf /etc/nginx/sites-available/photogongju /etc/nginx/sites-enabled/photogongju
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

log "Nginx 配置完成"

# ═══════════════════════════════════════════════════════════
# Step 8: 定时清理
# ═══════════════════════════════════════════════════════════
step "Step 8: 配置定时清理 (隐私合规)"

sudo tee /opt/photogongju/scripts/cleanup.sh > /dev/null << 'CLEANUP'
#!/bin/bash
BASE=/opt/photogongju
find $BASE/python_ai/uploads -type f -mtime +7 -delete 2>/dev/null
find $BASE/python_ai/outputs -type f -mtime +7 -delete 2>/dev/null
find $BASE/node_web/public/uploads -type f -mtime +7 -delete 2>/dev/null
echo "[$(date)] Cleanup done" >> /var/log/photogongju_cleanup.log
CLEANUP

sudo chmod +x /opt/photogongju/scripts/cleanup.sh
# 每天凌晨 3:00 清理
(sudo crontab -l 2>/dev/null; echo "0 3 * * * /opt/photogongju/scripts/cleanup.sh") | sudo crontab -
log "定时清理已配置 (每天3:00 AM)"

# ═══════════════════════════════════════════════════════════
# 完成
# ═══════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║  PhotoGongju 部署完成！                                  ║${NC}"
echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}${BOLD}║${NC}  访问地址: http://124.221.182.124"
echo -e "${GREEN}${BOLD}║${NC}  API 文档: http://124.221.182.124/docs"
echo -e "${GREEN}${BOLD}║${NC}  服务管理:"
echo -e "${GREEN}${BOLD}║${NC}    supervisorctl status                    # 查看状态"
echo -e "${GREEN}${BOLD}║${NC}    supervisorctl restart photogongju-node   # 重启主站"
echo -e "${GREEN}${BOLD}║${NC}    supervisorctl restart photogongju-python # 重启AI"
echo -e "${GREEN}${BOLD}║${NC}    tail -f /opt/photogongju/logs/node_web.log  # 日志"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
