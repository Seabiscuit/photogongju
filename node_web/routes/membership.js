/**
 * 会员 & 支付路由
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

// ============================================
// 支付配置（对接个人免签 / 易支付）
// 替换为实际商户信息
// ============================================

const PAY_CONFIG = {
    // 易支付商户ID
    pid: process.env.PAY_PID || '1001',
    // 易支付密钥
    key: process.env.PAY_KEY || 'YourPayKeyHere',
    // 支付网关地址
    gateway: process.env.PAY_GATEWAY || 'https://pay.example.com/submit.php',
    // 回调地址
    notifyUrl: process.env.PAY_NOTIFY_URL || 'http://localhost:3000/api/payment/callback',
    // 前台跳转地址
    returnUrl: process.env.PAY_RETURN_URL || 'http://localhost:3000/membership',
};

// 订单临时存储（生产环境应使用数据库）
const orderStore = new Map();

// ═══════════════════════════════════════════════════
// 短信验证码存储（生产环境应接入阿里云/腾讯云短信）
// ═══════════════════════════════════════════════════
const smsCodeStore = new Map();  // phone -> { code, expiresAt, attempt }

const SMS_CONFIG = {
    codeLength: 6,
    expireSeconds: 300,      // 5 分钟有效
    resendSeconds: 60,       // 60 秒后可重发
    maxAttempts: 5,          // 每手机号每天最多 5 次
    devMode: process.env.NODE_ENV !== 'production',
};

// 演示用户数据（含手机号映射）
const demoUsers = {
    'admin': { password: 'admin123', tier: 'admin', name: '管理员', phone: '13800000001' },
    'vip': { password: 'vip123', tier: 'yearly', name: 'VIP会员', phone: '13800000002' },
    'test': { password: 'test123', tier: 'free', name: '测试用户', phone: '13800000003' },
};
const phoneUserMap = {};
for (const [uid, u] of Object.entries(demoUsers)) {
    if (u.phone) phoneUserMap[u.phone] = { ...u, id: uid };
}

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
        payConfig: {
            gateway: PAY_CONFIG.gateway,
        },
    });
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
        smsExpire: SMS_CONFIG.expireSeconds,
        smsResend: SMS_CONFIG.resendSeconds,
    });
});

/**
 * 发送短信验证码
 * POST /api/send-sms
 * Body: { phone }
 */
router.post('/api/send-sms', express.json(), (req, res) => {
    const { phone } = req.body;

    // 校验手机号格式
    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
        return res.status(400).json({ error: '请输入有效的手机号码' });
    }

    // 限频检查：60 秒内不可重复发送
    const existing = smsCodeStore.get(phone);
    if (existing && Date.now() - existing.sentAt < SMS_CONFIG.resendSeconds * 1000) {
        const remain = Math.ceil((SMS_CONFIG.resendSeconds * 1000 - (Date.now() - existing.sentAt)) / 1000);
        return res.status(429).json({ error: `请 ${remain} 秒后再试`, retryAfter: remain });
    }

    // 每日发送次数限制
    const todayKey = `${phone}_${new Date().toDateString()}`;
    const todayCount = Array.from(smsCodeStore.keys()).filter(k => k.startsWith(todayKey)).length;
    if (todayCount >= SMS_CONFIG.maxAttempts) {
        return res.status(429).json({ error: '今日发送次数已达上限，请明天再试' });
    }

    // 生成 6 位验证码
    const code = SMS_CONFIG.devMode
        ? '123456'  // 开发模式固定验证码，方便测试
        : String(Math.floor(100000 + Math.random() * 900000));

    // 存储验证码
    smsCodeStore.set(phone, {
        code,
        sentAt: Date.now(),
        expiresAt: Date.now() + SMS_CONFIG.expireSeconds * 1000,
        attempts: 0,
    });

    // 开发模式：打印验证码到控制台
    if (SMS_CONFIG.devMode) {
        console.log(`\n  [SMS DEV] 手机号: ${phone}  验证码: ${code}\n`);
    } else {
        // ★ 生产环境：调用阿里云/腾讯云短信 API
        // await sendSms(phone, code);
        console.log(`[SMS] 验证码已发送至 ${phone}`);
    }

    res.json({
        success: true,
        message: '验证码已发送',
        expireSeconds: SMS_CONFIG.expireSeconds,
    });
});

/**
 * 登录处理（支持手机号+验证码 和 用户名+密码）
 */
