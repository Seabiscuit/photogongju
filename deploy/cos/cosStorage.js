/**
 * 腾讯 COS（对象存储）集成模块
 *
 * 用途：将用户上传图片转存至云端，降低服务器存储压力
 * 改造范围：替换本地文件系统读写 → COS 对象存储读写
 *
 * 对接方式：
 *   1. 安装 SDK: npm install cos-nodejs-sdk-v5
 *   2. 在 .env 中配置 COS 密钥
 *   3. 在 node_web/services/ 中 import 本模块
 *   4. 替换原 fs.writeFile / fs.readFile 调用
 *
 * 安全注意事项：
 *   - SecretId/SecretKey 务必放在环境变量中，不要硬编码
 *   - 建议使用临时密钥（STS）而非永久密钥
 *   - 上传文件设置为私有读写，通过预签名 URL 对外提供访问
 */

const path = require('path');
const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════
// COS 配置（从环境变量读取）
// ═══════════════════════════════════════════════════════════

const COS_CONFIG = {
    // 存储桶所在地域（如 ap-guangzhou, ap-beijing, ap-shanghai）
    Region: process.env.COS_REGION || 'ap-guangzhou',

    // 存储桶名称（格式: BucketName-APPID）
    Bucket: process.env.COS_BUCKET || 'photogongju-1234567890',

    // 密钥（强烈建议使用子账号密钥，权限最小化）
    SecretId: process.env.COS_SECRET_ID || '',
    SecretKey: process.env.COS_SECRET_KEY || '',

    // 是否使用临时密钥（推荐生产环境使用 STS）
    UseSTS: process.env.COS_USE_STS === 'true',

    // CDN 加速域名（可选，用于公开访问）
    CdnDomain: process.env.COS_CDN_DOMAIN || '',

    // 文件夹前缀
    Prefix: {
        uploads: 'uploads/',        // 用户上传原图
        outputs: 'outputs/',        // 处理结果
        watermarks: 'watermarks/',  // 水印素材
        avatars: 'avatars/',        // 用户头像
    },
};

// ═══════════════════════════════════════════════════════════
// COS SDK 懒加载（避免未安装 SDK 时启动报错）
// ═══════════════════════════════════════════════════════════

let COS = null;
let cosClient = null;

function getCOSClient() {
    if (cosClient) return cosClient;

    try {
        COS = require('cos-nodejs-sdk-v5');
    } catch (e) {
        console.error('[COS] cos-nodejs-sdk-v5 未安装。请运行: npm install cos-nodejs-sdk-v5');
        throw new Error('COS SDK 未安装');
    }

    if (!COS_CONFIG.SecretId || !COS_CONFIG.SecretKey) {
        console.warn('[COS] 密钥未配置，回退到本地存储模式');
        return null;
    }

    cosClient = new COS({
        SecretId: COS_CONFIG.SecretId,
        SecretKey: COS_CONFIG.SecretKey,
        // 使用内网域名（同地域服务器免流量费）
        Domain: '{Bucket}.cos-internal.{Region}.tencentcos.cn',
    });

    console.log('[COS] 客户端初始化成功, 存储桶:', COS_CONFIG.Bucket);
    return cosClient;
}

// ═══════════════════════════════════════════════════════════
// 核心 API — 文件上传
// ═══════════════════════════════════════════════════════════

/**
 * 上传文件到 COS
 * @param {Buffer|string} fileData - 文件二进制数据或本地路径
 * @param {string} remoteKey  - COS 对象键名（如 uploads/2024/abc123.jpg）
 * @param {object} options    - 可选配置
 * @returns {Promise<object>} - { url, key, etag, location }
 */
async function uploadFile(fileData, remoteKey, options = {}) {
    const client = getCOSClient();
    if (!client) {
        // 回退：保存到本地
        return fallbackLocalSave(fileData, remoteKey);
    }

    const body = Buffer.isBuffer(fileData)
        ? fileData
        : require('fs').readFileSync(fileData);

    return new Promise((resolve, reject) => {
        client.putObject(
            {
                Bucket: COS_CONFIG.Bucket,
                Region: COS_CONFIG.Region,
                Key: remoteKey,
                Body: body,
                ContentType: options.contentType || 'image/png',
                // 私有读写（通过预签名 URL 对外提供访问）
                ACL: options.isPublic ? 'public-read' : 'private',
                // 存储类型：标准存储
                StorageClass: options.storageClass || 'STANDARD',
                // 自定义元数据（可用于记录上传者信息）
                Metadata: {
                    'uploaded-by': options.userId || 'anonymous',
                    'upload-time': new Date().toISOString(),
                    ...(options.metadata || {}),
                },
                // 上传进度回调
                onProgress: (progressData) => {
                    if (options.onProgress) {
                        options.onProgress(progressData);
                    }
                },
            },
            (err, data) => {
                if (err) {
                    console.error('[COS] 上传失败:', err.message);
                    // 上传失败时回退到本地存储
                    return fallbackLocalSave(fileData, remoteKey)
                        .then(resolve)
                        .catch(reject);
                }

                const result = {
                    url: data.Location,
                    key: remoteKey,
                    etag: data.ETag,
                    location: data.Location,
                    // 生成 CDN 访问地址（如已配置）
                    cdnUrl: COS_CONFIG.CdnDomain
                        ? `https://${COS_CONFIG.CdnDomain}/${remoteKey}`
                        : data.Location,
                };

                resolve(result);
            }
        );
    });
}

