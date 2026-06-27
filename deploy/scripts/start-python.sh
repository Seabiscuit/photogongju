#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════╗
# ║  PhotoGongju Python AI 微服务 — 宝塔面板启动脚本          ║
# ║  使用: 宝塔 → 进程守护管理器 → 添加 → 选择本文件           ║
# ╚══════════════════════════════════════════════════════════╝
set -e

DEPLOY_DIR="/opt/photogongju"
cd "$DEPLOY_DIR/python_ai"

# 激活虚拟环境
source "$DEPLOY_DIR/python_ai/venv/bin/activate"

exec uvicorn main:app \
    --host 127.0.0.1 \
    --port 8001 \
    --workers 2 \
    --log-level info
