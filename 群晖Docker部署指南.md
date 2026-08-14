# 简舜科技建站信息聚合平台 · 群晖 Docker 部署指南

> 适用：群晖 DSM 7.2+（含 Container Manager），或其他支持 Docker 的 NAS。
> 本部署包已内置全部数据（86 个场地、分类、AI/高德配置），部署完成即可直接使用。

---

## 一、准备工作

1. 套件中心安装 **Container Manager**（DSM 7.2+）或 **Docker**（旧版 DSM）。
2. 将本部署包 `jianshun-site-docker-deploy.zip` 上传到群晖 **File Station**（建议放在 `/volume1/docker/`）。
3. 在 File Station 中右键压缩包 → **解压**，得到 `jianshun-site` 文件夹。
4. 确认解压后目录结构：
   ```
   /volume1/docker/jianshun-site/
   ├── docker-compose.yml   ← Container Manager 需要识别这个文件
   ├── Dockerfile
   ├── server.js
   ├── lib/  public/  data/  uploads/  scripts/
   └── .env
   ```

---

## 二、方式 A：Container Manager 图形界面（推荐，无需 SSH）

1. 打开 **Container Manager** → 左侧 **项目** → **新增**。
2. 名称随意（如 `jianshun-site`），路径选择 `docker/jianshun-site` 文件夹。
   - 系统会自动识别 `docker-compose.yml`，显示"可用的项目"。
3. 点击 **下一步**，确认配置：
   - **启用构建镜像**：保持勾选（首次部署需构建）。
   - 端口：`3000` 已映射，如冲突可修改。
4. 点击 **完成**，等待构建并启动（首次构建需下载镜像 + 安装依赖，约 2~5 分钟）。
5. 启动成功后访问：`http://群晖IP:3000`。

### 常见问题（方式 A）

| 现象 | 处理 |
| --- | --- |
| 构建失败，提示网络错误/拉取超时 | 群晖无法访问 Docker Hub 或 npm registry，见第四节「离线/受限网络方案」 |
| 启动后马上退出（日志有 EADDRINUSE） | 3000 端口被占用，改 `docker-compose.yml` 中 `"3000:3000"` 为 `"3001:3000"`，访问 `:3001` |
| 数据目录没写入权限 | File Station 中右键 `data`、`uploads` 文件夹 → 属性 → 权限 → 设为可读写 |
| 想停止/重启 | Container Manager → 项目 → 选择该项目 → 停止/启动 |

---

## 三、方式 B：SSH + docker-compose

群晖开启 SSH（控制面板 → 终端机和 SNMP → 启用 SSH），然后：

```bash
ssh 用户名@群晖IP
cd /volume1/docker/jianshun-site

# 构建并启动
sudo docker compose up -d --build

# 查看日志
sudo docker compose logs -f

# 停止 / 重启 / 删除
sudo docker compose stop
sudo docker compose restart
sudo docker compose down
```

---

## 四、离线 / 受限网络方案

若群晖无法访问 **Docker Hub**（拉取 `node:18-alpine`）或 **npm registry**（`npm install`），二选一：

### 方案 1：换用国内镜像源
```bash
# 在群晖 SSH 中执行（仅影响本次构建）
sudo docker compose build --build-arg  # 或编辑 Dockerfile 顶部加：
```
编辑 `Dockerfile`，在 `FROM node:18-alpine` 后加一行：
```dockerfile
RUN npm config set registry https://registry.npmmirror.com
```
Docker Hub 镜像源（如 `docker.m.daocloud.io/node:18-alpine`）可自行替换 FROM。

### 方案 2：免构建部署（依赖全部为纯 JS，无原生模块）
在能联网的电脑上执行 `npm install` 生成 `node_modules`，随包一起上传，
然后改 `docker-compose.yml` 中 `build: .` 为 `image: node:18-alpine`，并在
`volumes` 中追加 `- ./node_modules:/app/node_modules`，启动命令保持 `node server.js`。
（本部署包默认不含 node_modules，采用标准构建方式。）

---

## 五、数据与备份

- 所有业务数据在 `data/`（sites/users/categories/ai_config JSON），媒体在 `uploads/`。
- **备份 = 拷贝这两个文件夹**（或 Container Manager 中做快照）。
- 迁移到新机器：拷贝 `data/` + `uploads/` 到新部署包对应目录即可，无需导出导入。

## 六、安全提醒

- ⚠️ **`data/ai_config.json` 内含真实 API Key（DeepSeek / 高德）**，请妥善保管本部署包，勿上传公开仓库或外传。
- 默认管理员 `admin / password`，首次登录后请立即修改密码。
- 密码为明文存储（演示级），公网部署建议后续升级 bcrypt 加密（见 PRD §9.3）。

## 七、验证清单

部署完成后逐项确认：
- [ ] `http://群晖IP:3000` 打开地图，86 个标记正常显示
- [ ] 登录 `admin`，能看到管理按钮
- [ ] 点开任意场地详情，数据完整
- [ ] 「路况热力图」能出图（需高德 Key 已配置——本包已内置）
- [ ] 「AI 分析报告」能生成（需 DeepSeek Key 有效——本包已内置）
