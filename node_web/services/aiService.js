/**
 * AI 服务客户端
 * 封装对 python_ai 微服务的 HTTP 调用
 * 将所有 AI 相关的图片处理请求转发到 FastAPI 后端
 */

const axios = require('axios');
const FormData = require('form-data');
const { Readable } = require('stream');

// ============================================
// 配置
// ============================================

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8001';
const API_PREFIX = '/api/v1';

// axios 实例（带超时与重试）
const client = axios.create({
    baseURL: AI_SERVICE_URL,
    timeout: 120000, // 图片处理最长等待 2 分钟
    maxRedirects: 5,
});

// ★ 会员等级请求头注入
function tierHeaders(userTier) {
    return {
        'X-User-Tier': userTier || 'free',
        'X-Request-Source': 'photogongju-web',
    };
}

// ============================================
// 健康检查
// ============================================

async function healthCheck() {
    /**
     * 检查 AI 服务是否在线
     * 返回: { status, version, models_available }
     */
    const { data } = await client.get(`${API_PREFIX}/health`);
    return data;
}

// ============================================
// 上传图片到 AI 服务
// ============================================

async function uploadToAIService(fileBuffer, originalName, userTier = 'free') {
    /**
     * 将用户上传的图片转发给 AI 微服务
     * fileBuffer: Buffer — 文件二进制数据
     * originalName: string — 原始文件名
     * userTier: string — ★ 会员等级标识
     * 返回: { task_id, success, message, original }
     */
    const form = new FormData();
    form.append('file', fileBuffer, {
        filename: originalName,
        contentType: 'application/octet-stream',
    });

    const { data } = await client.post(`${API_PREFIX}/upload`, form, {
        headers: { ...form.getHeaders(), ...tierHeaders(userTier) },
    });

    // 将 task_id 存入 session 以便后续操作
    return data;
}

// ============================================
// 图片缩放
// ============================================

async function resizeImage(taskId, resizeParams, userTier = 'free') {
    /**
     * 缩放已上传的图片
     * resizeParams: { width?, height?, mode?, upscale?, background? }
     * userTier: string — ★ 会员等级
     */
    const { data } = await client.post(
        `${API_PREFIX}/resize/${taskId}`,
        resizeParams,
        { headers: tierHeaders(userTier) }
    );
    return data;
}

// ============================================
// 滤镜处理
// ============================================

async function applyFilter(taskId, filterParams, userTier = 'free') {
    /**
     * 对已上传的图片应用滤镜
     * filterParams: { filter_type, intensity, ... }
     */
    const { data } = await client.post(
        `${API_PREFIX}/filter/${taskId}`,
        filterParams,
        { headers: tierHeaders(userTier) }
    );
    return data;
}

// ============================================
// 水印添加
// ============================================

async function addWatermark(taskId, watermarkParams, watermarkFileBuffer = null, watermarkFileName = null, userTier = 'free') {
    // ★ 新增 userTier 参数
    const form = new FormData();

    Object.entries(watermarkParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            form.append(key, String(value));
        }
    });

    if (watermarkFileBuffer && watermarkFileName) {
        form.append('watermark_file', watermarkFileBuffer, {
            filename: watermarkFileName,
            contentType: 'application/octet-stream',
        });
    }

    const { data } = await client.post(
        `${API_PREFIX}/watermark/${taskId}`,
        form,
        { headers: { ...form.getHeaders(), ...tierHeaders(userTier) } }
    );
    return data;
}

// ============================================
// AI 背景去除
// ============================================

async function removeBackground(taskId, bgParams = {}, userTier = 'free') {
    // ★ 新增 userTier
    const { data } = await client.post(
        `${API_PREFIX}/remove-background/${taskId}`,
        bgParams,
        { headers: tierHeaders(userTier) }
    );
    return data;
}

// ============================================
// 批量流水线处理
// ============================================

async function runPipeline(taskId, pipelineParams, watermarkFileBuffer = null, watermarkFileName = null, userTier = 'free') {
    // ★ 新增 userTier
    const form = new FormData();

    // 如果没有水印文件，用 multipart 格式发送（FastAPI File 参数要求）
    if (!watermarkFileBuffer) {
        const form = new FormData();
        form.append('req', JSON.stringify(pipelineParams));
        const { data } = await client.post(
            `${API_PREFIX}/pipeline/${taskId}`,
            form,
            { headers: { ...form.getHeaders(), ...tierHeaders(userTier) } }
        );
        return data;
    }

    if (pipelineParams.resize) form.append('resize', JSON.stringify(pipelineParams.resize));
    if (pipelineParams.filter) form.append('filter', JSON.stringify(pipelineParams.filter));
    if (pipelineParams.watermark) form.append('watermark', JSON.stringify(pipelineParams.watermark));
    if (pipelineParams.remove_bg) form.append('remove_bg', JSON.stringify(pipelineParams.remove_bg));
    if (pipelineParams.output_format) form.append('output_format', pipelineParams.output_format);
    if (pipelineParams.quality) form.append('quality', String(pipelineParams.quality));

    if (watermarkFileBuffer && watermarkFileName) {
        form.append('watermark_file', watermarkFileBuffer, {
            filename: watermarkFileName,
            contentType: 'application/octet-stream',
        });
    }

    const { data } = await client.post(
        `${API_PREFIX}/pipeline/${taskId}`,
        form,
        { headers: { ...form.getHeaders(), ...tierHeaders(userTier) } }
    );
    return data;
}

// ============================================
// 获取下载链接
// ============================================

function getDownloadUrl(taskId) {
    /**
     * 构建处理结果的下载 URL
     */
    return `${AI_SERVICE_URL}${API_PREFIX}/download/${taskId}`;
}

// ============================================
// 获取图片信息
// ============================================

async function getImageInfo(taskId) {
    /**
     * 获取已上传图片的详细信息
     */
    const { data } = await client.get(`${API_PREFIX}/info/${taskId}`);
    return data;
}

// ============================================
// 尺寸库查询
// ============================================

async function getSizeLibrary(category = null, keyword = null) {
    /**
     * 获取图片尺寸预设库
     */
    const params = {};
    if (category) params.category = category;
    if (keyword) params.keyword = keyword;

    const { data } = await client.get(`${API_PREFIX}/size-library`, { params });
    return data;
}

async function recommendSize(taskId, topK = 5) {
    /**
     * 根据图片尺寸智能推荐预设
     */
    const { data } = await client.get(
        `${API_PREFIX}/size-library/recommend/${taskId}`,
        { params: { top_k: topK } }
    );
    return data;
}

// ============================================
// 导出
// ============================================

module.exports = {
    healthCheck,
    uploadToAIService,
    resizeImage,
    applyFilter,
    addWatermark,
    removeBackground,
    runPipeline,
    getDownloadUrl,
    getImageInfo,
    getSizeLibrary,
    recommendSize,
};
