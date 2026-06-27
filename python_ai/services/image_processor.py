"""
核心图片处理服务
- 缩放（fill / fit / cover / thumbnail）
- 滤镜（灰度、怀旧、模糊、锐化、亮度、对比度、饱和度、色温）
- 格式转换
- AI 背景去除（基于 ONNX rembg 模型）
"""

import time
from pathlib import Path
from typing import Optional, Tuple, Dict, Any
from io import BytesIO

from PIL import Image, ImageFilter, ImageEnhance, ImageOps
import numpy as np
import cv2  # type: ignore

from config import WEIGHTS_DIR, MODELS, DEFAULT_IMAGE_PARAMS
from utils.helpers import (
    safe_open_image, safe_save_image, image_to_bytes,
    calc_fit_size, calc_cover_size, generate_task_id, get_image_info
)
from models.schemas import (
    ResizeRequest, FilterRequest, AIBackgroundRequest,
    ResizeMode, FilterType, TaskResult
)

# 尝试导入 ONNX Runtime（可选依赖）
try:
    import onnxruntime as ort  # type: ignore
    HAS_ONNX = True
except ImportError:
    HAS_ONNX = False
    print("[WARN] onnxruntime 未安装，AI 背景去除功能不可用")


# ============================================
# 图片缩放处理
# ============================================

def process_resize(
    img: Image.Image,
    params: ResizeRequest
) -> Image.Image:
    """
    图片缩放处理
    支持 fill / fit / cover / thumbnail 四种模式
    """
    src_w, src_h = img.size
    target_w = params.width or src_w
    target_h = params.height or src_h

    if params.mode == ResizeMode.FILL:
        # 直接拉伸，不保持比例
        result = img.resize((target_w, target_h), Image.LANCZOS)

    elif params.mode == ResizeMode.FIT:
        # 等比缩放，可能有留白，背景色填充
        new_w, new_h = calc_fit_size(src_w, src_h, target_w, target_h, params.upscale)
        result = img.resize((new_w, new_h), Image.LANCZOS)
        bg = parse_hex_color(params.background)

        # ★ 如果图片是 RGBA（如抠图后）且指定了非白背景色，始终合成背景
        if img.mode == "RGBA" and params.background != "#FFFFFF":
            canvas = Image.new("RGBA", (target_w, target_h), bg)
            offset_x = (target_w - new_w) // 2
            offset_y = (target_h - new_h) // 2
            canvas.paste(result, (offset_x, offset_y), result)
            result = canvas
        elif new_w != target_w or new_h != target_h:
            # 尺寸不完全一致时，在画布上居中放置（留白填充）
            canvas = Image.new("RGBA" if img.mode == "RGBA" else "RGB",
                               (target_w, target_h), bg)
            offset_x = (target_w - new_w) // 2
            offset_y = (target_h - new_h) // 2
            canvas.paste(result, (offset_x, offset_y), result if img.mode == "RGBA" else None)
            result = canvas

    elif params.mode == ResizeMode.COVER:
        # 等比缩放覆盖，居中裁剪
        new_w, new_h, left, top = calc_cover_size(src_w, src_h, target_w, target_h)
        result = img.resize((new_w, new_h), Image.LANCZOS)
        result = result.crop((left, top, left + target_w, top + target_h))

    elif params.mode == ResizeMode.THUMBNAIL:
        # PIL 原生缩略图（保持比例，不超过目标尺寸）
        result = img.copy()
        result.thumbnail((target_w, target_h), Image.LANCZOS)

    else:
        result = img.copy()

    return result


def parse_hex_color(hex_str: str) -> Tuple[int, int, int]:
    """解析十六进制颜色字符串为 RGB 元组"""
    hex_str = hex_str.lstrip("#")
    if len(hex_str) == 3:
        hex_str = "".join(c * 2 for c in hex_str)
    return tuple(int(hex_str[i:i+2], 16) for i in (0, 2, 4))


# ============================================
# 滤镜处理
# ============================================

