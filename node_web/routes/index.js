/**
 * 页面路由
 * 处理所有页面级 GET 请求，渲染 EJS 模板
 */

const express = require('express');
const router = express.Router();

const aiService = require('../services/aiService');

// ============================================
// 首页
// ============================================

router.get('/', async (req, res) => {
    try {
        // 检查 AI 服务状态
        let aiStatus = 'offline';
        try {
            const health = await aiService.healthCheck();
            aiStatus = health.status === 'ok' ? 'online' : 'offline';
        } catch {
            aiStatus = 'offline';
        }

        res.render('index', {
            title: 'PhotoGongju - 智能图片处理工具箱',
            subtitle: '一站式在线图片编辑：缩放、滤镜、水印、AI抠图、尺寸预设',
            activeNav: 'home',
            aiStatus,
            bodyClass: 'page-home',
        });
    } catch (err) {
        console.error('[ERROR] 首页渲染失败:', err.message);
        res.render('index', {
            title: 'PhotoGongju',
            subtitle: '智能图片处理工具箱',
            activeNav: 'home',
            aiStatus: 'offline',
            bodyClass: 'page-home',
        });
    }
});

// ============================================
// 上传页面
// ============================================

router.get('/upload', (req, res) => {
    res.render('upload', {
        title: '上传图片 - PhotoGongju',
        activeNav: 'upload',
        bodyClass: 'page-upload',
        taskId: req.query.taskId || null, // 如果是从其他页面重定向来的 task_id
        success: req.query.success || null,
    });
});

// ============================================
// 结果展示页面
// ============================================

router.get('/result/:taskId', async (req, res) => {
    const { taskId } = req.params;

    try {
        // 获取处理后的图片信息
        const resultInfo = await aiService.getImageInfo(taskId);
        const downloadUrl = aiService.getDownloadUrl(taskId);

        // 原始图片：如果有 original 信息，代理到 Python AI 服务下载
        let originalUrl = null;
        if (resultInfo && resultInfo.original && resultInfo.original.width) {
            originalUrl = `/api/proxy-image/${taskId}`;
        } else if (resultInfo && resultInfo.processed) {
            // 这是处理结果，原始上传文件不可追溯
            originalUrl = null;
        }

        res.render('result', {
            title: '处理结果 - PhotoGongju',
            activeNav: '',
            bodyClass: 'page-result',
            taskId,
            result: resultInfo,
            downloadUrl,
            originalUrl,
        });
    } catch (err) {
        console.error('[ERROR] 获取处理结果失败:', err.message);
        res.render('result', {
            title: '处理结果 - PhotoGongju',
            activeNav: '',
            bodyClass: 'page-result',
            taskId,
            result: null,
            downloadUrl: null,
            originalUrl: null,
            error: '无法加载处理结果，任务可能已过期',
        });
    }
});

// ============================================
// 尺寸库页面
// ============================================

