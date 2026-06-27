"""
水印引擎服务
支持三种水印模式：
1. 文字水印 — 自定义文字、字体大小、颜色、透明度、旋转
2. 图片水印 — 叠加 PNG/JPEG Logo，支持缩放与透明度
3. 平铺水印 — 文字或图片平铺覆盖整张图片
"""

from pathlib import Path
from typing import Optional, Tuple
import math

from PIL import Image, ImageDraw, ImageFont, ImageEnhance
import numpy as np

from models.schemas import (
    WatermarkRequest, WatermarkType, WatermarkPosition,
    WatermarkTextConfig, WatermarkImageConfig
)


# ============================================
# 系统字体搜索
# ============================================

def _find_system_font() -> str:
    """
    跨平台查找可用字体
    优先返回支持中文的字体
    """
    import platform
    system = platform.system()

    # 按优先级排列的字体列表
    if system == "Windows":
        candidates = [
            "C:/Windows/Fonts/simhei.ttf",       # 黑体
            "C:/Windows/Fonts/msyh.ttc",          # 微软雅黑
            "C:/Windows/Fonts/simsun.ttc",        # 宋体
            "C:/Windows/Fonts/arial.ttf",
        ]
    elif system == "Darwin":
        candidates = [
            "/System/Library/Fonts/PingFang.ttc",
            "/Library/Fonts/Arial Unicode.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
        ]
    else:
        candidates = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        ]

    for font_path in candidates:
        if Path(font_path).exists():
            return font_path
    # 如果都找不到，使用默认路径（PIL 会回退到默认字体）
    return ""


SYSTEM_FONT_PATH = _find_system_font()


# ============================================
# 通用工具
# ============================================

def _adjust_opacity(img: Image.Image, opacity: float) -> Image.Image:
    """调整图片整体不透明度"""
    if opacity >= 1.0:
        return img
    if opacity <= 0.0:
        # 完全透明，返回空图
        return Image.new("RGBA", img.size, (0, 0, 0, 0))

    # 分离 alpha 通道并乘上 opacity
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    r, g, b, a = img.split()
    a = a.point(lambda x: int(x * opacity))
    img = Image.merge("RGBA", (r, g, b, a))
    return img


def _rotate_image(img: Image.Image, angle: float, expand: bool = True) -> Image.Image:
    """旋转图片（自动扩展画布）"""
    if angle == 0:
        return img
    return img.rotate(angle, resample=Image.BICUBIC, expand=expand)


