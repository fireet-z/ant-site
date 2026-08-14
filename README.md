# XX科技 · 建站信息聚合平台

「地图 + 信息 + AI」一体化的建站选址信息聚合管理系统，帮助蚂蚁站业务拓展人员快速定位场地、评估周边环境、生成专业分析报告，支持多用户协同管理。

- **文档版本**：V3.0（对应 PRD V3.0，2026-08-10）
- **技术栈**：Node.js 18 + Express 4 ｜ 原生 HTML5/CSS3/JS(ES6) + Leaflet + 高德地图 ｜ JSON 文件存储

---

## 功能总览

| 模块 | 说明 |
| --- | --- |
| 🗺️ 地图展示 | 高德矢量瓦片（GCJ-02）、数字序号标记、选中紫色高亮、弹窗快捷详情、复位视图 |
| 📍 选点添加 | 地图右上角「选点添加」，点击地图自动填入经纬度 |
| 🚦 路况热力图 | 调用高德交通态势 API，绿→黄→橙→红实时展示当前视野拥堵，移动/缩放自动更新 |
| 📋 场地管理 | 完整选址字段 CRUD，搜索（名称/地址/联系人/描述）+ 分类筛选，列表与地图同步 |
| 📄 独立详情页 | URL 携带 `?id=` 直接打开详情，一键复制分享链接 |
| 🖼️ 多媒体上传 | 图片(jpg/png/gif/webp) + 视频(mp4/mov/webm)，单文件 ≤ 50MB，进度条 |
| 🏷️ 自定义分类 | 管理员新增/删除分类，表单与筛选下拉实时同步 |
| 📋 自定义字段 | 后台动态表单：文本框/多行文本/数字/单选/下拉/多选六种控件，可增删、排序、设必填，按角色（管理员/普通用户/游客）控制是否显示，值随场地数据导入导出。**内置 22 个非关键字段（区域类型/产权/租赁等）同样可在「字段管理」中修改或删除，删除时同步清理场地数据**（名称/地址/经纬度为关键字段不可删） |
| 👥 用户权限 | 游客 / 普通用户 / 管理员三级权限，密码可修改，admin 不可删除 |
| 📦 导入导出 | JSON/CSV 导入（覆盖/追加 + 自动去重选项 + 必填校验 + 模版下载）；导出纯数据或含媒体 ZIP（按场地地址分文件夹） |
| 🤖 AI 智能分析 | 建站分析报告 + 周边可行性分析（OpenAI 兼容接口：DeepSeek/通义千问等），Markdown 展示 + 下载 .md |
| ⚙️ AI 配置 | 网页动态配置 API Key / 接口地址 / 模型 / 高德 Key，无需改代码重启 |

## 目录结构

```
jianshun-site/
├── server.js              # Express 后端（全部 API）
├── package.json
├── .env.example           # 环境变量模板
├── Dockerfile
├── docker-compose.yml
├── lib/                   # 后端模块（数据层/认证/CSV/外部服务）
├── data/                  # 数据文件（Docker 挂载卷）
│   ├── sites.json         # 场地数据
│   ├── users.json         # 用户（默认 admin / password）
│   ├── categories.json    # 分类
│   ├── fields.json        # 字段定义（内置 22 个非关键字段 + 自定义字段）
│   └── ai_config.json     # AI / 高德配置
├── uploads/               # 上传的图片视频（Docker 挂载卷）
└── public/                # 前端（index.html / css / js / vendor 本地依赖）
```

## 快速开始

### 方式一：Docker 部署（推荐）

```bash
cd jianshun-site
cp .env.example .env        # 配置 AI / 高德 Key（也可部署后在网页「AI 配置」中设置）
docker-compose down
docker-compose build --no-cache
docker-compose up -d
docker-compose logs -f      # 查看日志
# 访问 http://你的服务器IP:3000
```

### 方式二：群晖 Web Station 部署

1. 套件中心安装 **Web Station** 和 **Node.js**；
2. 将项目文件上传到 `web` 共享文件夹；
3. Web Station → 新增网页服务：
   - 服务类型：**本机脚本语言网站**
   - 脚本语言：**Node.js**
   - 主要脚本：`server.js`
   - 端口：自定义（如 3000）
4. 防火墙放行该端口；
5. 访问 `http://群晖IP:端口`。

### 方式三：独立 Node.js 部署

```bash
npm install
npm install -g pm2
pm2 start server.js --name jianshun-site
pm2 save && pm2 startup
```

## 环境变量（.env）

| 变量 | 说明 | 必填 | 默认值 |
| --- | --- | --- | --- |
| PORT | 服务端口 | 否 | 3000 |
| AI_API_KEY | AI 服务 API Key | 否（可在网页配置） | - |
| AI_API_URL | AI 服务 API 地址 | 否（可在网页配置） | https://api.openai.com/v1/chat/completions |
| AI_MODEL | AI 模型名称 | 否（可在网页配置） | gpt-4o-mini |
| AI_AMAP_KEY | 高德地图 Key | 否（可在网页配置） | - |
| MAX_UPLOAD_MB | 单文件上传上限(MB) | 否 | 50 |

