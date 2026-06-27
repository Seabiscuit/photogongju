/**
 * 会员 & 用户路由
 *
 * 页面:
 *   GET  /membership       — 套餐对比/充值页面
 *   GET  /login            — 登录页面
 *   POST /login            — 登录处理
 *   GET  /logout           — 退出登录
 *   POST /register         — 注册处理
 *
 * API:
 *   POST /api/payment/create-order   — 创建支付订单
 *   GET  /api/payment/callback       — 支付异步回调 (易支付/个人免签)
 *   POST /api/payment/callback       — 支付异步回调 (POST 方式)
 *   GET  /api/payment/check/:orderId — 查询支付状态
 *   GET  /api/membership/status      — 获取当前会员状态
 *   GET  /api/membership/restrictions — 获取功能限制列表
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const membership = require('../models/membership');
const userModel = require('../models/user');
const captcha = require('../services/captcha');

// 初始化演示账号
userModel.initDemoUsers();

// ============================================
// 支付配置（对接个人免签 / 易支付）
// ============================================

const PAY_CONFIG = {
    pid: process.env.PAY_PID || '1001',
    key: process.env.PAY_KEY || 'YourPayKeyHere',
    gateway: process.env.PAY_GATEWAY || 'https://pay.example.com/submit.php',
    notifyUrl: process.env.PAY_NOTIFY_URL || 'http://localhost:3000/api/payment/callback',
    returnUrl: process.env.PAY_RETURN_URL || 'http://localhost:3000/membership',
};

const orderStore = new Map();

// ============================================
// ── 页面路由 ──
// ============================================

/**
 * 会员套餐充值页
 */
router.get('/membership', (req, res) => {
    const plans = membership.getPlans();
    const member = membership.getMembership(req.userId);
    const restrictions = membership.getRestrictions(req.userId);

    res.render('membership', {
        title: '开通会员 - PhotoGongju',
        activeNav: 'membership',
        bodyClass: 'page-membership',
        plans,
        currentTier: member.tier,
        isVip: membership.isVip(req.userId),
        expireDesc: membership.getExpireDesc(req.userId),
        restrictions,
        payConfig: { gateway: PAY_CONFIG.gateway },
    });
});

/**
 * 图形验证码
 * GET /api/captcha  — 返回 SVG 验证码图片
 */
router.get('/api/captcha', (req, res) => {
    const { key, svg } = captcha.generate();

    // 将 key 写入 session 供登录验证使用
    req.session.captchaKey = key;

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(svg);
});

/**
 * 登录页面
 */
router.get('/login', (req, res) => {
    if (req.session && req.session.user) {
        return res.redirect('/');
    }

    res.render('login', {
        title: '登录 - PhotoGongju',
        activeNav: '',
        bodyClass: 'page-login',
        redirect: req.query.redirect || '/',
        error: req.query.error || null,
        success: req.query.success || null,
    });
});

/**
 * 登录处理 — 邮箱 + 密码
 */
router.post('/login', express.urlencoded({ extended: true }), (req, res) => {
    const { email, password, redirect } = req.body;
    const target = redirect || '/';

    // 校验
    if (!email || !password) {
        return res.redirect('/login?error=' + encodeURIComponent('请输入邮箱和密码'));
    }

    // 验证图形验证码
    const captchaInput = req.body.captcha || '';
    const captchaKey = req.session.captchaKey;
    if (!captcha.verify(captchaKey, captchaInput)) {
        return res.redirect('/login?error=' + encodeURIComponent('验证码错误，请重试'));
    }

    const user = userModel.authenticateUser(email, password);

    if (!user) {
        return res.redirect('/login?error=' + encodeURIComponent('邮箱或密码错误'));
    }

    // 登录成功，写入 session
    req.session.user = {
        id: user.email,
        email: user.email,
        name: user.name,
        role: user.tier || 'free',
    };

    // 同步会员缓存
    if (user.tier && user.tier !== 'free') {
        try {
            membership.activateMembership(user.email, 'yearly', 'INIT_' + Date.now());
        } catch (e) { /* ignore */ }
    }

    res.redirect(target);
});

/**
 * 注册处理 — 邮箱 + 密码 + 确认密码
 */
router.post('/register', express.urlencoded({ extended: true }), (req, res) => {
    const { email, password, password2 } = req.body;

    // 校验
    if (!email || !password) {
        return res.redirect('/login?error=' + encodeURIComponent('请填写邮箱和密码'));
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.redirect('/login?error=' + encodeURIComponent('请输入有效的邮箱地址'));
    }
    if (password.length < 6) {
        return res.redirect('/login?error=' + encodeURIComponent('密码至少6个字符'));
    }
    if (password !== password2) {
        return res.redirect('/login?error=' + encodeURIComponent('两次密码不一致'));
    }

    // 检查是否已注册
    if (userModel.isEmailRegistered(email)) {
        return res.redirect('/login?error=' + encodeURIComponent('该邮箱已被注册，请直接登录'));
    }

    try {
        const user = userModel.createUser(email, password);

        // 注册成功，自动登录
        req.session.user = {
            id: user.email,
            email: user.email,
            name: user.name,
            role: user.tier,
        };

        res.redirect('/login?success=' + encodeURIComponent('注册成功，欢迎！'));
    } catch (err) {
        return res.redirect('/login?error=' + encodeURIComponent(err.message));
    }
});

