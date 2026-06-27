/**
 * 易宝支付 (Yeepay) Node.js 客户端
 *
 * 实现 YOP RSA2048-SHA256 签名协议，支持:
 *   - 主扫支付下单 (aggpay-pre-pay)
 *   - 订单查询 (trade-order-query)
 *   - 支付回调验签
 *
 * 无需官方 SDK，纯 Node.js 内置模块实现。
 * 协议参考: yeepay-skills/references/平台文档/平台规范/安全认证/
 */

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const querystring = require('querystring');
const url = require('url');

// ============================================
// 商户配置（通过环境变量注入）
// ============================================
const YEEPAY_CONFIG = {
    appKey: process.env.YEEPAY_APP_KEY || '',
    merchantNo: process.env.YEEPAY_MERCHANT_NO || '',
    // RSA 商户私钥（PEM 格式字符串，或文件路径）
    privateKey: process.env.YEEPAY_PRIVATE_KEY || '',
    // 易宝平台 RSA 公钥（用于验签回调）
    yeepayPublicKey: process.env.YEEPAY_PUBLIC_KEY || '',
    // 网关地址
    gateway: process.env.NODE_ENV === 'production'
        ? 'https://openapi.yeepay.com/yop-center'
        : 'https://sandbox.yeepay.com/yop-center',
    // 回调地址
    notifyUrl: process.env.YEEPAY_NOTIFY_URL || 'http://localhost:3000/api/payment/callback',
};

// SDK 版本信息
const SDK_VERSION = '4.0.0';
const SDK_LANGS = 'nodejs';

// ============================================
// 工具函数
// ============================================

/**
 * URL 编码（签名用：一次编码，空格 → %20，RFC3986）
 */