> 网页端「AI 配置」保存的值优先级高于环境变量。

## 默认账号

| 角色 | 账号 | 密码 |
| --- | --- | --- |
| 超级管理员 | admin | password |

> ⚠️ 演示级：密码明文存储，生产环境请修改默认密码并升级 bcrypt 加密（见 PRD §9.3）。

## API 一览

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| POST | /api/login | 登录，返回 token | 公开 |
| GET | /api/users | 用户列表 | 管理员 |
| POST | /api/users | 添加用户 | 管理员 |
| DELETE | /api/users/:id | 删除用户（admin 除外） | 管理员 |
| PUT | /api/users/password | 修改密码 | 已登录 |
| GET | /api/categories | 分类列表 | 公开 |
| POST | /api/categories | 添加分类 | 管理员 |
| DELETE | /api/categories/:name | 删除分类 | 管理员 |
| GET | /api/fields | 自定义字段列表（按角色过滤） | 公开 |
| GET | /api/fields/admin | 全部自定义字段（含可见性配置） | 管理员 |
| POST | /api/fields | 添加自定义字段 | 管理员 |
| PUT | /api/fields/:id | 更新自定义字段 | 管理员 |
| DELETE | /api/fields/:id | 删除自定义字段（同步清理场地值） | 管理员 |
| POST | /api/fields/reorder | 调整字段顺序 | 管理员 |
| GET | /api/sites | 场地列表（游客隐藏联系方式） | 公开 |
| POST | /api/sites | 添加场地 | 管理员 |
| PUT | /api/sites/:id | 更新场地 | 管理员 |
| DELETE | /api/sites/:id | 删除场地 | 管理员 |
| POST | /api/upload | 上传图片/视频（多文件） | 管理员 |
| DELETE | /api/upload/:filename | 删除已上传的媒体文件 | 管理员 |
| POST | /api/sites/import | 导入 JSON/CSV（覆盖/追加） | 管理员 |
| GET | /api/sites/import-template | 下载导入模版 | 管理员 |
| GET | /api/sites/export | 导出纯数据 JSON/CSV | 管理员 |
| GET | /api/sites/export-full | 导出含媒体 ZIP | 管理员 |
| GET | /api/ai/config | 获取 AI 配置 | 管理员 |
| PUT | /api/ai/config | 更新 AI 配置 | 管理员 |
| POST | /api/sites/:id/analyze | 生成建站分析报告 | 管理员 |
| POST | /api/sites/:id/analyze-surrounding | 生成周边可行性分析 | 管理员 |
| POST | /api/surrounding-pois | 搜索周边 POI（充电站） | 管理员 |
| GET | /api/traffic/heatmap | 交通态势热力图数据 | 管理员 |
| GET | /api/fields | 当前角色可见的自定义字段定义 | 公开 |
| GET | /api/fields/admin | 全部字段（含可见性配置） | 管理员 |
| POST | /api/fields | 添加自定义字段 | 管理员 |
| PUT | /api/fields/:id | 更新自定义字段 | 管理员 |
| DELETE | /api/fields/:id | 删除字段（同步清理场地中的值） | 管理员 |
| POST | /api/fields/reorder | 调整字段顺序 | 管理员 |

认证方式：`Authorization: Bearer <token>`。

## 使用提示

- **配置 Key**：登录 admin → 右上角用户名 → 「AI 配置」，填入 AI API Key / 接口地址 / 模型 / 高德 Key。
- **导入数据**：先在「导入/导出 → 下载导入模版」获取格式，JSON/CSV 均可，必填 `name, lat, lng`。默认勾选「自动去重（按 名称+坐标 跳过已存在的场地）」，防止重复导入导致数据翻倍；如需强制新增可取消勾选。
- **导出含媒体**：选择「导出 ZIP」会按场地地址分文件夹打包全部图片/视频。
- **分享场地**：详情页「分享此场地」复制链接，微信等平台打开即直达详情（`?id=`）。
- **移动端**：窄屏（<769px）自动切换为底部抽屉布局。
- **数据备份**：备份 `data/` 与 `uploads/` 两个目录即可。

## 技术说明

- 前端依赖（Leaflet、Leaflet.heat、Font Awesome）已本地化至 `public/vendor/`，内网/群晖环境无需外网 CDN。
- 高德瓦片与 GCJ-02 坐标直接匹配；如瓦片访问受限可替换为 CartoDB/OSM 瓦片（PRD §11）。
- 周边 POI 保存时自动存入场地 `surroundingPois`，详情页地图与列表同步展示。
