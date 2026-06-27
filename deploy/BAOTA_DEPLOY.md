# PhotoGongju — 腾讯云宝塔Linux面板部署指南

## 环境要求

| 组件 | 最低版本 | 说明 |
|------|---------|------|
| 服务器 | Ubuntu 22.04/24.04 x86_64 | 2核4G+ (AI模型需内存) |
| 宝塔面板 | 9.x | 已安装LNMP基础环境 |
| Node.js | 18 LTS | 通过宝塔「软件商店」安装 |
| Python | 3.10+ | 系统自带或宝塔安装 |
| Nginx | 1.24+ | 宝塔默认已安装 |
| 磁盘 | 5GB+ | u2net.onnx 模型 ~176MB |

---

## 第一步：宝塔面板环境准备

### 1.1 安装必要软件

登录宝塔面板 → 软件商店 → 搜索安装：

| 软件 | 说明 |
|------|------|
| **Node.js版本管理器** | 安装Node.js 18 LTS |
| **Nginx** | (通常已预装) |
| **进程守护管理器 (Supervisor)** | 保持Node/Python服务运行 |
| **Python项目管理器** (可选) | 管理Python虚拟环境 |

### 1.2 安装系统依赖

```bash
# SSH登录服务器，安装Python编译依赖
sudo apt update
sudo apt install -y python3 python3-pip python3-venv python3-dev \
    build-essential libssl-dev libffi-dev \
    libgl1-mesa-glx libglib2.0-0 libsm6 libxext6 libxrender-dev
```

---

## 第二步：上传项目代码

### 方式A：宝塔文件管理器（推荐）

1. 本地将项目打包（排除 node_modules、venv、.git）：

```bash
# 在本地Windows执行
cd f:/photogongju
tar --exclude='node_modules' --exclude='venv' --exclude='__pycache__' \
    --exclude='*.pyc' --exclude='.git' --exclude='image' \
    --exclude='ezremove_*' --exclude='test_*' \
    -czf photogongju.tar.gz \
    node_web/ python_ai/ deploy/ scripts/ start-dev.sh
```

2. 宝塔面板 → 文件 → 进入 `/opt/` → 上传 `photogongju.tar.gz`
3. 解压：

```bash
cd /opt
tar -xzf photogongju.tar.gz
mkdir -p /opt/photogongju/python_ai/uploads
mkdir -p /opt/photogongju/python_ai/outputs
mkdir -p /opt/photogongju/node_web/public/uploads
mkdir -p /opt/photogongju/logs
```

### 方式B：Git 克隆

```bash
cd /opt
git clone git@github.com:Seabiscuit/photogongju.git
```

> 宝塔面板也支持通过「网站 → Git管理」插件拉取代码。

---

## 第三步：安装项目依赖

### 3.1 Node.js 依赖

```bash
# 使用宝塔安装的Node.js（确认版本）
node -v    # 应显示 v18.x.x

# 安装npm依赖（国内服务器使用镜像源加速）
cd /opt/photogongju/node_web
npm config set registry https://registry.npmmirror.com
npm install --production
```

### 3.2 Python 依赖

```bash
cd /opt/photogongju/python_ai

# 创建虚拟环境
python3 -m venv venv

# 激活并安装
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
deactivate
```

---

## 第四步：下载AI模型

```bash
cd /opt/photogongju/python_ai/weights

# 下载 U²-Net ONNX 模型 (176MB)
wget -O u2net.onnx \
    "https://github.com/danielgatis/rembg/releases/download/v0.1.4/rembg.onnx"

# 验证
ls -lh u2net.onnx
# 应显示约 176MB
```

---

## 第五步：配置Supervisor进程守护

宝塔面板 → 软件商店 → **进程守护管理器** → 设置 → 添加守护进程。

### 5.1 Node.js 主站守护

| 字段 | 值 |
|------|-----|
| 名称 | `photogongju-node` |
| 启动用户 | `root` (或 `www`) |
| 运行目录 | `/opt/photogongju/node_web` |
| 启动命令 | `/usr/bin/node /opt/photogongju/node_web/app.js` |
| 进程数 | 1 |

或者通过命令行配置：

```bash
# 复制Supervisor配置文件
sudo cp /opt/photogongju/deploy/supervisor/photogongju-node.conf \
    /etc/supervisor/conf.d/

sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl start photogongju-node
```

### 5.2 Python AI 服务守护

| 字段 | 值 |
|------|-----|
| 名称 | `photogongju-python` |
| 启动用户 | `root` |
| 运行目录 | `/opt/photogongju/python_ai` |
| 启动命令 | `/opt/photogongju/python_ai/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8001 --workers 2 --log-level info` |
| 进程数 | 1 |

或者：

```bash
sudo cp /opt/photogongju/deploy/supervisor/photogongju-python.conf \
    /etc/supervisor/conf.d/

sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl start photogongju-python
```

### 5.3 验证服务启动

```bash
# 检查两个服务状态
sudo supervisorctl status

# 预期输出：
# photogongju-node    RUNNING   pid 12345, uptime 0:00:30
# photogongju-python  RUNNING   pid 12346, uptime 0:00:28

# 手动测试
curl http://localhost:3000/api/health
# → {"status":"ok"...}

curl http://localhost:8001/api/v1/health
# → {"status":"ok","version":"1.0.0","models_available":["rmbg_onnx"]}
```

