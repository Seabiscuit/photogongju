#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════╗
# ║  PhotoGongju Node.js 主站 — 宝塔面板启动脚本              ║
# ║  使用: 宝塔 → 进程守护管理器 → 添加 → 选择本文件           ║
# ╚══════════════════════════════════════════════════════════╝
set -e

DEPLOY_DIR="/opt/photogongju"
cd "$DEPLOY_DIR/node_web"

# ── 检查依赖是否已安装 ──
if [ ! -d "node_modules" ]; then
    echo "=============================================="
    echo "  ERROR: node_modules 未安装！"
    echo "  请在 SSH 中执行以下命令安装依赖:"
    echo ""
    echo "  cd /opt/photogongju/node_web"
    echo "  npm config set registry https://registry.npmmirror.com"
    echo "  npm install"
    echo "=============================================="
    exit 1
fi

export NODE_ENV="production"
export PORT="3000"
export AI_SERVICE_URL="http://127.0.0.1:8001"

exec /usr/bin/node "$DEPLOY_DIR/node_web/app.js"