// 内置回退数据（Python 服务不可用时使用）
const FALLBACK_SIZE_LIBRARY = {
    presets: [
        // 社交媒体
        { name:"instagram_square", label:"Instagram 正方形", width:1080, height:1080, category:"社交媒体" },
        { name:"instagram_portrait", label:"Instagram 竖版", width:1080, height:1350, category:"社交媒体" },
        { name:"instagram_story", label:"Instagram 快拍", width:1080, height:1920, category:"社交媒体" },
        { name:"facebook_post", label:"Facebook 帖子", width:1200, height:630, category:"社交媒体" },
        { name:"twitter_post", label:"Twitter/X 帖子", width:1200, height:675, category:"社交媒体" },
        { name:"linkedin_post", label:"LinkedIn 帖子", width:1200, height:627, category:"社交媒体" },
        { name:"pinterest_pin", label:"Pinterest 图钉", width:1000, height:1500, category:"社交媒体" },
        { name:"wechat_moment", label:"微信朋友圈", width:1080, height:1080, category:"社交媒体" },
        { name:"weibo_post", label:"微博配图", width:1200, height:1200, category:"社交媒体" },
        { name:"xiaohongshu", label:"小红书封面", width:1080, height:1440, category:"社交媒体" },
        { name:"douyin_cover", label:"抖音封面", width:1080, height:1920, category:"社交媒体" },
        // 电商
        { name:"taobao_main", label:"淘宝主图", width:800, height:800, category:"电商" },
        { name:"taobao_detail", label:"淘宝详情图", width:750, height:1000, category:"电商" },
        { name:"jd_main", label:"京东主图", width:800, height:800, category:"电商" },
        { name:"pdd_main", label:"拼多多主图", width:800, height:800, category:"电商" },
        { name:"amazon_main", label:"Amazon 主图", width:2000, height:2000, category:"电商" },
        { name:"shopify_product", label:"Shopify 产品图", width:2048, height:2048, category:"电商" },
        // 视频封面
        { name:"youtube_thumbnail", label:"YouTube 缩略图", width:1280, height:720, category:"视频封面" },
        { name:"bilibili_cover", label:"B站封面", width:1920, height:1080, category:"视频封面" },
        // 证件照
        { name:"id_1inch", label:"一寸照", width:295, height:413, category:"证件照" },
        { name:"id_2inch", label:"二寸照", width:413, height:579, category:"证件照" },
        { name:"id_passport_cn", label:"中国护照", width:390, height:567, category:"证件照" },
        { name:"id_visa_us", label:"美国签证", width:600, height:600, category:"证件照" },
        { name:"id_card_cn", label:"身份证照", width:358, height:441, category:"证件照" },
        // 打印
        { name:"print_a4_300dpi", label:"A4 打印 (300dpi)", width:2480, height:3508, category:"打印" },
        { name:"print_a3_300dpi", label:"A3 打印 (300dpi)", width:3508, height:4961, category:"打印" },
        { name:"print_4x6", label:"4×6 照片", width:1200, height:1800, category:"打印" },
        { name:"print_5x7", label:"5×7 照片", width:1500, height:2100, category:"打印" },
        { name:"print_8x10", label:"8×10 照片", width:2400, height:3000, category:"打印" },
        // 网页
        { name:"web_hero_banner", label:"网页 Hero 横幅", width:1920, height:800, category:"网页" },
        { name:"web_og_image", label:"Open Graph 图", width:1200, height:630, category:"网页" },
        { name:"web_favicon", label:"网站 Favicon", width:256, height:256, category:"网页" },
        { name:"web_logo_square", label:"方形 Logo", width:512, height:512, category:"网页" },
        // 壁纸
        { name:"wallpaper_iphone15", label:"iPhone 15 壁纸", width:1290, height:2796, category:"壁纸" },
        { name:"wallpaper_android_hd", label:"安卓 HD 壁纸", width:1080, height:1920, category:"壁纸" },
        { name:"wallpaper_desktop_1080p", label:"桌面 1080p 壁纸", width:1920, height:1080, category:"壁纸" },
        { name:"wallpaper_desktop_4k", label:"桌面 4K 壁纸", width:3840, height:2160, category:"壁纸" },
        // 特殊
        { name:"golden_ratio_landscape", label:"黄金比例 横版", width:1618, height:1000, category:"特殊" },
        { name:"golden_ratio_portrait", label:"黄金比例 竖版", width:1000, height:1618, category:"特殊" },
    ],
    total: 39,
};

router.get('/size-library', async (req, res) => {
    let sizeData = null;
    let fromFallback = false;

    try {
        sizeData = await aiService.getSizeLibrary();
    } catch (err) {
        console.error('[WARN] Python 服务不可用，使用本地尺寸库:', err.message);
        sizeData = FALLBACK_SIZE_LIBRARY;
        fromFallback = true;
    }

    res.render('size-library', {
        title: '尺寸库 - PhotoGongju',
        sizeLibrary: sizeData,
        sizeCategories: [...new Set(sizeData.presets.map(p => p.category))],
        activeNav: 'size-library',
        bodyClass: 'page-size-library',
        fromFallback,
    });
});

// ============================================
// 教程资讯路由 — ★ SEO 内链矩阵
// 所有教程页自动包含向内跳转到对应工具页面的 CTA
// ============================================

