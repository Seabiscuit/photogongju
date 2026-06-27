#!/usr/bin/env bash
# ============================================
# PhotoGongju — AI 模型一键下载脚本
# 将所有模型权重文件自动下载到 python_ai/weights/ 目录
#
# 用法：
#   bash scripts/download_models.sh          # 下载全部模型
#   bash scripts/download_models.sh rmbg     # 只下载背景去除模型
#   bash scripts/download_models.sh esrgan   # 只下载超分辨率模型
#   bash scripts/download_models.sh --list   # 列出所有可用模型
#
# 下载完成后，模型文件存放于：
#   python_ai/weights/
# ============================================

set -euo pipefail

# ── 颜色输出 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ── 路径定义 ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WEIGHTS_DIR="$PROJECT_DIR/python_ai/weights"

# ── 确保权重目录存在 ──
mkdir -p "$WEIGHTS_DIR"

# ── 模型定义（名称、文件名、下载URL、MD5校验、大小） ──
declare -A MODEL_INFO=()

MODEL_INFO["rmbg"]="rembg-1.4.onnx|https://github.com/danielgatis/rembg/releases/download/v0.1.4/rembg.onnx|N/A|~176MB|背景去除模型 (ONNX U²-Net)"
MODEL_INFO["esrgan"]="RealESRGAN_x4plus.pth|https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth|N/A|~67MB|超分辨率模型 x4 (Real-ESRGAN)"
MODEL_INFO["mobilenet"]="mobilenet_v2.onnx|https://github.com/onnx/models/raw/main/validated/vision/classification/mobilenet/model/mobilenetv2-12.onnx|N/A|~14MB|图像分类模型 (MobileNetV2 ONNX)"

# ── 国内镜像源映射（加速下载） ──
declare -A MIRRORS=()
# GitHub 文件可以通过 ghproxy.com 加速
GITHUB_PROXY="https://ghproxy.com/"
# HuggingFace 镜像
HF_MIRROR="https://hf-mirror.com/"

# ── 工具函数 ──

print_banner() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║      PhotoGongju AI 模型下载工具                          ║${NC}"
    echo -e "${CYAN}║      模型存放目录: python_ai/weights/                      ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_model_list() {
    echo -e "${YELLOW}可用模型列表：${NC}"
    echo "─────────────────────────────────────────────────────────────"
    for key in "${!MODEL_INFO[@]}"; do
        IFS='|' read -r filename url md5 size desc <<< "${MODEL_INFO[$key]}"
        printf "  ${GREEN}%-15s${NC} %s\n" "$key" "$desc"
        printf "    文件: %s | 大小: %s\n" "$filename" "$size"
    done
    echo "─────────────────────────────────────────────────────────────"
}

# ── 检查下载工具 ──
check_downloader() {
    if command -v wget &> /dev/null; then
        DOWNLOADER="wget"
        DOWNLOAD_CMD="wget --show-progress --no-check-certificate -O"
    elif command -v curl &> /dev/null; then
        DOWNLOADER="curl"
        DOWNLOAD_CMD="curl -L --progress-bar -o"
    else
        echo -e "${RED}[错误] 未找到 wget 或 curl，请先安装其中一个${NC}"
        echo "  Ubuntu/Debian: sudo apt install wget"
        echo "  CentOS/RHEL:   sudo yum install wget"
        echo "  macOS:         brew install wget"
        exit 1
    fi
    echo -e "${GREEN}[检测] 使用下载工具: $DOWNLOADER${NC}"
}

# ── 下载单个模型 ──
download_model() {
    local model_key="$1"
    local info="${MODEL_INFO[$model_key]}"

    IFS='|' read -r filename url md5 size desc <<< "$info"
    local output_path="$WEIGHTS_DIR/$filename"

    # 检查是否已存在
    if [ -f "$output_path" ]; then
        local filesize=$(du -h "$output_path" | cut -f1)
        echo -e "${YELLOW}[跳过] $filename 已存在 ($filesize)${NC}"
        echo "  如需重新下载，请先删除该文件: rm $output_path"
        return 0
    fi

    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}正在下载: $desc${NC}"
    echo -e "  文件: $filename"
    echo -e "  大小: $size"
    echo -e "  地址: $url"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    # 尝试直接下载
    if $DOWNLOAD_CMD "$output_path" "$url"; then
        echo -e "${GREEN}[完成] $filename 下载成功 → $output_path${NC}"
        local filesize=$(du -h "$output_path" | cut -f1)
        echo -e "  文件大小: $filesize"
    else
        echo -e "${RED}[失败] $filename 下载失败${NC}"

        # GitHub 文件尝试使用代理重试
        if [[ "$url" == *"github.com"* ]]; then
            echo -e "${YELLOW}[重试] 尝试通过 ghproxy.com 代理下载...${NC}"
            local proxy_url="${GITHUB_PROXY}${url}"
            if $DOWNLOAD_CMD "$output_path" "$proxy_url"; then
                echo -e "${GREEN}[完成] $filename 通过代理下载成功${NC}"
            else
                echo -e "${RED}[失败] 代理下载也失败了，请手动下载：${NC}"
                echo "  $url"
                echo "  保存到: $output_path"
                return 1
            fi
        else
            echo -e "${YELLOW}[提示] 请手动下载：${NC}"
            echo "  $url"
            echo "  保存到: $output_path"
            return 1
        fi
    fi

    return 0
}