router.post('/login', express.urlencoded({ extended: true }), (req, res) => {
    const { phone, code, username, password, redirect } = req.body;

    const target = redirect || '/';

    // ── 方式1: 手机号 + 验证码登录 ──
    if (phone && code) {
        // 校验手机号格式
        if (!/^1[3-9]\d{9}$/.test(phone)) {
            return res.redirect('/login?error=' + encodeURIComponent('请输入有效的手机号码'));
        }

        // 验证验证码
        const smsRecord = smsCodeStore.get(phone);
        if (!smsRecord) {
            return res.redirect('/login?error=' + encodeURIComponent('请先获取验证码'));
        }

        if (Date.now() > smsRecord.expiresAt) {
            smsCodeStore.delete(phone);
            return res.redirect('/login?error=' + encodeURIComponent('验证码已过期，请重新获取'));
        }

        smsRecord.attempts++;
        if (smsRecord.attempts > 5) {
            smsCodeStore.delete(phone);
            return res.redirect('/login?error=' + encodeURIComponent('验证码错误次数过多，请重新获取'));
        }

        if (smsRecord.code !== code) {
            return res.redirect('/login?error=' + encodeURIComponent('验证码错误'));
        }

        // 验证成功，清除验证码
        smsCodeStore.delete(phone);

        // 查找已注册用户，或自动创建新用户
        const registered = phoneUserMap[phone];
        const userInfo = registered || {
            id: `phone_${phone}`,
            name: `用户${phone.slice(-4)}`,
            tier: 'free',
        };

        req.session.user = {
            id: userInfo.id,
            username: userInfo.id,
            phone: phone,
            name: userInfo.name,
            role: userInfo.tier || 'free',
        };

        // 如果是 VIP 用户，同步会员缓存
        if (userInfo.tier && userInfo.tier !== 'free') {
            try {
                membership.activateMembership(userInfo.id, 'yearly', 'PHONE_' + Date.now());
            } catch (e) {}
        }

        return res.redirect(target);
    }

    // ── 方式2: 用户名 + 密码登录（兼容旧版） ──
    if (!username || !password) {
        return res.redirect('/login?error=' + encodeURIComponent('请输入手机号和验证码'));
    }

    const user = demoUsers[username.toLowerCase()];
    if (!user || user.password !== password) {
        return res.redirect('/login?error=' + encodeURIComponent('用户名或密码错误'));
    }

    req.session.user = {
        id: username.toLowerCase(),
        username: username.toLowerCase(),
        name: user.name,
        role: user.tier,
    };

    if (user.tier !== 'free') {
        try {
            membership.activateMembership(username.toLowerCase(), 'yearly', 'DEMO_' + Date.now());
        } catch (e) {}
    }

    res.redirect(target);
});

/**
 * 注册处理
 */
