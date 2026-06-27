"""
FastAPI 路由定义
包含全部 REST API 接口：
- 健康检查
- 图片上传 / 信息读取
- 图片缩放
- 水印添加
- 滤镜应用
- AI 背景去除
- 批量流水线处理
- 尺寸库查询
"""

import time
import shutil
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, UploadFile, File, Form, Query, HTTPException, Body
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image

from config import UPLOAD_DIR, OUTPUT_DIR, MODELS
from utils.helpers import (
    validate_image_format, safe_open_image, safe_save_image,
    generate_task_id, get_image_info, image_to_bytes
)
from models.schemas import (
    TaskResult, ImageInfo, HealthResponse,
    ResizeRequest, FilterRequest, WatermarkRequest,
    AIBackgroundRequest, ProcessPipelineRequest,
    WatermarkType, SizeLibraryResponse, SizePreset,
)
from services.image_processor import (
    process_resize, apply_filter, process_remove_background, convert_format,
    parse_hex_color, simple_background_replace
)
from services.watermark import apply_watermark
from services.size_library import (
    get_all_presets, get_all_categories, get_preset_by_name,
    recommend_size, get_presets_by_category
)

router = APIRouter(prefix="/api/v1", tags=["图片处理"])


# ============================================
# 健康检查
# ============================================

@router.get("/health", response_model=HealthResponse)
async def health_check():
    """
    服务健康检查
    返回服务状态、版本号、已加载的 AI 模型列表
    """
    # 检查哪些模型文件存在
    available_models = [
        model_id for model_id, model_info in MODELS.items()
        if model_info["file"].exists()
    ]

    return HealthResponse(
        status="ok",
        version="1.0.0",
        models_available=available_models,
    )


# ============================================
# 图片上传
# ============================================

@router.post("/upload", response_model=TaskResult)
async def upload_image(file: UploadFile = File(..., description="图片文件")):
    """
    上传单张图片
    自动校验格式，保存到临时目录，返回图片基本信息
    """
    # 校验文件名
    if not file.filename:
        raise HTTPException(status_code=400, detail="请提供有效的文件名")

    # 校验文件格式
    is_valid, suffix = validate_image_format(file.filename)
    if not is_valid:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的图片格式: {suffix}。支持的格式: PNG, JPG, JPEG, WEBP, BMP, TIFF, GIF"
        )

    # 生成唯一任务 ID 和安全文件名
    task_id = generate_task_id()
    safe_filename = f"{task_id}{suffix}"
    upload_path = UPLOAD_DIR / safe_filename

    # 保存文件到磁盘
    try:
        with open(upload_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"文件保存失败: {str(e)}")

    # 提取图片信息
    info = get_image_info(upload_path)
    if not info:
        upload_path.unlink(missing_ok=True)  # 清理无效文件
        raise HTTPException(status_code=400, detail="无法解析图片文件，请确认文件未损坏")

    return TaskResult(
        task_id=task_id,
        success=True,
        message="上传成功",
        original=ImageInfo(**info),
        processed=None,
        download_url=None,
        elapsed_seconds=0.0,
    )


# ============================================
# 图片信息查询
# ============================================

@router.get("/info/{task_id}", response_model=TaskResult)
async def get_image_info_api(task_id: str):
    """
    根据任务 ID 获取图片的详细信息
    优先搜索 outputs 目录（处理结果），再搜索 uploads 目录（原始上传）
    """
    # 1. 先搜索输出目录（处理后的结果）
    for output_file in OUTPUT_DIR.iterdir():
        if output_file.name.startswith(task_id):
            info = get_image_info(output_file)
            if info:
                return TaskResult(
                    task_id=task_id,
                    success=True,
                    message="查询成功（处理结果）",
                    original=None,
                    processed=ImageInfo(**info),
                )

    # 2. 搜索上传目录（原始图片）
    for upload_file in UPLOAD_DIR.iterdir():
        if upload_file.name.startswith(task_id):
            info = get_image_info(upload_file)
            if info:
                return TaskResult(
                    task_id=task_id,
                    success=True,
                    message="查询成功",
                    original=ImageInfo(**info),
                )
            break

    raise HTTPException(status_code=404, detail=f"未找到任务 {task_id} 对应的图片")


