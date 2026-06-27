/**
 * 会员缓存模型
 * 使用 JSON 文件存储会员状态，支持过期自动清理
 *
 * 会员等级:
 *   free         — 免费用户，功能受限
 *   single_paid  — 单次付费，24小时全功能
 *   monthly      — 月卡会员，30天全功能
 *   yearly       — 年卡会员，365天全功能
 *   admin        — 管理员，永久全功能
 *
 * 免费用户限制:
 *   - 高清输出 (>1080p)  ❌
 *   - 批量流水线处理      ❌
 *   - AI 背景去除         ❌
 *   - 签证/证件照尺寸      ❌
 *   - 图片 Logo 水印      ❌
 *   - 平铺水印            ❌
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const MEMBERS_FILE = path.join(DATA_DIR, 'members.json');
const PAID_USERS_FILE = path.join(DATA_DIR, 'paid_users.json');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ============================================
// 数据读写
// ============================================

function readMembers() {
    try {
        if (!fs.existsSync(MEMBERS_FILE)) return {};
        return JSON.parse(fs.readFileSync(MEMBERS_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function writeMembers(data) {
    fs.writeFileSync(MEMBERS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function readPaidRecords() {
    try {
        if (!fs.existsSync(PAID_USERS_FILE)) return [];
        return JSON.parse(fs.readFileSync(PAID_USERS_FILE, 'utf8'));
    } catch {
        return [];
    }
}

function writePaidRecords(data) {
    fs.writeFileSync(PAID_USERS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ============================================
// 会员套餐定义
// ============================================

const PLANS = {
    single: {
        id: 'single',
        name: '单次付费',
        price: 9.9,
        originalPrice: 19.9,
        durationHours: 24,
        durationLabel: '24小时',
        features: [
            '全功能解锁 24 小时',
            '高清输出 (最高 8K)',
            'AI 智能背景去除',
            '批量流水线处理',
            '全部水印模式',
            '全部尺寸预设',
            '证件照 / 签证尺寸',
        ],
        color: '#6366f1',
        popular: false,
    },
    monthly: {
        id: 'monthly',
        name: '月卡会员',
        price: 29.9,
        originalPrice: 59.9,
        durationHours: 720, // 30天
        durationLabel: '30天',
        features: [
            '单次付费全部权益',
            '30天不限次数使用',
            '优先处理队列',
            '专属客服支持',
            '无广告纯净体验',
            '每月赠送 100 次 AI 抠图',
        ],
        color: '#f59e0b',
        popular: true,
    },
    yearly: {
        id: 'yearly',
        name: '年卡会员',
        price: 199,
        originalPrice: 399,
        durationHours: 8760, // 365天
        durationLabel: '365天',
        features: [
            '月卡全部权益',
            '全年无限次使用',
            'API 接口访问权限',
            '新功能抢先体验',
            '专属技术支持',
            '商业使用授权',
        ],
        color: '#ef4444',
        popular: false,
    },
};

// ============================================
// 权限配置：各功能所需的最低会员等级
// ============================================

const FEATURE_PERMISSIONS = {
    'resize_hd': { minTier: 'single_paid', desc: '高清输出 (>1080p)' },
    'pipeline': { minTier: 'single_paid', desc: '批量流水线处理' },
    'remove_background': { minTier: 'single_paid', desc: 'AI 背景去除' },
    'visa_size': { minTier: 'single_paid', desc: '证件照/签证尺寸' },
    'watermark_image': { minTier: 'single_paid', desc: '图片 Logo 水印' },
    'watermark_tile': { minTier: 'single_paid', desc: '平铺水印' },
    'batch_upload': { minTier: 'monthly', desc: '批量上传处理' },
    'api_access': { minTier: 'yearly', desc: 'API 接口访问' },
};

// 等级权重（数值越大权限越高）
const TIER_WEIGHT = {
    'free': 0,
    'single_paid': 1,
    'monthly': 2,
    'yearly': 3,
    'admin': 99,
};

// ============================================
// 核心方法
// ============================================

/**
 * 获取用户会员信息
 * @param {string} userId - 用户标识 (sessionId 或用户名)
 * @returns {object} { tier, expiredAt, paidAt, planId }
 */
