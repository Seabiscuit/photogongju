#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════╗
# ║  PhotoGongju — Ubuntu 服务器一键部署脚本                              ║
# ║  适用系统: Ubuntu 20.04 / 22.04 / 24.04 (x86_64)                    ║
# ║  部署内容: Node/Python环境 → 依赖安装 → 模型下载 → Supervisor → Nginx ║
# ║  使用方法:                                                           ║
# ║     chmod +x install.sh                                              ║
# ║     sudo bash install.sh                                             ║
# ║  或分步执行:                                                          ║
# ║     sudo bash install.sh --step=env      # 仅安装环境                 ║
# ║     sudo bash install.sh --step=app      # 仅部署应用                 ║
# ║     sudo bash install.sh --step=models   # 仅下载模型                 ║
# ║     sudo bash install.sh --step=supervisor # 仅配置进程守护           ║
# ║     sudo bash install.sh --step=nginx    # 仅配置Nginx                ║
# ╚══════════════════════════════════════════════════════════════════════╝

set -euo pipefail

# ═══════════════════════════════════════════════════════════
# 配置变量（按需修改）
# ═══════════════════════════════════════════════════════════

# 项目部署目录
DEPLOY_DIR="/opt/photogongju"
# 项目源码目录（如果已在服务器上，设置为实际路径）
SOURCE_DIR="${SOURCE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
# Node.js 主站端口
NODE_PORT="${NODE_PORT:-3000}"
# Python AI 服务端口
PYTHON_PORT="${PYTHON_PORT:-8001}"
# 域名（用于 Nginx 配置）
DOMAIN="${DOMAIN:-photogongju.example.com}"
# 是否启用 HTTPS（1=启用, 0=不启用）
ENABLE_HTTPS="${ENABLE_HTTPS:-0}"
# 管理员邮箱（Let's Encrypt 证书通知）
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
# 是否使用国内镜像源（1=清华/阿里源, 0=官方源）
USE_CN_MIRROR="${USE_CN_MIRROR:-1}"

# ═══════════════════════════════════════════════════════════
# 颜色输出
# ═══════════════════════════════════════════════════════════
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step()  { echo -e "\n${CYAN}${BOLD}▶▶▶ $1${NC}\n"; }
log_done()  { echo -e "${GREEN}${BOLD}✓ $1${NC}"; }

# ═══════════════════════════════════════════════════════════
# 权限检查
# ═══════════════════════════════════════════════════════════
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "请使用 root 权限运行: sudo bash install.sh"
        exit 1
    fi
}

# ═══════════════════════════════════════════════════════════
# Step 1: 系统更新 & 基础依赖
# ═══════════════════════════════════════════════════════════
step_system_update() {
    log_step "Step 1/7: 系统更新 & 安装基础依赖"

    # 换国内源（可选，加速 apt 下载）
    if [[ "$USE_CN_MIRROR" == "1" ]]; then
        log_info "配置 Ubuntu 国内镜像源 (阿里云)..."
        if [[ -f /etc/apt/sources.list ]]; then
            # 备份原始源
            cp /etc/apt/sources.list /etc/apt/sources.list.bak.$(date +%Y%m%d)
            # 替换为阿里云镜像
            sed -i 's|http://.*archive.ubuntu.com|http://mirrors.aliyun.com|g' /etc/apt/sources.list
            sed -i 's|http://.*security.ubuntu.com|http://mirrors.aliyun.com|g' /etc/apt/sources.list
            log_done "APT 源已切换至阿里云镜像"
        fi
    fi

    # 更新包索引
    log_info "更新 apt 包索引..."
    apt update -y

    # 升级已安装的包
    log_info "升级系统包..."
    apt upgrade -y

    # 安装基础工具
    log_info "安装基础依赖 (curl/wget/git/unzip/build-essential)..."
    apt install -y curl wget git unzip build-essential \
        libssl-dev zlib1g-dev libbz2-dev libreadline-dev \
        libsqlite3-dev llvm libncurses5-dev libncursesw5-dev \
        xz-utils tk-dev libffi-dev liblzma-dev \
        nginx supervisor cron

    log_done "系统更新 & 基础依赖安装完成"
}