# ============================================
# 图片缩放接口
# ============================================

@router.post("/resize/{task_id}", response_model=TaskResult)
async def resize_image(
    task_id: str,
    req: ResizeRequest,
):
    """
    对已上传的图片进行缩放处理
    支持 fill / fit / cover / thumbnail 模式
    """
    # 查找源文件
    source_path = _find_uploaded_file(task_id)
    if not source_path:
        raise HTTPException(status_code=404, detail=f"未找到任务 {task_id} 对应的图片，请先上传")

    t0 = time.time()
    img = safe_open_image(source_path)
    if img is None:
        raise HTTPException(status_code=400, detail="无法打开图片文件")

    # 执行缩放
    result_img = process_resize(img, req)
    img.close()

    # 保存结果 — ★ 传递背景色
    output_id = generate_task_id()
    output_path = OUTPUT_DIR / f"{output_id}.png"
    bg = parse_hex_color(req.background) if req.background else (255, 255, 255)
    safe_save_image(result_img, output_path, "PNG", bg_color=bg)
    result_img.close()

    elapsed = round(time.time() - t0, 3)
    processed_info = get_image_info(output_path)

    return TaskResult(
        task_id=output_id,
        success=True,
        message=f"缩放完成 ({req.mode.value})",
        processed=ImageInfo(**processed_info) if processed_info else None,
        download_url=f"/api/v1/download/{output_id}",
        elapsed_seconds=elapsed,
    )


# ============================================
# 滤镜接口
# ============================================

@router.post("/filter/{task_id}", response_model=TaskResult)
async def filter_image(
    task_id: str,
    req: FilterRequest,
):
    """
    对已上传的图片应用滤镜效果
    支持灰度、怀旧、模糊、锐化、亮度、对比度、饱和度、色温
    """
    source_path = _find_uploaded_file(task_id)
    if not source_path:
        raise HTTPException(status_code=404, detail=f"未找到任务 {task_id} 对应的图片，请先上传")

    t0 = time.time()
    img = safe_open_image(source_path)
    if img is None:
        raise HTTPException(status_code=400, detail="无法打开图片文件")

    # 应用滤镜
    result_img = apply_filter(img, req)
    img.close()

    # 保存
    output_id = generate_task_id()
    output_path = OUTPUT_DIR / f"{output_id}.png"
    safe_save_image(result_img, output_path, "PNG")
    result_img.close()

    elapsed = round(time.time() - t0, 3)

    return TaskResult(
        task_id=output_id,
        success=True,
        message=f"滤镜应用完成 ({req.filter_type.value})",
        download_url=f"/api/v1/download/{output_id}",
        elapsed_seconds=elapsed,
    )


# ============================================
# 水印接口
# ============================================