// 教程中心主页
router.get('/tutorial', (req, res) => {
    res.render('tutorial', {
        title: '证件照制作教程中心 - PhotoGongju',
        activeNav: 'tutorial',
        bodyClass: 'page-tutorial',
    });
});

// 教程详情页 — 统一路由处理
router.get('/tutorial/:slug', (req, res) => {
    const { slug } = req.params;
    const tutorial = getTutorialContent(slug);

    if (!tutorial) {
        return res.redirect('/tutorial'); // 无此教程 → 跳转教程中心
    }

    res.render('tutorial-detail', {
        title: tutorial.title + ' - PhotoGongju',
        activeNav: 'tutorial',
        bodyClass: 'page-tutorial-detail',
        tutorialTitle: tutorial.title,
        tutorialDesc: tutorial.desc,
        tutorialKeywords: tutorial.keywords,
        tutorialContent: tutorial.content,
        canonical: '/tutorial/' + slug,
        updateDate: tutorial.updateDate,
        readTime: tutorial.readTime,
        viewCount: tutorial.viewCount,
        relatedTutorials: tutorial.related,
    });
});

/**
 * ★ 教程内容数据库
 * 每篇教程包含丰富的内链指向对应的工具页面
 * 百度爬虫会顺着这些内链发现更多页面，提升整站收录率
 */
