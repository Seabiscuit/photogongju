/**
 * COS 集成改造指南 — node_web 代码改造示例
 *
 * 将以下代码按行替换到 node_web/routes/api.js 的 upload 处理器中
 * 即可实现"用户上传 → 本地暂存 → 转存 COS → 删除本地缓存"的流程
 *
 * 改造前请先在 .env 配置:
 *   COS_REGION=ap-guangzhou
 *   COS_BUCKET=photogongju-1234567890
 *   COS_SECRET_ID=AKIDxxxxxx
 *   COS_SECRET_KEY=xxxxxxxx
 *   COS_CDN_DOMAIN=cdn.example.com    (可选)
 */

// ═══════════════════════════════════════════════════════════
// 改造示例: routes/api.js 上传接口
// ═══════════════════════════════════════════════════════════

/*
// ── 原代码 ──
const result = await aiService.uploadToAIService(
    req.file.buffer,
    req.file.originalname,
    req.userTier || 'free'
);

// ── 改为 (在原有逻辑后添加) ──
const result = await aiService.uploadToAIService(
    req.file.buffer,
    req.file.originalname,
    req.userTier || 'free'
);

// ★ 新增: 转存用户原图到 COS 云端
const cosStorage = require('../deploy/cos/cosStorage');
try {
    const cosResult = await cosStorage.uploadUserImage(
        req.file.buffer,
        req.file.originalname,
        req.userId || 'anonymous'
    );
    // 将 COS URL 附加到响应中
    result.cos_url = cosResult.cdnUrl || cosResult.url;
    console.log('[COS] 原图已转存:', cosResult.key);
} catch (cosErr) {
    // COS 失败不影响业务流程，仅记录日志
    console.warn('[COS] 转存失败（已回退本地）:', cosErr.message);
}
*/

// ═══════════════════════════════════════════════════════════
// 改造示例: 处理结果也存到 COS
// ═══════════════════════════════════════════════════════════

/*
// 在 api.js 的 download 路由中，判断文件是否在 COS 上
router.get('/download/:taskId', async (req, res) => {
    const { taskId } = req.params;
    const cosStorage = require('../deploy/cos/cosStorage');

    try {
        if (cosStorage.isAvailable()) {
            // 从 COS 获取预签名 URL 并重定向
            const presignedUrl = cosStorage.getPresignedUrl(
                `outputs/${taskId}.png`,
                300 // 5分钟有效
            );
            return res.redirect(presignedUrl);
        }
        // 回退到本地文件流
        // ... 原有逻辑 ...
    } catch (err) {
        // 处理错误
    }
});
*/

// ═══════════════════════════════════════════════════════════
// 改造示例: cleanup_temp.sh 扩展 COS 清理
// ═══════════════════════════════════════════════════════════

/*
// 在 deploy/scripts/cleanup_temp.sh 末尾添加 COS 过期文件清理:

cleanup_cos() {
    log "▶ 开始清理 COS 过期文件"
    cd /opt/photogongju/node_web
    node -e "
        const cos = require('../deploy/cos/cosStorage');
        if (cos.isAvailable()) {
            cos.cleanupExpiredFiles('uploads/', ${UPLOAD_RETENTION_DAYS})
                .then(() => cos.cleanupExpiredFiles('outputs/', ${OUTPUT_RETENTION_DAYS}))
                .then(() => process.exit(0))
                .catch(e => { console.error(e); process.exit(1); });
        } else {
            console.log('COS 不可用，跳过云端清理');
            process.exit(0);
        }
    "
    log "  COS 清理完成"
}
*/

// ═══════════════════════════════════════════════════════════
// .env 文件模板
// ═══════════════════════════════════════════════════════════

const ENV_TEMPLATE = `
# ── COS 对象存储配置 ──
COS_REGION=ap-guangzhou
COS_BUCKET=photogongju-1234567890
COS_SECRET_ID=你的SecretId
COS_SECRET_KEY=你的SecretKey
COS_CDN_DOMAIN=cdn.yourdomain.com
COS_USE_STS=false

# ── 支付配置 ──
PAY_PID=1001
PAY_KEY=YourPayKeyHere
PAY_GATEWAY=https://pay.example.com/submit.php
PAY_NOTIFY_URL=https://yourdomain.com/api/payment/callback
PAY_RETURN_URL=https://yourdomain.com/membership

# ── 其他配置 ──
AI_SERVICE_URL=http://127.0.0.1:8001
NODE_ENV=production
PORT=3000
`;

console.log('COS 集成指南已加载，请参考上方注释进行改造');
console.log('\n.env 文件模板:\n' + ENV_TEMPLATE);

module.exports = { ENV_TEMPLATE };
