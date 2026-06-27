#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════╗
# ║  PhotoGongju — 定时清理脚本                                         ║
# ║  用途: 自动清理临时图片文件，满足人脸隐私合规要求                      ║
# ║  清理范围:                                                          ║
# ║    - python_ai/uploads/   用户上传原图 (7天后删除)                    ║
# ║    - python_ai/outputs/   处理结果图片 (7天后删除)                    ║
# ║    - node_web/uploads/    前端暂存文件 (7天后删除)                    ║
# ║    - 日志归档              (30天后压缩归档)                           ║
# ║  安装方式:                                                           ║
# ║    sudo cp cleanup_temp.sh /opt/photogongju/scripts/                  ║
# ║    sudo chmod +x /opt/photogongju/scripts/cleanup_temp.sh             ║
# ║    sudo crontab -e                                                   ║
# ║    # 每天凌晨 3:00 执行                                              ║
# ║    0 3 * * * /opt/photogongju/scripts/cleanup_temp.sh >> /var/log/photogongju_cleanup.log 2>&1 ║
# ║  隐私合规要点:                                                       ║
# ║    - 用户上传的原始图片仅保留 7 天，超期自动安全删除                    ║
# ║    - 处理结果最多保存 7 天，超期自动清理                               ║
# ║    - 使用 shred 安全擦除（而非仅 rm 删除），防止数据恢复               ║
# ║    - 所有清理操作记录日志，满足审计要求                                ║
# ╚══════════════════════════════════════════════════════════════════════╝

set -euo pipefail

# ═══════════════════════════════════════════════════════════
# 配置
# ═══════════════════════════════════════════════════════════

# 项目根目录
BASE_DIR="${BASE_DIR:-/opt/photogongju}"

# 清理策略（天数）
UPLOAD_RETENTION_DAYS=7        # 上传原图保留天数
OUTPUT_RETENTION_DAYS=7        # 处理结果保留天数
LOG_RETENTION_DAYS=30          # 日志保留天数（超过则压缩归档）
ARCHIVE_RETENTION_DAYS=90      # 归档保留天数（超过则删除）
SESSION_RETENTION_DAYS=7       # 会话数据保留天数

# 清理目录
UPLOAD_DIRS=(
    "$BASE_DIR/python_ai/uploads"
    "$BASE_DIR/node_web/public/uploads"
)
OUTPUT_DIRS=(
    "$BASE_DIR/python_ai/outputs"
)
LOG_DIR="$BASE_DIR/logs"
DATA_DIR="$BASE_DIR/node_web/data"

# 日志文件
CLEANUP_LOG="/var/log/photogongju_cleanup.log"

# 是否安全擦除（使用 shred 覆写后再删除，1=启用，0=仅 rm）
SECURE_DELETE=1

# ═══════════════════════════════════════════════════════════
# 工具函数
# ═══════════════════════════════════════════════════════════

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$CLEANUP_LOG"
}

# 安全删除文件（覆写后删除，防止数据恢复）
safe_delete() {
    local file="$1"
    if [[ "$SECURE_DELETE" == "1" ]] && command -v shred &>/dev/null; then
        # shred -u: 覆写 3 次后删除
        shred -u -z "$file" 2>/dev/null || rm -f "$file"
    else
        rm -f "$file"
    fi
}

# 获取文件大小（人类可读）
human_size() {
    du -sh "$1" 2>/dev/null | cut -f1 || echo "0"
}

# ═══════════════════════════════════════════════════════════
# 1. 清理过期上传文件（人脸隐私合规核心）
# ═══════════════════════════════════════════════════════════
cleanup_uploads() {
    log "──────────────────────────────────────────────"
    log "▶ 开始清理过期上传文件 (保留 ${UPLOAD_RETENTION_DAYS} 天)"
    log "──────────────────────────────────────────────"

    local total_deleted=0
    local total_size=0

    for dir in "${UPLOAD_DIRS[@]}"; do
        if [[ ! -d "$dir" ]]; then
            log "  [跳过] 目录不存在: $dir"
            continue
        fi

        log "  扫描目录: $dir"

        # 查找并删除 N 天前的文件（排除 .gitkeep）
        while IFS= read -r -d '' file; do
            local fname=$(basename "$file")
            # 跳过占位文件
            if [[ "$fname" == ".gitkeep" ]]; then
                continue
            fi

            local fsize=$(stat -c%s "$file" 2>/dev/null || echo 0)
            local mtime=$(stat -c%Y "$file" 2>/dev/null || echo 0)
            local age_days=$(( ($(date +%s) - mtime) / 86400 ))

            log "    [删除] $fname (${age_days}天前, $(human_size "$file"))"
            safe_delete "$file"
            total_deleted=$((total_deleted + 1))
            total_size=$((total_size + fsize))
        done < <(find "$dir" -type f -mtime +${UPLOAD_RETENTION_DAYS} -print0 2>/dev/null)

        # 清理空子目录
        find "$dir" -type d -empty -delete 2>/dev/null || true
    done

    log "  上传文件清理完成: 删除 ${total_deleted} 个文件, 释放约 $(echo "scale=1; $total_size/1024/1024" | bc 2>/dev/null || echo 0) MB"
}

