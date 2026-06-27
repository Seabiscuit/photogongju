/**
 * 用户模型
 * 邮箱注册、密码登录，JSON 文件存储
 *
 * 数据结构:
 *   users/<email_hash>.json → { email, passwordHash, salt, name, tier, createdAt }
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');

// 确保目录存在
if (!fs.existsSync(USERS_DIR)) {
    fs.mkdirSync(USERS_DIR, { recursive: true });
}

// ============================================
// 密码哈希配置
// ============================================
const HASH_CONFIG = {
    iterations: 100000,
    keylen: 64,
    digest: 'sha512',
    saltBytes: 32,
};

/**
 * 哈希密码
 * @returns {object} { hash, salt }
 */
function hashPassword(password) {
    const salt = crypto.randomBytes(HASH_CONFIG.saltBytes).toString('hex');
    const hash = crypto.pbkdf2Sync(
        password,
        salt,
        HASH_CONFIG.iterations,
        HASH_CONFIG.keylen,
        HASH_CONFIG.digest
    ).toString('hex');
    return { hash, salt };
}

/**
 * 验证密码
 * @returns {boolean}
 */
function verifyPassword(password, salt, expectedHash) {
    const hash = crypto.pbkdf2Sync(
        password,
        salt,
        HASH_CONFIG.iterations,
        HASH_CONFIG.keylen,
        HASH_CONFIG.digest
    ).toString('hex');
    return hash === expectedHash;
}

/**
 * 将邮箱转换为安全的文件名
 */
function emailToKey(email) {
    return email.toLowerCase().trim();
}

function emailToFilename(email) {
    return path.join(USERS_DIR, emailToKey(email) + '.json');
}

// ============================================
// 核心方法
// ============================================

/**
 * 创建新用户
 * @param {string} email
 * @param {string} password  — 明文密码（将自动哈希存储）
 * @param {string} name     — 显示名称（可选，默认取邮箱前缀）
 * @returns {object} { email, name, tier, createdAt }
 */
function createUser(email, password, name = '') {
    const key = emailToKey(email);
    const filePath = emailToFilename(email);

    if (fs.existsSync(filePath)) {
        throw new Error('该邮箱已被注册');
    }

    const { hash, salt } = hashPassword(password);
    const now = Date.now();

    const user = {
        email: key,
        passwordHash: hash,
        salt,
        name: name || key.split('@')[0],
        tier: 'free',
        createdAt: now,
    };

    fs.writeFileSync(filePath, JSON.stringify(user, null, 2), 'utf8');
    return sanitizeUser(user);
}

/**
 * 验证登录
 * @returns {object|null} 用户对象（不含密码字段），null 表示验证失败
 */
function authenticateUser(email, password) {
    const filePath = emailToFilename(email);
    if (!fs.existsSync(filePath)) return null;

    const user = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!verifyPassword(password, user.salt, user.passwordHash)) return null;

    return sanitizeUser(user);
}

/**
 * 根据邮箱获取用户
 * @returns {object|null}
 */
function getUserByEmail(email) {
    const filePath = emailToFilename(email);
    if (!fs.existsSync(filePath)) return null;
    const user = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return sanitizeUser(user);
}

/**
 * 检查邮箱是否已注册
 */
function isEmailRegistered(email) {
    return fs.existsSync(emailToFilename(email));
}

/**
 * 更新用户会员等级
 */
function updateUserTier(email, tier) {
    const filePath = emailToFilename(email);
    if (!fs.existsSync(filePath)) throw new Error('用户不存在');

    const user = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    user.tier = tier;
    fs.writeFileSync(filePath, JSON.stringify(user, null, 2), 'utf8');
    return sanitizeUser(user);
}

// ============================================
// 工具函数
// ============================================

/**
 * 脱敏用户对象（移除敏感字段）
 */
function sanitizeUser(user) {
    return {
        email: user.email,
        name: user.name,
        tier: user.tier,
        createdAt: user.createdAt,
    };
}

// 初始化演示账号（如果不存在）
function initDemoUsers() {
    const demos = [
        { email: 'admin@photogongju.com', password: 'admin123', name: 'Admin', tier: 'admin' },
        { email: 'vip@photogongju.com', password: 'vip123', name: 'VIP User', tier: 'yearly' },
        { email: 'test@photogongju.com', password: 'test123', name: 'Test User', tier: 'free' },
    ];

    for (const d of demos) {
        if (!isEmailRegistered(d.email)) {
            const user = createUser(d.email, d.password, d.name);
            if (d.tier !== 'free') {
                updateUserTier(d.email, d.tier);
            }
        }
    }
}

module.exports = {
    createUser,
    authenticateUser,
    getUserByEmail,
    isEmailRegistered,
    updateUserTier,
    sanitizeUser,
    initDemoUsers,
};
