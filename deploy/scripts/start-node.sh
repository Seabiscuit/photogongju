#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════╗
# ║  PhotoGongju Node.js 主站 — 宝塔面板启动脚本              ║
# ║  使用: 宝塔 → 进程守护管理器 → 添加 → 选择本文件           ║
# ╚══════════════════════════════════════════════════════════╝
set -e

DEPLOY_DIR="/opt/photogongju"
cd "$DEPLOY_DIR/node_web"

export NODE_ENV="production"
export PORT="3000"
export AI_SERVICE_URL="http://127.0.0.1:8001"

/usr/bin/node "$DEPLOY_DIR/node_web/app.js"