# ═══════════════════════════════════════════════════════════
# 2. 清理过期处理结果
# ═══════════════════════════════════════════════════════════
cleanup_outputs() {
    log "──────────────────────────────────────────────"
    log "▶ 开始清理过期处理结果 (保留 ${OUTPUT_RETENTION_DAYS} 天)"
    log "──────────────────────────────────────────────"

    local total_deleted=0

    for dir in "${OUTPUT_DIRS[@]}"; do
        if [[ ! -d "$dir" ]]; then
            log "  [跳过] 目录不存在: $dir"
            continue
        fi

        log "  扫描目录: $dir"

        while IFS= read -r -d '' file; do
            local fname=$(basename "$file")
            log "    [删除] $fname"
            safe_delete "$file"
            total_deleted=$((total_deleted + 1))
        done < <(find "$dir" -type f -mtime +${OUTPUT_RETENTION_DAYS} -print0 2>/dev/null)

        find "$dir" -type d -empty -delete 2>/dev/null || true
    done

    log "  处理结果清理完成: 删除 ${total_deleted} 个文件"
}

# ═══════════════════════════════════════════════════════════
# 3. 日志轮转 & 归档
# ═══════════════════════════════════════════════════════════
cleanup_logs() {
    log "──────────────────────────────────────────────"
    log "▶ 开始日志轮转与归档"
    log "──────────────────────────────────────────────"

    if [[ ! -d "$LOG_DIR" ]]; then
        log "  [跳过] 日志目录不存在: $LOG_DIR"
        return 0
    fi

    local archive_dir="$LOG_DIR/archive"
    mkdir -p "$archive_dir"

    # 压缩 30 天前的日志文件
    while IFS= read -r -d '' file; do
        local fname=$(basename "$file")
        # 跳过已压缩的
        if [[ "$fname" == *.gz ]] || [[ "$fname" == *.tar.gz ]]; then
            continue
        fi

        log "    [压缩] $fname"
        gzip -f "$file"
        mv "${file}.gz" "$archive_dir/"
    done < <(find "$LOG_DIR" -type f -name "*.log" -mtime +${LOG_RETENTION_DAYS} -print0 2>/dev/null)

    # 删除 90 天前的归档文件
    local old_archives=$(find "$archive_dir" -type f -mtime +${ARCHIVE_RETENTION_DAYS} -print0 2>/dev/null | xargs -0 rm -fv 2>/dev/null | wc -l)
    if [[ $old_archives -gt 0 ]]; then
        log "  删除 ${old_archives} 个过期归档文件"
    fi

    log "  日志轮转完成"
}

# ═══════════════════════════════════════════════════════════
# 4. 清理过期会话数据
# ═══════════════════════════════════════════════════════════
cleanup_sessions() {
    log "──────────────────────────────────────────────"
    log "▶ 清理过期会员/任务缓存数据"
    log "──────────────────────────────────────────────"

    if [[ ! -d "$DATA_DIR" ]]; then
        log "  [跳过] 数据目录不存在: $DATA_DIR"
        return 0
    fi

    # 清理 members.json 中过期的免费用户记录（可选功能）
    if [[ -f "$DATA_DIR/members.json" ]]; then
        # 使用 Python 小脚本清理过期记录
        python3 -c "
import json, os, time
f = '$DATA_DIR/members.json'
try:
    with open(f) as fh:
        data = json.load(fh)
    now = time.time() * 1000
    cleaned = {k: v for k, v in data.items() if v.get('tier', 'free') != 'free' or (now - v.get('paidAt', 0)) < 90 * 86400000}
    if len(cleaned) != len(data):
        with open(f, 'w') as fh:
            json.dump(cleaned, fh, indent=2)
        log(f'  清理了 {len(data) - len(cleaned)} 条过期免费用户记录')
except Exception as e:
    log(f'  会话清理跳过 (members.json 处理出错): {e}')
" 2>/dev/null || true
    fi

    log "  会话数据清理完成"
}

# ═══════════════════════════════════════════════════════════
# 5. 生成清理报告
# ═══════════════════════════════════════════════════════════
generate_report() {
    log "──────────────────────────────────────────────"
    log "▶ 磁盘使用情况报告"
    log "──────────────────────────────────────────────"

    for dir in "${UPLOAD_DIRS[@]}" "${OUTPUT_DIRS[@]}" "$LOG_DIR" "$DATA_DIR"; do
        if [[ -d "$dir" ]]; then
            log "  $(human_size "$dir")  $dir"
        fi
    done

    # 磁盘整体使用率
    local disk_usage=$(df -h /opt 2>/dev/null | tail -1 | awk '{print $5}')
    log "  磁盘使用率: ${disk_usage:-N/A}"
}

# ═══════════════════════════════════════════════════════════
# 主入口
# ═══════════════════════════════════════════════════════════
main() {
    log ""
    log "╔══════════════════════════════════════════════════════════════╗"
    log "║  PhotoGongju 隐私合规清理任务开始                             ║"
    log "╚══════════════════════════════════════════════════════════════╝"
    log "  保留策略: 上传文件 ${UPLOAD_RETENTION_DAYS}天 | 处理结果 ${OUTPUT_RETENTION_DAYS}天 | 日志 ${LOG_RETENTION_DAYS}天"
    log "  安全擦除: $([[ "$SECURE_DELETE" == "1" ]] && echo 'shred覆写' || echo '普通删除')"

    cleanup_uploads
    cleanup_outputs
    cleanup_logs
    cleanup_sessions
    generate_report

    log ""
    log "╔══════════════════════════════════════════════════════════════╗"
    log "║  清理任务完成                                                 ║"
    log "╚══════════════════════════════════════════════════════════════╝"
    log ""
}

# 运行
main "$@"
