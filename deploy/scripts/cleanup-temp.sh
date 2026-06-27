#!/bin/bash
# 临时图片清理 - 7天自动删除
# 宝塔计划任务: 每天 3:00 执行
DIRS=("/www/wwwroot/photogongju/python-service/temp" "/www/wwwroot/photogongju/node-server/temp")
DEL=0
for d in "${DIRS[@]}";do
 if [ -d "$d" ];then
  c=$(find "$d" -type f -mtime +7 -delete -print|wc -l)
  DEL=$((DEL+c))
  echo "[$(date)] $d: deleted $c files"
 fi
done
echo "[$(date)] Total deleted: $DEL"
