#!/bin/bash
# ─────────────────────────────────────────────
# PhotoGongju — 本地开发环境启动 (Git Bash)
# ─────────────────────────────────────────────

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  🖼️  PhotoGongju — 本地开发环境启动                    ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# 检查 Python venv
if [ ! -f "$PROJECT_DIR/python_ai/venv/Scripts/python.exe" ]; then
    echo "[初始化] 创建 Python 虚拟环境..."
    cd "$PROJECT_DIR/python_ai" && python -m venv venv
    source venv/Scripts/activate
    pip install --upgrade pip -q
    pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
    echo "[初始化] Python 环境就绪"
fi

# 启动 Python AI 服务
echo "[1/2] 启动 Python AI 微服务 (端口 8001) ..."
cd "$PROJECT_DIR/python_ai"
source venv/Scripts/activate
uvicorn main:app --host 127.0.0.1 --port 8001 --reload &
PYTHON_PID=$!
echo "       Python AI PID: $PYTHON_PID"

# 启动 Node.js 主站
echo "[2/2] 启动 Node.js 主站 (端口 3000) ..."
cd "$PROJECT_DIR/node_web"
AI_SERVICE_URL="http://127.0.0.1:8001" node app.js &
NODE_PID=$!
echo "       Node.js PID: $NODE_PID"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✅ 所有服务已启动                                      ║"
echo "║                                                      ║"
echo "║  🌐 主站首页:     http://localhost:3000                ║"
echo "║  📄 API 文档:     http://localhost:8001/docs           ║"
echo "║  💚 健康检查:     http://localhost:8001/api/v1/health  ║"
echo "║                                                      ║"
echo "║  按 Ctrl+C 停止所有服务                                ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# 捕获 Ctrl+C 停止所有服务
trap 'echo ""; echo "🛑 正在停止服务..."; kill $PYTHON_PID $NODE_PID 2>/dev/null; echo "已停止"; exit 0' INT

# 等待子进程
wait