router.post('/register', express.urlencoded({ extended: true }), (req, res) => {
    const { username, password, password2 } = req.body;

    if (!username || !password) {
        return res.redirect('/login?error=' + encodeURIComponent('请填写用户名和密码'));
    }
    if (password !== password2) {
        return res.redirect('/login?error=' + encodeURIComponent('两次密码不一致'));
    }
    if (username.length < 3) {
        return res.redirect('/login?error=' + encodeURIComponent('用户名至少3个字符'));
    }

    // 生产环境应存储到数据库
    req.session.user = {
        id: username.toLowerCase(),
        username: username.toLowerCase(),
        name: username,
        role: 'free',
    };

    res.redirect('/');
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

/**
 * 创建支付订单
 * POST /api/payment/create-order
 * Body: { planId: 'single'|'monthly'|'yearly' }
 */
router.post('/api/payment/create-order', express.json(), (req, res) => {
    try {
        const { planId } = req.body;
        const plan = membership.getPlanById(planId);

        if (!plan) {
            return res.status(400).json({ error: '无效的套餐' });
        }

        const orderId = membership.generateOrderId();
        const userId = req.userId || 'guest';

        // 存储订单
        orderStore.set(orderId, {
            orderId,
            userId,
            planId,
            price: plan.price,
            status: 'pending',
            createdAt: Date.now(),
            expiresAt: Date.now() + 30 * 60 * 1000, // 30分钟过期
        });

        // ── 生成易支付支付链接 ──
        // 个人免签/易支付对接参数
        const payParams = {
            pid: PAY_CONFIG.pid,
            type: 'alipay',           // 支付方式: alipay / wxpay
            out_trade_no: orderId,
            notify_url: PAY_CONFIG.notifyUrl,
            return_url: PAY_CONFIG.returnUrl,
            name: `PhotoGongju ${plan.name}`,
            money: plan.price.toFixed(2),
            sitename: 'PhotoGongju',
        };

        // 生成签名（易支付风格）
        const signStr = Object.keys(payParams)
            .sort()
            .map(k => `${k}=${payParams[k]}`)
            .join('&') + PAY_CONFIG.key;
        payParams.sign = crypto.createHash('md5').update(signStr).digest('hex');
        payParams.sign_type = 'MD5';

        // 构建支付 URL
        const queryStr = Object.entries(payParams)
            .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
            .join('&');
        const payUrl = `${PAY_CONFIG.gateway}?${queryStr}`;

        // ── 同时生成模拟支付链接（用于开发测试） ──
        const mockPayUrl = `/api/payment/callback?out_trade_no=${orderId}&money=${plan.price.toFixed(2)}&trade_status=TRADE_SUCCESS&sign=dev_mock`;

        res.json({
            success: true,
            orderId,
            plan: plan.name,
            price: plan.price,
            payUrl,
            mockPayUrl, // 开发环境模拟支付
            qrCode: payUrl, // 可替换为实际的二维码生成链接
        });
    } catch (err) {
        console.error('[ERROR] 创建订单失败:', err.message);
        res.status(500).json({ error: '创建订单失败' });
    }
});

/**
 * 支付异步回调 (GET + POST 兼容)
 * 易支付 / 个人免签 在用户支付成功后回调此接口
 *
 * 回调参数:
 *   out_trade_no  — 订单号
 *   money         — 支付金额
 *   trade_status  — TRADE_SUCCESS
 *   sign          — MD5 签名
 */
router.all('/api/payment/callback', (req, res) => {
    const params = req.method === 'POST' ? req.body : req.query;

    console.log('[INFO] 支付回调收到:', JSON.stringify(params));

    try {
        const { out_trade_no, money, trade_status, sign, sign_type } = params;

        // ══ 签名验证（开发模式下允许跳过） ══
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

        // ══ 校验订单 ══
        const order = orderStore.get(out_trade_no);
        if (!order) {
            console.error('[ERROR] 订单不存在:', out_trade_no);
            // 尝试从历史记录查找（防止回调先于订单存储）
            return res.status(404).send('order not found');
        }

        // ══ 校验金额 ══
        if (order.price !== parseFloat(money)) {
            console.error('[ERROR] 支付金额不匹配:', money, 'expected:', order.price);
            return res.status(400).send('money mismatch');
        }

        // ══ 校验交易状态 ══
        if (trade_status !== 'TRADE_SUCCESS') {
            console.log('[INFO] 交易未成功:', trade_status);
            return res.send('waiting');
        }

        // ══ 防止重复回调 ══
        if (order.status === 'paid') {
            console.log('[INFO] 订单已处理，跳过');
            return res.send('success');
        }

        // ══ 激活会员 ══
        const memberInfo = membership.activateMembership(
            order.userId,
            order.planId,
            out_trade_no
        );

        // 更新订单状态
        order.status = 'paid';
        order.paidAt = Date.now();
        order.tier = memberInfo.tier;
        order.expiredAt = memberInfo.expiredAt;
        orderStore.set(out_trade_no, order);

        console.log(`[SUCCESS] 会员激活成功: userId=${order.userId}, plan=${order.planId}, tier=${memberInfo.tier}, expire=${new Date(memberInfo.expiredAt).toISOString()}`);

        // 返回 success 给支付网关
        res.send('success');
    } catch (err) {
        console.error('[ERROR] 支付回调处理异常:', err.message);
        res.status(500).send('error');
    }
});

/**
 * 查询支付状态
 * GET /api/payment/check/:orderId
 */
router.get('/api/payment/check/:orderId', (req, res) => {
    const { orderId } = req.params;
    const order = orderStore.get(orderId);

    if (!order) {
        return res.status(404).json({ error: '订单不存在' });
    }

    res.json({
        orderId: order.orderId,
        status: order.status,
        planId: order.planId,
        price: order.price,
        paidAt: order.paidAt || null,
    });
});

/**
 * 获取当前用户会员状态
 * GET /api/membership/status
 */
router.get('/api/membership/status', (req, res) => {
    const member = membership.getMembership(req.userId);

    res.json({
        success: true,
        tier: member.tier,
        tierLabel: membership.getTierLabel(member.tier),
        isVip: membership.isVip(req.userId),
        planId: member.planId || '',
        paidAt: member.paidAt || 0,
        expiredAt: member.expiredAt || 0,
        expireDesc: membership.getExpireDesc(req.userId),
        remainingMs: Math.max(0, (member.expiredAt || 0) - Date.now()),
    });
});

/**
 * 获取功能限制列表
 * GET /api/membership/restrictions
 */
router.get('/api/membership/restrictions', (req, res) => {
    const restrictions = membership.getRestrictions(req.userId);

    res.json({
        success: true,
        tier: membership.getMembership(req.userId).tier,
        isVip: membership.isVip(req.userId),
        restrictions,
        total: restrictions.length,
    });
});

// ============================================
// 导出
// ============================================

module.exports = router;
module.exports.orderStore = orderStore;
module.exports.PAY_CONFIG = PAY_CONFIG;