function urlEncodeForSign(str) {
    return encodeURIComponent(str)
        .replace(/!/g, '%21')
        .replace(/'/g, '%27')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/\*/g, '%2A')
        .replace(/~/g, '%7E');
}

/**
 * URL 编码（HTTP 报文用：值两次编码）
 */
function httpFormEncode(str) {
    return urlEncodeForSign(urlEncodeForSign(str));
}

/**
 * 构建签名用 canonical headers 串
 * 按 key 升序，每行 urlencode(key):urlencode(value)
 */
function buildCanonicalHeaders(headers) {
    const sorted = Object.keys(headers).sort();
    return sorted.map(k => `${urlEncodeForSign(k)}:${urlEncodeForSign(headers[k])}`).join('\n');
}

/**
 * 构建签名用 canonical query string
 * 按 key 升序 k=v&k=v...（一次编码，空格 %20）
 */
function buildCanonicalQuery(params) {
    const keys = Object.keys(params).sort();
    return keys.map(k => `${urlEncodeForSign(k)}=${urlEncodeForSign(String(params[k]))}`).join('&');
}

/**
 * 生成 UUID v4
 */
function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

/**
 * 当前 UTC 时间戳（yyyy-MM-ddTHH:mm:ssZ）
 */
function utcTimestamp() {
    return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

/**
 * URL-safe Base64（去掉尾部 =）
 */
function urlSafeBase64(buf) {
    return buf.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

// ============================================
// 核心：RSA 签名 + 请求发送
// ============================================

/**
 * 构建带签名的 Authorization 头
 */
function buildAuthorization(method, uriPath, queryParams, formParams, jsonBody) {
    const timestamp = utcTimestamp();
    const expireSeconds = 1800;
    const requestId = uuid();

    // 1. 计算 x-yop-content-sha256
    let contentSha256;
    let contentType;
    let bodyStr;

    if (method === 'GET') {
        contentSha256 = crypto.createHash('sha256').update('').digest('hex');
        contentType = 'application/x-www-form-urlencoded;charset=UTF-8';
    } else if (jsonBody) {
        bodyStr = JSON.stringify(jsonBody);
        contentSha256 = crypto.createHash('sha256').update(bodyStr).digest('hex');
        contentType = 'application/json';
    } else if (formParams) {
        bodyStr = buildCanonicalQuery(formParams);
        contentSha256 = crypto.createHash('sha256').update(bodyStr).digest('hex');
        contentType = 'application/x-www-form-urlencoded;charset=UTF-8';
    } else {
        contentSha256 = crypto.createHash('sha256').update('').digest('hex');
        contentType = 'application/x-www-form-urlencoded;charset=UTF-8';
    }

    // 2. 签名用 headers
    const signHeaders = {
        'x-yop-appkey': YEEPAY_CONFIG.appKey,
        'x-yop-content-sha256': contentSha256,
        'x-yop-request-id': requestId,
    };

    // 3. Canonical request（5 行，\n 连接）
    const authString = `yop-auth-v3/${YEEPAY_CONFIG.appKey}/${timestamp}/${expireSeconds}`;
    const canonicalQuery = queryParams ? buildCanonicalQuery(queryParams) : '';
    const canonicalHeaders = buildCanonicalHeaders(signHeaders);

    const canonicalRequest = [
        authString,
        method.toUpperCase(),
        uriPath,
        canonicalQuery,
        canonicalHeaders,
    ].join('\n');

    // 4. RSA SHA256 签名
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(canonicalRequest);
    const signature = urlSafeBase64(sign.sign(YEEPAY_CONFIG.privateKey)) + '$SHA256';

    // 5. Authorization 头
    const signedHeaderKeys = Object.keys(signHeaders).sort().join(';');
    const authorization = `YOP-RSA2048-SHA256 ${authString}/${signedHeaderKeys}/${signature}`;

    return {
        authorization,
        contentSha256,
        contentType,
        requestId,
        timestamp,
        bodyStr,
    };
}

/**
 * 发送 API 请求
 */
function apiRequest(method, uriPath, queryParams = null, formParams = null, jsonBody = null) {
    return new Promise((resolve, reject) => {
        const auth = buildAuthorization(method, uriPath, queryParams, formParams, jsonBody);

        const gatewayUrl = new url.URL(YEEPAY_CONFIG.gateway);
        const isHttps = gatewayUrl.protocol === 'https:';

        // 构建请求路径 + query
        let fullPath = uriPath;
        if (queryParams) {
            const qs = Object.keys(queryParams).sort().map(k =>
                `${urlEncodeForSign(k)}=${httpFormEncode(String(queryParams[k]))}`
            ).join('&');
            fullPath += '?' + qs;
        }

        const headers = {
            'Authorization': auth.authorization,
            'Content-Type': auth.contentType,
            'x-yop-appkey': YEEPAY_CONFIG.appKey,
            'x-yop-sdk-version': SDK_VERSION,
            'x-yop-sdk-langs': SDK_LANGS,
            'x-yop-request-id': auth.requestId,
            'User-Agent': `nodejs/${process.version}`,
        };

        const options = {
            hostname: gatewayUrl.hostname,
            port: gatewayUrl.port || (isHttps ? 443 : 80),
            path: fullPath,
            method: method.toUpperCase(),
            headers,
        };

        const client = isHttps ? https : http;

        const req = client.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    if (res.statusCode >= 200 && res.statusCode < 300 && data.returnCode === 'SUCCESS') {
                        resolve(data);
                    } else {
                        const err = new Error(data.returnMsg || data.message || `HTTP ${res.statusCode}`);
                        err.code = data.returnCode || 'UNKNOWN';
                        err.data = data;
                        reject(err);
                    }
                } catch (e) {
                    reject(new Error(`Parse error (HTTP ${res.statusCode}): ${body.substring(0, 200)}`));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });

        if (auth.bodyStr) {
            req.write(auth.bodyStr);
        }
        req.end();
    });
}

// ============================================
// 业务 API
// ============================================

/**
 * 主扫支付下单（线上 PC）
 * 返回包含二维码链接的 prePayTn
 *
 * @param {object} params
 * @param {string} params.orderId    — 商户订单号
 * @param {number} params.amount     — 金额（元）
 * @param {string} params.subject    — 商品名称
 * @param {string} params.payWay     — 支付方式 WECHAT / ALIPAY
 * @returns {object} { prePayTn, orderId, codeUrl }
 */
function createPayment(params) {
    const { orderId, amount, subject, payWay = 'WECHAT' } = params;

    const formParams = {
        merchantNo: YEEPAY_CONFIG.merchantNo,
        orderId: orderId,
        orderAmount: amount.toFixed(2),
        goodsName: subject || 'PhotoGongju VIP',
        fundProcessType: 'REALTIME',
        payWay: 'USER_SCAN',
        channel: payWay,
        notifyUrl: YEEPAY_CONFIG.notifyUrl,
        timeoutExpress: '1440',
    };

    return apiRequest('POST', '/rest/v1.0/aggpay/pre-pay', null, formParams, null);
}

/**
 * 查询订单状态
 * @param {string} orderId — 商户订单号
 */
function queryOrder(orderId) {
    const queryParams = {
        merchantNo: YEEPAY_CONFIG.merchantNo,
        orderId: orderId,
    };
    return apiRequest('GET', '/rest/v1.0/trade/order/query', queryParams, null, null);
}

/**
 * 验签支付回调
 * 用易宝平台公钥验证 x-yop-sign
 *
 * @param {string} body     — 回调请求 body（原始字符串）
 * @param {string} signature — x-yop-sign 头
 * @returns {boolean}
 */
function verifyCallback(body, signature) {
    if (!signature) return false;

    try {
        // 去掉签名算法后缀
        const parts = signature.split('$');
        const signValue = parts[0];
        // URL-safe base64 → 标准 base64
        const stdBase64 = signValue.replace(/-/g, '+').replace(/_/g, '/');
        // 补齐尾部 =
        const padded = stdBase64 + '='.repeat((4 - stdBase64.length % 4) % 4);

        // 规范化 body：去掉空格、制表符、换行
        const normalized = body.replace(/[ \t\n\r]/g, '');

        const verify = crypto.createVerify('RSA-SHA256');
        verify.update(normalized);
        return verify.verify(YEEPAY_CONFIG.yeepayPublicKey, Buffer.from(padded, 'base64'));
    } catch (e) {
        console.error('[YeePay] Callback verify error:', e.message);
        return false;
    }
}

/**
 * 检查是否已配置
 */
function isConfigured() {
    return !!(YEEPAY_CONFIG.appKey && YEEPAY_CONFIG.privateKey && YEEPAY_CONFIG.merchantNo);
}

module.exports = {
    createPayment,
    queryOrder,
    verifyCallback,
    isConfigured,
    YEEPAY_CONFIG,
};