---

## 第六步：配置Nginx反向代理

### 6.1 宝塔面板方式（推荐）

1. 宝塔面板 → **网站** → **添加站点**
2. 填写域名（如 `photogongju.yourdomain.com`），PHP版本选「纯静态」
3. 站点创建后 → 点击域名 → **配置文件**
4. 清空默认内容，粘贴下方配置（修改域名）：

```
# ═══ 复制 deploy/nginx/photogongju.conf 的全部内容 ═══
```

或者直接替换配置文件：

```bash
# 备份原配置
sudo cp /www/server/panel/vhost/nginx/photogongju.conf \
    /www/server/panel/vhost/nginx/photogongju.conf.bak

# 复制项目提供的Nginx配置（已针对宝塔优化）
sudo cp /opt/photogongju/deploy/nginx/photogongju.conf \
    /www/server/panel/vhost/nginx/photogongju.yourdomain.com.conf

# 替换域名占位符
sudo sed -i 's/photogongju\.example\.com/你的域名/g' \
    /www/server/panel/vhost/nginx/photogongju.yourdomain.com.conf

# 测试并重载
sudo nginx -t
sudo nginx -s reload
```

### 6.2 SSL 证书（宝塔一键申请）

1. 宝塔面板 → 网站 → 点击域名 → **SSL**
2. 选择「Let's Encrypt」→ 勾选域名 → 申请
3. 开启「强制HTTPS」
4. 如需 HTTPS 配置，取消 `deploy/nginx/photogongju.conf` 末尾的 HTTPS server 块注释

---

## 第七步：验证部署

```bash
# 1. 健康检查
curl http://localhost:3000/api/health
curl http://localhost:8001/api/v1/health

# 2. 上传测试
curl -X POST http://localhost:3000/api/upload \
    -F "image=@test_photo.png"

# 3. 通过域名访问
curl https://你的域名/
# 应返回完整HTML页面

# 4. 证件照生成测试
# 用返回的 task_id 替换
curl -X POST http://localhost:3000/api/id-photo/TASK_ID \
    -H "Content-Type: application/json" \
    -d '{"width":295,"height":413,"background":"#438EDB","label":"一寸蓝底"}'
```

---

## 宝塔面板常用操作

### 查看日志

```bash
# 宝塔面板日志路径
tail -f /www/wwwlogs/photogongju_access.log    # Nginx访问日志
tail -f /www/wwwlogs/photogongju_error.log     # Nginx错误日志
tail -f /opt/photogongju/logs/node_web.log     # Node主站日志
tail -f /opt/photogongju/logs/python_ai.log    # Python AI日志
```

也可在宝塔面板 → 网站 → 日志 中直接查看。

### 重启服务

```bash
# 通过 Supervisor
sudo supervisorctl restart photogongju-node
sudo supervisorctl restart photogongju-python

# 或通过宝塔面板「进程守护管理器」一键重启
```

### 更新代码

```bash
cd /opt/photogongju
git pull origin master

# 安装新依赖（如有新增）
cd node_web && npm install --production && cd ..
cd python_ai && source venv/bin/activate && pip install -r requirements.txt && deactivate && cd ..

# 重启服务
sudo supervisorctl restart all
```

---

## 服务器安全建议

1. **宝塔面板端口**：修改默认 8888 端口为自定义端口
2. **防火墙**：仅开放 80、443 和宝塔管理端口

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 你的宝塔端口/tcp
sudo ufw enable
```

3. **文件权限**：

```bash
sudo chown -R www:www /opt/photogongju
sudo chmod -R 755 /opt/photogongju
sudo chmod -R 777 /opt/photogongju/python_ai/uploads
sudo chmod -R 777 /opt/photogongju/python_ai/outputs
```

4. **宝塔面板** → 安全 → 开启 SSH 防火墙、禁 ping、修改面板端口

---

## 常见问题

| 问题 | 排查方法 |
|------|---------|
| 502 Bad Gateway | `supervisorctl status` 检查后端服务是否运行 |
| AI抠图失败 | 确认 `u2net.onnx` 在 `/opt/photogongju/python_ai/weights/` |
| 上传大文件失败 | 检查 Nginx `client_max_body_size` 和宝塔上传限制 |
| 中文乱码 | 确认 Nginx `charset utf-8;` |
| 模型下载慢 | 手动下载后通过宝塔文件管理器上传到 weights/ |

---

## 快速部署（一键脚本）

项目提供了完整的一键部署脚本：

```bash
cd /opt/photogongju
sudo chmod +x deploy/install.sh
sudo bash deploy/install.sh
```

脚本支持分步执行：

```bash
sudo bash deploy/install.sh --step=env       # 仅安装Node/Python环境
sudo bash deploy/install.sh --step=app       # 仅部署应用代码
sudo bash deploy/install.sh --step=models    # 仅下载AI模型
sudo bash deploy/install.sh --step=supervisor # 仅配置进程守护
sudo bash deploy/install.sh --step=nginx     # 仅配置Nginx
```
