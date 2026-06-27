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
const yeepay = require('../services/yeepay');

// 初始化演示账号
userModel.initDemoUsers();

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
        payConfig: { gateway: yeepay.YEEPAY_CONFIG.gateway },
        yeepayConfigured: yeepay.isConfigured(),
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

router.post('/api/payment/create-order', express.json(), async (req, res) => {
    try {
        const { planId, channel } = req.body;
        const plan = membership.getPlanById(planId);
        if (!plan) return res.status(400).json({ error: '无效的套餐' });

        const orderId = membership.generateOrderId();
        const userId = req.userId || 'guest';

        // 存储订单信息
        orderStore.set(orderId, {
            orderId, userId, planId, price: plan.price,
            status: 'pending', channel: channel || 'WECHAT',
            createdAt: Date.now(),
            expiresAt: Date.now() + 30 * 60 * 1000,
        });

        // 开发模式：使用模拟支付
        const mockPayUrl = `/api/payment/callback?orderId=${orderId}&amount=${plan.price.toFixed(2)}&orderStatus=SUCCESS&sign=dev_mock`;

        // 生产模式：调用易宝支付创建二维码
        if (yeepay.isConfigured()) {
            try {
                const result = await yeepay.createPayment({
                    orderId,
                    amount: plan.price,
                    subject: `PhotoGongju ${plan.name}`,
                    payWay: channel || 'WECHAT',
                });
                return res.json({
                    success: true, orderId, plan: plan.name, price: plan.price,
                    codeUrl: result.codeUrl || result.prePayTn,
                    qrUrl: result.codeUrl || result.prePayTn,
                    channel: channel || 'WECHAT',
                    mockPayUrl,
                });
            } catch (yeepayErr) {
                console.error('[YeePay] Create order failed, fallback to mock:', yeepayErr.message);
            }
        }

        // 开发模式 / 易宝未配置：返回模拟支付
        res.json({
            success: true, orderId, plan: plan.name, price: plan.price,
            codeUrl: mockPayUrl,
            qrUrl: null,
            channel: channel || 'WECHAT',
            mockPayUrl,
        });
    } catch (err) {
        console.error('[ERROR] 创建订单失败:', err.message);
        res.status(500).json({ error: '创建订单失败' });
    }
});

router.all('/api/payment/callback', (req, res) => {
    console.log('[INFO] 支付回调收到:', req.method, JSON.stringify(req.query || req.body));

    try {
        // 开发模式：模拟支付
        if (req.query.sign === 'dev_mock' || (req.body && req.body.sign === 'dev_mock')) {
            const p = req.method === 'POST' ? req.body : req.query;
            const { orderId, amount, orderStatus } = p;
            return processPaymentCallback(orderId, parseFloat(amount), orderStatus, res);
        }

        // 生产模式：易宝支付回调
        const rawBody = req.rawBody || JSON.stringify(req.body);
        const signature = req.headers['x-yop-sign'];

        // 验签
        if (!yeepay.verifyCallback(rawBody, signature)) {
            console.error('[YeePay] Callback signature verification failed');
            return res.status(400).send('sign error');
        }

        // 解析回调参数
        const params = req.method === 'POST' ? req.body : req.query;
        const { orderId, orderAmount, orderStatus } = params;

        if (!orderId) return res.status(400).send('missing orderId');

        return processPaymentCallback(orderId, parseFloat(orderAmount || '0'), orderStatus, res);
    } catch (err) {
        console.error('[ERROR] 支付回调处理异常:', err.message);
        res.status(500).send('error');
    }
});

function processPaymentCallback(orderId, amount, status, res) {
    const order = orderStore.get(orderId);
    if (!order) {
        console.error('[ERROR] 订单不存在:', orderId);
        return res.status(404).send('order not found');
    }
    if (status !== 'SUCCESS') return res.send('waiting');
    if (order.status === 'paid') return res.send('success');

    const memberInfo = membership.activateMembership(order.userId, order.planId, orderId);
    order.status = 'paid';
    order.paidAt = Date.now();
    order.tier = memberInfo.tier;
    order.expiredAt = memberInfo.expiredAt;
    orderStore.set(orderId, order);

    console.log(`[SUCCESS] 会员激活: userId=${order.userId}, tier=${memberInfo.tier}`);
    res.send('success');
}

router.get('/api/payment/check/:orderId', async (req, res) => {
    const { orderId } = req.params;
    const order = orderStore.get(orderId);
    if (!order) return res.status(404).json({ error: '订单不存在' });

    // 生产模式 + 订单未支付：查询易宝确认状态
    if (yeepay.isConfigured() && order.status === 'pending') {
        try {
            const result = await yeepay.queryOrder(orderId);
            if (result.orderStatus === 'SUCCESS') {
                const memberInfo = membership.activateMembership(order.userId, order.planId, orderId);
                order.status = 'paid';
                order.paidAt = Date.now();
                order.tier = memberInfo.tier;
                order.expiredAt = memberInfo.expiredAt;
                orderStore.set(orderId, order);
            }
            return res.json({ orderId, status: order.status, ...result });
        } catch (e) {
            // 查询失败不影响已有状态
        }
    }

    res.json({ orderId, status: order.status, planId: order.planId, price: order.price, paidAt: order.paidAt || null });
});

router.get('/api/membership/status', (req, res) => {
    const member = membership.getMembership(req.userId);
    const trial = membership.getTrialStatus(req.userId);
    res.json({
        success: true, tier: member.tier,
        tierLabel: membership.getTierLabel(member.tier),
        isVip: membership.isVip(req.userId),
        planId: member.planId || '', paidAt: member.paidAt || 0,
        expiredAt: member.expiredAt || 0,
        expireDesc: membership.getExpireDesc(req.userId),
        remainingMs: Math.max(0, (member.expiredAt || 0) - Date.now()),
        dailyTrial: {
            limit: trial.limit,
            used: trial.used,
            remaining: trial.remaining,
        },
    });
});

/**
 * 消耗一次试用额度（供各 api 调用前检查）
 * POST /api/trial/use
 */
router.post('/api/trial/use', express.json(), (req, res) => {
    const result = membership.recordTrial(req.userId);
    if (!result.allowed) {
        return res.status(403).json({
            error: '今日免费试用次数已用完',
            code: 'TRIAL_EXHAUSTED',
            ...result,
            redirect: '/membership',
        });
    }
    res.json({ success: true, ...result });
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
