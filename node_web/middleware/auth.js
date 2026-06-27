/**
 * 鉴权中间件
 * 负责 Session 用户识别、会员状态注入、权限拦截
 */

const membership = require('../models/membership');

// ============================================
// 用户标识解析中间件
// 在所有路由之前执行，确保 req.userId 可用
// ============================================

function userIdentity(req, res, next) {
    // 优先使用 session 中的登录用户
    if (req.session && req.session.user) {
        req.userId = req.session.user.id || req.session.user.username;
        req.user = req.session.user;
    } else {
        // 未登录用户使用 sessionId 作为临时标识
        req.userId = req.sessionID || 'guest_' + Math.random().toString(36).substring(7);
    }

    // 注入会员信息
    req.membership = membership.getMembership(req.userId);
    req.isVip = membership.isVip(req.userId);
    req.userTier = req.membership.tier;

    // 注入权限检查方法
    req.can = (featureKey) => membership.hasPermission(req.userId, featureKey);
    req.getRestrictions = () => membership.getRestrictions(req.userId);

    // 注入到 res.locals 供模板使用
    res.locals.user = req.session?.user || null;
    res.locals.isLoggedIn = !!req.session?.user;
    res.locals.membership = req.membership;
    res.locals.isVip = req.isVip;
    res.locals.userTier = req.userTier;
    res.locals.tierLabel = membership.getTierLabel(req.userTier);
    res.locals.expireDesc = membership.getExpireDesc(req.userId);
    res.locals.can = req.can;
    res.locals.getRestrictions = req.getRestrictions;

    next();
}

// ============================================
// 登录状态要求中间件
// ============================================

function requireLogin(req, res, next) {
    if (!req.session || !req.session.user) {
        if (req.xhr || req.headers['accept']?.includes('application/json')) {
            return res.status(401).json({ error: '请先登录', redirect: '/login' });
        }
        return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
    }
    next();
}

// ============================================
// VIP 会员要求中间件
// ============================================

function requireVip(req, res, next) {
    if (!membership.isVip(req.userId)) {
        if (req.xhr || req.headers['accept']?.includes('application/json')) {
            return res.status(403).json({
                error: '此功能需要开通会员',
                code: 'VIP_REQUIRED',
                redirect: '/membership',
            });
        }
        req.session.vipRedirect = req.originalUrl;
        return res.redirect('/membership');
    }
    next();
}

// ============================================
// 功能权限检查中间件工厂
// usage: app.post('/api/xxx', requireFeature('remove_background'), handler)
// ============================================

function requireFeature(featureKey) {
    return (req, res, next) => {
        if (!membership.hasPermission(req.userId, featureKey)) {
            const perm = membership.FEATURE_PERMISSIONS[featureKey];
            return res.status(403).json({
                error: `此功能需要 ${perm?.minTier || 'VIP'} 会员`,
                code: 'FEATURE_LOCKED',
                feature: featureKey,
                desc: perm?.desc || featureKey,
                minTier: perm?.minTier || 'monthly',
                redirect: '/membership',
            });
        }
        next();
    };
}

module.exports = {
    userIdentity,
    requireLogin,
    requireVip,
    requireFeature,
};
