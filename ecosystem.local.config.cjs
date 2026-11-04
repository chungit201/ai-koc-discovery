// pm2 trên MÁY LOCAL (Windows): worker crawl chạy liên tục. Server dùng ecosystem.config.cjs (web).
//   npm i -g pm2 · pm2 start ecosystem.local.config.cjs · pm2 save
// Tự bật lại sau khi khởi động máy: scheduled task "DETOLA-pm2" chạy `pm2 resurrect` lúc đăng nhập
// (pm2 startup không hỗ trợ Windows) — xem docs/04-crawl.md.
module.exports = {
  apps: [
    {
      name: "detola-crawl",
      cwd: __dirname,
      script: "scripts/crawl-worker.ts",
      interpreter: "node",
      interpreter_args: "--env-file=.env.local --import tsx",
      // 3 = tài khoản bị khóa, 4 = Kalodata chặn, 6 = phiên hỏng → KHÔNG tự bật lại (cần người xử lý)
      stop_exit_codes: [3, 4, 6],
      autorestart: true,
      restart_delay: 600000, // worker chết bất thường → bật lại sau 10 phút
      max_restarts: 50,
      time: true,
      out_file: "logs/crawl-worker.log",
      error_file: "logs/crawl-worker.err.log",
      merge_logs: true,
    },
  ],
};
