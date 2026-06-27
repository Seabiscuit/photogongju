"""
PhotoGongju — Python AI 微服务入口
FastAPI 应用主文件

启动方式：
    # 开发模式（热重载）
    uvicorn main:app --host 127.0.0.1 --port 8001 --reload

    # 生产模式
    uvicorn main:app --host 0.0.0.0 --port 8001 --workers 4

    # 使用国内镜像源安装依赖：
    pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
"""

import sys
import io

# 修复 Windows 下 GBK 编码导致的 emoji 打印异常
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import SERVICE_HOST, SERVICE_PORT, UPLOAD_DIR, OUTPUT_DIR
from api.routes import router as api_router


# ============================================
# 应用生命周期管理
# ============================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    应用启动/关闭时的处理逻辑
    启动时：初始化目录、预热模型（可选）
    关闭时：清理临时文件（可选）
    """
    # ── 启动时执行 ──
    print("=" * 60)
    print("🚀 PhotoGongju AI 微服务启动中...")
    print(f"   服务地址: http://{SERVICE_HOST}:{SERVICE_PORT}")
    print(f"   API 文档: http://{SERVICE_HOST}:{SERVICE_PORT}/docs")
    print(f"   上传目录: {UPLOAD_DIR}")
    print(f"   输出目录: {OUTPUT_DIR}")
    print("=" * 60)

    # 懒加载模型（首次请求时才真正加载，避免启动耗时过长）
    # 如需启动时预热，取消下面的注释：
    # from services.image_processor import _get_onnx_session
    # _get_onnx_session()

    yield  # ← 应用运行期间

    # ── 关闭时执行 ──
    print("\n🛑 PhotoGongju AI 微服务已停止")


# ============================================
# 创建 FastAPI 应用
# ============================================

app = FastAPI(
    title="PhotoGongju AI 微服务",
    description="""
## 功能概览

- **图片上传**：支持 PNG / JPG / WEBP / BMP 等主流格式
- **智能缩放**：fill / fit / cover / thumbnail 四种模式
- **滤镜效果**：灰度、怀旧、模糊、锐化、亮度、对比度、饱和度、色温
- **水印引擎**：文字水印 / 图片 Logo / 平铺水印，支持旋转与透明度
- **AI 背景去除**：基于 ONNX 深度学习模型的人像/物体抠图
- **批量流水线**：一次请求完成多种处理组合
- **尺寸库**：内置 50+ 平台预设，智能推荐匹配

## 使用流程

1. `POST /api/v1/upload` 上传图片，获取 `task_id`
2. 调用对应处理接口（resize / filter / watermark / remove-background / pipeline）
3. 通过返回的 `download_url` 下载处理结果
""",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",               # Swagger UI 文档
    redoc_url="/redoc",             # ReDoc 文档
)

# ============================================
# CORS 跨域中间件
# ============================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "*",  # 生产环境建议改为具体域名
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
    max_age=600,  # 预检请求缓存时间（秒）
)

# ============================================
# 挂载路由
# ============================================

app.include_router(api_router)

# 静态文件挂载（用于直接访问输出目录）
app.mount("/outputs", StaticFiles(directory=str(OUTPUT_DIR)), name="outputs")


# ============================================
# 根路径
# ============================================

@app.get("/")
async def root():
    """
    根路径：服务基本信息
    """
    return {
        "service": "PhotoGongju AI 微服务",
        "version": "1.0.0",
        "docs": "/docs",
        "redoc": "/redoc",
        "health": "/api/v1/health",
        "endpoints": {
            "upload": "POST /api/v1/upload",
            "resize": "POST /api/v1/resize/{task_id}",
            "filter": "POST /api/v1/filter/{task_id}",
            "watermark": "POST /api/v1/watermark/{task_id}",
            "remove_bg": "POST /api/v1/remove-background/{task_id}",
            "pipeline": "POST /api/v1/pipeline/{task_id}",
            "download": "GET /api/v1/download/{task_id}",
            "size_library": "GET /api/v1/size-library",
        },
    }


# ============================================
# 直接启动入口
# ============================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=SERVICE_HOST,
        port=SERVICE_PORT,
        reload=True,  # 开发模式下自动重载
        log_level="info",
    )