def _calc_position(
    canvas_size: Tuple[int, int],
    element_size: Tuple[int, int],
    position: WatermarkPosition,
    margin_x: int = 0,
    margin_y: int = 0,
    custom_xy: Optional[Tuple[int, int]] = None
) -> Tuple[int, int]:
    """
    计算元素在画布上的放置坐标（左上角）
    canvas_size: (宽, 高)
    element_size: (宽, 高)
    """
    cw, ch = canvas_size
    ew, eh = element_size

    positions = {
        WatermarkPosition.TOP_LEFT:      (margin_x, margin_y),
        WatermarkPosition.TOP_CENTER:    ((cw - ew) // 2, margin_y),
        WatermarkPosition.TOP_RIGHT:     (cw - ew - margin_x, margin_y),
        WatermarkPosition.CENTER:        ((cw - ew) // 2, (ch - eh) // 2),
        WatermarkPosition.BOTTOM_LEFT:   (margin_x, ch - eh - margin_y),
        WatermarkPosition.BOTTOM_CENTER: ((cw - ew) // 2, ch - eh - margin_y),
        WatermarkPosition.BOTTOM_RIGHT:  (cw - ew - margin_x, ch - eh - margin_y),
        WatermarkPosition.CUSTOM:        custom_xy or (margin_x, margin_y),
    }

    return positions.get(position, (margin_x, margin_y))


# ============================================
# 文字水印
# ============================================

def create_text_watermark_layer(
    text: str,
    font_size: int,
    font_color: str,
    font_family: str = "Arial",
    stroke_color: Optional[str] = None,
    stroke_width: int = 0,
) -> Image.Image:
    """
    创建文字水印图层（RGBA 模式）
    返回一个透明背景的文字图层，其尺寸刚好容纳文字
    """
    # 加载字体
    try:
        if SYSTEM_FONT_PATH:
            font = ImageFont.truetype(SYSTEM_FONT_PATH, font_size)
        else:
            font = ImageFont.load_default()
    except Exception:
        font = ImageFont.load_default()

    # 计算文字边界框
    # 使用 textbbox 获取精确尺寸
    temp_img = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    temp_draw = ImageDraw.Draw(temp_img)
    bbox = temp_draw.textbbox((0, 0), text, font=font, stroke_width=stroke_width)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    # 额外留一些边距，用于旋转时不会被裁切
    padding = max(font_size // 4, stroke_width * 2)
    layer_w = text_w + padding * 2
    layer_h = text_h + padding * 2

    # 创建透明图层
    layer = Image.new("RGBA", (layer_w, layer_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    # 解析颜色
    fill_color = _parse_color(font_color)
    stroke = _parse_color(stroke_color) if stroke_color else None

    # 在图层中央绘制文字
    text_x = padding - bbox[0]
    text_y = padding - bbox[1]
    draw.text(
        (text_x, text_y),
        text,
        font=font,
        fill=fill_color,
        stroke_width=stroke_width,
        stroke_fill=stroke,
    )

    return layer


def apply_text_watermark(
    img: Image.Image,
    config: WatermarkTextConfig,
    position: WatermarkPosition,
    margin_x: int,
    margin_y: int,
    rotation: float,
) -> Image.Image:
    """
    对图片应用文字水印
    """
    # 创建文字图层
    text_layer = create_text_watermark_layer(
        text=config.text,
        font_size=config.font_size,
        font_color=config.font_color,
        font_family=config.font_family,
        stroke_color=config.stroke_color,
        stroke_width=config.stroke_width,
    )

    # 设置不透明度
    text_layer = _adjust_opacity(text_layer, config.opacity)

    # 旋转文字图层
    if rotation != 0:
        text_layer = _rotate_image(text_layer, rotation)

    # 计算位置
    pos = _calc_position(img.size, text_layer.size, position, margin_x, margin_y)

    # 合成到原图上
    result = img.copy()
    if result.mode != "RGBA":
        result = result.convert("RGBA")

    result.paste(text_layer, pos, text_layer)  # 使用 alpha 通道做 mask
    return result


# ============================================
# 图片水印
# ============================================

def apply_image_watermark(
    img: Image.Image,
    watermark_img: Image.Image,
    config: WatermarkImageConfig,
    position: WatermarkPosition,
    margin_x: int,
    margin_y: int,
    rotation: float,
) -> Image.Image:
    """
    对图片应用图片水印（如 Logo）
    """

    # 计算水印尺寸（相对于原图的比例）
    wm_scale = config.scale_ratio
    wm_w = int(img.size[0] * wm_scale)
    wm_h = int(watermark_img.size[1] * (wm_w / watermark_img.size[0]))
    wm_h = max(wm_h, 1)

    # 缩放水印图
    wm_resized = watermark_img.copy()
    wm_resized.thumbnail((wm_w, wm_h), Image.LANCZOS)

    # 转 RGBA 并调整不透明度
    if wm_resized.mode != "RGBA":
        wm_resized = wm_resized.convert("RGBA")
    wm_resized = _adjust_opacity(wm_resized, config.opacity)

    # 旋转
    if rotation != 0:
        wm_resized = _rotate_image(wm_resized, rotation)

    # 计算位置
    pos = _calc_position(img.size, wm_resized.size, position, margin_x, margin_y)

    # 合成
    result = img.copy()
    if result.mode != "RGBA":
        result = result.convert("RGBA")

    result.paste(wm_resized, pos, wm_resized)
    return result


# ============================================
# 平铺水印
# ============================================

def apply_tile_watermark(
    img: Image.Image,
    tile_source: Image.Image,
    opacity: float = 0.3,
    spacing_ratio: float = 3.0,
) -> Image.Image:
    """
    平铺水印：将指定图片在整个画布上重复平铺

    参数:
        img: 原始图片
        tile_source: 平铺单元图（文字图层或 Logo）
        opacity: 平铺单元透明度
        spacing_ratio: 平铺间距相对于单元尺寸的比例（3.0 表示间距为单元宽度的 3 倍）
    """
    result = img.copy()
    if result.mode != "RGBA":
        result = result.convert("RGBA")

    # 设置透明度
    tile = _adjust_opacity(tile_source, opacity)

    tw, th = tile.size
    cw, ch = img.size

    # 计算水平和垂直间距
    spacing_x = int(tw * spacing_ratio)
    spacing_y = int(th * spacing_ratio)

    step_x = tw + spacing_x
    step_y = th + spacing_y

    # 平铺覆盖整个画布
    y = 0
    while y < ch:
        x = 0
        while x < cw:
            result.paste(tile, (x, y), tile)
            x += step_x
        y += step_y

    return result


def create_tile_text_layer(
    text: str,
    font_size: int = 24,
    font_color: str = "#FFFFFF",
    opacity: float = 0.3,
    rotation: float = -30,
) -> Image.Image:
    """
    创建用于平铺的文字水印单元
    旋转后产生经典的防伪水印效果
    """
    layer = create_text_watermark_layer(
        text=text,
        font_size=font_size,
        font_color=font_color,
    )
    layer = _adjust_opacity(layer, opacity)
    if rotation != 0:
        layer = _rotate_image(layer, rotation)
    return layer


# ============================================
# 统一水印入口
# ============================================

def apply_watermark(
    img: Image.Image,
    params: WatermarkRequest,
    watermark_image: Optional[Image.Image] = None,  # 图片水印时传入的水印图
) -> Image.Image:
    """
    统一水印处理入口
    根据 params.type 自动分发到对应处理方法
    """
    if params.type == WatermarkType.TEXT:
        # 文字水印
        if params.text_config is None:
            raise ValueError("文字水印需要提供 text_config 参数")
        return apply_text_watermark(
            img=img,
            config=params.text_config,
            position=params.position,
            margin_x=params.margin_x,
            margin_y=params.margin_y,
            rotation=params.rotation,
        )

    elif params.type == WatermarkType.IMAGE:
        # 图片水印
        if watermark_image is None:
            raise ValueError("图片水印需要上传水印图片文件")
        if params.image_config is None:
            params.image_config = WatermarkImageConfig()
        return apply_image_watermark(
            img=img,
            watermark_img=watermark_image,
            config=params.image_config,
            position=params.position,
            margin_x=params.margin_x,
            margin_y=params.margin_y,
            rotation=params.rotation,
        )

    elif params.type == WatermarkType.TILE:
        # 平铺水印
        if params.text_config is not None:
            # 文字平铺
            tile_layer = create_tile_text_layer(
                text=params.text_config.text,
                font_size=params.text_config.font_size,
                font_color=params.text_config.font_color,
                opacity=params.text_config.opacity,
                rotation=params.rotation if params.rotation != 0 else -30,
            )
        elif watermark_image is not None:
            # 图片平铺
            tile_layer = watermark_image.copy()
            if tile_layer.mode != "RGBA":
                tile_layer = tile_layer.convert("RGBA")
            tile_layer = _adjust_opacity(tile_layer, params.image_config.opacity if params.image_config else 0.3)
        else:
            raise ValueError("平铺水印需要提供 text_config 或上传水印图片")

        return apply_tile_watermark(
            img=img,
            tile_source=tile_layer,
            opacity=0.3,
            spacing_ratio=3.0,
        )

    return img.copy()


# ============================================
# 内部工具
# ============================================

def _parse_color(color_str: str) -> Tuple[int, int, int, int]:
    """
    解析颜色字符串为 RGBA 元组
    支持格式:
        "#FFFFFF" → (255, 255, 255, 255)
        "#FFF"    → (255, 255, 255, 255)
        "rgba(255,255,255,0.5)" → (255, 255, 255, 127)
        "red", "white" 等 → 对应颜色
    """
    color_str = color_str.strip()

    # rgba() 格式
    if color_str.startswith("rgba("):
        parts = color_str[5:-1].split(",")
        r = int(parts[0])
        g = int(parts[1])
        b = int(parts[2])
        a = int(float(parts[3]) * 255)
        return (r, g, b, a)

    # rgb() 格式
    if color_str.startswith("rgb("):
        parts = color_str[4:-1].split(",")
        return (int(parts[0]), int(parts[1]), int(parts[2]), 255)

    # Hex 格式
    if color_str.startswith("#"):
        hex_str = color_str.lstrip("#")
        if len(hex_str) == 3:
            hex_str = "".join(c * 2 for c in hex_str)
        if len(hex_str) == 8:
            # #RRGGBBAA
            return (
                int(hex_str[0:2], 16),
                int(hex_str[2:4], 16),
                int(hex_str[4:6], 16),
                int(hex_str[6:8], 16),
            )
        return (
            int(hex_str[0:2], 16),
            int(hex_str[2:4], 16),
            int(hex_str[4:6], 16),
            255,
        )

    # 命名字符串
    try:
        from PIL.ImageColor import getrgb
        r, g, b = getrgb(color_str)
        return (r, g, b, 255)
    except ValueError:
        return (255, 255, 255, 255)