# ═══════════════════════════════════════════════════════════
# Step 2: Node.js 环境安装
# ═══════════════════════════════════════════════════════════
step_install_nodejs() {
    log_step "Step 2/7: 安装 Node.js 18 LTS"

    # 检查是否已安装
    if command -v node &>/dev/null; then
        NODE_VER=$(node -v)
        log_warn "Node.js 已安装: $NODE_VER，跳过安装"
        return 0
    fi

    # 使用 NodeSource 官方源安装 Node.js 18 LTS
    log_info "添加 NodeSource 仓库..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -

    log_info "安装 Node.js..."
    apt install -y nodejs

    # 验证安装
    log_info "Node.js 版本: $(node -v)"
    log_info "npm 版本: $(npm -v)"

    # 配置 npm 国内镜像源（加速 install）
    if [[ "$USE_CN_MIRROR" == "1" ]]; then
        log_info "配置 npm 国内镜像源 (npmmirror)..."
        npm config set registry https://registry.npmmirror.com
        log_done "npm 镜像源已切换"
    fi

    # 全局安装 pm2（可选，作为 Supervisor 的备选方案）
    log_info "安装 PM2 进程管理器..."
    npm install -g pm2

    log_done "Node.js 环境安装完成"
}

# ═══════════════════════════════════════════════════════════
# Step 3: Python 环境安装
# ═══════════════════════════════════════════════════════════
step_install_python() {
    log_step "Step 3/7: 安装 Python 3.10+ 运行环境"

    # 检查是否已有 Python 3.10+
    if command -v python3 &>/dev/null; then
        PY_VER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
        PY_MAJOR=$(echo $PY_VER | cut -d. -f1)
        PY_MINOR=$(echo $PY_VER | cut -d. -f2)
        if [[ $PY_MAJOR -ge 3 && $PY_MINOR -ge 10 ]]; then
            log_warn "Python $PY_VER 已满足要求，跳过安装"
        else
            log_warn "Python $PY_VER 版本过低，需要 3.10+，尝试安装..."
            _install_python310
        fi
    else
        _install_python310
    fi

    # 升级 pip
    log_info "升级 pip..."
    python3 -m pip install --upgrade pip

    # 配置 pip 国内镜像源
    if [[ "$USE_CN_MIRROR" == "1" ]]; then
        log_info "配置 pip 国内镜像源 (清华源)..."
        mkdir -p /root/.pip
        cat > /root/.pip/pip.conf << 'PIPCONF'
[global]
index-url = https://pypi.tuna.tsinghua.edu.cn/simple
trusted-host = pypi.tuna.tsinghua.edu.cn
PIPCONF
        log_done "pip 镜像源已切换"
    fi

    log_done "Python 环境安装完成"
}

# 安装 Python 3.10（从 deadsnakes PPA）
_install_python310() {
    log_info "添加 deadsnakes PPA..."
    apt install -y software-properties-common
    add-apt-repository -y ppa:deadsnakes/ppa
    apt update -y

    log_info "安装 Python 3.10..."
    apt install -y python3.10 python3.10-dev python3.10-venv python3.10-distutils

    # 创建软链接
    update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.10 1

    log_done "Python 3.10 安装完成"
}