def apply_filter(
    img: Image.Image,
    params: FilterRequest
) -> Image.Image:
    """
    对图片应用滤镜效果
    所有滤镜强度通过 intensity 参数控制
    """
    intensity = params.intensity
    result = img.copy()

    if params.filter_type == FilterType.GRAYSCALE:
        # 灰度：将 RGB 转灰度再与原始图混合
        gray = result.convert("L").convert("RGB")
        result = blend_images(result, gray, intensity)

    elif params.filter_type == FilterType.SEPIA:
        # 怀旧风格：先灰度，再叠加棕色调
        gray = result.convert("L").convert("RGB")
        # sepia 矩阵变换
        sepia_data = np.array(gray, dtype=np.float64)
        # 经典 sepia 滤镜矩阵
        tr = np.clip(sepia_data[:, :, 0] * 1.0, 0, 255)
        tg = np.clip(sepia_data[:, :, 0] * 0.95, 0, 255)
        tb = np.clip(sepia_data[:, :, 0] * 0.82, 0, 255)
        sepia_arr = np.stack([tr, tg, tb], axis=2).astype(np.uint8)
        sepia_img = Image.fromarray(sepia_arr)
        result = blend_images(result, sepia_img, intensity)

    elif params.filter_type == FilterType.BLUR:
        # 高斯模糊
        radius = params.blur_radius * intensity
        result = result.filter(ImageFilter.GaussianBlur(radius=radius))

    elif params.filter_type == FilterType.SHARPEN:
        # 锐化
        if intensity > 0.01:
            enhancer = ImageEnhance.Sharpness(result)
            # 锐化系数: 1.0 = 无变化， >1 增强锐化
            factor = 1.0 + intensity * 4.0
            result = enhancer.enhance(factor)

    elif params.filter_type == FilterType.BRIGHTNESS:
        # 亮度调整
        factor = params.brighten_factor * intensity + (1.0 - intensity)
        enhancer = ImageEnhance.Brightness(result)
        result = enhancer.enhance(factor)

    elif params.filter_type == FilterType.CONTRAST:
        # 对比度调整
        factor = params.contrast_factor * intensity + (1.0 - intensity)
        enhancer = ImageEnhance.Contrast(result)
        result = enhancer.enhance(factor)

    elif params.filter_type == FilterType.SATURATION:
        # 饱和度调整
        factor = params.saturation_factor * intensity + (1.0 - intensity)
        enhancer = ImageEnhance.Color(result)
        result = enhancer.enhance(factor)

    elif params.filter_type == FilterType.WARM:
        # 暖色调：增加红/黄色温
        warmth = 30 * intensity  # 色温偏移量
        result = adjust_color_temperature(result, warmth)

    elif params.filter_type == FilterType.COOL:
        # 冷色调：增加蓝色温
        warmth = -30 * intensity
        result = adjust_color_temperature(result, warmth)

    return result


def blend_images(img1: Image.Image, img2: Image.Image, alpha: float) -> Image.Image:
    """
    混合两张图片
    alpha=0 → 完全 img1; alpha=1 → 完全 img2
    """
    if alpha <= 0.01:
        return img1.copy()
    if alpha >= 0.99:
        return img2.copy()
    return Image.blend(img1.convert("RGBA"), img2.convert("RGBA"), alpha)


def adjust_color_temperature(img: Image.Image, warmth: float) -> Image.Image:
    """
    调整色温
    warmth > 0: 暖色（+红 -蓝）
    warmth < 0: 冷色（-红 +蓝）
    """
    arr = np.array(img.convert("RGB"), dtype=np.int16)
    r, g, b = cv2.split(arr)

    # 暖色：增加红色通道，减少蓝色通道
    r = np.clip(r + warmth, 0, 255)
    b = np.clip(b - warmth, 0, 255)

    result_arr = cv2.merge([r, g, b]).astype(np.uint8)
    return Image.fromarray(result_arr).convert(img.mode)


# ============================================
# AI 背景去除
# ============================================