function getMembership(userId) {
    if (!userId) return createFreeMembership();

    const members = readMembers();
    const member = members[userId];

    if (!member) return createFreeMembership();

    // 检查是否过期
    if (member.tier !== 'admin' && member.tier !== 'free') {
        const now = Date.now();
        if (now > member.expiredAt) {
            // 已过期，降级为免费
            member.tier = 'free';
            member.expiredAt = 0;
            writeMembers(members);
            return createFreeMembership();
        }
    }

    return { ...member };
}

/**
 * 检查用户是否有权限使用某项功能
 */
function hasPermission(userId, featureKey) {
    const member = getMembership(userId);
    const perm = FEATURE_PERMISSIONS[featureKey];

    if (!perm) return true; // 未知功能默认允许

    const userWeight = TIER_WEIGHT[member.tier] || 0;
    const requiredWeight = TIER_WEIGHT[perm.minTier] || 0;

    return userWeight >= requiredWeight;
}

/**
 * 获取用户受限制的功能列表
 */
function getRestrictions(userId) {
    const member = getMembership(userId);
    const restrictions = [];

    for (const [key, perm] of Object.entries(FEATURE_PERMISSIONS)) {
        const userWeight = TIER_WEIGHT[member.tier] || 0;
        const requiredWeight = TIER_WEIGHT[perm.minTier] || 0;
        if (userWeight < requiredWeight) {
            restrictions.push({
                key,
                desc: perm.desc,
                minTier: perm.minTier,
                minTierLabel: getTierLabel(perm.minTier),
            });
        }
    }

    return restrictions;
}

/**
 * 激活会员（支付成功后调用）
 * @param {string} userId
 * @param {string} planId - single | monthly | yearly
 * @param {string} payOrderId - 支付订单号
 */
function activateMembership(userId, planId, payOrderId = '') {
    const plan = PLANS[planId];
    if (!plan) throw new Error(`未知套餐: ${planId}`);

    const members = readMembers();
    const now = Date.now();
    const tier = planId === 'single' ? 'single_paid' : planId;

    // 如果已有会员且未过期，叠加时间
    let baseTime = now;
    const existing = members[userId];
    if (existing && existing.tier !== 'free' && existing.expiredAt > now) {
        baseTime = existing.expiredAt; // 在现有到期时间上叠加
    }

    members[userId] = {
        userId,
        tier,
        planId,
        paidAt: now,
        expiredAt: baseTime + plan.durationHours * 3600 * 1000,
        payOrderId,
    };

    writeMembers(members);

    // 记录付费日志
    const records = readPaidRecords();
    records.push({
        userId,
        planId,
        tier,
        price: plan.price,
        paidAt: now,
        expiredAt: members[userId].expiredAt,
        payOrderId,
    });
    writePaidRecords(records);

    return members[userId];
}

/**
 * 获取套餐信息
 */
function getPlans() {
    return PLANS;
}

function getPlanById(planId) {
    return PLANS[planId] || null;
}

/**
 * 生成支付订单号
 */
function generateOrderId() {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `PG${timestamp}${random}`;
}

// ============================================
// 工具函数
// ============================================

function createFreeMembership() {
    return {
        userId: '',
        tier: 'free',
        planId: '',
        paidAt: 0,
        expiredAt: 0,
        payOrderId: '',
    };
}

function getTierLabel(tier) {
    const labels = {
        'free': '免费用户',
        'single_paid': '单次付费',
        'monthly': '月卡会员',
        'yearly': '年卡会员',
        'admin': '管理员',
    };
    return labels[tier] || '未知';
}

function getTierWeight(tier) {
    return TIER_WEIGHT[tier] || 0;
}

function isVip(userId) {
    const member = getMembership(userId);
    return ['single_paid', 'monthly', 'yearly', 'admin'].includes(member.tier);
}

/**
 * 获取会员到期时间描述
 */
function getExpireDesc(userId) {
    const member = getMembership(userId);
    if (member.tier === 'free') return '免费用户';
    if (member.tier === 'admin') return '永久有效';

    const remain = member.expiredAt - Date.now();
    if (remain <= 0) return '已过期';

    const hours = Math.floor(remain / 3600000);
    const days = Math.floor(hours / 24);

    if (days > 0) return `剩余 ${days} 天`;
    return `剩余 ${hours} 小时`;
}

module.exports = {
    PLANS,
    getPlans,
    getPlanById,
    getMembership,
    hasPermission,
    getRestrictions,
    activateMembership,
    generateOrderId,
    getTierLabel,
    getTierWeight,
    isVip,
    getExpireDesc,
    FEATURE_PERMISSIONS,
    TIER_WEIGHT,
    readPaidRecords,
};