# ═══════════════════════════════════════════════════════════
# Step 4: 项目代码部署 & 依赖安装
# ═══════════════════════════════════════════════════════════
step_deploy_app() {
    log_step "Step 4/7: 部署项目代码 & 安装依赖"

    # 创建部署目录
    mkdir -p "$DEPLOY_DIR"
    log_info "部署目录: $DEPLOY_DIR"

    # 复制项目代码（排除 node_modules、.next、__pycache__ 等）
    log_info "复制项目代码..."
    if [[ -d "$SOURCE_DIR/node_web" ]]; then
        rsync -av --exclude='node_modules' --exclude='.next' --exclude='__pycache__' \
            --exclude='*.pyc' --exclude='.git' \
            "$SOURCE_DIR/node_web/" "$DEPLOY_DIR/node_web/"
    fi
    if [[ -d "$SOURCE_DIR/python_ai" ]]; then
        rsync -av --exclude='__pycache__' --exclude='*.pyc' --exclude='weights/*.onnx' \
            --exclude='weights/*.pth' --exclude='.git' \
            "$SOURCE_DIR/python_ai/" "$DEPLOY_DIR/python_ai/"
    fi
    if [[ -f "$SOURCE_DIR/scripts/download_models.sh" ]]; then
        cp "$SOURCE_DIR/scripts/download_models.sh" "$DEPLOY_DIR/scripts/"
    fi

    # 创建必要的子目录
    mkdir -p "$DEPLOY_DIR/python_ai/uploads"
    mkdir -p "$DEPLOY_DIR/python_ai/outputs"
    mkdir -p "$DEPLOY_DIR/python_ai/weights"
    mkdir -p "$DEPLOY_DIR/node_web/public/uploads"
    mkdir -p "$DEPLOY_DIR/logs"

    # ══ 安装 Node.js 依赖 ══
    log_info "安装 Node.js 依赖 (npm install)..."
    cd "$DEPLOY_DIR/node_web"

    # 设置 npm 国内源（二次确保）
    if [[ "$USE_CN_MIRROR" == "1" ]]; then
        npm config set registry https://registry.npmmirror.com
    fi

    # 安装生产依赖
    npm install --production 2>&1 | tail -20
    log_done "Node.js 依赖安装完成"

    # ══ 安装 Python 依赖 ══
    log_info "安装 Python 依赖 (pip install)..."
    cd "$DEPLOY_DIR/python_ai"

    # 创建虚拟环境（推荐）
    if [[ ! -d "venv" ]]; then
        python3 -m venv venv
        log_done "Python 虚拟环境创建完成: $DEPLOY_DIR/python_ai/venv"
    fi

    # 激活虚拟环境并安装
    source venv/bin/activate
    pip install --upgrade pip

    if [[ "$USE_CN_MIRROR" == "1" ]]; then
        pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple 2>&1 | tail -10
    else
        pip install -r requirements.txt 2>&1 | tail -10
    fi
    deactivate
    log_done "Python 依赖安装完成"

    # ══ 设置文件权限 ══
    log_info "设置文件权限..."
    chown -R www-data:www-data "$DEPLOY_DIR" 2>/dev/null || true
    chmod -R 755 "$DEPLOY_DIR"
    # 确保 uploads/outputs 可写
    chmod -R 777 "$DEPLOY_DIR/python_ai/uploads"
    chmod -R 777 "$DEPLOY_DIR/python_ai/outputs"
    chmod -R 777 "$DEPLOY_DIR/node_web/public/uploads"
    log_done "权限设置完成"

    log_done "项目代码部署完成"
}

# ═══════════════════════════════════════════════════════════
# Step 5: AI 模型下载
# ═══════════════════════════════════════════════════════════
step_download_models() {
    log_step "Step 5/7: 下载 AI 模型权重文件"

    MODELS_DIR="$DEPLOY_DIR/python_ai/weights"

    # 背景去除模型 (U²-Net ONNX) — 约 176MB
    if [[ ! -f "$MODELS_DIR/rembg-1.4.onnx" ]]; then
        log_info "下载背景去除模型 (rembg-1.4.onnx) ..."
        wget -q --show-progress -O "$MODELS_DIR/rembg-1.4.onnx" \
            "https://github.com/danielgatis/rembg/releases/download/v0.1.4/rembg.onnx" \
            || log_warn "rembg 模型下载失败，可稍后重试"
    else
        log_warn "rembg 模型已存在，跳过"
    fi

    # 超分辨率模型 (Real-ESRGAN) — 约 67MB
    if [[ ! -f "$MODELS_DIR/RealESRGAN_x4plus.pth" ]]; then
        log_info "下载超分辨率模型 (RealESRGAN_x4plus.pth) ..."
        wget -q --show-progress -O "$MODELS_DIR/RealESRGAN_x4plus.pth" \
            "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth" \
            || log_warn "ESRGAN 模型下载失败，可稍后重试"
    else
        log_warn "ESRGAN 模型已存在，跳过"
    fi

    # MobileNetV2 分类模型 — 约 14MB
    if [[ ! -f "$MODELS_DIR/mobilenet_v2.onnx" ]]; then
        log_info "下载分类模型 (mobilenet_v2.onnx) ..."
        wget -q --show-progress -O "$MODELS_DIR/mobilenet_v2.onnx" \
            "https://github.com/onnx/models/raw/main/validated/vision/classification/mobilenet/model/mobilenetv2-12.onnx" \
            || log_warn "MobileNet 模型下载失败，可稍后重试"
    else
        log_warn "MobileNet 模型已存在，跳过"
    fi

    log_done "AI 模型下载完成"
    log_info "模型目录: $MODELS_DIR"
    ls -lh "$MODELS_DIR/" 2>/dev/null | grep -v "^total"
}

