"""
通用工具函数
- 图片安全读写
- 文件哈希校验
- EXIF 元数据提取
- 图片信息计算
"""

import hashlib
import uuid
import time
from pathlib import Path
from typing import Optional, Tuple, Dict, Any
from io import BytesIO

from PIL import Image, ExifTags
from PIL.ExifTags import GPSTAGS
import numpy as np

from config import SUPPORTED_INPUT_FORMATS, SUPPORTED_OUTPUT_FORMATS, DEFAULT_IMAGE_PARAMS


# ============================================
# 文件哈希
# ============================================

def file_md5(file_path: Path) -> str:
    """计算文件的 MD5 哈希值"""
    hash_md5 = hashlib.md5()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest()


def generate_task_id() -> str:
    """生成唯一的任务 ID（UUID4 + 时间戳）"""
    return f"{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"


# ============================================
# 格式校验
# ============================================

def validate_image_format(filename: str) -> Tuple[bool, str]:
    """
    校验文件后缀是否为支持的图片格式
    返回: (是否合法, 小写后缀)
    """
    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED_INPUT_FORMATS:
        return False, suffix
    return True, suffix


def validate_output_format(fmt: str) -> Tuple[bool, str]:
    """校验输出格式是否支持"""
    suffix = f".{fmt.lower().lstrip('.')}"
    if suffix not in SUPPORTED_OUTPUT_FORMATS:
        return False, suffix
    return True, suffix


# ============================================
# 图片读写
# ============================================

def safe_open_image(file_path: Path) -> Optional[Image.Image]:
    """
    安全打开图片文件，自动转 RGB/RGBA
    返回 PIL Image 对象或 None
    """
    try:
        img = Image.open(file_path)
        # 复制一份避免文件锁
        img.load()
        # 统一转 RGB（保留透明通道信息）
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA")
        return img
    except Exception as e:
        print(f"[ERROR] 无法打开图片: {file_path}, 错误: {e}")
        return None


def safe_save_image(
    img: Image.Image,
    output_path: Path,
    fmt: str = "PNG",
    quality: int = DEFAULT_IMAGE_PARAMS["quality"],
    bg_color: Tuple[int, int, int] = (255, 255, 255)
) -> bool:
    """
    安全保存图片到文件
    bg_color: RGBA→RGB 转换时的背景色（默认白色）
    """
    try:
        fmt_upper = fmt.upper()
        save_kwargs = {}
        # PIL 只识别 "JPEG"，不识别 "JPG"
        pil_format = "JPEG" if fmt_upper in ("JPEG", "JPG") else fmt_upper

        if fmt_upper in ("JPEG", "JPG"):
            save_kwargs["quality"] = quality
            save_kwargs["optimize"] = True
            # JPEG 不支持 Alpha 通道，需转 RGB
            if img.mode == "RGBA":
                # ★ 使用指定的背景色而非固定白色
                background = Image.new("RGB", img.size, bg_color)
                background.paste(img, mask=img.split()[3])
                img = background

        elif fmt_upper == "WEBP":
            save_kwargs["quality"] = quality

        elif fmt_upper == "PNG":
            save_kwargs["optimize"] = True

        img.save(output_path, format=pil_format, **save_kwargs)
        return True
    except Exception as e:
        print(f"[ERROR] 保存图片失败: {output_path}, 错误: {e}")
        return False


def image_to_bytes(img: Image.Image, fmt: str = "PNG", quality: int = 85) -> BytesIO:
    """将 PIL Image 转为内存字节流"""
    buf = BytesIO()
    fmt_upper = fmt.upper()

    save_kwargs = {}
    pil_format = "JPEG" if fmt_upper in ("JPEG", "JPG") else fmt_upper

    if fmt_upper in ("JPEG", "JPG"):
        save_kwargs["quality"] = quality
        if img.mode == "RGBA":
            background = Image.new("RGB", img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[3])
            img = background
    elif fmt_upper == "WEBP":
        save_kwargs["quality"] = quality

    img.save(buf, format=pil_format, **save_kwargs)
    buf.seek(0)
    return buf


# ============================================
# 图片信息提取
# ============================================

def get_image_info(file_path: Path) -> Dict[str, Any]:
    """
    提取图片的完整信息：尺寸、格式、大小、DPI、EXIF 等
    """
    img = safe_open_image(file_path)
    if img is None:
        return {}

    file_size = file_path.stat().st_size
    width, height = img.size

    # 计算宽高比的最简分数表示
    from math import gcd
    g = gcd(width, height)
    aspect_ratio = f"{width//g}:{height//g}"

    # 提取 DPI
    dpi_val = img.info.get("dpi", None)
    dpi = int(dpi_val[0]) if dpi_val else None

    # 提取 EXIF 元数据
    exif_data = extract_exif(img)

    info = {
        "width": width,
        "height": height,
        "format": img.format or Path(file_path).suffix.upper().lstrip("."),
        "file_size": file_size,
        "aspect_ratio": aspect_ratio,
        "dpi": dpi,
        "exif": exif_data,
    }
    img.close()
    return info


def extract_exif(img: Image.Image) -> Optional[Dict[str, Any]]:
    """
    安全提取 EXIF 元数据
    将原始字节值转为可读文本
    """
    try:
        exif_raw = img._getexif()
        if not exif_raw:
            return None

        result = {}
        for tag_id, value in exif_raw.items():
            tag_name = ExifTags.TAGS.get(tag_id, str(tag_id))
            # 跳过二进制大字段（如缩略图）
            if isinstance(value, bytes) and len(value) > 256:
                continue
            # GPS 信息单独处理
            if tag_name == "GPSInfo":
                gps_info = {}
                for k, v in value.items():
                    gps_tag = GPSTAGS.get(k, str(k))
                    gps_info[gps_tag] = str(v)
                result["GPSInfo"] = gps_info
            else:
                result[tag_name] = str(value)
        return result if result else None
    except Exception:
        return None


# ============================================
# 图片尺寸 / 比例工具
# ============================================

def calc_fit_size(
    src_width: int, src_height: int,
    target_width: int, target_height: int,
    upscale: bool = True
) -> Tuple[int, int]:
    """
    等比缩放计算（fit 模式）
    返回新的 (宽, 高)，保持宽高比，不裁剪

    如果 upscale=False 且目标尺寸大于原图，则保持原尺寸
    """
    if not upscale and target_width >= src_width and target_height >= src_height:
        return src_width, src_height

    ratio = min(target_width / src_width, target_height / src_height)
    new_w = int(src_width * ratio)
    new_h = int(src_height * ratio)
    return new_w, new_h


def calc_cover_size(
    src_width: int, src_height: int,
    target_width: int, target_height: int
) -> Tuple[int, int, int, int]:
    """
    等比缩放计算（cover 模式）
    返回 (新宽, 新高, 裁剪左, 裁剪上) — 裁剪区域居中
    """
    ratio = max(target_width / src_width, target_height / src_height)
    new_w = int(src_width * ratio)
    new_h = int(src_height * ratio)

    left = (new_w - target_width) // 2
    top = (new_h - target_height) // 2
    return new_w, new_h, left, top


def get_dominant_color(img: Image.Image) -> Tuple[int, int, int]:
    """
    快速获取图片主色调（基于缩略图的平均值）
    """
    thumbnail = img.copy()
    thumbnail.thumbnail((100, 100))
    arr = np.array(thumbnail.convert("RGB"))
    mean_color = arr.mean(axis=(0, 1)).astype(int)
    thumbnail.close()
    return tuple(mean_color)