@router.post("/watermark/{task_id}", response_model=TaskResult)
async def watermark_image(
    task_id: str,
    type: WatermarkType = Form(WatermarkType.TEXT, description="水印类型: text / image / tile"),
    position: str = Form("bottom_right", description="水印位置"),
    margin_x: int = Form(20, ge=0, le=500, description="水平边距"),
    margin_y: int = Form(20, ge=0, le=500, description="垂直边距"),
    rotation: float = Form(0.0, ge=-360, le=360, description="旋转角度"),
    # 文字水印参数
    text: Optional[str] = Form(None, max_length=200, description="水印文字内容"),
    font_size: int = Form(36, ge=8, le=500, description="字体大小"),
    font_color: str = Form("#FFFFFF", description="字体颜色"),
    text_opacity: float = Form(0.5, ge=0.0, le=1.0, description="文字透明度"),
    # 图片水印参数
    watermark_file: Optional[UploadFile] = File(None, description="水印图片文件"),
    image_opacity: float = Form(0.7, ge=0.0, le=1.0, description="图片水印透明度"),
    image_scale: float = Form(0.2, ge=0.01, le=1.0, description="图片水印缩放比例"),
):
    """
    对已上传的图片添加水印
    支持文字水印、图片 Logo 水印、平铺水印三种模式

    文字水印示例：传入 type=text + text="© PhotoGongju"
    图片水印示例：传入 type=image + watermark_file=@logo.png
    平铺水印示例：传入 type=tile + text="CONFIDENTIAL"
    """
    from models.schemas import WatermarkPosition

    source_path = _find_uploaded_file(task_id)
    if not source_path:
        raise HTTPException(status_code=404, detail=f"未找到任务 {task_id} 对应的图片，请先上传")

    t0 = time.time()
    img = safe_open_image(source_path)
    if img is None:
        raise HTTPException(status_code=400, detail="无法打开图片文件")

    # 构建水印请求对象
    try:
        pos_enum = WatermarkPosition(position)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"无效的水印位置: {position}")

    # 文字水印配置
    text_config = None
    if text:
        from models.schemas import WatermarkTextConfig
        text_config = WatermarkTextConfig(
            text=text,
            font_size=font_size,
            font_color=font_color,
            opacity=text_opacity,
        )

    # 图片水印配置
    image_config = None
    from models.schemas import WatermarkImageConfig
    image_config = WatermarkImageConfig(
        opacity=image_opacity,
        scale_ratio=image_scale,
    )

    watermark_req = WatermarkRequest(
        type=type,
        position=pos_enum,
        margin_x=margin_x,
        margin_y=margin_y,
        rotation=rotation,
        text_config=text_config,
        image_config=image_config,
    )

    # 处理水印图片文件
    wm_img = None
    if watermark_file is not None:
        wm_data = await watermark_file.read()
        from io import BytesIO
        wm_img = Image.open(BytesIO(wm_data))
        if wm_img.mode != "RGBA":
            wm_img = wm_img.convert("RGBA")

    # 应用水印
    try:
        result_img = apply_watermark(img, watermark_req, watermark_image=wm_img)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        img.close()
        if wm_img:
            wm_img.close()

    # 保存
    output_id = generate_task_id()
    output_path = OUTPUT_DIR / f"{output_id}.png"
    safe_save_image(result_img, output_path, "PNG")
    result_img.close()

    elapsed = round(time.time() - t0, 3)

    return TaskResult(
        task_id=output_id,
        success=True,
        message=f"水印添加完成 ({type.value})",
        download_url=f"/api/v1/download/{output_id}",
        elapsed_seconds=elapsed,
    )


# ============================================
# AI 背景去除接口
# ============================================

@router.post("/remove-background/{task_id}", response_model=TaskResult)
async def remove_background(
    task_id: str,
    req: AIBackgroundRequest,
):
    """
    AI 背景去除（抠图）
    使用 ONNX 模型进行人像/物体背景去除
    返回带透明通道的 PNG 图片
    """
    source_path = _find_uploaded_file(task_id)
    if not source_path:
        raise HTTPException(status_code=404, detail=f"未找到任务 {task_id} 对应的图片，请先上传")

    # 检查模型是否存在
    model_path = MODELS.get(req.model, {}).get("file")
    if model_path and not model_path.exists():
        raise HTTPException(
            status_code=503,
            detail=f"模型 {req.model} 未下载，请先运行 scripts/download_models.sh 下载模型文件"
        )

    t0 = time.time()
    img = safe_open_image(source_path)
    if img is None:
        raise HTTPException(status_code=400, detail="无法打开图片文件")

    # 执行 AI 背景去除
    result_img = process_remove_background(img, req)
    img.close()

    if result_img is None:
        raise HTTPException(
            status_code=500,
            detail="AI 背景去除失败，请确认模型已正确加载且图片格式正确"
        )

    # 保存（必须用 PNG 保留透明通道）
    output_id = generate_task_id()
    output_path = OUTPUT_DIR / f"{output_id}.png"
    safe_save_image(result_img, output_path, "PNG")
    result_img.close()

    elapsed = round(time.time() - t0, 3)

    return TaskResult(
        task_id=output_id,
        success=True,
        message="AI 背景去除完成",
        download_url=f"/api/v1/download/{output_id}",
        elapsed_seconds=elapsed,
    )