/**
 * 退出登录
 */
router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// ============================================
// ── 支付 API ──
// ============================================

router.post('/api/payment/create-order', express.json(), (req, res) => {
    try {
        const { planId } = req.body;
        const plan = membership.getPlanById(planId);
        if (!plan) return res.status(400).json({ error: '无效的套餐' });

        const orderId = membership.generateOrderId();
        const userId = req.userId || 'guest';

        orderStore.set(orderId, {
            orderId, userId, planId, price: plan.price,
            status: 'pending',
            createdAt: Date.now(),
            expiresAt: Date.now() + 30 * 60 * 1000,
        });

        const payParams = {
            pid: PAY_CONFIG.pid,
            type: 'alipay',
            out_trade_no: orderId,
            notify_url: PAY_CONFIG.notifyUrl,
            return_url: PAY_CONFIG.returnUrl,
            name: `PhotoGongju ${plan.name}`,
            money: plan.price.toFixed(2),
            sitename: 'PhotoGongju',
        };

        const signStr = Object.keys(payParams)
            .sort()
            .map(k => `${k}=${payParams[k]}`)
            .join('&') + PAY_CONFIG.key;
        payParams.sign = crypto.createHash('md5').update(signStr).digest('hex');
        payParams.sign_type = 'MD5';

        const queryStr = Object.entries(payParams)
            .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
            .join('&');
        const payUrl = `${PAY_CONFIG.gateway}?${queryStr}`;
        const mockPayUrl = `/api/payment/callback?out_trade_no=${orderId}&money=${plan.price.toFixed(2)}&trade_status=TRADE_SUCCESS&sign=dev_mock`;

        res.json({
            success: true, orderId, plan: plan.name, price: plan.price,
            payUrl, mockPayUrl, qrCode: payUrl,
        });
    } catch (err) {
        console.error('[ERROR] 创建订单失败:', err.message);
        res.status(500).json({ error: '创建订单失败' });
    }
});

router.all('/api/payment/callback', (req, res) => {
    const params = req.method === 'POST' ? req.body : req.query;
    console.log('[INFO] 支付回调收到:', JSON.stringify(params));

    try {
        const { out_trade_no, money, trade_status, sign, sign_type } = params;

        if (process.env.NODE_ENV !== 'development' || sign !== 'dev_mock') {
            const verifyParams = { ...params };
            delete verifyParams.sign;
            delete verifyParams.sign_type;
            const signStr = Object.keys(verifyParams)
                .sort()
                .filter(k => verifyParams[k] !== '' && verifyParams[k] !== undefined)
                .map(k => `${k}=${verifyParams[k]}`)
                .join('&') + PAY_CONFIG.key;
            const expectedSign = crypto.createHash('md5').update(signStr).digest('hex');
            if (sign !== expectedSign) {
                console.error('[ERROR] 支付回调签名验证失败');
                return res.status(400).send('sign error');
            }
        }

        const order = orderStore.get(out_trade_no);
        if (!order) return res.status(404).send('order not found');
        if (order.price !== parseFloat(money)) return res.status(400).send('money mismatch');
        if (trade_status !== 'TRADE_SUCCESS') return res.send('waiting');
        if (order.status === 'paid') return res.send('success');

        const memberInfo = membership.activateMembership(order.userId, order.planId, out_trade_no);
        order.status = 'paid';
        order.paidAt = Date.now();
        order.tier = memberInfo.tier;
        order.expiredAt = memberInfo.expiredAt;
        orderStore.set(out_trade_no, order);

        // 同步更新用户模型的 tier
        const sessionUser = req.session?.user;
        if (sessionUser?.email) {
            try { userModel.updateUserTier(sessionUser.email, memberInfo.tier); } catch (e) {}
        }

        console.log(`[SUCCESS] 会员激活成功: userId=${order.userId}, tier=${memberInfo.tier}`);
        res.send('success');
    } catch (err) {
        console.error('[ERROR] 支付回调处理异常:', err.message);
        res.status(500).send('error');
    }
});

router.get('/api/payment/check/:orderId', (req, res) => {
    const { orderId } = req.params;
    const order = orderStore.get(orderId);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    res.json({ orderId: order.orderId, status: order.status, planId: order.planId, price: order.price, paidAt: order.paidAt || null });
});

router.get('/api/membership/status', (req, res) => {
    const member = membership.getMembership(req.userId);
    res.json({
        success: true, tier: member.tier,
        tierLabel: membership.getTierLabel(member.tier),
        isVip: membership.isVip(req.userId),
        planId: member.planId || '', paidAt: member.paidAt || 0,
        expiredAt: member.expiredAt || 0,
        expireDesc: membership.getExpireDesc(req.userId),
        remainingMs: Math.max(0, (member.expiredAt || 0) - Date.now()),
    });
});

router.get('/api/membership/restrictions', (req, res) => {
    const restrictions = membership.getRestrictions(req.userId);
    res.json({
        success: true, tier: membership.getMembership(req.userId).tier,
        isVip: membership.isVip(req.userId), restrictions,
        total: restrictions.length,
    });
});

module.exports = router;
module.exports.orderStore = orderStore;
module.exports.PAY_CONFIG = PAY_CONFIG;