# ── 下载全部模型 ──
download_all() {
    echo -e "${GREEN}开始下载全部 ${#MODEL_INFO[@]} 个模型...${NC}"
    echo ""

    local failed=0
    for key in "${!MODEL_INFO[@]}"; do
        if ! download_model "$key"; then
            ((failed++))
        fi
    done

    echo ""
    echo "══════════════════════════════════════════════════════════════"
    if [ $failed -eq 0 ]; then
        echo -e "${GREEN}✅ 全部模型下载完成！${NC}"
    else
        echo -e "${YELLOW}⚠️  下载完成，但有 $failed 个模型失败${NC}"
    fi
    echo -e "模型存放目录: ${CYAN}$WEIGHTS_DIR${NC}"

    # 列出已下载的文件
    echo ""
    echo -e "${GREEN}已下载的模型文件：${NC}"
    ls -lh "$WEIGHTS_DIR/" 2>/dev/null | grep -v "^total" | grep -v "^d" || echo "  (无文件)"
    echo ""
}

# ── 验证模型文件完整性 ──
verify_models() {
    echo -e "${YELLOW}验证模型文件完整性...${NC}"
    echo ""

    local all_ok=true
    for key in "${!MODEL_INFO[@]}"; do
        IFS='|' read -r filename url md5 size desc <<< "${MODEL_INFO[$key]}"
        local filepath="$WEIGHTS_DIR/$filename"

        if [ -f "$filepath" ]; then
            local filesize=$(du -h "$filepath" | cut -f1)
            echo -e "  ${GREEN}✓${NC} $filename ($filesize)"
        else
            echo -e "  ${RED}✗${NC} $filename — 未下载"
            all_ok=false
        fi
    done

    if [ "$all_ok" = true ]; then
        echo ""
        echo -e "${GREEN}✅ 所有模型文件完整${NC}"
    fi
}

# ═══════════════════════════════════════════════════════════════
# 主入口
# ═══════════════════════════════════════════════════════════════

print_banner

# 显示模型列表
print_model_list

# 检查下载工具
check_downloader

# 解析参数
MODE="${1:-all}"

case "$MODE" in
    --list|-l)
        # 仅列出，不下载
        exit 0
        ;;
    --verify|-v)
        verify_models
        exit 0
        ;;
    all|--all|-a)
        download_all
        ;;
    rmbg|esrgan|mobilenet)
        if [ -z "${MODEL_INFO[$MODE]+_}" ]; then
            echo -e "${RED}[错误] 未知模型: $MODE${NC}"
            echo "可用模型: ${!MODEL_INFO[*]}"
            exit 1
        fi
        download_model "$MODE"
        ;;
    *)
        echo -e "${RED}[错误] 未知参数: $MODE${NC}"
        echo ""
        echo "用法:"
        echo "  bash scripts/download_models.sh              # 下载全部模型"
        echo "  bash scripts/download_models.sh rmbg         # 只下载背景去除模型"
        echo "  bash scripts/download_models.sh esrgan       # 只下载超分辨率模型"
        echo "  bash scripts/download_models.sh mobilenet    # 只下载分类模型"
        echo "  bash scripts/download_models.sh --list       # 列出模型"
        echo "  bash scripts/download_models.sh --verify     # 验证已下载模型"
        exit 1
        ;;
esac

# 完成后验证
verify_models

echo -e "${GREEN}🎉 模型下载任务结束。现在可以启动 python_ai 服务：${NC}"
echo -e "  cd python_ai"
echo -e "  pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple"
echo -e "  python main.py"
echo ""