# ============================================
# 批量流水线处理接口
# ============================================

@router.post("/pipeline/{task_id}", response_model=TaskResult)
async def process_pipeline(
    task_id: str,
    req: str = Form(..., description="流水线处理参数 (JSON字符串)"),
    watermark_file: Optional[UploadFile] = File(None, description="水印图片（当使用图片水印时）"),
):
    """
    流水线批量处理：一次请求完成多种处理

    处理顺序：
    1. AI 背景去除 → 2. 缩放 → 3. 滤镜 → 4. 水印 → 5. 格式转换

    只传入需要的步骤参数即可，未传入的步骤会自动跳过
    """
    import json
    req_data = json.loads(req)
    from models.schemas import ProcessPipelineRequest
    pipeline_req = ProcessPipelineRequest(**req_data)

    source_path = _find_uploaded_file(task_id)
    if not source_path:
        raise HTTPException(status_code=404, detail=f"未找到任务 {task_id} 对应的图片，请先上传")

    # 检查模型（如果需要背景去除）— 缺失时不阻止请求，走降级方案
    model_missing = False
    if pipeline_req.remove_bg:
        model_path = MODELS.get(pipeline_req.remove_bg.model, {}).get("file")
        if model_path and not model_path.exists():
            model_missing = True  # ★ 不抛异常，后续用简单背景替换

    t0 = time.time()
    img = safe_open_image(source_path)
    if img is None:
        raise HTTPException(status_code=400, detail="无法打开图片文件")

    result_img = img

    # 1. AI 背景去除 (or fallback)
    if pipeline_req.remove_bg:
        bg_result = process_remove_background(result_img.copy(), pipeline_req.remove_bg)
        if bg_result is not None:
            result_img = bg_result
        elif pipeline_req.resize and pipeline_req.resize.background:
            # ★ AI 模型不可用 → 降级为简单边缘采样背景替换
            target_bg = parse_hex_color(pipeline_req.resize.background)
            result_img = simple_background_replace(result_img, target_bg)

    # 2. 缩放
    if pipeline_req.resize:
        temp = process_resize(result_img, pipeline_req.resize)
        result_img = temp

    # 3. 滤镜
    if pipeline_req.filter:
        temp = apply_filter(result_img, pipeline_req.filter)
        result_img = temp

    # 4. 水印
    if pipeline_req.watermark:
        wm_img = None
        if watermark_file is not None:
            wm_data = await watermark_file.read()
            from io import BytesIO
            wm_img = Image.open(BytesIO(wm_data))
            if wm_img.mode != "RGBA":
                wm_img = wm_img.convert("RGBA")

        try:
            temp = apply_watermark(result_img, pipeline_req.watermark, watermark_image=wm_img)
            result_img = temp
        finally:
            if wm_img:
                wm_img.close()

    # 5. 格式转换 — ★ 提取背景色，确保抠图后的透明区域填充用户选择的颜色
    output_fmt = pipeline_req.output_format.value
    output_ext = output_fmt
    bg_color = (255, 255, 255)  # 默认白色
    if pipeline_req.resize and pipeline_req.resize.background:
        bg_color = parse_hex_color(pipeline_req.resize.background)
    result_img = convert_format(result_img, output_fmt, bg_color=bg_color)

    # 保存结果
    output_id = generate_task_id()
    output_path = OUTPUT_DIR / f"{output_id}.{output_ext}"
    safe_save_image(result_img, output_path, output_fmt, quality=pipeline_req.quality, bg_color=bg_color)
    result_img.close()

    elapsed = round(time.time() - t0, 3)
    processed_info = get_image_info(output_path)

    return TaskResult(
        task_id=output_id,
        success=True,
        message="流水线处理完成",
        processed=ImageInfo(**processed_info) if processed_info else None,
        download_url=f"/api/v1/download/{output_id}",
        elapsed_seconds=elapsed,
    )


