#!/bin/bash
set -e
MODEL_DIR="/www/wwwroot/photogongju/python-service/models"
mkdir -p $MODEL_DIR
export U2NET_HOME=$MODEL_DIR
echo "Downloading U2Net model..."
# rembg will auto-download; trigger via Python
cd /www/wwwroot/photogongju/python-service
source venv/bin/activate
python -c "from rembg import new_session; s=new_session('u2net'); print('Model OK')"
echo "Model ready: $MODEL_DIR"
ls -lh $MODEL_DIR/
