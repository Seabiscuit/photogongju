/**
 * PhotoGongju 前端交互逻辑
 * 功能：文件拖拽上传、图片预览、处理参数配置、API 调用
 * ★ 新增：会员状态检测、免费用户功能锁定
 */

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════
    // ★ 语言切换
    // ═══════════════════════════════════════════════════

    window.switchLang = function (lang) {
        // 设置 Cookie（有效期 365 天），刷新页面生效
        const d = new Date();
        d.setFullYear(d.getFullYear() + 1);
        document.cookie = 'lang=' + lang + ';path=/;expires=' + d.toUTCString() + ';SameSite=Lax';
        location.reload();
    };

    // ═══════════════════════════════════════════════════
    // ★ 会员状态管理
    // ═══════════════════════════════════════════════════

    let MEMBER_STATE = { tier: 'free', isVip: false, restrictions: [] };

    /** 从服务端获取会员状态 */
    async function loadMemberState() {
        try {
            const res = await fetch('/api/membership/status');
            const data = await res.json();
            if (data.success) {
                MEMBER_STATE = {
                    tier: data.tier,
                    isVip: data.isVip,
                    tierLabel: data.tierLabel,
                    expireDesc: data.expireDesc,
                };
            }
        } catch (e) {
            // 静默失败，默认为 free
        }
        applyPermissionUI();
    }

    /** 根据会员状态更新 UI：锁定受限按钮、显示锁图标 */
    function applyPermissionUI() {
        if (MEMBER_STATE.isVip) return; // VIP 用户全部解锁

        // 加载权限限制列表
        fetch('/api/membership/restrictions')
            .then(r => r.json())
            .then(data => {
                if (!data.restrictions) return;
                const lockedFeatures = new Set(data.restrictions.map(r => r.key));

                // AI 背景去除按钮
                const removeBgBtn = document.getElementById('removeBgBtn');
                if (removeBgBtn && lockedFeatures.has('remove_background')) {
                    lockButton(removeBgBtn, 'AI 背景去除');
                }

                // 流水线按钮
                const pipelineBtn = document.getElementById('pipelineBtn');
                if (pipelineBtn && lockedFeatures.has('pipeline')) {
                    lockButton(pipelineBtn, '批量流水线');
                }

                // 图片水印配置区
                if (lockedFeatures.has('watermark_image') || lockedFeatures.has('watermark_tile')) {
                    const wmTypeSelect = document.getElementById('watermarkType');
                    if (wmTypeSelect) {
                        // 禁用 image 和 tile 选项
                        Array.from(wmTypeSelect.options).forEach(opt => {
                            if ((opt.value === 'image' && lockedFeatures.has('watermark_image')) ||
                                (opt.value === 'tile' && lockedFeatures.has('watermark_tile'))) {
                                opt.text += ' (需会员)';
                            }
                        });
                    }
                }

                // 证件照尺寸提示
                if (lockedFeatures.has('visa_size')) {
                    const resizeMode = document.getElementById('resizeMode');
                    if (resizeMode) {
                        // 在缩放区添加提示
                        const hint = document.createElement('span');
                        hint.className = 'restriction-tag-sm';
                        hint.textContent = '证件照/签证尺寸需会员';
                        hint.style.cssText = 'margin-left:8px;font-size:0.78rem;';
                        const group = resizeMode.closest('.process-group');
                        if (group) group.appendChild(hint);
                    }
                }
            })
            .catch(() => {});
    }

    /** 锁定按钮：禁用 + 显示锁图标 + 点击跳转会员页 */
    function lockButton(btn, featureName) {
        btn.disabled = true;
        btn.title = featureName + ' - 需开通会员';
        const origText = btn.textContent;
        btn.textContent = '🔒 ' + origText;
        btn.style.opacity = '0.6';
        btn.style.cursor = 'not-allowed';
        // 点击跳转到会员页
        btn.addEventListener('click', function handler(e) {
            e.preventDefault();
            e.stopPropagation();
            if (confirm(featureName + ' 需要开通会员，是否前往开通？')) {
                window.location.href = '/membership';
            }
        }, true);
    }

    // 页面加载时初始化
    loadMemberState();

    // ============================================
    // DOM 元素引用
    // ============================================
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');
    const preview = document.getElementById('preview');
    const uploadProgress = document.getElementById('uploadProgress');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const uploadBtn = document.getElementById('uploadBtn');
    const uploadPlaceholder = document.querySelector('.upload-placeholder');

    const resizeBtn = document.getElementById('resizeBtn');
    const filterBtn = document.getElementById('filterBtn');
    const watermarkBtn = document.getElementById('watermarkBtn');
    const removeBgBtn = document.getElementById('removeBgBtn');
    const pipelineBtn = document.getElementById('pipelineBtn');

    const resultNotification = document.getElementById('resultNotification');
    const notificationText = document.getElementById('notificationText');
    const notificationIcon = document.getElementById('notificationIcon');
    const viewResultBtn = document.getElementById('viewResultBtn');

    // ============================================
    // 全局状态
    // ============================================
    let currentTaskId = null;
    let selectedFile = null;

    // ═══════════════════════════════════════════════════
    // 证件照快捷生成状态
    // ═══════════════════════════════════════════════════
    let quickPreset = {
        width: null,
        height: null,
        label: null,
        bgColor: '#FFFFFF',
        bgName: '白色',
    };

    // ═══════════════════════════════════════════════════
    // 证件照快捷预设按钮
    // ═══════════════════════════════════════════════════
    const quickPresets = document.getElementById('quickPresets');
    const quickGenerateBtn = document.getElementById('quickGenerateBtn');
    const quickPresetsStatus = document.getElementById('quickPresetsStatus');
    const processPlaceholder = document.getElementById('processPlaceholder');

    // 尺寸选择
    document.querySelectorAll('.preset-size').forEach(btn => {
        btn.addEventListener('click', () => {
            // 切换 active
            document.querySelectorAll('.preset-size').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            quickPreset.width = parseInt(btn.dataset.width);
            quickPreset.height = parseInt(btn.dataset.height);
            quickPreset.label = btn.dataset.label;

            // 同步到缩放表单
            const wEl = document.getElementById('resizeWidth');
            const hEl = document.getElementById('resizeHeight');
            if (wEl) wEl.value = quickPreset.width;
            if (hEl) hEl.value = quickPreset.height;

            // 更新模式为等比适应
            const modeEl = document.getElementById('resizeMode');
            if (modeEl) modeEl.value = 'fit';

            updateQuickGenerateBtn();
        });
    });

    // 背景色选择
    document.querySelectorAll('.preset-bg').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.preset-bg').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            quickPreset.bgColor = btn.dataset.bg;
            quickPreset.bgName = btn.dataset.bgName;
            updateQuickGenerateBtn();
        });
    });

    function updateQuickGenerateBtn() {
        if (quickGenerateBtn && currentTaskId && quickPreset.width && quickPreset.height) {
            quickGenerateBtn.disabled = false;
            quickGenerateBtn.textContent = '🚀 一键生成' + quickPreset.label + '证件照 (' + quickPreset.bgName + '背景)';
            if (quickPresetsStatus) quickPresetsStatus.textContent = '';
        } else if (quickGenerateBtn && currentTaskId && (!quickPreset.width || !quickPreset.height)) {
            quickGenerateBtn.disabled = true;
            quickGenerateBtn.textContent = '🚀 一键生成证件照（请先选择尺寸）';
        }
    }

    // 一键生成按钮
    if (quickGenerateBtn) {
        quickGenerateBtn.addEventListener('click', async () => {
            if (!currentTaskId) {
                showNotification('error', '请先上传图片');
                return;
            }
            if (!quickPreset.width || !quickPreset.height) {
                showNotification('error', '请先选择证件照尺寸');
                return;
            }

            quickGenerateBtn.disabled = true;
            quickGenerateBtn.textContent = '⏳ 生成中...';
            if (quickPresetsStatus) quickPresetsStatus.textContent = '正在智能抠图并生成' + quickPreset.label + '证件照...';

            try {
                // ★ 使用专用证件照生成端点：抠图去背景 → 缩放到目标尺寸填充背景色
                const params = {
                    width: quickPreset.width,
                    height: quickPreset.height,
                    background: quickPreset.bgColor,
                    label: quickPreset.label,
                };

                const res = await fetch(`/api/id-photo/${currentTaskId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(params),
                });
                const data = await res.json();

                if (res.ok && data.task_id) {
                    currentTaskId = data.task_id;
                    showNotification('success',
                        '✅ ' + quickPreset.label + '证件照生成成功！(' + quickPreset.bgName + '背景)',
                        data.task_id);
                    if (quickPresetsStatus) {
                        quickPresetsStatus.innerHTML = '<span style="color:#10b981">✅ 生成成功！' +
                            '<a href="/result/' + data.task_id + '" style="margin-left:8px">查看结果 →</a></span>';
                    }
                } else {
                    // ★ 如果是抠图功能需要会员，给出友好提示
                    const errMsg = data.error || data.detail || '生成失败';
                    showNotification('error', errMsg);
                    if (quickPresetsStatus) {
                        if (data.code === 'FEATURE_LOCKED' || errMsg.includes('会员')) {
                            quickPresetsStatus.innerHTML = '<span style="color:#f59e0b">⚠️ AI抠图换背景需要开通会员，'
                                + '<a href="/membership" style="margin-left:4px">立即开通 →</a></span>';
                        } else if (errMsg.includes('模型') || errMsg.includes('未下载')) {
                            quickPresetsStatus.innerHTML = '<span style="color:#f59e0b">⚠️ AI模型未安装，'
                                + '请先下载模型文件 (python_ai/weights/)</span>';
                        } else {
                            quickPresetsStatus.innerHTML = '<span class="error-msg">❌ ' + errMsg + '</span>';
                        }
                    }
                }
            } catch (err) {
                showNotification('error', '请求失败: ' + err.message);
                if (quickPresetsStatus) {
                    quickPresetsStatus.innerHTML = '<span class="error-msg">❌ 网络错误，请重试</span>';
                }
            }

            quickGenerateBtn.disabled = false;
            updateQuickGenerateBtn();
        });
    }

    // ============================================
    // 上传区域交互
    // ============================================
    if (uploadZone) {
        // 点击上传区域
        uploadZone.addEventListener('click', () => fileInput.click());

        // 拖拽事件
        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('drag-over');
        });
        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('drag-over');
        });
        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                handleFileSelect(files[0]);
            }
        });

        // 文件选择
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                handleFileSelect(fileInput.files[0]);
            }
        });
    }

    /**
     * 处理文件选择：显示预览、启用上传按钮
     */
    function handleFileSelect(file) {
        // 检查文件类型
        const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff', 'image/gif'];
        if (!validTypes.includes(file.type)) {
            showNotification('error', '请选择图片文件（JPG/PNG/WEBP/BMP）');
            return;
        }

        // 检查文件大小
        if (file.size > 50 * 1024 * 1024) {
            showNotification('error', '文件大小不能超过 50MB');
            return;
        }

        selectedFile = file;

        // 预览
        const reader = new FileReader();
        reader.onload = (e) => {
            preview.src = e.target.result;
            preview.style.display = 'block';
            if (uploadPlaceholder) uploadPlaceholder.style.display = 'none';
        };
        reader.readAsDataURL(file);

        // 启用按钮
        uploadBtn.disabled = false;
        uploadBtn.textContent = '⬆️ 上传图片';
    }

    // ============================================
    // 上传按钮
    // ============================================
    if (uploadBtn) {
        uploadBtn.addEventListener('click', async () => {
            if (!selectedFile) {
                showNotification('error', '请先选择图片文件');
                return;
            }

            uploadBtn.disabled = true;
            uploadBtn.textContent = '上传中...';
            uploadProgress.style.display = 'block';

            const formData = new FormData();
            formData.append('image', selectedFile);

            try {
                // 使用 XMLHttpRequest 来获取上传进度
                const xhr = new XMLHttpRequest();

                xhr.upload.addEventListener('progress', (e) => {
                    if (e.lengthComputable) {
                        const pct = Math.round((e.loaded / e.total) * 100);
                        progressFill.style.width = pct + '%';
                        progressText.textContent = `上传中... ${pct}%`;
                    }
                });

                xhr.addEventListener('load', () => {
                    if (xhr.status === 200) {
                        const data = JSON.parse(xhr.responseText);
                        currentTaskId = data.task_id;
                        showNotification('success', `上传成功！请选择证件照尺寸`);

                        // ★ 显示快捷证件照生成区
                        if (quickPresets) {
                            quickPresets.style.display = 'block';
                            quickPresets.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                        if (processPlaceholder) {
                            processPlaceholder.style.display = 'none';
                        }
                        // 默认选中一寸
                        const firstPreset = document.querySelector('.preset-size');
                        if (firstPreset && !document.querySelector('.preset-size.active')) {
                            firstPreset.click();
                        }

                        // 启用所有处理按钮
                        [resizeBtn, filterBtn, watermarkBtn, removeBgBtn, pipelineBtn].forEach(btn => {
                            if (btn) btn.disabled = false;
                        });

                        uploadBtn.textContent = '✅ 已上传';
                        uploadBtn.disabled = true;
                    } else {
                        const errData = JSON.parse(xhr.responseText);
                        showNotification('error', errData.error || '上传失败');
                        uploadBtn.disabled = false;
                        uploadBtn.textContent = '⬆️ 重新上传';
                    }
                    progressFill.style.width = '0%';
                });

                xhr.addEventListener('error', () => {
                    showNotification('error', '网络错误，请检查网络连接');
                    uploadBtn.disabled = false;
                    uploadBtn.textContent = '⬆️ 重试上传';
                });

                xhr.open('POST', '/api/upload');
                xhr.send(formData);

            } catch (err) {
                showNotification('error', '上传失败: ' + err.message);
                uploadBtn.disabled = false;
                uploadBtn.textContent = '⬆️ 重试上传';
            }
        });
    }

    // ============================================
    // 缩放处理
    // ============================================
    if (resizeBtn) {
        resizeBtn.addEventListener('click', () => handleProcess('resize', {
            width: getValue('resizeWidth') || null,
            height: getValue('resizeHeight') || null,
            mode: document.getElementById('resizeMode')?.value || 'fit',
            background: document.getElementById('resizeBg')?.value || '#FFFFFF',
            upscale: document.getElementById('resizeUpscale')?.checked ?? true,
        }));
    }

    // ============================================
    // 滤镜处理
    // ============================================
    if (filterBtn) {
        filterBtn.addEventListener('click', () => handleProcess('filter', {
            filter_type: document.getElementById('filterType')?.value || 'grayscale',
            intensity: parseFloat(document.getElementById('filterIntensity')?.value || 0.5),
        }));
    }

    // ============================================
    // 水印处理
    // ============================================
    if (watermarkBtn) {
        watermarkBtn.addEventListener('click', () => {
            const wmType = document.getElementById('watermarkType')?.value || 'text';
            const formData = new FormData();
            formData.append('type', wmType);
            formData.append('position', document.getElementById('wmPosition')?.value || 'bottom_right');
            formData.append('rotation', document.getElementById('wmRotation')?.value || '0');

            if (wmType === 'text' || wmType === 'tile') {
                formData.append('text', document.getElementById('wmText')?.value || '© PhotoGongju');
                formData.append('font_size', document.getElementById('wmFontSize')?.value || '36');
                formData.append('font_color', document.getElementById('wmColor')?.value || '#FFFFFF');
                formData.append('text_opacity', document.getElementById('wmOpacity')?.value || '0.5');
            }

            if (wmType === 'image') {
                const wmFile = document.getElementById('wmImageFile')?.files[0];
                if (wmFile) formData.append('watermark_image', wmFile);
                formData.append('image_opacity', document.getElementById('wmImgOpacity')?.value || '0.7');
                formData.append('image_scale', document.getElementById('wmScale')?.value || '0.2');
            }

            handleProcessMultipart('watermark', formData);
        });
    }

    // ============================================
    // AI 背景去除
    // ============================================
    if (removeBgBtn) {
        removeBgBtn.addEventListener('click', () => handleProcess('remove-background', {
            model: 'rmbg_onnx',
            alpha_matting: document.getElementById('alphaMatting')?.checked || false,
        }));
    }

    // ============================================
    // 流水线处理
    // ============================================
    if (pipelineBtn) {
        pipelineBtn.addEventListener('click', () => {
            const pipeParams = {};

            if (document.getElementById('pipeRemoveBg')?.checked) {
                pipeParams.remove_bg = { model: 'rmbg_onnx' };
            }
            if (document.getElementById('pipeResize')?.checked) {
                pipeParams.resize = {
                    width: getValue('resizeWidth') || null,
                    height: getValue('resizeHeight') || null,
                    mode: document.getElementById('resizeMode')?.value || 'fit',
                };
            }
            if (document.getElementById('pipeFilter')?.checked) {
                pipeParams.filter = {
                    filter_type: document.getElementById('filterType')?.value || 'grayscale',
                    intensity: parseFloat(document.getElementById('filterIntensity')?.value || 0.5),
                };
            }
            if (document.getElementById('pipeWatermark')?.checked) {
                pipeParams.watermark = {
                    type: document.getElementById('watermarkType')?.value || 'text',
                    position: document.getElementById('wmPosition')?.value || 'bottom_right',
                    text_config: {
                        text: document.getElementById('wmText')?.value || '© PhotoGongju',
                        font_size: parseInt(document.getElementById('wmFontSize')?.value) || 36,
                        font_color: document.getElementById('wmColor')?.value || '#FFFFFF',
                        opacity: parseFloat(document.getElementById('wmOpacity')?.value) || 0.5,
                    },
                };
            }
            pipeParams.output_format = document.getElementById('outputFormat')?.value || 'png';
            pipeParams.quality = 85;

            handleProcess('pipeline', pipeParams);
        });
    }

    // ============================================
    // 通用处理函数（JSON 模式）
    // ============================================
    async function handleProcess(endpoint, params) {
        if (!currentTaskId) {
            showNotification('error', '请先上传图片');
            return;
        }

        try {
            const res = await fetch(`/api/${endpoint}/${currentTaskId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
            });
            const data = await res.json();

            if (data.success && data.task_id) {
                showNotification('success', data.message || '处理完成！', data.task_id);
            } else {
                showNotification('error', data.detail || data.error || '处理失败');
            }
        } catch (err) {
            showNotification('error', '请求失败: ' + err.message);
        }
    }

    // ============================================
    // 通用处理函数（Multipart 模式 — 水印等需要上传文件的场景）
    // ============================================
    async function handleProcessMultipart(endpoint, formData) {
        if (!currentTaskId) {
            showNotification('error', '请先上传图片');
            return;
        }

        try {
            const res = await fetch(`/api/${endpoint}/${currentTaskId}`, {
                method: 'POST',
                body: formData,
            });
            const data = await res.json();

            if (data.success && data.task_id) {
                showNotification('success', data.message || '处理完成！', data.task_id);
            } else {
                showNotification('error', data.detail || data.error || '处理失败');
            }
        } catch (err) {
            showNotification('error', '请求失败: ' + err.message);
        }
    }

    // ============================================
    // 处理标签页切换
    // ============================================
    document.querySelectorAll('.process-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            // 高亮当前标签
            document.querySelectorAll('.process-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // 切换内容
            const target = tab.dataset.tab;
            document.getElementById('singleProcess').style.display = target === 'single' ? 'block' : 'none';
            document.getElementById('pipelineProcess').style.display = target === 'pipeline' ? 'block' : 'none';
        });
    });

    // ============================================
    // 水印类型切换 — 显示/隐藏对应配置区
    // ============================================
    const wmTypeSelect = document.getElementById('watermarkType');
    if (wmTypeSelect) {
        wmTypeSelect.addEventListener('change', () => {
            const type = wmTypeSelect.value;
            document.getElementById('textWatermarkConfig').style.display =
                (type === 'text' || type === 'tile') ? 'block' : 'none';
            document.getElementById('imageWatermarkConfig').style.display =
                type === 'image' ? 'block' : 'none';
        });
    }

    // ============================================
    // Range 滑块值同步显示
    // ============================================
    bindRange('filterIntensity', 'filterIntensityVal');
    bindRange('wmOpacity', 'wmOpacityVal');
    bindRange('wmImgOpacity', 'wmImgOpacityVal');
    bindRange('wmScale', 'wmScaleVal');

    function bindRange(rangeId, displayId) {
        const rangeEl = document.getElementById(rangeId);
        const displayEl = document.getElementById(displayId);
        if (rangeEl && displayEl) {
            rangeEl.addEventListener('input', () => { displayEl.textContent = rangeEl.value; });
        }
    }

    // ============================================
    // 通知提示
    // ============================================
    function showNotification(type, message, newTaskId) {
        notificationText.textContent = message;
        notificationIcon.textContent = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
        resultNotification.style.display = 'block';
        resultNotification.style.borderColor = type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#e2e8f0';

        if (newTaskId) {
            currentTaskId = newTaskId;
            viewResultBtn.style.display = 'inline-flex';
            viewResultBtn.href = `/result/${newTaskId}`;
        } else {
            viewResultBtn.style.display = 'none';
        }

        // 自动隐藏通知（非错误消息 5 秒后消失）
        if (type !== 'error') {
            setTimeout(() => {
                resultNotification.style.display = 'none';
            }, 8000);
        }
    }

    // ============================================
    // 辅助函数：获取输入值（处理空字符串转为 null）
    // ============================================
    function getValue(id) {
        const el = document.getElementById(id);
        if (!el) return null;
        const val = el.value.trim();
        return val === '' ? null : val;
    }

    // ═══════════════════════════════════════════════════
    // ★ 图片懒加载 — 减少首屏加载耗时
    // ═══════════════════════════════════════════════════
    function initLazyLoading() {
        // 如果浏览器原生支持 loading="lazy"
        if ('loading' in HTMLImageElement.prototype) {
            document.querySelectorAll('img[data-src]').forEach(img => {
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
            });
            return;
        }

        // Intersection Observer 降级方案
        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        if (img.dataset.src) {
                            img.src = img.dataset.src;
                            img.removeAttribute('data-src');
                        }
                        observer.unobserve(img);
                    }
                });
            }, { rootMargin: '200px' }); // 提前 200px 开始加载

            document.querySelectorAll('img[data-src]').forEach(img => observer.observe(img));
        } else {
            // 最终降级：直接加载所有图片
            document.querySelectorAll('img[data-src]').forEach(img => {
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
            });
        }
    }

    // ═══════════════════════════════════════════════════
    // ★ 百度统计（SEO 数据追踪）
    // ═══════════════════════════════════════════════════
    function initBaiduAnalytics() {
        var _hmt = _hmt || [];
        (function() {
            var hm = document.createElement('script');
            hm.src = 'https://hm.baidu.com/hm.js?REPLACE_WITH_YOUR_BAIDU_ID';
            hm.async = true;
            var s = document.getElementsByTagName('script')[0];
            s.parentNode.insertBefore(hm, s);
        })();
    }

    // ═══════════════════════════════════════════════════
    // ★ 初始化所有优化
    // ═══════════════════════════════════════════════════
    document.addEventListener('DOMContentLoaded', () => {
        initLazyLoading();
        // initBaiduAnalytics(); // 取消注释并替换百度统计ID后启用
    });

})();
