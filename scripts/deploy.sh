#!/usr/bin/env bash
# Deploy web lên server: đóng gói code đang có ở máy (kể cả thay đổi chưa commit) → đẩy lên
# /srv/detola → npm ci → build → pm2 reload. Chạy từ gốc repo:  bash scripts/deploy.sh
#
# Server (cài một lần, xem docs/01-getting-started.md §7): Node 20, nginx, pm2, Claude CLI, user `detola`.
# `.env.local` trên server là bản RIÊNG (Mongo nối thẳng 127.0.0.1:27017, không qua tunnel) — script
# không ghi đè nó.
set -euo pipefail

HOST="${DEPLOY_HOST:-root@66.42.50.32}"
DIR=/srv/detola

echo "▸ đóng gói + đẩy code lên $HOST:$DIR"
tar czf - \
  --exclude=./node_modules --exclude=./.next --exclude=./.git --exclude=./.auth \
  --exclude=./logs --exclude=./.cache --exclude=./.idea --exclude='./.env*' --exclude=./tsconfig.tsbuildinfo \
  . | ssh "$HOST" "mkdir -p $DIR && tar xzf - -C $DIR && chown -R detola:detola $DIR"

echo "▸ cài thư viện + build + khởi động lại"
ssh "$HOST" "su - detola -c 'set -e; cd $DIR
  test -f .env.local || { echo \"THIẾU $DIR/.env.local trên server\"; exit 1; }
  npm ci --no-audit --no-fund --loglevel=error
  npm run build
  pm2 startOrReload ecosystem.config.cjs --update-env
  pm2 save'"

echo "✓ xong — https://bananacinema.com"
