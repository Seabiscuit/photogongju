/**
 * API 路由
 * 负责：接收前端请求 → 权限校验 → 转发给 python_ai 微服务 → 返回结果给前端
 * ★ 新增会员权限拦截：免费用户限制高清/批量/AI抠图/证件照尺寸
 */

const express = require('express');
const router = express.Router();
const path = require('path');

const aiService = require('../services/aiService');
const { requireFeature } = require('../middleware/auth'); // ★ 功能权限中间件
const membership = require('../models/membership');        // ★ 会员缓存

// ============================================
// 健康检查 (直接代理到 AI 服务)
// ============================================

router.get('/health', async (req, res) => {
    try {
        const health = await aiService.healthCheck();
        res.json({
            web_service: 'ok',
            ai_service: health.status,
            version: '1.0.0',
            models: health.models_available,
        });
    } catch (err) {
        res.status(503).json({
            web_service: 'ok',
            ai_service: 'offline',
            error: 'AI 微服务未启动，请先启动 python_ai 服务',
        });
    }
});

// ============================================
// 文件上传接口
// ============================================

router.post('/upload', async (req, res, next) => {
    /**
     * 接收用户上传的图片文件
     * 转发到 python_ai 微服务进行格式校验与存储
     * 返回 task_id 供后续处理使用
     */
    const upload = req.app.get('upload');

    upload.single('image')(req, res, async (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ error: '文件大小超过限制（最大 50MB）' });
            }
            return res.status(400).json({ error: err.message });
        }

        if (!req.file) {
            return res.status(400).json({ error: '请选择要上传的图片文件' });
        }

        try {
            // 转发到 AI 服务 ★ 携带会员等级
            const result = await aiService.uploadToAIService(
                req.file.buffer,
                req.file.originalname,
                req.userTier || 'free'
            );

            // 存储 task_id 到 session，方便后续操作
            if (!req.session.tasks) {
                req.session.tasks = [];
            }
            req.session.tasks.push(result.task_id);

            res.json(result);
        } catch (apiErr) {
            console.error('[ERROR] 上传转发失败:', apiErr.message);

            // 尝试提取 AI 服务返回的错误详情
            if (apiErr.response && apiErr.response.data) {
                return res.status(apiErr.response.status).json(apiErr.response.data);
            }

            res.status(502).json({
                error: 'AI 服务处理失败',
                detail: apiErr.message,
            });
        }
    });
});

// ============================================
// 图片缩放接口
// ============================================

router.post('/resize/:taskId', async (req, res) => {
    const { taskId } = req.params;

    // ★ 高清输出检测：免费用户缩放超过 1920px 需会员
    const targetW = parseInt(req.body.width) || 0;
    const targetH = parseInt(req.body.height) || 0;
    if ((targetW > 1920 || targetH > 1920) && !membership.hasPermission(req.userId, 'resize_hd')) {
        return res.status(403).json({
            error: '高清输出 (>1920px) 需要开通会员',
            code: 'FEATURE_LOCKED',
            feature: 'resize_hd',
            desc: '高清输出 (>1080p)',
            minTier: 'single_paid',
            redirect: '/membership',
        });
    }

    // ★ 证件照尺寸检测：free 用户不可选 visa/id 类别尺寸
    const presetName = req.body.preset_name || '';
    if ((presetName.startsWith('id_') || presetName.startsWith('visa_')) && !membership.hasPermission(req.userId, 'visa_size')) {
        return res.status(403).json({
            error: '证件照/签证尺寸功能需要开通会员',
            code: 'FEATURE_LOCKED',
            feature: 'visa_size',
            desc: '证件照/签证尺寸',
            minTier: 'single_paid',
            redirect: '/membership',
        });
    }

    try {
        const result = await aiService.resizeImage(taskId, req.body, req.userTier); // ★ 传递会员等级

        if (result.task_id && req.session.tasks) {
            req.session.tasks.push(result.task_id);
        }

        res.json(result);
    } catch (err) {
        handleAIError(err, res);
    }
});

// ============================================
// 滤镜接口
// ============================================

router.post('/filter/:taskId', async (req, res) => {
    const { taskId } = req.params;

    try {
        const result = await aiService.applyFilter(taskId, req.body, req.userTier); // ★ 传递会员等级

        if (result.task_id && req.session.tasks) {
            req.session.tasks.push(result.task_id);
        }

        res.json(result);
    } catch (err) {
        handleAIError(err, res);
    }
});

// ============================================
// 水印接口
// ============================================

