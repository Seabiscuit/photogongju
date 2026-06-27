/**
 * 会员缓存模型
 * 使用 JSON 文件存储会员状态，支持过期自动清理
 *
 * 会员等级:
 *   free         — 免费用户，每天3次试用
 *   monthly      — 月卡会员，30天全功能无限次
 *   yearly       — 年卡会员，365天全功能无限次
 *   admin        — 管理员，永久全功能
 *
 * 免费用户: 每天3次试用额度（UTC+8日期计算）
 * 会员用户: 不限制使用所有功能
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
    monthly: {
        id: 'monthly',
        name: '月卡会员',
        price: 9.9,
        originalPrice: 29.9,
        durationHours: 720, // 30天
        durationLabel: '30天',
        features: [
            '全功能无限次使用',
            'AI 智能背景去除无限次',
            '高清输出 (最高 8K)',
            '批量流水线处理',
            '全部水印模式',
            '全部尺寸预设',
            '证件照 / 签证尺寸',
            '优先处理队列',
            '专属客服支持',
            '无广告纯净体验',
        ],
        color: '#f59e0b',
        popular: true,
    },
    yearly: {
        id: 'yearly',
        name: '年卡会员',
        price: 59.9,
        originalPrice: 199,
        durationHours: 8760, // 365天
        durationLabel: '365天',
        features: [
            '月卡全部权益',
            '全年365天无限次使用',
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

// 免费用户每天试用次数
const FREE_DAILY_TRIALS = 3;

// 等级权重
const TIER_WEIGHT = {
    'free': 0,
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
 * 获取今天的日期键（UTC+8 中国时区）
 */
function getTodayKey() {
    const now = new Date();
    // 转为北京时间
    const bj = new Date(now.getTime() + 8 * 3600 * 1000);
    return bj.toISOString().slice(0, 10); // YYYY-MM-DD
}

// 每日试用计数存储
const dailyTrialStore = new Map(); // userId_today → count

/**
 * 记录一次免费试用（仅 free 用户调用）
 * @returns {object} { allowed, used, remaining, limit }
 */
function recordTrial(userId) {
    const member = getMembership(userId);

    // VIP/管理员不限制
    if (member.tier !== 'free') {
        return { allowed: true, used: 0, remaining: Infinity, limit: Infinity };
    }

    const key = `${userId}_${getTodayKey()}`;
    const used = dailyTrialStore.get(key) || 0;

    if (used >= FREE_DAILY_TRIALS) {
        return { allowed: false, used, remaining: 0, limit: FREE_DAILY_TRIALS };
    }

    dailyTrialStore.set(key, used + 1);
    return { allowed: true, used: used + 1, remaining: FREE_DAILY_TRIALS - used - 1, limit: FREE_DAILY_TRIALS };
}

/**
 * 检查用户是否还有今日试用次数
 */
function getTrialStatus(userId) {
    const member = getMembership(userId);
    if (member.tier !== 'free') {
        return { allowed: true, used: 0, remaining: Infinity, limit: Infinity, tier: member.tier };
    }
    const key = `${userId}_${getTodayKey()}`;
    const used = dailyTrialStore.get(key) || 0;
    return {
        allowed: used < FREE_DAILY_TRIALS,
        used,
        remaining: Math.max(0, FREE_DAILY_TRIALS - used),
        limit: FREE_DAILY_TRIALS,
        tier: 'free',
    };
}

/**
 * 检查用户是否有权限（VIP 不限，free 看试用次数）
 */
function hasPermission(userId, featureKey) {
    const member = getMembership(userId);
    // VIP/管理员：所有功能开放
    if (member.tier !== 'free') return true;
    // 免费用户：不限制具体功能，用每日试用次数控制
    return getTrialStatus(userId).allowed;
}

/**
 * 获取用户受限制的功能列表（仅显示试用次数限制）
 */
function getRestrictions(userId) {
    const member = getMembership(userId);
    if (member.tier !== 'free') return [];

    const status = getTrialStatus(userId);
    return [{
        key: 'daily_trial',
        desc: `每日免费试用 (${status.used}/${status.limit} 已用)`,
        minTier: 'monthly',
        minTierLabel: '月卡会员',
    }];
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
    const tier = planId;

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
    return ['monthly', 'yearly', 'admin'].includes(member.tier);
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
    FREE_DAILY_TRIALS,
    getPlans,
    getPlanById,
    getMembership,
    hasPermission,
    getRestrictions,
    recordTrial,
    getTrialStatus,
    activateMembership,
    generateOrderId,
    getTierLabel,
    getTierWeight,
    isVip,
    getExpireDesc,
    TIER_WEIGHT,
    readPaidRecords,
    dailyTrialStore,
};
