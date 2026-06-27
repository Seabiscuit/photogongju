"""
尺寸库服务
- 内置 50+ 常用图片尺寸预设（多平台、多场景）
- 智能推荐：根据原图比例自动匹配最接近的预设尺寸
- 支持按分类筛选与关键词搜索
"""

from typing import Optional, List, Dict, Any
from math import gcd

from models.schemas import SizePreset, SizeLibraryResponse


# ============================================
# 尺寸预设数据库
# 覆盖：社交媒体、电商、视频封面、证件照、打印、网页横幅等
# ============================================

SIZE_PRESETS: List[Dict[str, Any]] = [
    # ── 社交媒体 ──
    {"name": "instagram_square", "label": "Instagram 正方形", "width": 1080, "height": 1080, "category": "社交媒体", "description": "Instagram 帖子标准尺寸"},
    {"name": "instagram_portrait", "label": "Instagram 竖版", "width": 1080, "height": 1350, "category": "社交媒体", "description": "Instagram 竖版帖子"},
    {"name": "instagram_landscape", "label": "Instagram 横版", "width": 1080, "height": 566, "category": "社交媒体", "description": "Instagram 横版帖子"},
    {"name": "instagram_story", "label": "Instagram 快拍", "width": 1080, "height": 1920, "category": "社交媒体", "description": "Instagram Stories / Reels"},
    {"name": "facebook_post", "label": "Facebook 帖子", "width": 1200, "height": 630, "category": "社交媒体", "description": "Facebook 分享链接图片"},
    {"name": "facebook_cover", "label": "Facebook 封面", "width": 851, "height": 315, "category": "社交媒体", "description": "Facebook 主页封面图"},
    {"name": "twitter_post", "label": "Twitter/X 帖子", "width": 1200, "height": 675, "category": "社交媒体", "description": "Twitter/X 推文图片"},
    {"name": "twitter_header", "label": "Twitter/X 头部", "width": 1500, "height": 500, "category": "社交媒体", "description": "Twitter/X 个人主页横幅"},
    {"name": "linkedin_post", "label": "LinkedIn 帖子", "width": 1200, "height": 627, "category": "社交媒体", "description": "LinkedIn 分享图片"},
    {"name": "linkedin_banner", "label": "LinkedIn 横幅", "width": 1584, "height": 396, "category": "社交媒体", "description": "LinkedIn 个人/公司页横幅"},
    {"name": "pinterest_pin", "label": "Pinterest 图钉", "width": 1000, "height": 1500, "category": "社交媒体", "description": "Pinterest 标准 Pin 尺寸"},
    {"name": "wechat_moment", "label": "微信朋友圈", "width": 1080, "height": 1080, "category": "社交媒体", "description": "微信朋友圈图片推荐尺寸"},
    {"name": "weibo_post", "label": "微博配图", "width": 1200, "height": 1200, "category": "社交媒体", "description": "微博发帖配图"},
    {"name": "xiaohongshu", "label": "小红书封面", "width": 1080, "height": 1440, "category": "社交媒体", "description": "小红书笔记封面 3:4"},
    {"name": "douyin_cover", "label": "抖音封面", "width": 1080, "height": 1920, "category": "社交媒体", "description": "抖音短视频封面 9:16"},

    # ── 电商 ──
    {"name": "taobao_main", "label": "淘宝主图", "width": 800, "height": 800, "category": "电商", "description": "淘宝/天猫商品主图"},
    {"name": "taobao_detail", "label": "淘宝详情图", "width": 750, "height": 1000, "category": "电商", "description": "淘宝描述详情图 (宽度750)"},
    {"name": "jd_main", "label": "京东主图", "width": 800, "height": 800, "category": "电商", "description": "京东商品主图"},
    {"name": "pdd_main", "label": "拼多多主图", "width": 800, "height": 800, "category": "电商", "description": "拼多多商品主图"},
    {"name": "amazon_main", "label": "Amazon 主图", "width": 2000, "height": 2000, "category": "电商", "description": "Amazon 商品主图 (白色背景)"},
    {"name": "shopify_product", "label": "Shopify 产品图", "width": 2048, "height": 2048, "category": "电商", "description": "Shopify 产品图片"},
    {"name": "ebay_main", "label": "eBay 主图", "width": 1600, "height": 1600, "category": "电商", "description": "eBay 商品主图"},

    # ── 视频平台封面 ──
    {"name": "youtube_thumbnail", "label": "YouTube 缩略图", "width": 1280, "height": 720, "category": "视频封面", "description": "YouTube 视频缩略图 16:9"},
    {"name": "bilibili_cover", "label": "B站封面", "width": 1920, "height": 1080, "category": "视频封面", "description": "哔哩哔哩视频封面 16:9"},
    {"name": "tiktok_cover", "label": "TikTok 封面", "width": 1080, "height": 1920, "category": "视频封面", "description": "TikTok 视频封面 9:16"},

    # ── 证件照 ──
    {"name": "id_1inch", "label": "一寸照", "width": 295, "height": 413, "category": "证件照", "description": "标准一寸证件照 (25mm×35mm @300dpi)"},
    {"name": "id_2inch", "label": "二寸照", "width": 413, "height": 579, "category": "证件照", "description": "标准二寸证件照 (35mm×49mm @300dpi)"},
    {"name": "id_passport_cn", "label": "中国护照", "width": 390, "height": 567, "category": "证件照", "description": "中国护照照片 (33mm×48mm @300dpi)"},
    {"name": "id_visa_us", "label": "美国签证", "width": 600, "height": 600, "category": "证件照", "description": "美国签证照片 (51mm×51mm @300dpi)"},
    {"name": "id_card_cn", "label": "身份证照", "width": 358, "height": 441, "category": "证件照", "description": "二代身份证照片"},

    # ── 打印 / 印刷 ──
    {"name": "print_a4_300dpi", "label": "A4 打印 (300dpi)", "width": 2480, "height": 3508, "category": "打印", "description": "A4 尺寸 @300dpi"},
    {"name": "print_a3_300dpi", "label": "A3 打印 (300dpi)", "width": 3508, "height": 4961, "category": "打印", "description": "A3 尺寸 @300dpi"},
    {"name": "print_4x6", "label": '4"×6" 照片', "width": 1200, "height": 1800, "category": "打印", "description": "标准 4×6 英寸照片 @300dpi"},
    {"name": "print_5x7", "label": '5"×7" 照片', "width": 1500, "height": 2100, "category": "打印", "description": "标准 5×7 英寸照片 @300dpi"},
    {"name": "print_8x10", "label": '8"×10" 照片', "width": 2400, "height": 3000, "category": "打印", "description": "标准 8×10 英寸照片 @300dpi"},
    {"name": "print_poster_a2", "label": "A2 海报", "width": 4961, "height": 7016, "category": "打印", "description": "A2 海报 @300dpi"},

    # ── 网页 / UI ──
    {"name": "web_hero_banner", "label": "网页 Hero 横幅", "width": 1920, "height": 800, "category": "网页", "description": "网站首屏大图横幅"},
    {"name": "web_blog_featured", "label": "博客特色图", "width": 1200, "height": 628, "category": "网页", "description": "博客文章特色图片"},
    {"name": "web_og_image", "label": "Open Graph 图", "width": 1200, "height": 630, "category": "网页", "description": "社交媒体分享 Open Graph 标签图片"},
    {"name": "web_favicon", "label": "网站 Favicon", "width": 256, "height": 256, "category": "网页", "description": "网站图标 (推荐256×256)"},
    {"name": "web_logo_rect", "label": "横版 Logo", "width": 500, "height": 200, "category": "网页", "description": "网站横版 Logo (常用)"},
    {"name": "web_logo_square", "label": "方形 Logo", "width": 512, "height": 512, "category": "网页", "description": "App / 方形 Logo"},

    # ── 手机壁纸 ──
    {"name": "wallpaper_iphone15", "label": "iPhone 15 壁纸", "width": 1290, "height": 2796, "category": "壁纸", "description": "iPhone 15 Pro Max 壁纸"},
    {"name": "wallpaper_iphone_se", "label": "iPhone SE 壁纸", "width": 750, "height": 1334, "category": "壁纸", "description": "iPhone SE 壁纸"},
    {"name": "wallpaper_android_hd", "label": "安卓 HD 壁纸", "width": 1080, "height": 1920, "category": "壁纸", "description": "安卓手机通用 1080p 壁纸"},
    {"name": "wallpaper_android_2k", "label": "安卓 2K 壁纸", "width": 1440, "height": 2560, "category": "壁纸", "description": "安卓手机 2K 壁纸"},
    {"name": "wallpaper_desktop_1080p", "label": "桌面 1080p 壁纸", "width": 1920, "height": 1080, "category": "壁纸", "description": "标准桌面 1080p 壁纸"},
    {"name": "wallpaper_desktop_4k", "label": "桌面 4K 壁纸", "width": 3840, "height": 2160, "category": "壁纸", "description": "桌面 4K UHD 壁纸"},

    # ── 特殊尺寸 ──
    {"name": "golden_ratio_landscape", "label": "黄金比例 横版", "width": 1618, "height": 1000, "category": "特殊", "description": "黄金比例 φ≈1.618"},
    {"name": "golden_ratio_portrait", "label": "黄金比例 竖版", "width": 1000, "height": 1618, "category": "特殊", "description": "黄金比例 φ≈1.618 (竖版)"},
]