function getTutorialContent(slug) {
    const tutorials = {
        'how-to-take-id-photo': {
            title: '在家自己拍证件照完整教程',
            desc: '不用去照相馆！用手机或相机在家就能拍出合格证件照的完整教程，含灯光布置、背景选择、姿势指导、后期处理全流程。',
            keywords: '在家拍证件照,证件照拍摄教程,手机拍证件照,一寸照片拍摄,二寸照片教程,证件照灯光,证件照背景',
            updateDate: '2024-06-20',
            readTime: '8',
            viewCount: '3,580',
            content: `
                <h2>一、准备工作</h2>
                <p>拍证件照前，你需要准备以下物品：一部手机（或相机）、一面白色墙壁、自然光源（或台灯）、深色有领上衣。建议选择白天拍摄，利用窗户边的自然光效果最好。</p>

                <h2>二、灯光布置技巧</h2>
                <p>证件照最关键的就是光线均匀。站姿面向窗户，让光线从正面照射到脸上，避免侧光造成的阴阳脸。如果有台灯，可以放在左右两侧45度角位置作为补光，消除下巴阴影。</p>
                <p>利用我们的 <a href="/upload"><strong>在线证件照制作工具</strong></a>，上传照片后可以自动调整亮度、对比度，弥补灯光不足的问题。</p>

                <h2>三、背景要求</h2>
                <p>证件照背景通常要求纯色：白色（护照/身份证）、蓝色（毕业证/简历）、红色（结婚证/医保）。在家拍摄时找一面白墙即可，后期使用 <a href="/tutorial/change-background"><strong>AI换底色功能</strong></a> 一键替换为任意颜色背景。</p>

                <h2>四、拍摄姿势规范</h2>
                <ul>
                    <li>正面免冠，双耳露出</li>
                    <li>双眼平视镜头，表情自然</li>
                    <li>肩膀放松，身体正对镜头</li>
                    <li>不戴首饰，不戴有色眼镜</li>
                </ul>

                <h2>五、后期处理</h2>
                <p>拍摄完成后，使用 PhotoGongju 的 <a href="/upload"><strong>证件照制作工具</strong></a> 进行裁剪、调整尺寸。在 <a href="/size-library"><strong>尺寸规格库</strong></a> 中选择对应的证件类型（一寸、二寸、护照等），系统会自动按标准尺寸裁剪。</p>
            `,
            related: [
                { url: '/tutorial/change-background', title: '证件照换底色教程' },
                { url: '/tutorial/photo-resize', title: '照片尺寸调整教程' },
                { url: '/tutorial/id-photo-print', title: '证件照打印排版教程' },
                { url: '/size-library', title: '证件照尺寸规格大全' },
            ],
        },
        'change-background': {
            title: '证件照换底色教程 — 红底蓝底白底一键切换',
            desc: '学会用在线工具给证件照换背景色，红底蓝底白底任意切换，无需Photoshop技能。',
            keywords: '证件照换底色,证件照换背景,红底证件照,蓝底证件照,白底证件照,照片换颜色,AI换背景',
            updateDate: '2024-06-18',
            readTime: '5',
            viewCount: '4,210',
            content: `
                <h2>为什么需要换底色</h2>
                <p>不同的证件类型要求不同的背景颜色。身份证需要白色背景，毕业证和简历通常用蓝色背景，结婚证和部分国家签证需要红色背景。学会换底色技巧，一张照片满足所有需求。</p>

                <h2>使用在线工具换底色</h2>
                <p>打开 <a href="/upload"><strong>PhotoGongju证件照制作工具</strong></a>，上传你的照片。系统内置AI智能抠图，会自动识别人像与背景。</p>

                <h2>选择目标背景色</h2>
                <p>在工具中你可以选择：</p>
                <ul>
                    <li><strong>白色背景 #FFFFFF</strong> — 身份证、护照、驾照常用</li>
                    <li><strong>蓝色背景 #438EDB</strong> — 毕业证、简历、部分签证</li>
                    <li><strong>红色背景 #FF0000</strong> — 结婚证、医保卡</li>
                    <li><strong>自定义颜色</strong> — 满足特殊需求</li>
                </ul>
                <p>如果需要更精细的抠图效果，可以试试 <a href="/tutorial/ai-background-removal"><strong>AI智能抠图功能</strong></a>。</p>
            `,
            related: [
                { url: '/tutorial/how-to-take-id-photo', title: '在家拍证件照完整教程' },
                { url: '/tutorial/ai-background-removal', title: 'AI智能抠图教程' },
                { url: '/tutorial/visa-photo-guide', title: '各国签证照片规格指南' },
                { url: '/upload', title: '在线证件照制作工具' },
            ],
        },
        'photo-resize': {
            title: '照片尺寸调整教程 — 一寸二寸大小精修',
            desc: '详细讲解一寸、二寸、小一寸等常见证件照尺寸规格和精确裁剪方法。',
            keywords: '照片尺寸,一寸照片尺寸,二寸照片尺寸,证件照裁剪,照片比例,一寸照是多少厘米,二寸照是多少像素',
            updateDate: '2024-06-15',
            readTime: '6',
            viewCount: '2,890',
            content: `
                <h2>常见证件照尺寸一览</h2>
                <p>不同证件类型对应的照片尺寸各不相同，搞懂这些规格是拍好证件照的基础：</p>
                <ul>
                    <li><strong>一寸照片</strong>：25mm × 35mm，约 295×413 像素 @300dpi</li>
                    <li><strong>二寸照片</strong>：35mm × 49mm，约 413×579 像素 @300dpi</li>
                    <li><strong>小一寸</strong>：22mm × 32mm，常用于驾照</li>
                    <li><strong>大一寸</strong>：33mm × 48mm，常用于护照</li>
                </ul>
                <p>访问 <a href="/size-library"><strong>证件照尺寸规格大全</strong></a> 查看50+种常用尺寸预设，选择对应类型即可自动裁剪。</p>

                <h2>如何精确裁剪</h2>
                <p>在 <a href="/upload"><strong>证件照制作工具</strong></a> 中上传照片，选择目标尺寸后，系统自动等比缩放并居中裁剪，确保头部占比符合规范。</p>
            `,
            related: [
                { url: '/size-library', title: '证件照尺寸规格大全' },
                { url: '/tutorial/how-to-take-id-photo', title: '在家拍证件照完整教程' },
                { url: '/tutorial/id-photo-print', title: '证件照打印排版教程' },
            ],
        },
        'visa-photo-guide': {
            title: '各国签证照片规格指南',
            desc: '汇总美国、日本、申根、英国等热门国家签证照片要求，尺寸、底色、着装规范一网打尽。',
            keywords: '签证照片,美国签证照片,日本签证照片,申根签证照片,护照照片尺寸,各国签证照片尺寸,签证照要求',
            updateDate: '2024-06-10',
            readTime: '7',
            viewCount: '5,120',
            content: `
                <h2>热门国家签证照片要求</h2>
                <ul>
                    <li><strong>美国签证</strong>：51mm × 51mm，白色背景，6个月内近照</li>
                    <li><strong>日本签证</strong>：45mm × 45mm，白色背景，6个月内</li>
                    <li><strong>申根签证</strong>：35mm × 45mm，浅色背景</li>
                    <li><strong>英国签证</strong>：35mm × 45mm，浅灰或奶油色背景</li>
                    <li><strong>加拿大签证</strong>：35mm × 45mm，白色背景</li>
                </ul>
                <p>使用 <a href="/upload"><strong>证件照制作工具</strong></a> 选择对应的国家尺寸预设即可自动裁剪。更多规格请查看 <a href="/size-library"><strong>尺寸库</strong></a>。</p>
            `,
            related: [
                { url: '/size-library', title: '证件照尺寸规格大全' },
                { url: '/tutorial/change-background', title: '证件照换底色教程' },
                { url: '/tutorial/photo-resize', title: '照片尺寸调整教程' },
            ],
        },
        'id-photo-print': {
            title: '证件照打印排版教程 — 一张相纸排版多张',
            desc: '学会用排版工具在一张相纸上排版多张证件照，省钱又方便。',
            keywords: '证件照打印,证件照排版,相纸排版,一寸照打印,省钱打印证件照',
            updateDate: '2024-06-08',
            readTime: '5',
            viewCount: '1,950',
            content: `<p>使用 <a href="/upload"><strong>证件照制作工具</strong></a> 处理后，可直接下载排版好的照片文件，一张4×6英寸相纸可排8张一寸照或4张二寸照。具体尺寸参阅 <a href="/size-library"><strong>尺寸库</strong></a>。</p>`,
            related: [
                { url: '/tutorial/photo-resize', title: '照片尺寸调整教程' },
                { url: '/upload', title: '在线证件照制作工具' },
            ],
        },
        'ai-background-removal': {
            title: 'AI智能抠图去背景教程',
            desc: '零门槛掌握AI抠图工具，一键去除照片背景，轻松制作透明底证件照。',
            keywords: 'AI抠图,智能抠图,去背景,透明底,人像抠图,一键抠图,在线抠图',
            updateDate: '2024-06-05',
            readTime: '4',
            viewCount: '6,340',
            content: `<p>PhotoGongju内置深度学习抠图模型。在 <a href="/upload"><strong>证件照制作工具</strong></a> 中上传照片后，选择「AI背景去除」即可自动分离人像与背景。如需更换背景色，参见 <a href="/tutorial/change-background"><strong>换底色教程</strong></a>。VIP会员可无限次使用高清AI抠图，<a href="/membership"><strong>开通会员</strong></a>了解更多。</p>`,
            related: [
                { url: '/tutorial/change-background', title: '证件照换底色教程' },
                { url: '/tutorial/how-to-take-id-photo', title: '在家拍证件照完整教程' },
                { url: '/membership', title: '升级VIP会员解锁AI功能' },
            ],
        },
        'watermark-guide': {
            title: '给照片添加水印保护版权',
            desc: '学会用在线水印工具为照片添加文字或Logo水印，保护原创作品不被盗用。',
            keywords: '照片水印,添加水印,文字水印,Logo水印,版权保护,图片防盗',
            updateDate: '2024-06-01',
            readTime: '4',
            viewCount: '1,560',
            content: `<p>在 <a href="/upload"><strong>证件照制作工具</strong></a> 中上传照片后，选择「水印」功能，支持文字水印和平铺水印。如需添加Logo水印，请 <a href="/membership"><strong>升级VIP会员</strong></a>。</p>`,
            related: [
                { url: '/upload', title: '在线证件照制作工具' },
                { url: '/membership', title: '升级VIP会员' },
            ],
        },
    };

    return tutorials[slug] || null;
}

// ============================================
// 关于页面
// ============================================

router.get('/about', (req, res) => {
    res.render('index', {
        title: '关于 - PhotoGongju',
        subtitle: '关于 PhotoGongju 图片处理工具箱',
        activeNav: 'about',
        aiStatus: 'offline',
        bodyClass: 'page-about',
    });
});

module.exports = router;
