"""
全局配置文件
- 路径统一管理
- 镜像源 / 模型配置
- 图片处理默认参数
"""

import os
from pathlib import Path

# ============================================
# 项目根路径
# ============================================
BASE_DIR = Path(__file__).resolve().parent
WEIGHTS_DIR = BASE_DIR / "weights"              # AI 模型权重目录
UPLOAD_DIR = BASE_DIR / "uploads"               # 临时上传目录
OUTPUT_DIR = BASE_DIR / "outputs"               # 处理结果输出目录

# 确保目录存在
for d in [WEIGHTS_DIR, UPLOAD_DIR, OUTPUT_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# ============================================
# AI 模型配置
# ============================================
MODELS = {
    "rmbg_onnx": {
        "name": "U²-Net 背景去除模型 (ONNX)",
        "file": WEIGHTS_DIR / "u2net.onnx",
        "url": "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx",
        "desc": "通用背景去除，基于 U²-Net 架构，320×320 输入"
    },
    "esrgan_x4": {
        "name": "超分辨率模型 x4",
        "file": WEIGHTS_DIR / "RealESRGAN_x4plus.pth",
        "url": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth",
        "desc": "Real-ESRGAN 4倍超分辨率重建"
    },
    "mobilenet_v2": {
        "name": "图像分类模型",
        "file": WEIGHTS_DIR / "mobilenet_v2.onnx",
        "url": "https://github.com/onnx/models/raw/main/validated/vision/classification/mobilenet/model/mobilenetv2-12.onnx",
        "desc": "MobileNetV2 轻量分类模型"
    }
}

# ============================================
# 图片处理默认参数
# ============================================
DEFAULT_IMAGE_PARAMS = {
    "quality": 85,                              # JPEG 质量 (1-100)
    "max_size": 4096,                           # 最大边长像素
    "format": "PNG",                            # 默认输出格式
    "dpi": 72,                                  # 默认 DPI
}

# 支持的输入 / 输出格式
SUPPORTED_INPUT_FORMATS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".gif"}
SUPPORTED_OUTPUT_FORMATS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".pdf"}

# ============================================
# 服务配置
# ============================================
SERVICE_HOST = os.getenv("AI_SERVICE_HOST", "127.0.0.1")
SERVICE_PORT = int(os.getenv("AI_SERVICE_PORT", "8001"))
SERVICE_WORKERS = int(os.getenv("AI_SERVICE_WORKERS", "1"))

# ============================================
# 国内镜像源提示（用于 pip install）
# ============================================
PIP_MIRRORS = {
    "tsinghua": "https://pypi.tuna.tsinghua.edu.cn/simple",
    "aliyun": "https://mirrors.aliyun.com/pypi/simple/",
    "ustc": "https://pypi.mirrors.ustc.edu.cn/simple/",
}
