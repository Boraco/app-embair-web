#!/usr/bin/env bash
set -u
export TERM=xterm

echo "===(1) HOST==="
hostname
uname -a

echo "===(2) STATUS GIT ANTES==="
cd /var/www/app-embair-web 2>/dev/null || {
  echo "NO EXISTE /var/www/app-embair-web, clonando..."
  mkdir -p /var/www
  cd /var/www
  git clone https://github.com/Boraco/app-embair-web.git app-embair-web
  cd app-embair-web
}
pwd
BACKUP_ROOT="/var/backups/app-embair-web/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_ROOT"
echo "===(0) BACKUP DATOS Y UPLOADS ==="
cp -a data "$BACKUP_ROOT/data"
cp -a public/uploads "$BACKUP_ROOT/uploads"
python3 - <<'PY'
import json
from pathlib import Path
p = Path("data/products.json")
try:
  data = json.loads(p.read_text())
  print(f"products.json items before deploy: {len(data) if isinstance(data, list) else 'invalid_format'}")
except Exception as e:
  print(f"ERROR leyendo products.json antes del deploy: {e}")
PY
echo "Backup remoto creado en: $BACKUP_ROOT"
git status 2>&1 | head -30
echo "Local last commit:"
git log -1 --oneline 2>&1
echo "Origin main last commit:"
git fetch origin main 2>&1 | tail -5
git log -1 --oneline origin/main 2>&1

echo "===(3) GIT PULL==="
cp .env /tmp/.env.bak 2>/dev/null || true
git stash 2>&1 | tail -5
git pull origin main 2>&1 | tail -15
cp -a "$BACKUP_ROOT/data/." data/
cp -a "$BACKUP_ROOT/uploads/." public/uploads/
echo "Datos y uploads restaurados desde el backup posterior al pull."
[ -f /tmp/.env.bak ] && cp /tmp/.env.bak .env
if grep -q '^PUBLIC_URL=' .env 2>/dev/null; then sed -i 's#^PUBLIC_URL=.*#PUBLIC_URL=https://embair.es#' .env; else echo 'PUBLIC_URL=https://embair.es' >> .env; fi
if grep -q '^BASE_URL=' .env 2>/dev/null; then sed -i 's#^BASE_URL=.*#BASE_URL=https://embair.es#' .env; else echo 'BASE_URL=https://embair.es' >> .env; fi
echo "Post-pull local commit:"
git log -1 --oneline

echo "===(4) DEPS + PERMS==="
npm install --no-audit --no-fund 2>&1 | tail -10
mkdir -p public/uploads data
chown -R www-data:www-data /var/www/app-embair-web 2>&1
chmod -R 775 public/uploads data 2>&1

echo "===(5) NGINX FIX CACHE HTML==="
mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
CONF_FILE=/etc/nginx/sites-available/app-embair-web.conf
if [ -f "$CONF_FILE" ]; then
  echo "Ngnix conf exists, patching cache headers..."
  grep -q 'Cache-Control' "$CONF_FILE" || {
    python3 - <<'PY'
from pathlib import Path
p = Path("/etc/nginx/sites-available/app-embair-web.conf")
s = p.read_text()
inject = '''
        location ~* \.html$ {
            add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
            expires off;
            proxy_pass http://127.0.0.1:3002;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }
'''
# Only inject if there's no such block; otherwise don't risk duplicate
if "Cache-Control" not in s:
    # Insert right before location / { block
    marker = "location / {"
    lines = s.splitlines()
    out = []
    for line in lines:
        if line.strip() == marker:
            out.append(inject.rstrip())
            out.append("")
        out.append(line)
    p.write_text("\n".join(out) + "\n")
PY
  }
  nginx -t 2>&1 | tail -10
  systemctl reload nginx 2>&1 | tail -5
else
  echo "Creando Nginx conf por primera vez..."
  cat > "$CONF_FILE" <<'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _ 217.160.212.31;

    client_max_body_size 50M;

    location ~* \.html$ {
        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
        expires off;
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX
  rm -f /etc/nginx/sites-enabled/default
  ln -sf /etc/nginx/sites-available/app-embair-web.conf /etc/nginx/sites-enabled/app-embair-web.conf
  nginx -t 2>&1 | tail -10
  systemctl restart nginx 2>&1 | tail -5
fi

echo "===(6) PM2==="
which pm2 >/dev/null 2>&1 || {
  echo "pm2 not found, installing..."
  npm install -g pm2 2>&1 | tail -5
}
pm2 delete app-embair-web 2>&1 | tail -3
PORT=3002 pm2 start /var/www/app-embair-web/server/index.js --name app-embair-web --cwd /var/www/app-embair-web 2>&1 | tail -10
pm2 save 2>&1 | tail -3
pm2 list 2>&1 | head -30
echo "--- pm2 logs tail ---"
pm2 logs app-embair-web --lines 40 --nostream 2>&1 | tail -60

echo "===(7) ENDPOINT CHECKS (localhost)==="
sleep 3
curl -sS -o /dev/null -w "GET / -> HTTP %{http_code}\n" http://127.0.0.1:3002/
curl -sS -o /dev/null -w "GET /landing.html -> HTTP %{http_code}\n" http://127.0.0.1:3002/landing.html
curl -sS -o /dev/null -w "GET /admin.html -> HTTP %{http_code}\n" http://127.0.0.1:3002/admin.html
curl -sS -o /dev/null -w "GET /api/products -> HTTP %{http_code}\n" http://127.0.0.1:3002/api/products

echo "===DONE==="