# 全局 ONNX 模型缓存（懒加载）
_onnx_session = None


def _get_onnx_session() -> Optional[Any]:
    """
    懒加载 ONNX 推理会话
    首次调用时加载模型，后续直接复用
    """
    global _onnx_session
    if _onnx_session is not None:
        return _onnx_session

    if not HAS_ONNX:
        return None

    model_path = MODELS["rmbg_onnx"]["file"]
    if not model_path.exists():
        print(f"[WARN] 模型文件不存在: {model_path}，请先运行 scripts/download_models.sh")
        return None

    try:
        # 使用 CPU 推理（跨平台兼容）
        _onnx_session = ort.InferenceSession(
            str(model_path),
            providers=["CPUExecutionProvider"]
        )
        print(f"[INFO] ONNX 模型加载成功: {model_path.name}")
        return _onnx_session
    except Exception as e:
        print(f"[ERROR] ONNX 模型加载失败: {e}")
        return None


def _preprocess_for_rembg(img: Image.Image):
    """
    u2net 模型预处理：
    - 缩放到 320×320（保持比例，短边填充）
    - 用边缘颜色填充而非黑色（避免深色衣物被混淆为背景）
    - 归一化: ImageNet mean/std
    """
    target_size = 320
    orig_w, orig_h = img.size

    # 转换为 RGB
    if img.mode == "RGBA":
        img = img.convert("RGB")
    elif img.mode != "RGB":
        img = img.convert("RGB")

    # ★ 估计背景色用于填充（而非黑色）
    import numpy as np
    arr_small = np.array(img.resize((64, 64), Image.LANCZOS), dtype=np.float32)
    # 从四周窄带采样
    edge_vals = np.concatenate([
        arr_small[:2, :, :].reshape(-1, 3), arr_small[-2:, :, :].reshape(-1, 3),
        arr_small[:, :2, :].reshape(-1, 3), arr_small[:, -2:, :].reshape(-1, 3),
    ], axis=0)
    pad_color = tuple(np.median(edge_vals, axis=0).astype(np.uint8).tolist())

    # 等比缩放
    ratio = target_size / max(orig_w, orig_h)
    new_w = max(1, int(orig_w * ratio))
    new_h = max(1, int(orig_h * ratio))
    img_resized = img.resize((new_w, new_h), Image.LANCZOS)

    # 正方形画布，用估计背景色填充（替代黑色）
    canvas = Image.new("RGB", (target_size, target_size), pad_color)
    offset_x = (target_size - new_w) // 2
    offset_y = (target_size - new_h) // 2
    canvas.paste(img_resized, (offset_x, offset_y))

    # numpy 归一化 — u2net 使用 ImageNet 统计量
    arr = np.array(canvas, dtype=np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    arr = (arr - mean) / std

    # CHW + batch = [1, 3, 320, 320]
    arr = arr.transpose((2, 0, 1))
    arr = np.expand_dims(arr, axis=0).astype(np.float32)

    return arr, (orig_w, orig_h), (offset_x, offset_y, new_w, new_h)


def process_remove_background(
    img: Image.Image,
    params: AIBackgroundRequest
) -> Optional[Image.Image]:
    """
    AI 背景去除 — 使用 u2net ONNX 模型
    返回 RGBA 模式图片（背景透明）

    ★ 优化：高图预裁剪，确保人物在 320×320 中有足够分辨率
    """
    session = _get_onnx_session()
    if session is None:
        return None

    orig_size = img.size
    ow, oh = orig_size

    # ★ 预裁剪：确保输入比例适合 AI 处理（320×320 中人物足够大）
    # ID 照最佳比例 ~4:5，高图裁剪到上半身，宽图裁剪到居中
    crop_img = img
    max_ratio = 1.4  # h:w 不超过 ~1.4:1（匹配证件照比例 413/295≈1.4）
    if oh > ow * max_ratio:
        target_h = int(ow * max_ratio)
        crop_top = (oh - target_h) // 4  # 偏上裁剪保留头部
        crop_img = img.crop((0, max(0, crop_top), ow, min(oh, crop_top + target_h)))
        print(f'[INFO] Tall image crop: {orig_size} -> {crop_img.size}')

    # 预处理
    input_tensor, (orig_w, orig_h), (ox, oy, nw, nh) = _preprocess_for_rembg(crop_img)

    # ONNX 推理
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name
    output = session.run([output_name], {input_name: input_tensor})[0]

    # 后处理 — u2net 输出 [1, 1, 320, 320] mask
    pred = output[0]
    if pred.ndim == 3:
        pred = pred[0]  # → [320, 320]

    # ★ 优化1: 剔除极端离群值后用百分位归一化
    p_low = np.percentile(pred, 2)
    p_high = np.percentile(pred, 98)
    if p_high > p_low:
        pred = (pred - p_low) / (p_high - p_low)
    pred = np.clip(pred, 0, 1)

    # ★ 优化2: Sigmoid 拉伸 — 把中置信度区域（衣物等）拉向前景
    # center=0.3, steepness=8: 映射 0.41→0.71, 0.2→0.31, 0.5→0.83
    center = 0.30
    steepness = 8.0
    pred = 1.0 / (1.0 + np.exp(-(pred - center) * steepness))

    # 裁剪到实际图片区域 + 缩放到处理图像尺寸
    pred_cropped = pred[oy:oy + nh, ox:ox + nw]
    mask_img = Image.fromarray((pred_cropped * 255).astype(np.uint8), mode="L")
    mask_img = mask_img.resize(crop_img.size, Image.LANCZOS)

    # ★ 优化4: 形态学清理 — 去噪+边缘保持（使用小核+双边滤波替代高斯模糊）
    if getattr(params, 'morph_cleanup', True):
        mask_arr = np.array(mask_img)
        # 二值化
        _, binary = cv2.threshold(mask_arr, 127, 255, cv2.THRESH_BINARY)
        # 闭运算：填充前景小孔（小核，不过度腐蚀边缘）
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
        # 开运算：去背景噪点
        binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
        # ★ 边缘保持平滑：双边滤波保留边缘锐度，仅平滑内部
        binary_smooth = cv2.bilateralFilter(binary, 7, 50, 50)
        # 恢复二值化（双边滤波后值域变化）
        _, binary_smooth = cv2.threshold(binary_smooth, 127, 255, cv2.THRESH_BINARY)
        mask_img = Image.fromarray(binary_smooth, mode="L")

    # Alpha 抠图优化
    if params.alpha_matting:
        mask_arr = np.array(mask_img, dtype=np.float32) / 255.0
        mask_arr = np.power(mask_arr, 1.8)  # 略微增强边缘对比
        mask_arr = np.clip(mask_arr, 0.0, 1.0)
        mask_img = Image.fromarray((mask_arr * 255).astype(np.uint8), mode="L")

    # 应用 mask 为 alpha 通道
    img_rgba = img.convert("RGBA") if img.mode != "RGBA" else img.copy()

    # ★ 优化5: 与边缘采样 mask 取并集（使用裁剪后的图像）
    if getattr(params, 'edge_fallback', True):
        edge_rgba = simple_background_replace(crop_img, (0, 0, 0))
        edge_arr = np.array(edge_rgba.convert("L"), dtype=np.float32) / 255.0
        ai_arr = np.array(mask_img, dtype=np.float32) / 255.0
        combined = np.maximum(ai_arr, edge_arr)

        # ★ 优化6: 中心偏置 — 仅在已有前景信号的区域增强
        h, w = combined.shape
        cy, cx = h / 2, w / 2
        yy, xx = np.ogrid[:h, :w]
        dist_from_center = np.sqrt(((xx - cx) / (w * 0.5)) ** 2 + ((yy - cy) / (h * 0.5)) ** 2)
        center_bias = 1.0 / (1.0 + np.exp((dist_from_center - 0.85) * 15.0))
        # ★ 只在有前景信号的位置应用偏置（避免把纯背景也变前景）
        has_signal = (ai_arr > 0.05) | (edge_arr > 0.05)
        center_bias = center_bias * has_signal.astype(np.float32)
        combined = np.maximum(combined, center_bias)

        # ★ 优化7: 填充前景孔洞
        binary = (combined > 0.4).astype(np.uint8) * 255
        kernel_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
        filled = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel_close)
        contours, _ = cv2.findContours(filled, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        hole_filled = np.zeros_like(binary)
        cv2.drawContours(hole_filled, contours, -1, 255, -1)
        filled_arr = hole_filled.astype(np.float32) / 255.0
        combined = np.maximum(combined, filled_arr)

        # 边缘保持平滑（小半径，保留锐利过渡）
        combined = cv2.bilateralFilter(combined.astype(np.float32), 5, 0.3, 0.1)
        mask_img = Image.fromarray((combined * 255).astype(np.uint8), mode="L")

    # ★ 优化8: 创建锐利边缘 mask（trimap 方法：确定前景+确定背景+过渡区）
    mask_arr_final = np.array(mask_img, dtype=np.float32) / 255.0

    # 用膨胀/腐蚀生成 trimap 三区：
    # - 确定前景：mask > 0.9 且经腐蚀保留
    # - 确定背景：mask < 0.1 且经膨胀扩展
    # - 过渡区：两者之间的窄带
    binary_mask = (mask_arr_final * 255).astype(np.uint8)
    kernel_small = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    kernel_erode = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    # 确定前景 = 腐蚀后仍为255的区域
    sure_fg = cv2.erode(binary_mask, kernel_erode, iterations=1)
    # 确定背景 = 膨胀后仍为0的区域
    sure_bg = cv2.dilate(binary_mask, kernel_erode, iterations=1)
    # 边缘过渡区
    trimap = np.full_like(binary_mask, 128, dtype=np.uint8)  # 128 = 未知
    trimap[sure_fg == 255] = 255  # 确定前景
    trimap[sure_bg == 0] = 0      # 确定背景

    # 对过渡区做窄带羽化（仅 1-2px）
    edge_band = (trimap == 128)
    refined_mask = mask_arr_final.copy()
    if edge_band.any():
        # 用距离变换计算过渡区各像素到确定前景/背景的距离，生成软 alpha
        from scipy import ndimage as ndi
        dist_to_fg = ndi.distance_transform_edt(trimap != 255)
        dist_to_bg = ndi.distance_transform_edt(trimap != 0)
        total_dist = dist_to_fg + dist_to_bg + 1e-6
        refined_mask[edge_band] = np.clip(dist_to_bg[edge_band] / total_dist[edge_band], 0, 1)

    # ★ 优化9: 颜色净化 — 去除边缘过渡区的原始背景色
    img_arr = np.array(crop_img.convert("RGB"), dtype=np.float32)
    h_img, w_img = img_arr.shape[:2]
    cs_sample = min(10, h_img // 4, w_img // 4)
    old_bg = np.median(np.concatenate([
        img_arr[:cs_sample, :cs_sample, :].reshape(-1, 3),
        img_arr[:cs_sample, w_img-cs_sample:, :].reshape(-1, 3),
        img_arr[h_img-cs_sample:, :cs_sample, :].reshape(-1, 3),
        img_arr[h_img-cs_sample:, w_img-cs_sample:, :].reshape(-1, 3),
    ], axis=0), axis=0)

    # ★ 对 alpha < 0.99 且原始颜色接近背景色的像素做净化（避免污染前景衣物）
    alpha_3c = np.stack([refined_mask, refined_mask, refined_mask], axis=2)
    bg_3c = old_bg.reshape(1, 1, 3)
    # fg = clamp((observed - (1-alpha)*old_bg) / alpha, 0, 255)
    fg_estimated = (img_arr - (1 - alpha_3c) * bg_3c) / np.maximum(alpha_3c, 0.02)
    fg_estimated = np.clip(fg_estimated, 0, 255)

    # ★ 关键：只有原始颜色接近背景色时才做净化（避免把红色衣物当成白色背景净化）
    diff_from_bg = np.sqrt(np.sum((img_arr - bg_3c) ** 2, axis=2))
    is_near_bg = diff_from_bg < 80  # 距背景色 < 80 才算"可能被污染"
    near_bg_3c = np.stack([is_near_bg, is_near_bg, is_near_bg], axis=2)

    # alpha 越低保真度越低，但只在接近背景色的区域做净化
    blend = np.clip((0.99 - refined_mask) / 0.49, 0, 1)
    blend_3c = np.stack([blend, blend, blend], axis=2) * near_bg_3c.astype(np.float32)
    decontaminated = img_arr * (1 - blend_3c) + fg_estimated * blend_3c
    decontaminated = np.clip(decontaminated, 0, 255).astype(np.uint8)

    alpha_channel = (refined_mask * 255).astype(np.uint8)
    img_rgba = Image.fromarray(
        np.dstack([decontaminated, alpha_channel]), mode="RGBA"
    )

    # ★ 优化10: 裁剪透明/半透明边框 — 只保留真正不透明的区域
    alpha = np.array(img_rgba.split()[-1])
    # alpha > 30 才算有效前景（过滤半透明边缘，避免 resize 后被背景色覆盖）
    solid = np.where(alpha > 30)
    if len(solid[0]) > 0:
        t, b = solid[0].min(), solid[0].max()
        l, r = solid[1].min(), solid[1].max()
        # 安全边距：人物高度的 5%，最少 6px
        person_h = b - t
        margin = max(6, int(person_h * 0.05))
        img_rgba = img_rgba.crop((max(0, l-margin), max(0, t-margin),
                                   min(img_rgba.width, r+margin), min(img_rgba.height, b+margin)))

    return img_rgba


# ============================================
# 简单背景色替换（无 AI 模型时降级方案）
# ============================================

def simple_background_replace(
    img: Image.Image,
    target_bg_color: tuple,
    tolerance: int = 50,
    edge_width: int = 15
) -> Image.Image:
    """
    基于边缘条带采样的背景替换
    从四条边缘的窄条带采样，聚类取最大簇作为背景色

    Args:
        img: RGB/RGBA 模式的 PIL Image
        target_bg_color: 目标背景色 RGB 元组
        tolerance: 颜色相似容忍度 (0-255)
        edge_width: 采样边缘宽度 (px)
    Returns:
        背景已替换的 RGB 图片
    """
    import numpy as np

    if img.mode == "RGBA":
        img_rgb = img.convert("RGB")
    elif img.mode != "RGB":
        img_rgb = img.convert("RGB")
    else:
        img_rgb = img

    arr = np.array(img_rgb, dtype=np.float32)
    h, w = arr.shape[0], arr.shape[1]
    ew = min(edge_width, h // 4, w // 4)

    # ★ 从四条边缘窄带采样（每条边取中间 60%，避免角落被前景污染）
    margin = 0.2  # 跳过边缘两端各 20%
    left_start = int(h * margin)
    left_end = int(h * (1 - margin))
    right_start = int(h * margin)
    right_end = int(h * (1 - margin))
    top_start = int(w * margin)
    top_end = int(w * (1 - margin))
    bot_start = int(w * margin)
    bot_end = int(w * (1 - margin))

    edge_pixels = np.concatenate([
        arr[left_start:left_end, :ew, :].reshape(-1, 3),           # left strip
        arr[right_start:right_end, w-ew:, :].reshape(-1, 3),       # right strip
        arr[:ew, top_start:top_end, :].reshape(-1, 3),             # top strip
        arr[h-ew:, bot_start:bot_end, :].reshape(-1, 3),           # bottom strip
    ], axis=0)

    # ★ 直方图众数法估计主背景色（鲁棒，无需额外依赖）
    # 将边缘像素量化到 32 级 bins，取样本最多的颜色区间中心
    quantized = (edge_pixels // 8).astype(np.int32)  # 0-31 bins per channel
    packed = quantized[:, 0] * 1024 + quantized[:, 1] * 32 + quantized[:, 2]  # 单值索引
    bins_count = np.bincount(packed)
    dominant_bin = np.argmax(bins_count)
    # 解码回 RGB
    b_r = dominant_bin // 1024
    b_g = (dominant_bin % 1024) // 32
    b_b = dominant_bin % 32
    bg_color = np.array([b_r * 8 + 4, b_g * 8 + 4, b_b * 8 + 4], dtype=np.float32)  # 区间中心

    # ★ 计算每个像素与估计背景色的欧氏距离
    diff = arr - bg_color.reshape(1, 1, 3)
    distances = np.sqrt(np.sum(diff ** 2, axis=2))

    # mask: 距离 < tolerance 的为背景
    mask = distances < tolerance

    # ★ 连通区域标记 — 只替换连通到边缘的背景
    from scipy import ndimage
    labeled, _ = ndimage.label(mask)
    edge_labels = set()
    edge_labels.update(labeled[0, :].flatten().tolist())
    edge_labels.update(labeled[-1, :].flatten().tolist())
    edge_labels.update(labeled[:, 0].flatten().tolist())
    edge_labels.update(labeled[:, -1].flatten().tolist())
    edge_labels.discard(0)
    clean_mask = np.isin(labeled, list(edge_labels))

    # ★ 羽化边缘 — 从背景区域边缘向内羽化
    from scipy import ndimage as ndi
    dist_transform = ndi.distance_transform_edt(~clean_mask)
    # clean_mask=True=背景, 从前景边缘向背景内部羽化
    dist_to_fg = ndi.distance_transform_edt(clean_mask)
    feather_mask = np.clip(dist_to_fg / 3, 0, 1)

    # 加权混合替换
    target_arr = np.array(target_bg_color, dtype=np.float32).reshape(1, 1, 3)
    result = arr.copy()
    for c in range(3):
        result[:, :, c] = (
            arr[:, :, c] * (1 - feather_mask) +
            target_arr[0, 0, c] * feather_mask
        )

    return Image.fromarray(result.clip(0, 255).astype(np.uint8))


# ============================================
# 格式转换
# ============================================

def convert_format(
    img: Image.Image,
    target_format: str,
    bg_color: tuple = (255, 255, 255)
) -> Image.Image:
    """
    图片格式预处理
    对于不支持透明通道的目标格式（JPEG），用指定背景色合成
    bg_color: RGB 元组，默认白色
    """
    fmt = target_format.upper()
    if fmt in ("JPEG", "JPG") and img.mode == "RGBA":
        bg = Image.new("RGB", img.size, bg_color)
        bg.paste(img, mask=img.split()[3])
        return bg
    if fmt in ("JPEG", "JPG") and img.mode == "P":
        return img.convert("RGB")
    return img


# ============================================
# 批量流水线处理
# ============================================

def run_pipeline(
    img: Image.Image,
    resize: Optional[ResizeRequest] = None,
    watermark_fn: Optional[callable] = None,
    filter_params: Optional[FilterRequest] = None,
    remove_bg: Optional[AIBackgroundRequest] = None,
) -> Image.Image:
    """
    按顺序执行图片处理流水线：
    1. AI 背景去除（最先执行，后续操作基于抠图结果）
    2. 缩放
    3. 滤镜
    4. 水印（由外部函数注入执行）
    """
    result = img.copy()

    # 1. AI 背景去除
    if remove_bg is not None:
        bg_result = process_remove_background(result, remove_bg)
        if bg_result is not None:
            result = bg_result

    # 2. 缩放
    if resize is not None:
        result = process_resize(result, resize)

    # 3. 滤镜
    if filter_params is not None:
        result = apply_filter(result, filter_params)

    # 4. 水印（由调用方注入，因为水印需要额外的 watermark 图片参数）
    if watermark_fn is not None:
        result = watermark_fn(result)

    return result