/**
 * 上传用户图片（自动按日期分文件夹）
 * @param {Buffer} fileBuffer - 图片数据
 * @param {string} originalName - 原始文件名
 * @param {string} userId - 用户标识
 * @returns {Promise<object>}
 */
async function uploadUserImage(fileBuffer, originalName, userId = 'anonymous') {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '/'); // 2024/06/25
    const hash = crypto.createHash('md5').update(fileBuffer).digest('hex').slice(0, 12);
    const ext = path.extname(originalName).toLowerCase() || '.png';
    const remoteKey = `${COS_CONFIG.Prefix.uploads}${dateStr}/${hash}${ext}`;

    return uploadFile(fileBuffer, remoteKey, {
        contentType: getContentType(ext),
        isPublic: false, // 原图私有，防止泄露
        userId,
        metadata: {
            'original-name': Buffer.from(originalName, 'utf8').toString('base64'),
            'file-size': String(fileBuffer.length),
        },
    });
}

/**
 * 上传处理结果（可公开访问）
 * @param {Buffer} fileBuffer - 结果图片
 * @param {string} taskId - 任务 ID
 * @returns {Promise<object>}
 */
async function uploadResult(fileBuffer, taskId) {
    const remoteKey = `${COS_CONFIG.Prefix.outputs}${taskId}.png`;
    return uploadFile(fileBuffer, remoteKey, {
        contentType: 'image/png',
        isPublic: true, // 处理结果可公开访问
    });
}

// ═══════════════════════════════════════════════════════════
// 核心 API — 文件下载 / 读取
// ═══════════════════════════════════════════════════════════

/**
 * 从 COS 下载文件到内存
 * @param {string} remoteKey - COS 对象键名
 * @returns {Promise<Buffer>}
 */
async function downloadFile(remoteKey) {
    const client = getCOSClient();
    if (!client) {
        return fallbackLocalRead(remoteKey);
    }

    return new Promise((resolve, reject) => {
        client.getObject(
            {
                Bucket: COS_CONFIG.Bucket,
                Region: COS_CONFIG.Region,
                Key: remoteKey,
            },
            (err, data) => {
                if (err) {
                    console.error('[COS] 下载失败:', err.message);
                    return fallbackLocalRead(remoteKey)
                        .then(resolve)
                        .catch(reject);
                }
                resolve(data.Body);
            }
        );
    });
}

/**
 * 获取文件流（用于直接返回给客户端）
 * @param {string} remoteKey
 * @returns {Promise<Stream>}
 */
async function getFileStream(remoteKey) {
    const client = getCOSClient();
    if (!client) return null;

    return new Promise((resolve, reject) => {
        client.getObject(
            {
                Bucket: COS_CONFIG.Bucket,
                Region: COS_CONFIG.Region,
                Key: remoteKey,
            },
            (err, data) => {
                if (err) return reject(err);
                resolve(data.Body);
            }
        );
    });
}

// ═══════════════════════════════════════════════════════════
// 核心 API — 预签名 URL（私有文件临时访问）
// ═══════════════════════════════════════════════════════════

/**
 * 生成预签名下载 URL（有效期 10 分钟）
 * 用于私有文件（如用户上传原图）的临时安全访问
 * @param {string} remoteKey
 * @param {number} expires - 过期时间（秒），默认 600
 * @returns {string}
 */
function getPresignedUrl(remoteKey, expires = 600) {
    const client = getCOSClient();
    if (!client) {
        // 回退：返回本地URL
        return `/uploads/${path.basename(remoteKey)}`;
    }

    return client.getObjectUrl(
        {
            Bucket: COS_CONFIG.Bucket,
            Region: COS_CONFIG.Region,
            Key: remoteKey,
            Sign: true,
            Expires: expires,
        }
    );
}

/**
 * 获取 CDN 地址（公开文件使用）
 * @param {string} remoteKey
 * @returns {string}
 */
function getCdnUrl(remoteKey) {
    if (COS_CONFIG.CdnDomain) {
        return `https://${COS_CONFIG.CdnDomain}/${remoteKey}`;
    }
    // 无 CDN 时使用 COS 默认域名
    return `https://${COS_CONFIG.Bucket}.cos.${COS_CONFIG.Region}.myqcloud.com/${remoteKey}`;
}

// ═══════════════════════════════════════════════════════════
// 核心 API — 文件管理
// ═══════════════════════════════════════════════════════════

/**
 * 删除 COS 上的文件
 * @param {string} remoteKey
 * @returns {Promise<void>}
 */