# ═══════════════════════════════════════════════════════════
# Step 6: Supervisor 进程守护配置
# ═══════════════════════════════════════════════════════════
step_configure_supervisor() {
    log_step "Step 6/7: 配置 Supervisor 进程守护"

    # 确保 supervisor 已安装并运行
    apt install -y supervisor
    systemctl enable supervisor
    systemctl start supervisor

    # ── Node.js 主站 Supervisor 配置 ──
    cat > /etc/supervisor/conf.d/photogongju-node.conf << SUPERNODE
; ============================================================
; PhotoGongju Node.js 主站进程守护
; 实现: 开机自启、崩溃自动重启、日志管理
; ============================================================

[program:photogongju-node]
; 进程名称
process_name=photogongju-node

; 启动命令 (使用 node 直接启动)
command=/usr/bin/node ${DEPLOY_DIR}/node_web/app.js
directory=${DEPLOY_DIR}/node_web

; 运行用户 (www-data 更安全，避免用 root)
user=www-data

; 自动启动 (随 supervisor/system 启动)
autostart=true

; 崩溃自动重启
autorestart=true

; 启动等待时间 (秒) — 服务需在此时间内完成启动
startsecs=5

; 最大重启次数 (startretries * autorestart 配合使用)
startretries=10

; 退出码 — 哪些退出码被认为是"正常退出"（不触发重启）
exitcodes=0,2

; 停止信号 (SIGTERM 优雅终止)
stopsignal=TERM

; 停止等待超时 (秒)
stopwaitsecs=10

; 重定向 stderr 到 stdout
redirect_stderr=true

; 日志文件路径
stdout_logfile=${DEPLOY_DIR}/logs/node_web.log
stdout_logfile_maxbytes=50MB
stdout_logfile_backups=10

; 环境变量
environment=
    NODE_ENV="production",
    PORT="${NODE_PORT}",
    AI_SERVICE_URL="http://127.0.0.1:${PYTHON_PORT}"

; 进程优先级 (nice值)
priority=10
SUPERNODE

    # ── Python AI 微服务 Supervisor 配置 ──
    cat > /etc/supervisor/conf.d/photogongju-python.conf << SUPEPYTHON
; ============================================================
; PhotoGongju Python AI 微服务进程守护
; 使用虚拟环境中的 Python 运行 FastAPI
; ============================================================

[program:photogongju-python]
process_name=photogongju-python

; 启动命令 (虚拟环境中的 uvicorn，生产模式)
command=${DEPLOY_DIR}/python_ai/venv/bin/uvicorn main:app --host 127.0.0.1 --port ${PYTHON_PORT} --workers 2 --log-level info
directory=${DEPLOY_DIR}/python_ai

user=www-data
autostart=true
autorestart=true
startsecs=10
startretries=10
exitcodes=0,2
stopsignal=TERM
stopwaitsecs=15          ; AI 服务可能需要更长时间处理完当前请求
redirect_stderr=true

stdout_logfile=${DEPLOY_DIR}/logs/python_ai.log
stdout_logfile_maxbytes=50MB
stdout_logfile_backups=10

environment=
    AI_SERVICE_HOST="127.0.0.1",
    AI_SERVICE_PORT="${PYTHON_PORT}"

priority=20
SUPEPYTHON

    # ── 重新加载 Supervisor 配置 ──
    log_info "重载 Supervisor 配置..."
    supervisorctl reread
    supervisorctl update

    # 启动服务
    supervisorctl start photogongju-node || log_warn "Node 服务启动失败，请检查日志"
    supervisorctl start photogongju-python || log_warn "Python 服务启动失败，请检查日志"

    # 显示运行状态
    sleep 3
    log_info "Supervisor 进程状态:"
    supervisorctl status photogongju-node photogongju-python

    log_done "Supervisor 配置完成"
}

