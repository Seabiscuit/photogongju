"""
Pydantic 数据模型定义
- 请求体/响应体类型约束
- 枚举类型定义
- 字段校验与默认值
"""

from enum import Enum
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field, conint, confloat


# ============================================
# 枚举类型
# ============================================

class WatermarkType(str, Enum):
    """水印类型"""
    TEXT = "text"           # 文字水印
    IMAGE = "image"         # 图片水印
    TILE = "tile"           # 平铺水印


class WatermarkPosition(str, Enum):
    """水印位置"""
    TOP_LEFT = "top_left"
    TOP_CENTER = "top_center"
    TOP_RIGHT = "top_right"
    CENTER = "center"
    BOTTOM_LEFT = "bottom_left"
    BOTTOM_CENTER = "bottom_center"
    BOTTOM_RIGHT = "bottom_right"
    CUSTOM = "custom"       # 自定义坐标


class ResizeMode(str, Enum):
    """缩放模式"""
    FILL = "fill"           # 拉伸填满（不保持比例）
    FIT = "fit"             # 等比缩放适应（可能有留白）
    COVER = "cover"         # 等比缩放覆盖（可能裁剪）
    THUMBNAIL = "thumbnail" # 等比缩略图


class FilterType(str, Enum):
    """滤镜类型"""
    GRAYSCALE = "grayscale"         # 灰度
    SEPIA = "sepia"                 # 怀旧
    BLUR = "blur"                   # 模糊
    SHARPEN = "sharpen"             # 锐化
    BRIGHTNESS = "brightness"       # 亮度调整
    CONTRAST = "contrast"           # 对比度调整
    SATURATION = "saturation"       # 饱和度调整
    WARM = "warm"                   # 暖色调
    COOL = "cool"                   # 冷色调


class OutputFormat(str, Enum):
    """输出格式"""
    JPG = "jpg"
    JPEG = "jpeg"
    PNG = "png"
    WEBP = "webp"
    BMP = "bmp"


# ============================================
# 请求体模型
# ============================================

class ResizeRequest(BaseModel):
    """缩放请求"""
    width: Optional[conint(ge=1, le=8192)] = Field(None, description="目标宽度(px)")
    height: Optional[conint(ge=1, le=8192)] = Field(None, description="目标高度(px)")
    mode: ResizeMode = Field(ResizeMode.FIT, description="缩放模式")
    upscale: bool = Field(True, description="是否允许放大")
    background: str = Field("#FFFFFF", description="留白填充颜色(Hex)")

    class Config:
        json_schema_extra = {
            "example": {"width": 800, "height": 600, "mode": "fit", "upscale": True}
        }


class WatermarkTextConfig(BaseModel):
    """文字水印配置"""
    text: str = Field(..., min_length=1, max_length=200, description="水印文字内容")
    font_size: conint(ge=8, le=500) = Field(36, description="字体大小(px)")
    font_color: str = Field("#FFFFFF", description="字体颜色(Hex或rgba)")
    opacity: confloat(ge=0.0, le=1.0) = Field(0.5, description="不透明度 0~1")
    font_family: str = Field("Arial", description="字体名称")
    stroke_color: Optional[str] = Field(None, description="描边颜色")
    stroke_width: conint(ge=0, le=20) = Field(0, description="描边宽度(px)")


class WatermarkImageConfig(BaseModel):
    """图片水印配置"""
    opacity: confloat(ge=0.0, le=1.0) = Field(0.7, description="不透明度")
    scale_ratio: confloat(ge=0.01, le=1.0) = Field(0.2, description="相对主图的比例")


class WatermarkRequest(BaseModel):
    """水印请求"""
    type: WatermarkType = Field(WatermarkType.TEXT, description="水印类型")
    position: WatermarkPosition = Field(WatermarkPosition.BOTTOM_RIGHT, description="水印位置")
    margin_x: conint(ge=0, le=500) = Field(20, description="水平边距(px)")
    margin_y: conint(ge=0, le=500) = Field(20, description="垂直边距(px)")
    rotation: confloat(ge=-360, le=360) = Field(0.0, description="旋转角度(度)")
    text_config: Optional[WatermarkTextConfig] = Field(None, description="文字水印配置")
    image_config: Optional[WatermarkImageConfig] = Field(None, description="图片水印配置")

    class Config:
        json_schema_extra = {
            "example": {
                "type": "text",
                "position": "bottom_right",
                "text_config": {"text": "© 2024 PhotoGongju", "font_size": 24}
            }
        }


