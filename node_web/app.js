/**
 * PhotoGongju — Node.js 主站入口
 * Express 应用主文件
 *
 * 启动方式：
 *   # 直接启动
 *   npm start
 *
 *   # 开发模式（热重载）
 *   npm run dev
 *
 *   # 使用国内镜像源安装依赖：
 *   npm install --registry=https://registry.npmmirror.com
 */

const express = require('express');
const path = require('path');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const multer = require('multer');

// ── 引入鉴权中间件 ──
const { userIdentity } = require('./middleware/auth');

// ── 引入国际化翻译 ──
const { t } = require('./i18n');

// 引入路由模块
const indexRoutes = require('./routes/index');
const apiRoutes = require('./routes/api');
const membershipRoutes = require('./routes/membership'); // ★ 会员&支付路由

// ============================================
// 创建 Express 应用
// ============================================
const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// Multer 上传配置（内存存储，转发给 AI 服务）
// ============================================
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB 文件大小上限
        files: 5,                     // 单次最多 5 个文件
    },
    fileFilter: (req, file, cb) => {
        // 只允许图片格式
        const allowedMimes = [
            'image/jpeg', 'image/png', 'image/webp',
            'image/bmp', 'image/tiff', 'image/gif',
        ];
        const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.gif', '.svg'];

        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`不支持的文件类型: ${file.mimetype}。请上传图片文件`));
        }
    },
});

// 将 upload 中间件挂载到 app 上供路由使用
app.set('upload', upload);

// ============================================
// 中间件配置
// ============================================

// 视图引擎
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// 日志
app.use(morgan('dev'));

// 静态文件
app.use(express.static(path.join(__dirname, 'public')));

// 请求体解析
app.use(express.json({
    limit: '10mb',
    verify: (req, res, buf) => { req.rawBody = buf.toString(); },  // 保留原始 body 供验签
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie 与 Session
app.use(cookieParser());
app.use(session({
    secret: 'photogongju_session_secret_2024',
    resave: false,
    saveUninitialized: true,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000, // 24 小时
        httpOnly: true,
    },
}));

// ── ★ 用户身份识别中间件（必须在 session 之后、路由之前） ──
app.use(userIdentity);

// ── ★ 国际化语言中间件 ──
app.use((req, res, next) => {
    // 优先级: 1. Cookie  2. Query ?lang=  3. 默认英文
    let lang = 'en';
    if (req.cookies && req.cookies.lang && ['en', 'zh'].includes(req.cookies.lang)) {
        lang = req.cookies.lang;
    } else if (req.query.lang && ['en', 'zh'].includes(req.query.lang)) {
        lang = req.query.lang;
    }

    req.lang = lang;
    res.locals.lang = lang;
    res.locals.t = (key) => t(key, lang);
    res.locals.isEn = lang === 'en';
    res.locals.isZh = lang === 'zh';
    next();
});

// 全局限流（防止滥用）
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 分钟窗口
    max: 500,                   // 最多 500 次请求
    message: { error: '请求过于频繁，请稍后再试' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', globalLimiter);

// 上传接口更严格的限流
const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30, // 15 分钟内最多 30 次上传
    message: { error: '上传次数已达上限，请稍后再试' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/upload', uploadLimiter);

// 将配置注入 res.locals，供模板使用
app.locals.appName = 'PhotoGongju';
app.locals.aiServiceUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8001';

// ============================================
// 挂载路由
// ★ 会员&支付路由优先挂载（包含页面路由和 API 路由）
// ============================================

app.use('/', membershipRoutes);     // ★ /membership, /login, /logout, /register, /api/payment/*, /api/membership/*
app.use('/', indexRoutes);
app.use('/api', apiRoutes);

// ★ Sitemap 自动生成路由（搜索引擎请求时动态生成）
app.get(['/sitemap.xml', '/sitemap-index.xml', '/sitemap-mobile.xml'], (req, res) => {
    const sitemapFile = req.path.replace('/', '');
    const filePath = path.join(__dirname, 'public', sitemapFile);
    // 如果生成文件存在则返回，否则 404
    if (require('fs').existsSync(filePath)) {
        res.setHeader('Content-Type', 'application/xml');
        res.sendFile(filePath);
    } else {
        res.status(404).send('Sitemap not generated yet. Run: node scripts/generate-sitemap.js');
    }
});

// ============================================
// ★ 404 友好页面（SEO优化：含内链引导）
// ============================================

app.use((req, res) => {
    res.status(404).render('404', {
        title: '404 页面未找到 - PhotoGongju',
        bodyClass: 'page-404',
    });
});

// ============================================
// 全局错误处理
// ============================================

app.use((err, req, res, next) => {
    console.error('[ERROR]', err.stack || err.message);

    // Multer 文件大小超限
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: '文件大小超过限制（最大 50MB）' });
    }

    // Multer 文件类型错误
    if (err.message && err.message.includes('不支持的文件类型')) {
        return res.status(400).json({ error: err.message });
    }

    res.status(err.status || 500).json({
        error: process.env.NODE_ENV === 'production'
            ? '服务器内部错误'
            : err.message,
    });
});

// ============================================
// 启动服务
// ============================================

app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log(`🖼️  PhotoGongju 主站已启动`);
    console.log(`   访问地址: http://localhost:${PORT}`);
    console.log(`   AI 服务: ${app.locals.aiServiceUrl}`);
    console.log(`   环境: ${process.env.NODE_ENV || 'development'}`);
    console.log('='.repeat(60));
});

module.exports = app;