# ═══════════════════════════════════════════════════════════
# Step 7: Nginx 反向代理配置
# ═══════════════════════════════════════════════════════════
step_configure_nginx() {
    log_step "Step 7/7: 配置 Nginx 反向代理"

    # 确保 nginx 已安装
    apt install -y nginx

    # 复制项目中的宝塔兼容 Nginx 配置
    if [[ -f "$DEPLOY_DIR/../deploy/nginx/photogongju.conf" ]]; then
        cp "$DEPLOY_DIR/../deploy/nginx/photogongju.conf" /etc/nginx/sites-available/photogongju
    else
        # 如果找不到模板，从 SOURCE_DIR 找
        if [[ -f "$SOURCE_DIR/deploy/nginx/photogongju.conf" ]]; then
            cp "$SOURCE_DIR/deploy/nginx/photogongju.conf" /etc/nginx/sites-available/photogongju
        else
            # 生成内置的 Nginx 配置
            _generate_nginx_config
        fi
    fi

    # 替换配置中的变量占位符
    sed -i "s|DEPLOY_DIR_PLACEHOLDER|$DEPLOY_DIR|g" /etc/nginx/sites-available/photogongju
    sed -i "s|DOMAIN_PLACEHOLDER|$DOMAIN|g" /etc/nginx/sites-available/photogongju
    sed -i "s|NODE_PORT_PLACEHOLDER|$NODE_PORT|g" /etc/nginx/sites-available/photogongju
    sed -i "s|PYTHON_PORT_PLACEHOLDER|$PYTHON_PORT|g" /etc/nginx/sites-available/photogongju

    # 启用站点
    ln -sf /etc/nginx/sites-available/photogongju /etc/nginx/sites-enabled/photogongju

    # 删除默认站点（避免冲突）
    rm -f /etc/nginx/sites-enabled/default

    # 测试配置
    log_info "测试 Nginx 配置..."
    nginx -t

    # 重载 Nginx
    systemctl enable nginx
    systemctl restart nginx

    log_done "Nginx 反向代理配置完成"

    # ── 显示部署结果 ──
    _print_deploy_summary
}