router.post('/watermark/:taskId', async (req, res, next) => {
    /**
     * 水印添加
     * ★ 免费用户仅允许文字水印；图片Logo水印和平铺水印需会员
     */
    const { taskId } = req.params;

    // 如果请求中有文件（图片水印模式），使用 multer 解析
    const upload = req.app.get('upload');

    upload.single('watermark_image')(req, res, async (err) => {
        if (err) {
            return res.status(400).json({ error: err.message });
        }

        try {
            const wmType = req.body.type || 'text';

            // ★ 图片 Logo 水印权限检查
            if (wmType === 'image' && !membership.hasPermission(req.userId, 'watermark_image')) {
                return res.status(403).json({
                    error: '图片 Logo 水印功能需要开通会员',
                    code: 'FEATURE_LOCKED',
                    feature: 'watermark_image',
                    desc: '图片 Logo 水印',
                    minTier: 'single_paid',
                    redirect: '/membership',
                });
            }

            // ★ 平铺水印权限检查
            if (wmType === 'tile' && !membership.hasPermission(req.userId, 'watermark_tile')) {
                return res.status(403).json({
                    error: '平铺水印功能需要开通会员',
                    code: 'FEATURE_LOCKED',
                    feature: 'watermark_tile',
                    desc: '平铺水印',
                    minTier: 'single_paid',
                    redirect: '/membership',
                });
            }

            const watermarkParams = {
                type: wmType,
                position: req.body.position || 'bottom_right',
                margin_x: parseInt(req.body.margin_x) || 20,
                margin_y: parseInt(req.body.margin_y) || 20,
                rotation: parseFloat(req.body.rotation) || 0,
                text: req.body.text || null,
                font_size: parseInt(req.body.font_size) || 36,
                font_color: req.body.font_color || '#FFFFFF',
                text_opacity: parseFloat(req.body.text_opacity) || 0.5,
                image_opacity: parseFloat(req.body.image_opacity) || 0.7,
                image_scale: parseFloat(req.body.image_scale) || 0.2,
            };

            const watermarkFileBuffer = req.file ? req.file.buffer : null;
            const watermarkFileName = req.file ? req.file.originalname : null;

            const result = await aiService.addWatermark(
                taskId,
                watermarkParams,
                watermarkFileBuffer,
                watermarkFileName,
                req.userTier // ★ 传递会员等级
            );

            if (result.task_id && req.session.tasks) {
                req.session.tasks.push(result.task_id);
            }

            res.json(result);
        } catch (apiErr) {
            handleAIError(apiErr, res);
        }
    });
});

// ============================================
// AI 背景去除接口
// ★ 免费用户不可用，需 single_paid 及以上
// ============================================

router.post('/remove-background/:taskId', requireFeature('remove_background'), async (req, res) => {
    const { taskId } = req.params;

    try {
        const result = await aiService.removeBackground(taskId, req.body, req.userTier); // ★ 传递会员等级

        if (result.task_id && req.session.tasks) {
            req.session.tasks.push(result.task_id);
        }

        res.json(result);
    } catch (err) {
        handleAIError(err, res);
    }
});

// ============================================
// 批量流水线处理接口
// ★ 免费用户不可用，需 single_paid 及以上
// ============================================

router.post('/pipeline/:taskId', requireFeature('pipeline'), async (req, res, next) => {
    /**
     * 流水线批量处理
     * 支持 multipart（有水印文件时）和 JSON（纯参数）
     */
    const { taskId } = req.params;

    const upload = req.app.get('upload');

    upload.single('watermark_image')(req, res, async (err) => {
        if (err) {
            return res.status(400).json({ error: err.message });
        }

        try {
            // 构建 pipeline 参数
            const pipelineParams = {};

            // 如果是以 JSON body 发送（Content-Type: application/json）
            if (req.is('application/json') || (!req.file && req.body && req.body.resize === undefined && req.body.filter_type)) {
                // 已经是完整的 pipeline 对象
                Object.assign(pipelineParams, req.body);
            } else {
                // multipart 模式，逐步解析
                if (req.body.resize) {
                    pipelineParams.resize = typeof req.body.resize === 'string'
                        ? JSON.parse(req.body.resize)
                        : req.body.resize;
                }
                if (req.body.filter) {
                    pipelineParams.filter = typeof req.body.filter === 'string'
                        ? JSON.parse(req.body.filter)
                        : req.body.filter;
                }
                if (req.body.watermark) {
                    pipelineParams.watermark = typeof req.body.watermark === 'string'
                        ? JSON.parse(req.body.watermark)
                        : req.body.watermark;
                }
                if (req.body.remove_bg) {
                    pipelineParams.remove_bg = typeof req.body.remove_bg === 'string'
                        ? JSON.parse(req.body.remove_bg)
                        : req.body.remove_bg;
                }
                pipelineParams.output_format = req.body.output_format || 'png';
                pipelineParams.quality = parseInt(req.body.quality) || 85;
            }

            const watermarkFileBuffer = req.file ? req.file.buffer : null;
            const watermarkFileName = req.file ? req.file.originalname : null;

            const result = await aiService.runPipeline(
                taskId,
                pipelineParams,
                watermarkFileBuffer,
                watermarkFileName,
                req.userTier // ★ 传递会员等级
            );

            if (result.task_id && req.session.tasks) {
                req.session.tasks.push(result.task_id);
            }

            res.json(result);
        } catch (apiErr) {
            handleAIError(apiErr, res);
        }
    });
});

// ============================================
// 获取处理结果（代理下载）
// ============================================