# ============================================
# 结果下载接口
# ============================================

@router.get("/download/{task_id}")
async def download_result(task_id: str):
    """
    下载处理结果的图片文件
    根据 task_id 自动查找对应的输出文件或上传文件
    优先搜索输出目录，其次搜索上传目录
    """
    # 1. 搜索输出目录
    for output_file in OUTPUT_DIR.iterdir():
        if output_file.name.startswith(task_id):
            suffix = output_file.suffix.lower()
            media_types = {
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".webp": "image/webp",
                ".bmp": "image/bmp",
                ".pdf": "application/pdf",
            }
            media_type = media_types.get(suffix, "application/octet-stream")
            return FileResponse(
                path=str(output_file),
                media_type=media_type,
                filename=f"photogongju_result{suffix}",
            )

    # 2. 搜索上传目录（原始文件）
    for upload_file in UPLOAD_DIR.iterdir():
        if upload_file.name.startswith(task_id):
            suffix = upload_file.suffix.lower()
            media_types = {
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".webp": "image/webp",
                ".bmp": "image/bmp",
            }
            media_type = media_types.get(suffix, "application/octet-stream")
            return FileResponse(
                path=str(upload_file),
                media_type=media_type,
                filename=f"photogongju_original{suffix}",
            )

    raise HTTPException(status_code=404, detail=f"未找到任务 {task_id} 的处理结果")


# ============================================
# 尺寸库接口
# ============================================

@router.get("/size-library", response_model=SizeLibraryResponse)
async def get_size_library(
    category: Optional[str] = Query(None, description="按分类筛选"),
    keyword: Optional[str] = Query(None, description="关键词搜索"),
):
    """
    获取图片尺寸库
    - 不加参数：返回全部 50+ 预设尺寸
    - ?category=社交媒体：只返回社交媒体类尺寸
    - ?keyword=1080：搜索包含 1080 的预设
    """
    presets = get_all_presets(category=category, keyword=keyword)
    return SizeLibraryResponse(
        presets=presets,
        total=len(presets),
    )


@router.get("/size-library/categories")
async def get_size_categories():
    """获取所有尺寸库分类"""
    return {"categories": get_all_categories()}


@router.get("/size-library/recommend/{task_id}", response_model=SizeLibraryResponse)
async def recommend_size_for_image(
    task_id: str,
    top_k: int = Query(5, ge=1, le=20, description="返回推荐数量"),
):
    """
    根据已上传图片的尺寸，智能推荐最匹配的预设尺寸
    """
    source_path = _find_uploaded_file(task_id)
    if not source_path:
        raise HTTPException(status_code=404, detail=f"未找到任务 {task_id} 对应的图片，请先上传")

    img = safe_open_image(source_path)
    if img is None:
        raise HTTPException(status_code=400, detail="无法打开图片文件")

    w, h = img.size
    img.close()

    return recommend_size(w, h, top_k=top_k)


@router.get("/size-library/{preset_name}", response_model=SizePreset)
async def get_preset_detail(preset_name: str):
    """获取指定预设尺寸的详细信息"""
    preset = get_preset_by_name(preset_name)
    if preset is None:
        raise HTTPException(status_code=404, detail=f"未找到预设: {preset_name}")
    return preset


# ============================================
# 工具函数
# ============================================

def _find_uploaded_file(task_id: str) -> Optional[Path]:
    """
    在 UPLOAD_DIR 和 OUTPUT_DIR 中查找 task_id 对应的文件
    优先查找上传目录，其次查找输出目录（支持链式处理）
    返回匹配的文件路径，如果未找到则返回 None
    """
    for f in UPLOAD_DIR.iterdir():
        if f.is_file() and f.name.startswith(task_id):
            return f
    for f in OUTPUT_DIR.iterdir():
        if f.is_file() and f.name.startswith(task_id):
            return f
    return None