def _aspect_ratio_distance(
    src_w: int, src_h: int,
    preset_w: int, preset_h: int
) -> float:
    """
    计算源图与预设尺寸的宽高比相似度距离
    距离越小越相似
    使用对数比值差，对横向/纵向图都公平
    """
    import math
    src_ratio = src_w / src_h if src_h > 0 else 1.0
    preset_ratio = preset_w / preset_h if preset_h > 0 else 1.0

    # 对数距离：对横图和竖图都公平
    if src_ratio >= 1 and preset_ratio >= 1:
        # 都是横图（或正方形）
        distance = abs(math.log(src_ratio) - math.log(preset_ratio))
    elif src_ratio < 1 and preset_ratio < 1:
        # 都是竖图
        distance = abs(math.log(src_ratio) - math.log(preset_ratio))
    else:
        # 一横一竖，加大惩罚
        distance = abs(math.log(src_ratio) - math.log(preset_ratio)) + 0.5

    return distance


def get_all_presets(
    category: Optional[str] = None,
    keyword: Optional[str] = None
) -> List[SizePreset]:
    """
    获取所有尺寸预设，可按分类和关键词过滤
    """
    results: List[SizePreset] = []
    for p in SIZE_PRESETS:
        if category and p["category"] != category:
            continue
        if keyword:
            kw = keyword.lower()
            if kw not in p["name"].lower() and kw not in p["label"].lower() and kw not in p["description"].lower():
                # 也支持搜如 "1080×1080" 这种格式
                if kw not in f"{p['width']}x{p['height']}".lower() and kw not in f"{p['width']}×{p['height']}".lower():
                    continue
        results.append(SizePreset(**p))

    return results