router.get('/download/:taskId', async (req, res) => {
    /**
     * 代理 AI 服务的下载链接
     * 直接将图片流返回给客户端
     */
    const { taskId } = req.params;
    const axios = require('axios');
    const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8001';

    try {
        const response = await axios.get(
            `${AI_SERVICE_URL}/api/v1/download/${taskId}`,
            { responseType: 'stream' }
        );

        // 透传 Content-Type 头部
        res.setHeader('Content-Type', response.headers['content-type']);
        res.setHeader('Content-Disposition', response.headers['content-disposition'] || `attachment; filename="result_${taskId}"`);

        response.data.pipe(res);
    } catch (err) {
        if (err.response && err.response.status === 404) {
            return res.status(404).json({ error: '处理结果不存在或已过期' });
        }
        console.error('[ERROR] 下载代理失败:', err.message);
        res.status(502).json({ error: '下载失败，AI 服务异常' });
    }
});

// ============================================
// 尺寸库接口
// ============================================

router.get('/size-library', async (req, res) => {
    try {
        const { category, keyword } = req.query;
        const data = await aiService.getSizeLibrary(category, keyword);
        res.json(data);
    } catch (err) {
        handleAIError(err, res);
    }
});

// ============================================
// 尺寸推荐接口
// ============================================

router.get('/size-recommend/:taskId', async (req, res) => {
    const { taskId } = req.params;
    const topK = parseInt(req.query.top_k) || 5;

    try {
        const data = await aiService.recommendSize(taskId, topK);
        res.json(data);
    } catch (err) {
        handleAIError(err, res);
    }
});

// ============================================
// 获取图片信息
// ============================================

router.get('/info/:taskId', async (req, res) => {
    const { taskId } = req.params;

    try {
        const data = await aiService.getImageInfo(taskId);
        res.json(data);
    } catch (err) {
        handleAIError(err, res);
    }
});

// ============================================
// 获取用户当前 session 的任务列表
// ============================================

router.get('/my-tasks', (req, res) => {
    const tasks = req.session.tasks || [];
    res.json({
        tasks: tasks.slice(-20), // 最近 20 个任务
        total: tasks.length,
    });
});

// ============================================
// 图片代理端点 — 从 Python AI 服务获取原始/处理图片
// ============================================

router.get('/proxy-image/:taskId', async (req, res) => {
    const { taskId } = req.params;
    const axios = require('axios');
    const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8001';

    try {
        const response = await axios.get(
            `${AI_SERVICE_URL}/api/v1/download/${taskId}`,
            { responseType: 'stream', timeout: 30000 }
        );
        res.setHeader('Content-Type', response.headers['content-type']);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        response.data.pipe(res);
    } catch (err) {
        if (err.response && err.response.status === 404) {
            return res.status(404).send('Image not found');
        }
        console.error('[ERROR] 图片代理失败:', err.message);
        res.status(502).send('Image proxy error');
    }
});

// ============================================
// ★ 证件照快捷生成端点（Python 端自动降级：AI抠图→简单背景替换→纯缩放）
// ============================================

router.post('/id-photo/:taskId', async (req, res) => {
    const { taskId } = req.params;
    const { width, height, background, label } = req.body;

    if (!width || !height) {
        return res.status(400).json({ error: '请指定证件照尺寸' });
    }

    const bgColor = background || '#FFFFFF';

    try {
        const result = await aiService.runPipeline(taskId, {
            remove_bg: { model: 'rmbg_onnx', alpha_matting: false, foreground_bias: 0.15, morph_cleanup: true },
            resize: {
                width: parseInt(width),
                height: parseInt(height),
                mode: 'cover',  // ★ cover 裁剪填充，消除透明边框产生的背景条
                background: bgColor,
                upscale: true,
            },
            output_format: 'jpg',
            quality: 95,
        }, null, null, req.userTier || 'free');

        // 标记是否使用了 AI
        return res.json({
            ...result,
            ai_bg_removed: result.message?.includes('AI') || result.message?.includes('流水线'),
        });
    } catch (pipelineErr) {
        return handleAIError(pipelineErr, res);
    }
});

// ============================================
// 错误处理辅助函数
// ============================================

function handleAIError(err, res) {
    /**
     * 统一处理 AI 服务返回的错误
     */
    console.error('[ERROR] AI 服务调用失败:', err.message);

    if (err.response) {
        // AI 服务返回了错误响应
        const status = err.response.status;
        const detail = err.response.data;

        if (status === 404) {
            return res.status(404).json({
                error: '未找到对应的图片或处理结果',
                detail: detail.detail || '请先上传图片',
            });
        }

        if (status === 503) {
            return res.status(503).json({
                error: 'AI 模型不可用',
                detail: detail.detail || '请先下载所需的模型文件',
            });
        }

        return res.status(status).json(detail);
    }

    if (err.code === 'ECONNREFUSED') {
        return res.status(502).json({
            error: 'AI 微服务未启动',
            detail: '请确认 python_ai 服务正在运行 (python_ai/main.py)',
        });
    }

    if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') {
        return res.status(504).json({
            error: 'AI 服务响应超时',
            detail: '图片处理时间过长，请尝试缩小图片尺寸',
        });
    }

    res.status(500).json({
        error: '内部服务器错误',
        detail: process.env.NODE_ENV === 'production' ? null : err.message,
    });
}

module.exports = router;
