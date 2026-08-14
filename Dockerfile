# 简舜科技建站信息聚合平台 - Docker 镜像
# 群晖 Container Manager 构建时需能访问 Docker Hub 与 npm registry
# 若网络受限构建失败，见「群晖Docker部署指南.md」的离线备选方案
FROM node:18-alpine

WORKDIR /app

# 时区（可选，注释取消后需 apk add tzdata）
# ENV TZ=Asia/Shanghai
# RUN apk add --no-cache tzdata

# 先复制依赖清单，利用 Docker 层缓存
COPY package*.json ./
RUN npm install --omit=dev

# 复制源码
COPY . .

# 数据与上传目录（挂载卷）
VOLUME ["/app/data", "/app/uploads"]

EXPOSE 3000

# 健康检查（可选）
# HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3000/ || exit 1

CMD ["node", "server.js"]
