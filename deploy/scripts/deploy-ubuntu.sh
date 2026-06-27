#!/bin/bash
set -e
echo "CyberPhoto 一键部署 - Ubuntu 24.04"
PROJECT_DIR="/www/wwwroot/photogongju"
apt-get update -qq && apt-get install -y -qq python3 python3-pip python3-venv nodejs npm git nginx supervisor
mkdir -p $PROJECT_DIR/logs
cd $PROJECT_DIR/node-server && npm install --production --registry=https://registry.npmmirror.com
cd $PROJECT_DIR/python-service && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
bash $PROJECT_DIR/deploy/scripts/download-models.sh
cp $PROJECT_DIR/deploy/supervisor/*.conf /etc/supervisor/conf.d/
supervisorctl reread && supervisorctl update && supervisorctl start cyberphoto-node cyberphoto-python
cp $PROJECT_DIR/deploy/nginx/cyberphoto.conf /etc/nginx/sites-available/
ln -sf /etc/nginx/sites-available/cyberphoto.conf /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
(crontab -l 2>/dev/null;echo "0 3 * * * bash $PROJECT_DIR/deploy/scripts/cleanup-temp.sh")|crontab -
echo "Deploy complete! Node:127.0.0.1:3000 Python:127.0.0.1:7860"
