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
 * 重度遮挡：密集噪点 + 多条干扰线 + 交错弧线 + 随机色块
 */
function renderSvg(code) {
    const chars = code.split('');
    const w = 140;
    const h = 50;
    const padding = 8;
    const charW = (w - padding * 2) / chars.length;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
    // 背景（带微米色变化）
    const bgColor = randInt(0, 1) ? '#f9fafb' : '#f1f5f9';
    svg += `<rect width="${w}" height="${h}" fill="${bgColor}" rx="6"/>`;

    // ── 密集背景噪点（50个） ──
    for (let i = 0; i < 50; i++) {
        const cx = randInt(0, w);
        const cy = randInt(0, h);
        const r = randFloat(0.6, 2.5);
        const fill = ['#64748b', '#94a3b8', '#cbd5e1', '#475569'][randInt(0, 3)];
        const opacity = randFloat(0.12, 0.45);
        svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" opacity="${opacity}"/>`;
    }

    // ── 粗干扰线（横穿整个区域，5条） ──
    for (let i = 0; i < 5; i++) {
        const y1 = randInt(2, h - 2);
        const y2 = randInt(2, h - 2);
        const cp1 = randInt(-20, 20);
        const cp2 = randInt(-20, 20);
        const stroke = ['#cbd5e1', '#94a3b8', '#a8a29e', '#d6d3d1'][randInt(0, 3)];
        const sw = randFloat(1.2, 3.5);
        svg += `<path d="M0,${y1} Q${w * 0.33},${y1 + cp1} ${w * 0.66},${y2 + cp2} Q${w},${y2} ${w},${y2}"
                 fill="none" stroke="${stroke}" stroke-width="${sw}" opacity="0.65"/>`;
    }

    // ── 弧线干扰（横跨对角，3条） ──
    for (let i = 0; i < 3; i++) {
        const cx = w / 2 + randInt(-30, 30);
        const cy = h / 2 + randInt(-10, 10);
        const rx = randInt(50, 100);
        const ry = randInt(20, 40);
        const stroke = ['#94a3b8', '#a8a29e', '#78716c'][randInt(0, 2)];
        svg += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"
                 fill="none" stroke="${stroke}" stroke-width="${randFloat(0.8, 1.8)}" opacity="0.45"
                 transform="rotate(${randInt(-15, 15)},${cx},${cy})"/>`;
    }

    // ── 随机小色块（干扰视觉，8个） ──
    for (let i = 0; i < 8; i++) {
        const x = randInt(2, w - 12);
        const y = randInt(2, h - 10);
        const rw = randInt(4, 12);
        const rh = randInt(3, 8);
        const fill = ['#e2e8f0', '#cbd5e1', '#d1d5db', '#e5e7eb'][randInt(0, 3)];
        svg += `<rect x="${x}" y="${y}" width="${rw}" height="${rh}"
                 fill="${fill}" opacity="${randFloat(0.25, 0.55)}" rx="2"/>`;
    }

    // ── 字符（加大旋转/偏移/颜色随机性） ──
    for (let i = 0; i < chars.length; i++) {
        const x = padding + i * charW + charW / 2 + randInt(-3, 3);
        const y = h / 2 + randInt(-5, 5);
        const rotate = randInt(-35, 35);
        const size = randInt(26, 34);
        const color = randomColor();
        const skewX = randInt(-8, 8);
        const skewY = randInt(-3, 3);
        // 字符透明度在 0.75-0.95 之间波动，让干扰线隐约透出
        const opacity = randFloat(0.75, 0.95);

        svg += `<text x="${x}" y="${y}"
                 font-family="Arial,Helvetica,sans-serif" font-size="${size}" font-weight="bold"
                 fill="${color}" text-anchor="middle" dominant-baseline="central"
                 transform="rotate(${rotate},${x},${y}) skewX(${skewX}) skewY(${skewY})"
                 opacity="${opacity}"
                 stroke="${color}" stroke-width="0" stroke-opacity="0.15">${chars[i]}</text>`;
    }

    // ── 额外交叉细线（穿过字符层，3条） ──
    for (let i = 0; i < 3; i++) {
        const x1 = randInt(0, 30);
        const y1 = randInt(0, h);
        const x2 = randInt(w - 30, w);
        const y2 = randInt(0, h);
        svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
                 stroke="#94a3b8" stroke-width="${randFloat(0.5, 1.2)}" opacity="0.4"/>`;
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
