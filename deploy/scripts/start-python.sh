#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════╗
# ║  PhotoGongju Python AI 微服务 — 宝塔面板启动脚本          ║
# ║  使用: 宝塔 → 进程守护管理器 → 添加 → 选择本文件           ║
# ╚══════════════════════════════════════════════════════════╝
set -e

DEPLOY_DIR="/opt/photogongju"
cd "$DEPLOY_DIR/python_ai"

# ── 检查虚拟环境是否存在 ──
if [ ! -f "venv/bin/activate" ]; then
    echo "=============================================="
    echo "  ERROR: Python 虚拟环境未创建！"
    echo "  请在 SSH 中执行以下命令初始化:"
    echo ""
    echo "  cd /opt/photogongju/python_ai"
    echo "  python3 -m venv venv"
    echo "  source venv/bin/activate"
    echo "  pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple"
    echo "=============================================="
    exit 1
fi

# ── 检查 uvicorn 是否已安装 ──
if [ ! -f "venv/bin/uvicorn" ]; then
    echo "=============================================="
    echo "  ERROR: Python 依赖未安装！"
    echo "  请在 SSH 中执行以下命令安装依赖:"
    echo ""
    echo "  cd /opt/photogongju/python_ai"
    echo "  source venv/bin/activate"
    echo "  pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple"
    echo "=============================================="
    exit 1
fi

# 激活虚拟环境
source "$DEPLOY_DIR/python_ai/venv/bin/activate"

exec uvicorn main:app \
    --host 127.0.0.1 \
    --port 8001 \
    --workers 2 \
    --log-level info
