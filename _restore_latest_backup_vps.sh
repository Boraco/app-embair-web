#!/usr/bin/env bash
set -u
export TERM=xterm

cd /var/www/app-embair-web || exit 1
LATEST_BACKUP=$(find /var/backups/app-embair-web -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | tail -1)
if [ -z "$LATEST_BACKUP" ] || [ ! -d "$LATEST_BACKUP/data" ]; then
  echo "NO HAY BACKUP COMPLETO DISPONIBLE"
  exit 1
fi

echo "Restaurando desde: $LATEST_BACKUP"
mkdir -p data public/uploads
cp -a "$LATEST_BACKUP/data/." data/
if [ -d "$LATEST_BACKUP/uploads" ]; then
  cp -a "$LATEST_BACKUP/uploads/." public/uploads/
fi

python3 - <<'PY'
import json
from pathlib import Path
for label, path in [("backup", Path("/var/backups/app-embair-web")), ("actual", Path("data"))]:
    if label == "backup":
        candidates = sorted(path.glob("*/data/products.json"))
        target = candidates[-1] if candidates else None
    else:
        target = path / "products.json"
    if not target or not target.exists():
        print(f"{label} products.json: no encontrado")
        continue
    try:
        data = json.loads(target.read_text())
        print(f"{label} products.json items: {len(data) if isinstance(data, list) else 'invalid_format'}")
    except Exception as e:
        print(f"{label} products.json ERROR: {e}")
PY

chown -R www-data:www-data /var/www/app-embair-web
a=0
chmod -R 775 public/uploads data
pm2 restart app-embair-web 2>&1 | tail -10
pm2 save 2>&1 | tail -3
sleep 4
printf "GET /api/products items: "
curl -sS http://127.0.0.1:3002/api/products 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else 'invalid_response')" 2>&1
printf "GET /robots.txt HTTP: "
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3002/robots.txt
printf "GET /sitemap.xml HTTP: "
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3002/sitemap.xml
echo "===RESTORE DONE==="