class FilterRequest(BaseModel):
    """滤镜请求"""
    filter_type: FilterType = Field(..., description="滤镜类型")
    intensity: confloat(ge=0.0, le=1.0) = Field(0.5, description="滤镜强度 0~1")
    blur_radius: conint(ge=1, le=100) = Field(5, description="模糊半径(仅blur有效)")
    brighten_factor: confloat(ge=0.1, le=3.0) = Field(1.2, description="亮度系数(仅brightness有效)")
    contrast_factor: confloat(ge=0.1, le=3.0) = Field(1.5, description="对比度系数(仅contrast有效)")
    saturation_factor: confloat(ge=0.0, le=5.0) = Field(1.5, description="饱和度系数(仅saturation有效)")


class AIBackgroundRequest(BaseModel):
    """AI 背景去除请求"""
    model: str = Field("rmbg_onnx", description="使用的模型名称")
    alpha_matting: bool = Field(False, description="是否启用 alpha 抠图优化")
    foreground_bias: confloat(ge=0.0, le=0.5) = Field(0.15, description="前景偏置 — 越大保留越多前景")
    morph_cleanup: bool = Field(True, description="是否启用形态学清理")
    edge_fallback: bool = Field(True, description="是否与边缘采样 mask 取并集（补回模型漏掉的前景）")
    alpha_fg_threshold: conint(ge=0, le=255) = Field(240, description="前景阈值")
    alpha_bg_threshold: conint(ge=0, le=255) = Field(10, description="背景阈值")


class ProcessPipelineRequest(BaseModel):
    """批量流水线处理请求"""
    resize: Optional[ResizeRequest] = Field(None, description="缩放参数")
    watermark: Optional[WatermarkRequest] = Field(None, description="水印参数")
    filter: Optional[FilterRequest] = Field(None, description="滤镜参数")
    remove_bg: Optional[AIBackgroundRequest] = Field(None, description="AI背景去除参数")
    output_format: OutputFormat = Field(OutputFormat.PNG, description="输出格式")
    quality: conint(ge=1, le=100) = Field(85, description="输出质量")


# ============================================
# 响应体模型
# ============================================

class ImageInfo(BaseModel):
    """图片基本信息"""
    width: int = Field(..., description="图片宽度(px)")
    height: int = Field(..., description="图片高度(px)")
    format: str = Field(..., description="图片格式")
    file_size: int = Field(..., description="文件大小(bytes)")
    aspect_ratio: str = Field(..., description="宽高比（如 16:9）")
    dpi: Optional[int] = Field(None, description="DPI")
    exif: Optional[Dict[str, Any]] = Field(None, description="EXIF 元数据")


class TaskResult(BaseModel):
    """处理任务结果"""
    task_id: str = Field(..., description="任务唯一ID")
    success: bool = Field(True, description="是否成功")
    message: str = Field("处理完成", description="提示信息")
    original: Optional[ImageInfo] = Field(None, description="原始图片信息")
    processed: Optional[ImageInfo] = Field(None, description="处理后图片信息")
    download_url: Optional[str] = Field(None, description="下载链接")
    elapsed_seconds: float = Field(0.0, description="处理耗时(秒)")


class SizePreset(BaseModel):
    """尺寸预设"""
    name: str = Field(..., description="预设名称")
    label: str = Field(..., description="中文标签")
    width: int = Field(..., description="宽度(px)")
    height: int = Field(..., description="高度(px)")
    category: str = Field(..., description="分类")
    description: str = Field("", description="描述说明")


class SizeLibraryResponse(BaseModel):
    """尺寸库响应"""
    presets: List[SizePreset] = Field(default_factory=list, description="预设尺寸列表")
    recommend: Optional[SizePreset] = Field(None, description="智能推荐的尺寸")
    total: int = Field(0, description="总数")


class HealthResponse(BaseModel):
    """健康检查响应"""
    status: str = Field("ok", description="服务状态")
    version: str = Field("1.0.0", description="API 版本")
    models_available: List[str] = Field(default_factory=list, description="已加载的模型列表")