async function deleteFile(remoteKey) {
    const client = getCOSClient();
    if (!client) {
        // 回退：删除本地文件
        const localPath = path.join(require('../config').UPLOAD_DIR, path.basename(remoteKey));
        require('fs').unlink(localPath, () => {});
        return;
    }

    return new Promise((resolve) => {
        client.deleteObject(
            {
                Bucket: COS_CONFIG.Bucket,
                Region: COS_CONFIG.Region,
                Key: remoteKey,
            },
            (err) => {
                if (err) console.error('[COS] 删除失败:', err.message);
                resolve();
            }
        );
    });
}

/**
 * 批量删除文件
 * @param {string[]} remoteKeys
 * @returns {Promise<void>}
 */
async function deleteFiles(remoteKeys) {
    const client = getCOSClient();
    if (!client) return;

    return new Promise((resolve) => {
        client.deleteMultipleObject(
            {
                Bucket: COS_CONFIG.Bucket,
                Region: COS_CONFIG.Region,
                Objects: remoteKeys.map(key => ({ Key: key })),
            },
            (err) => {
                if (err) console.error('[COS] 批量删除失败:', err.message);
                resolve();
            }
        );
    });
}

/**
 * 检查文件是否存在
 * @param {string} remoteKey
 * @returns {Promise<boolean>}
 */
async function fileExists(remoteKey) {
    const client = getCOSClient();
    if (!client) {
        const localPath = path.join(require('../config').UPLOAD_DIR, path.basename(remoteKey));
        return require('fs').existsSync(localPath);
    }

    return new Promise((resolve) => {
        client.headObject(
            {
                Bucket: COS_CONFIG.Bucket,
                Region: COS_CONFIG.Region,
                Key: remoteKey,
            },
            (err) => {
                resolve(!err);
            }
        );
    });
}

// ═══════════════════════════════════════════════════════════
// 定时清理 — COS 生命周期规则 (在 COS 控制台配置更推荐)
// ═══════════════════════════════════════════════════════════

/**
 * 清理过期文件（超过指定天数）
 * 注意：COS 控制台中直接配置生命周期规则更高效、省钱
 * 腾讯云 COS 控制台 → 存储桶 → 基础配置 → 生命周期
 * 建议规则：uploads/ 前缀 → 7天后自动删除
 *
 * 本函数仅用于没有 COS 控制台权限时的兜底方案
 * @param {string} prefix - 对象键前缀
 * @param {number} days - 保留天数
 */
async function cleanupExpiredFiles(prefix, days) {
    const client = getCOSClient();
    if (!client) return;

    const cutoff = Date.now() - days * 86400000;
    const toDelete = [];

    // 列出所有文件（最多 1000 个）
    await new Promise((resolve) => {
        client.getBucket(
            {
                Bucket: COS_CONFIG.Bucket,
                Region: COS_CONFIG.Region,
                Prefix: prefix,
                MaxKeys: 1000,
            },
            (err, data) => {
                if (err) {
                    console.error('[COS] 列出文件失败:', err.message);
                    return resolve();
                }

                for (const obj of data.Contents || []) {
                    const mtime = new Date(obj.LastModified).getTime();
                    if (mtime < cutoff) {
                        toDelete.push(obj.Key);
                    }
                }
                resolve();
            }
        );
    });

    if (toDelete.length > 0) {
        await deleteFiles(toDelete);
        console.log(`[COS] 清理了 ${toDelete.length} 个过期文件 (${prefix}, >${days}天)`);
    }
}

// ═══════════════════════════════════════════════════════════
// 回退方案 — 本地存储（COS 不可用时自动切换）
// ═══════════════════════════════════════════════════════════

const fs = require('fs');

async function fallbackLocalSave(fileData, remoteKey) {
    const config = require('../../config');
    const localPath = path.join(config.UPLOAD_DIR || '/tmp/photogongju/uploads', path.basename(remoteKey));
    const dir = path.dirname(localPath);

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const buffer = Buffer.isBuffer(fileData) ? fileData : fs.readFileSync(fileData);
    fs.writeFileSync(localPath, buffer);

    console.log('[COS] 已回退到本地存储:', localPath);
    return {
        url: `/uploads/${path.basename(remoteKey)}`,
        key: remoteKey,
        localPath,
    };
}

async function fallbackLocalRead(remoteKey) {
    const config = require('../../config');
    const localPath = path.join(config.UPLOAD_DIR || '/tmp/photogongju/uploads', path.basename(remoteKey));

    if (!fs.existsSync(localPath)) {
        throw new Error(`文件不存在: ${localPath}`);
    }
    return fs.readFileSync(localPath);
}

// ═══════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════

function getContentType(ext) {
    const types = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.bmp': 'image/bmp',
        '.svg': 'image/svg+xml',
        '.pdf': 'application/pdf',
    };
    return types[ext] || 'application/octet-stream';
}

// ═══════════════════════════════════════════════════════════
// 导出
// ═══════════════════════════════════════════════════════════

module.exports = {
    // 配置
    COS_CONFIG,

    // 核心上传/下载
    uploadFile,
    uploadUserImage,
    uploadResult,
    downloadFile,
    getFileStream,

    // URL 管理
    getPresignedUrl,
    getCdnUrl,

    // 文件管理
    deleteFile,
    deleteFiles,
    fileExists,
    cleanupExpiredFiles,

    // 状态检查
    isAvailable: () => !!getCOSClient(),
};