# 生成内置 Nginx 配置（当模板文件不可用时）
_generate_nginx_config() {
    cat > /etc/nginx/sites-available/photogongju << 'NGINXCONF'
# ╔══════════════════════════════════════════════════════════════╗
# ║  PhotoGongju Nginx 配置                                      ║
# ║  兼容: 宝塔面板 / 原生 Nginx                                  ║
# ║  功能: 反向代理、静态缓存、伪静态、强制HTTPS、安全头           ║
# ╚══════════════════════════════════════════════════════════════╝

# ── HTTP 服务（80端口） ──
server {
    listen 80;
    listen [::]:80;
    server_name DOMAIN_PLACEHOLDER _;

    # 字符集
    charset utf-8;

    # ══ 安全头 ══
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # ══ 访问日志 ══
    access_log /var/log/nginx/photogongju_access.log;
    error_log  /var/log/nginx/photogongju_error.log;

    # ══ 客户端上传大小限制 ══
    client_max_body_size 50m;
    client_body_buffer_size 128k;
    client_header_timeout 60s;
    client_body_timeout 120s;

    # ══ Gzip 压缩 ══
    gzip on;
    gzip_vary on;
    gzip_min_length 1k;
    gzip_comp_level 6;
    gzip_types
        text/plain text/css text/xml text/javascript
        application/json application/javascript application/xml+rss
        image/svg+xml font/ttf font/otf font/woff font/woff2;

    # ════════════════════════════════════════════════
    # 静态资源 — 长期缓存（指纹文件名）
    # ════════════════════════════════════════════════
    location ~* ^/(css|js|images|fonts|img)/.*\.(css|js|jpg|jpeg|png|gif|webp|svg|ico|woff|woff2|ttf|eot)$ {
        root DEPLOY_DIR_PLACEHOLDER/node_web/public;
        expires 30d;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    # ════════════════════════════════════════════════
    # 处理结果资源 — 短期缓存
    # ════════════════════════════════════════════════
    location ~* ^/outputs/ {
        root DEPLOY_DIR_PLACEHOLDER/python_ai;
        expires 1d;
        add_header Cache-Control "public, max-age=86400";
    }

    # ════════════════════════════════════════════════
    # Python AI 微服务 API — 反向代理
    # ════════════════════════════════════════════════
    location /api/v1/ {
        proxy_pass http://127.0.0.1:PYTHON_PORT_PLACEHOLDER;
        proxy_http_version 1.1;

        # 代理头
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 超时（AI 处理可能较慢）
        proxy_connect_timeout 30s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;

        # 缓冲区
        proxy_buffering off;
        proxy_request_buffering off;
        client_max_body_size 50m;
    }

    # ════════════════════════════════════════════════
    # Swagger / ReDoc API 文档
    # ════════════════════════════════════════════════
    location ~* ^/(docs|redoc|openapi\.json) {
        proxy_pass http://127.0.0.1:PYTHON_PORT_PLACEHOLDER;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # ════════════════════════════════════════════════
    # Node.js 主站 — 反向代理（兜底）
    # ════════════════════════════════════════════════
    location / {
        proxy_pass http://127.0.0.1:NODE_PORT_PLACEHOLDER;
        proxy_http_version 1.1;

        # WebSocket 升级（如需）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # 代理头
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 超时
        proxy_connect_timeout 10s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;

        # 缓冲区
        proxy_buffering off;
    }

    # ════════════════════════════════════════════════
    # 健康检查端点（不记录日志）
    # ════════════════════════════════════════════════
    location ~* ^/(api/)?health {
        access_log off;
        proxy_pass http://127.0.0.1:NODE_PORT_PLACEHOLDER;
        proxy_set_header Host $host;
    }

    # ════════════════════════════════════════════════
    # 禁止访问隐藏文件
    # ════════════════════════════════════════════════
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }

    # ════════════════════════════════════════════════
    # 禁止访问敏感目录
    # ════════════════════════════════════════════════
    location ~* /(node_modules|__pycache__|\.git|\.env|weights) {
        deny all;
        return 403;
    }
}
NGINXCONF
}

# ═══════════════════════════════════════════════════════════
# 打印部署结果摘要
# ═══════════════════════════════════════════════════════════
_print_deploy_summary() {
    echo ""
    echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}${BOLD}║          PhotoGongju 部署完成！                              ║${NC}"
    echo -e "${CYAN}${BOLD}╠══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${CYAN}${BOLD}║${NC}  项目目录: ${GREEN}$DEPLOY_DIR${NC}"
    echo -e "${CYAN}${BOLD}║${NC}  Node 主站: http://localhost:${NODE_PORT}"
    echo -e "${CYAN}${BOLD}║${NC}  Python AI: http://localhost:${PYTHON_PORT}/docs"
    echo -e "${CYAN}${BOLD}║${NC}  Nginx 代理: http://${DOMAIN}"
    echo -e "${CYAN}${BOLD}╠══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${CYAN}${BOLD}║${NC}  常用管理命令:                                                ${NC}"
    echo -e "${CYAN}${BOLD}║${NC}  supervisorctl status                   查看进程状态           ${NC}"
    echo -e "${CYAN}${BOLD}║${NC}  supervisorctl restart photogongju-node  重启主站               ${NC}"
    echo -e "${CYAN}${BOLD}║${NC}  supervisorctl restart photogongju-python 重启AI服务            ${NC}"
    echo -e "${CYAN}${BOLD}║${NC}  systemctl restart nginx                 重启Nginx              ${NC}"
    echo -e "${CYAN}${BOLD}║${NC}  tail -f ${DEPLOY_DIR}/logs/node_web.log  查看主站日志          ${NC}"
    echo -e "${CYAN}${BOLD}║${NC}  tail -f ${DEPLOY_DIR}/logs/python_ai.log 查看AI服务日志        ${NC}"
    echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# ═══════════════════════════════════════════════════════════
# 主入口 — 解析参数 & 按步骤执行
# ═══════════════════════════════════════════════════════════
main() {
    check_root

    echo -e "${CYAN}${BOLD}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                                                              ║"
    echo "║     🖼️  PhotoGongju — Ubuntu 一键部署脚本                     ║"
    echo "║                                                              ║"
    echo "║     部署目标: Ubuntu 20.04 / 22.04 / 24.04                   ║"
    echo "║     部署内容: Node + Python 环境 | 依赖 | 模型 | Nginx | 守护 ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"

    # 解析 --step 参数
    STEP="${1:-all}"
    if [[ "$STEP" == --step=* ]]; then
        STEP="${STEP#--step=}"
    fi

    case "$STEP" in
        env)
            step_system_update
            step_install_nodejs
            step_install_python
            ;;
        app)
            step_deploy_app
            ;;
        models)
            step_download_models
            ;;
        supervisor)
            step_configure_supervisor
            ;;
        nginx)
            step_configure_nginx
            ;;
        all|*)
            step_system_update
            step_install_nodejs
            step_install_python
            step_deploy_app
            step_download_models
            step_configure_supervisor
            step_configure_nginx
            ;;
    esac

    echo ""
    echo -e "${GREEN}${BOLD}🎉 全部完成！现在可以访问服务器 IP 查看 PhotoGongju 页面${NC}"
}

# 运行主函数
main "$@"
