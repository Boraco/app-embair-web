#!/usr/bin/env bash
set -euo pipefail
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
umask 077
mkdir -p /var/backups/app-embair-web
BACKUP_ROOT="$(mktemp -d "/var/backups/app-embair-web/$(date +%Y%m%d_%H%M%S)_XXXXXX")"
echo "===(0) BACKUP DATOS, IMAGENES Y UPLOADS ==="
test -d data
test -d public/uploads
test -d public/img
mkdir -p "$BACKUP_ROOT/data" "$BACKUP_ROOT/uploads" "$BACKUP_ROOT/public-img"
cp -a data/. "$BACKUP_ROOT/data/"
cp -a public/uploads/. "$BACKUP_ROOT/uploads/"
cp -a public/img/. "$BACKUP_ROOT/public-img/"
python3 - "$BACKUP_ROOT" <<'PY'
import hashlib
import json
import os
import sys
from pathlib import Path
from datetime import datetime, timezone

backup = Path(sys.argv[1])
locations = {
  "data": (Path("data"), backup / "data"),
  "uploads": (Path("public/uploads"), backup / "uploads"),
  "public-img": (Path("public/img"), backup / "public-img"),
}

def snapshot(root):
  entries = {}
  def visit(folder, relative=""):
    for entry in sorted(os.scandir(folder), key=lambda item: item.name):
      path = Path(entry.path)
      name = f"{relative}/{entry.name}" if relative else entry.name
      if entry.is_symlink():
        entries[name] = {"type": "symlink", "target": os.readlink(entry.path)}
      elif entry.is_dir(follow_symlinks=False):
        entries[name] = {"type": "directory"}
        visit(path, name)
      elif entry.is_file(follow_symlinks=False):
        digest = hashlib.sha256()
        with open(entry.path, "rb") as stream:
          for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
        entries[name] = {"type": "file", "size": entry.stat(follow_symlinks=False).st_size, "sha256": digest.hexdigest()}
      else:
        raise RuntimeError(f"unsupported filesystem entry: {path}")
  visit(root)
  return entries

manifest = {"createdAt": datetime.now(timezone.utc).isoformat(), "locations": {}}
for name, (source, saved) in locations.items():
  original = snapshot(source)
  copied = snapshot(saved)
  if original != copied:
    missing = sorted(set(original) - set(copied))[:5]
    extra = sorted(set(copied) - set(original))[:5]
    changed = sorted(key for key in original.keys() & copied.keys() if original[key] != copied[key])[:5]
    raise SystemExit(f"ERROR verificando respaldo {name}: missing={missing}, extra={extra}, changed={changed}")
  manifest["locations"][name] = {
    "entries": len(original),
    "files": sum(item["type"] == "file" for item in original.values()),
    "sha256": hashlib.sha256(json.dumps(original, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
  }
  print(f"VERIFIED BACKUP {name}: {manifest['locations'][name]['files']} files; names and contents match")
(backup / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
os.chmod(backup / "manifest.json", 0o600)
PY
echo "Backup remoto creado en: $BACKUP_ROOT"
if [[ "${BACKUP_ONLY:-0}" == "1" ]]; then
  echo "BACKUP_ONLY_COMPLETED; no se actualizo el codigo ni se reiniciaron servicios."
  exit 0
fi
git status 2>&1 | head -30 || true
echo "Local last commit:"
git log -1 --oneline 2>&1
echo "Origin main last commit:"
git fetch origin main 2>&1 | tail -5
git log -1 --oneline origin/main 2>&1

echo "===(3) GIT PULL==="
cp .env /tmp/.env.bak 2>/dev/null || true
git stash 2>&1 | tail -5
git pull origin main 2>&1 | tail -15
python3 - "$BACKUP_ROOT" <<'PY'
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

backup = Path(sys.argv[1])
locations = {
  "data": (backup / "data", Path("data")),
  "uploads": (backup / "uploads", Path("public/uploads")),
  "public-img": (backup / "public-img", Path("public/img")),
}

def snapshot(root):
  entries = {}
  def visit(folder, relative=""):
    for entry in sorted(os.scandir(folder), key=lambda item: item.name):
      path = Path(entry.path)
      name = f"{relative}/{entry.name}" if relative else entry.name
      if entry.is_symlink():
        entries[name] = {"type": "symlink", "target": os.readlink(entry.path)}
      elif entry.is_dir(follow_symlinks=False):
        entries[name] = {"type": "directory"}
        visit(path, name)
      elif entry.is_file(follow_symlinks=False):
        digest = hashlib.sha256()
        with open(entry.path, "rb") as stream:
          for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
        entries[name] = {"type": "file", "size": entry.stat(follow_symlinks=False).st_size, "sha256": digest.hexdigest()}
      else:
        raise RuntimeError(f"unsupported filesystem entry: {path}")
  visit(root)
  return entries

manifest = json.loads((backup / "manifest.json").read_text())
for name, (saved, active) in locations.items():
  expected = snapshot(saved)
  digest = hashlib.sha256(json.dumps(expected, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
  if digest != manifest["locations"][name]["sha256"]:
    raise SystemExit(f"ERROR: respaldo alterado o ilegible: {name}")
  shutil.copytree(saved, active, dirs_exist_ok=True, symlinks=True)
  restored = snapshot(active)
  mismatched = [key for key, value in expected.items() if restored.get(key) != value]
  if mismatched:
    raise SystemExit(f"ERROR restaurando {name}; diferencias: {mismatched[:5]}")
  print(f"VERIFIED RESTORE {name}: {manifest['locations'][name]['files']} backup files preserved")
PY
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
pm2 list 2>&1 | head -30 || true
echo "--- pm2 logs tail ---"
pm2 logs app-embair-web --lines 40 --nostream 2>&1 | tail -60

echo "===(7) ENDPOINT CHECKS (localhost)==="
sleep 3
curl -sS -o /dev/null -w "GET / -> HTTP %{http_code}\n" http://127.0.0.1:3002/
curl -sS -o /dev/null -w "GET /landing.html -> HTTP %{http_code}\n" http://127.0.0.1:3002/landing.html
curl -sS -o /dev/null -w "GET /admin.html -> HTTP %{http_code}\n" http://127.0.0.1:3002/admin.html
curl -sS -o /dev/null -w "GET /api/products -> HTTP %{http_code}\n" http://127.0.0.1:3002/api/products

echo "===DONE==="