def get_all_categories() -> List[str]:
    """获取所有分类名称（去重排序）"""
    cats = sorted(set(p["category"] for p in SIZE_PRESETS))
    return cats


def get_preset_by_name(name: str) -> Optional[SizePreset]:
    """根据预设名称精确查找"""
    for p in SIZE_PRESETS:
        if p["name"] == name:
            return SizePreset(**p)
    return None


def recommend_size(
    src_width: int,
    src_height: int,
    top_k: int = 5
) -> SizeLibraryResponse:
    """
    根据原始图片尺寸，智能推荐最匹配的预设尺寸

    算法：
    1. 计算源图宽高比
    2. 对所有预设按比例相似度排序
    3. 返回 Top-K 个最佳匹配
    """
    # 计算每个预设的距离并排序
    scored = []
    for p in SIZE_PRESETS:
        dist = _aspect_ratio_distance(src_width, src_height, p["width"], p["height"])
        scored.append((dist, p))

    scored.sort(key=lambda x: x[0])

    # 取 Top-K
    top_matches = [SizePreset(**item[1]) for item in scored[:top_k]]

    # 对于最佳匹配，额外计算适配后的实际尺寸
    best_preset = top_matches[0] if top_matches else None

    return SizeLibraryResponse(
        presets=top_matches,
        recommend=best_preset,
        total=len(top_matches),
    )


def get_presets_by_category() -> Dict[str, List[SizePreset]]:
    """按分类分组返回所有预设"""
    grouped: Dict[str, List[SizePreset]] = {}
    for p in SIZE_PRESETS:
        cat = p["category"]
        if cat not in grouped:
            grouped[cat] = []
        grouped[cat].append(SizePreset(**p))
    return grouped
