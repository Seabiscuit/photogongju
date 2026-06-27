# 🖼️ PhotoGongju — 智能图片处理工具箱

基于 **Node.js + Python 双栈架构**的在线图片处理平台。

- **Python AI 微服务** (FastAPI): 图片缩放、滤镜、水印、AI 抠图、尺寸库
- **Node.js 主站** (Express + EJS): 用户界面、文件上传、API 转发

---

## 📁 项目结构

```
photogongju/
├── python_ai/                    # Python AI 微服务
│   ├── main.py                   # FastAPI 入口
│   ├── config.py                 # 全局配置
│   ├── requirements.txt          # Python 依赖
│   ├── api/routes.py             # REST API 路由
│   ├── services/
│   │   ├── image_processor.py    # 图片处理核心
│   │   ├── watermark.py          # 水印引擎
│   │   └── size_library.py       # 尺寸预设库
│   ├── models/schemas.py         # Pydantic 数据模型
│   ├── utils/helpers.py          # 通用工具函数
│   └── weights/                  # AI 模型目录
│
├── node_web/                     # Node.js 主站
│   ├── app.js                    # Express 入口
│   ├── package.json              # Node 依赖
│   ├── routes/
│   │   ├── index.js              # 页面路由
│   │   └── api.js                # API 路由 (转发 AI 服务)
│   ├── services/aiService.js     # AI 服务客户端
│   ├── views/
│   │   ├── index.ejs             # 首页
│   │   ├── upload.ejs            # 上传/处理页
│   │   └── result.ejs            # 结果展示页
│   └── public/css+js             # 前端资源
│
├── scripts/
│   └── download_models.sh        # AI 模型一键下载
│
└── README.md
```

---

## 🚀 快速启动

### 1. 环境要求

- Python 3.10+
- Node.js 18+
- (可选) ONNX Runtime 用于 AI 抠图功能

### 2. 安装 & 启动 Python AI 服务

```bash
# 进入 python_ai 目录
cd python_ai

# 使用国内镜像源安装依赖
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 下载 AI 模型（可选，背景去除功能需要）
bash ../scripts/download_models.sh

# 启动 FastAPI 服务 (开发模式)
python main.py

# 或使用 uvicorn 直接启动
uvicorn main:app --host 127.0.0.1 --port 8001 --reload
```

AI 服务启动后访问：
- API 文档 Swagger UI: http://127.0.0.1:8001/docs
- ReDoc 文档: http://127.0.0.1:8001/redoc

### 3. 安装 & 启动 Node.js 主站

```bash
# 进入 node_web 目录
cd node_web

# 使用国内镜像源安装依赖
npm install --registry=https://registry.npmmirror.com

# 启动 Express 服务 (开发模式)
npm run dev

# 或直接启动
npm start
```

主站启动后访问: http://localhost:3000

---

## 🔧 国内镜像源配置

### pip (Python)
在 `pip install` 命令中添加 `-i` 参数：
```bash
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```
其他可用镜像：
- 阿里云: `https://mirrors.aliyun.com/pypi/simple/`
- 中科大: `https://pypi.mirrors.ustc.edu.cn/simple/`

### npm (Node.js)
在 `npm install` 命令中添加 `--registry` 参数：
```bash
npm install --registry=https://registry.npmmirror.com
```

---

## 📡 API 接口概览

| 方法 | 路径 | 功能 |
|------|------|------|
| `GET` | `/api/v1/health` | 健康检查 |
| `POST` | `/api/v1/upload` | 上传图片 |
| `GET` | `/api/v1/info/{task_id}` | 获取图片信息 |
| `POST` | `/api/v1/resize/{task_id}` | 图片缩放 |
| `POST` | `/api/v1/filter/{task_id}` | 滤镜处理 |
| `POST` | `/api/v1/watermark/{task_id}` | 添加水印 |
| `POST` | `/api/v1/remove-background/{task_id}` | AI 背景去除 |
| `POST` | `/api/v1/pipeline/{task_id}` | 批量流水线处理 |
| `GET` | `/api/v1/download/{task_id}` | 下载处理结果 |
| `GET` | `/api/v1/size-library` | 尺寸库查询 |
| `GET` | `/api/v1/size-library/recommend/{task_id}` | 智能尺寸推荐 |

---

## 🎯 核心功能

### 图片缩放
- **Fill** — 拉伸填满（不保持比例）
- **Fit** — 等比适配（留白填充）
- **Cover** — 等比覆盖（居中裁剪）
- **Thumbnail** — 缩略图模式

### 滤镜效果
灰度、怀旧棕、高斯模糊、锐化、亮度、对比度、饱和度、暖色温、冷色温

### 水印引擎
- 文字水印 — 自定义字体/大小/颜色/透明度/旋转
- 图片水印 — Logo 叠加，支持缩放
- 平铺水印 — 全图密铺防伪水印

### AI 背景去除
基于 ONNX Runtime + U²-Net 深度学习模型的人像/物体智能抠图

### 尺寸库
内置 50+ 平台预设（Instagram、Facebook、Twitter、淘宝、京东、YouTube、B站、证件照、打印尺寸等）
支持按原图比例智能推荐

---

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | EJS 模板、原生 JavaScript、CSS3 |
| Node 层 | Express 4.x、Multer、Axios |
| AI 微服务 | FastAPI、Pydantic、Uvicorn |
| 图片处理 | Pillow、OpenCV、NumPy |
| AI 推理 | ONNX Runtime、PyTorch |
| 模型 | U²-Net (背景去除)、Real-ESRGAN (超分)、MobileNetV2 (分类) |

---

## 📄 License

MIT License
