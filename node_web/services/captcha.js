/**
 * 图形验证码服务
 * 纯 Node.js 实现，零外部依赖，生成 SVG 格式验证码
 */

const crypto = require('crypto');

// 内存存储（key → { code, expiresAt }）
const store = new Map();

// 过期时间 5 分钟
const EXPIRE_MS = 5 * 60 * 1000;

// 定期清理过期验证码
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of store) {
        if (now > val.expiresAt) store.delete(key);
    }
}, 60 * 1000);

/**
 * 生成验证码
 * @returns {object} { key, svg, code }
 */
function generate() {
    const code = randomCode(4);
    const key = crypto.randomBytes(16).toString('hex');

    store.set(key, { code: code.toLowerCase(), expiresAt: Date.now() + EXPIRE_MS });

    const svg = renderSvg(code);
    return { key, svg, code };
}

/**
 * 验证验证码
 * @param {string} key
 * @param {string} input
 * @returns {boolean}
 */
function verify(key, input) {
    if (!key || !input) return false;
    const record = store.get(key);
    if (!record) return false;
    if (Date.now() > record.expiresAt) {
        store.delete(key);
        return false;
    }
    // 验证成功即删除（一次性使用）
    const match = record.code === input.toLowerCase().trim();
    if (match) store.delete(key);
    return match;
}

/**
 * 生成随机字符验证码
 */
function randomCode(length) {
    // 排除容易混淆的字符: 0/O, 1/I/l, 2/Z, 5/S, 8/B
    const chars = '345679ACDEFGHJKLMNPQRTUVWXY';
    let code = '';
    const bytes = crypto.randomBytes(length * 2);
    for (let i = 0; i < length; i++) {
        code += chars[bytes[i] % chars.length];
    }
    return code;
}

/**
 * 渲染 SVG 验证码图片
 * 包含干扰线、扭曲效果、噪点
 */
function renderSvg(code) {
    const chars = code.split('');
    const w = 140;
    const h = 50;
    const padding = 10;
    const charW = (w - padding * 2) / chars.length;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
    svg += `<rect width="${w}" height="${h}" fill="#f8fafc" rx="6"/>`;

    // 背景噪点
    for (let i = 0; i < 30; i++) {
        const cx = randInt(0, w);
        const cy = randInt(0, h);
        const r = randFloat(0.8, 2);
        const opacity = randFloat(0.1, 0.3);
        svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#94a3b8" opacity="${opacity}"/>`;
    }

    // 干扰线
    for (let i = 0; i < 3; i++) {
        const y1 = randInt(5, h - 5);
        const y2 = randInt(5, h - 5);
        const cp = randInt(-15, 15);
        svg += `<path d="M0,${y1} Q${w / 2},${y1 + cp} ${w},${y2}"
                 fill="none" stroke="#cbd5e1" stroke-width="${randFloat(1, 2)}" opacity="0.7"/>`;
    }

    // 字符
    for (let i = 0; i < chars.length; i++) {
        const x = padding + i * charW + charW / 2;
        const y = h / 2 + randInt(-4, 4);
        const rotate = randInt(-25, 25);
        const size = randInt(28, 34);
        const color = randomColor();
        const skewX = randInt(-5, 5);

        svg += `<text x="${x}" y="${y}"
                 font-family="Arial,Helvetica,sans-serif" font-size="${size}" font-weight="bold"
                 fill="${color}" text-anchor="middle" dominant-baseline="central"
                 transform="rotate(${rotate},${x},${y}) skewX(${skewX})"
                 opacity="0.9">${chars[i]}</text>`;
    }

    svg += `</svg>`;
    return svg;
}

function randInt(min, max) {
    const bytes = crypto.randomBytes(4);
    const num = bytes.readUInt32BE(0);
    return min + (num % (max - min + 1));
}

function randFloat(min, max) {
    const bytes = crypto.randomBytes(4);
    const num = bytes.readUInt32BE(0) / 0xFFFFFFFF;
    return min + num * (max - min);
}

function randomColor() {
    const colors = ['#0ea5a3', '#6366f1', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#10b981'];
    return colors[randInt(0, colors.length - 1)];
}

module.exports = { generate, verify };
