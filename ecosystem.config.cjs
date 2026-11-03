// pm2 trên server (scripts/deploy.sh). Chỉ nghe 127.0.0.1 — nginx đứng trước nhận 80/443.
module.exports = {
  apps: [
    {
      name: "detola-web",
      cwd: "/srv/detola",
      script: "node_modules/next/dist/bin/next",
      args: "start -H 127.0.0.1 -p 3000",
      env: { NODE_ENV: "production" },
      max_memory_restart: "1500M",
    },
  ],
};
