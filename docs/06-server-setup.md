# Server & Database Setup

## Server

| | |
|---|---|
| Host | `root@66.42.50.32` (Vultr) |
| OS | Ubuntu 24.04.5 LTS · 2 vCPU · 3.8 GB RAM + 8 GB swap · 94 GB disk |
| Login | SSH key (`~/.ssh/id_ed25519`). Password root vẫn bật — nên tắt sau |
| Firewall | UFW active, chỉ allow `22/tcp` (OpenSSH) |

## MongoDB

| | |
|---|---|
| Version | MongoDB 8.0.34 (repo chính thức `mongodb-org/8.0`, noble) |
| Bind | `127.0.0.1:27017` — **không mở ra internet** |
| Auth | `security.authorization: enabled` |
| Users | `admin` (root, DB `admin`) — chỉ dùng vận hành · `detola` (readWrite, DB `detola`) — app dùng |
| Config | `/etc/mongod.conf` · data `/var/lib/mongodb` · log `/var/log/mongodb/mongod.log` |
| Secrets | `MONGODB_URI`, `MONGO_ADMIN_PASSWORD` trong `.env.local` (không commit) |

### Kết nối từ máy local

```bash
# Terminal 1 — giữ mở
npm run db:tunnel        # ssh -N -L 27117:127.0.0.1:27017 root@66.42.50.32

# Terminal 2
npm run db:ping          # → MongoDB ok=1 db=detola
```

Port local là **27117** (máy dev đã có một `mongod` riêng chạy ở 27018 — đừng dùng port đó).
Dùng GUI (Compass): connection string trong `.env.local`, host `127.0.0.1:27117` khi tunnel đang mở.

### Khi deploy app lên chính server này
App chạy cùng máy → đổi URI sang `127.0.0.1:27017`, không cần tunnel.

### Vận hành

```bash
ssh root@66.42.50.32
systemctl status mongod
mongosh "mongodb://admin:<MONGO_ADMIN_PASSWORD>@127.0.0.1:27017/admin"
mongodump --uri "mongodb://admin:<pw>@127.0.0.1:27017/?authSource=admin" --db detola --out /root/backup/$(date +%F)
```

## Lịch sử thay đổi

- 2026-11-01: thêm SSH key; bật UFW (chỉ SSH); thử cài PostgreSQL rồi gỡ sạch (chuyển sang MongoDB); cài MongoDB 8.0.34 + auth + 2 user; test kết nối qua tunnel thành công.

## TODO bảo mật
- [ ] Tắt `PasswordAuthentication` + đổi password root (password cũ đã lộ trong chat).
- [ ] Cron backup `mongodump` hằng ngày, giữ 7 bản.

## SSH tunnel tới MongoDB (máy dev) — sự cố 2026-11-02
- App kết nối `127.0.0.1:27117` → SSH tunnel → server `127.0.0.1:27017`.
- **Sự cố:** watchdog `scripts/db-tunnel.ps1` trước chỉ chạy tay một lần (tiến trình ẩn), không được đăng ký chạy tự động. Watchdog chết → tunnel rớt → không ai nối lại → app báo lỗi kết nối DB. Server và mongod không có lỗi gì.
- **Khắc phục:** watchdog đăng ký thành Scheduled Task `DETOLA-db-tunnel`:
  - chạy khi đăng nhập Windows;
  - tự khởi động lại nếu bị tắt (mỗi phút, tối đa 999 lần), không bị dừng khi dùng pin;
  - ssh rớt → nối lại trong ~15s (đã test: kill ssh → tự nối lại).
- Cài/cài lại: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\db-tunnel.ps1 -Install`
- Log: `.cache\db-tunnel.log` · Kiểm tra: `Get-ScheduledTask DETOLA-db-tunnel`, `npm`-free ping: `node --env-file=.env.local scripts/db-ping.mjs`
