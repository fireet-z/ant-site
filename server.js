/**
 * 简舜科技建站信息聚合平台 - 后端入口
 * Node.js 18+ / Express 4，JSON 文件存储，Docker / 群晖 Web Station / 独立部署
 */
// 轻量 .env 加载（无第三方依赖）
try {
  const envFile = require('fs').readFileSync(require('path').join(__dirname, '.env'), 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (e) { /* 无 .env 文件时忽略 */ }

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const archiver = require('archiver');
const db = require('./lib/db');
const auth = require('./lib/auth');
const csvUtil = require('./lib/csv');
const svc = require('./lib/services');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 50);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ---------- 静态资源 ----------
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(db.UPLOAD_DIR));

// ================= 5.1 认证 =================
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });
  const result = auth.login(String(username), String(password));
  if (!result) return res.status(401).json({ error: '用户名或密码错误' });
  res.json(result);
});

// ================= 5.2 用户管理 =================
app.get('/api/users', auth.requireAdmin, (req, res) => {
  const { users } = db.load('users');
  res.json(users.map(u => ({ id: u.id, username: u.username, role: u.role })));
});

app.post('/api/users', auth.requireAdmin, (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
  const store = db.load('users');
  if (store.users.some(u => u.username === username)) {
    return res.status(400).json({ error: '用户名已存在' });
  }
  const user = { id: db.genId(), username: String(username), password: String(password), role: role === 'admin' ? 'admin' : 'user' };
  store.users.push(user);
  db.save('users');
  res.json({ id: user.id, username: user.username, role: user.role });
});

app.delete('/api/users/:id', auth.requireAdmin, (req, res) => {
  const store = db.load('users');
  const idx = store.users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '用户不存在' });
  if (store.users[idx].id === 'admin' || store.users[idx].username === 'admin') {
    return res.status(400).json({ error: '不能删除超级管理员 admin' });
  }
  store.users.splice(idx, 1);
  db.save('users');
  res.json({ ok: true });
});

app.put('/api/users/password', auth.requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) return res.status(400).json({ error: '旧密码和新密码必填' });
  const store = db.load('users');
  const user = store.users.find(u => u.username === req.user.username);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.password !== String(oldPassword)) return res.status(400).json({ error: '旧密码不正确' });
  user.password = String(newPassword);
  db.save('users');
  res.json({ ok: true });
});

// ================= 5.3 分类管理 =================
app.get('/api/categories', (req, res) => {
  res.json(db.load('categories').categories);
});

app.post('/api/categories', auth.requireAdmin, (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: '分类名称不能为空' });
  const store = db.load('categories');
  const n = String(name).trim();
  if (store.categories.includes(n)) return res.status(400).json({ error: '分类已存在' });
  store.categories.push(n);
  db.save('categories');
  res.json(store.categories);
});

app.delete('/api/categories/:name', auth.requireAdmin, (req, res) => {
  const store = db.load('categories');
  const name = decodeURIComponent(req.params.name);
  const idx = store.categories.indexOf(name);
  if (idx === -1) return res.status(404).json({ error: '分类不存在' });
  store.categories.splice(idx, 1);
  db.save('categories');
  res.json(store.categories);
});

// ================= 5.4 场地管理 =================

/** 按权限过滤场地（游客/普通用户隐藏联系方式 + 不可见的自定义/内置字段） */
function sanitizeSite(site, user) {
  const role = user ? user.role : 'guest';
  if (role === 'admin') return site;
  const copy = { ...site };
  const { fields } = db.load('fields');
  // 自定义字段脱敏
  if (copy.fields) {
    const visibleIds = new Set(fields.filter(f => !f.internal && f.visibleTo.includes(role)).map(f => f.id));
    const filtered = {};
    for (const [k, v] of Object.entries(copy.fields)) if (visibleIds.has(k)) filtered[k] = v;
    copy.fields = filtered;
  }
  // 内置字段脱敏（contactPhone / contact 仅管理员可见）
  for (const f of fields) {
    if (!f.internal) continue;
    if (!f.visibleTo.includes(role)) delete copy[f.id];
  }
  return copy;
}

/** 自定义字段值清洗：仅保留已定义字段的 id */
function sanitizeFieldsInput(fields) {
  if (!fields || typeof fields !== 'object') return {};
  const { fields: defs } = db.load('fields');
  const known = new Set(defs.map(f => f.id));
  const out = {};
  for (const [k, v] of Object.entries(fields)) if (known.has(k)) out[k] = v;
  return out;
}

app.get('/api/sites', auth.optionalAuth, (req, res) => {
  const { sites } = db.load('sites');
  res.json(sites.map(s => sanitizeSite(s, req.user)));
});

/** 校验场地必填/经纬度/必填自定义字段 */
function validateSite(body) {
  if (!body.name || !String(body.name).trim()) return '场地名称必填';
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return '经纬度无效，请在地图上选点';
  }
  // 必填字段（内置字段查顶层属性，自定义字段查 fields 对象）——服务端兜底校验，防止绕过前端
  const { fields } = db.load('fields');
  for (const f of fields) {
    if (!f.required) continue;
    const v = f.internal ? body[f.id] : (body.fields && body.fields[f.id]);
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (empty) return `必填字段「${f.label}」未填写`;
  }
  return null;
}

app.post('/api/sites', auth.requireAdmin, (req, res) => {
  const err = validateSite(req.body || {});
  if (err) return res.status(400).json({ error: err });
  const store = db.load('sites');
  const site = {
    id: db.genId(),
    createdAt: new Date().toISOString(),
    ...req.body,
    images: Array.isArray(req.body.images) ? req.body.images : [],
    surroundingPois: Array.isArray(req.body.surroundingPois) ? req.body.surroundingPois : [],
    fields: sanitizeFieldsInput(req.body.fields)
  };
  store.sites.push(site);
  db.save('sites');
  res.json(site);
});

app.put('/api/sites/:id', auth.requireAdmin, (req, res) => {
  const err = validateSite(req.body || {});
  if (err) return res.status(400).json({ error: err });
  const store = db.load('sites');
  const idx = store.sites.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '场地不存在' });
  const existing = store.sites[idx];
  const updated = {
    ...existing,
    ...req.body,
    id: existing.id,
    images: Array.isArray(req.body.images) ? req.body.images : existing.images,
    surroundingPois: Array.isArray(req.body.surroundingPois) ? req.body.surroundingPois : existing.surroundingPois,
    fields: sanitizeFieldsInput(req.body.fields)
  };
  store.sites[idx] = updated;
  db.save('sites');
  res.json(updated);
});

app.delete('/api/sites/:id', auth.requireAdmin, (req, res) => {
  const store = db.load('sites');
  const idx = store.sites.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '场地不存在' });
  store.sites.splice(idx, 1);
  db.save('sites');
  res.json({ ok: true });
});

// ================= 5.5 文件上传 =================
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov', '.webm']);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, db.UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new Error(`不支持的文件类型 ${ext}，仅支持图片(jpg/png/gif/webp)和视频(mp4/mov/webm)`));
    cb(null, true);
  }
});

app.post('/api/upload', auth.requireAdmin, (req, res) => {
  upload.array('files', 20)(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? `单个文件不能超过 ${MAX_MB} MB` : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!req.files || !req.files.length) return res.status(400).json({ error: '未选择文件' });
    res.json({ files: req.files.map(f => `/uploads/${f.filename}`) });
  });
});

/** 删除已上传的媒体文件（配合场地图片管理：删除/重传） */
app.delete('/api/upload/:filename', auth.requireAdmin, (req, res) => {
  const name = path.basename(req.params.filename); // 防路径穿越
  if (!/^[\w.-]+$/.test(name)) return res.status(400).json({ error: '非法文件名' });
  const file = path.join(db.UPLOAD_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: '文件不存在' });
  fs.unlinkSync(file);
  res.json({ ok: true });
});

// ================= 5.6 导入导出 =================
/** 导入专用 multer：仅允许 .json/.csv */
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.json' && ext !== '.csv') return cb(new Error('导入仅支持 JSON 或 CSV 文件'));
    cb(null, true);
  }
});
/** 导入模版下载 */
app.get('/api/sites/import-template', auth.requireAdmin, (req, res) => {
  const fmt = req.query.format === 'csv' ? 'csv' : 'json';
  const sample = {
    name: '示例场地', siteCode: 'JD-001', lat: 31.2304, lng: 121.4737, address: '上海市浦东新区',
    regionType: '镇/村中心', heatmapColor: '绿色', trafficFlow: 10, contactPerson: '张三',
    contactPhone: '138-0000-0000', landType: '建设用地', landYears: 20, propertyType: '不动产权证',
    propertyOwner: '李四', canProvideProof: true, parkingCount: 2, parkingWidth: 2.5, parkingLength: 5.5,
    roadWidth: 4, distToRoad: 10, locationDesc: '临近高速入口', category: '办公', leaseTerms: '灵活租期',
    contact: '张经理 138-0000-1001', price: '10元/㎡/天', description: '场地开阔，交通便利',
    images: '[]', surroundingPois: '[]',
    fields: {} // 自定义字段值：{"字段ID":"值"}，字段ID在「字段管理」中查看
  };
  if (fmt === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sites-import-template.csv"');
    return res.send(csvUtil.toCSV([csvUtil.siteToRow(sample)], Object.keys(sample)));
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sites-import-template.json"');
  res.send(JSON.stringify([sample], null, 2));
});

/** 导入：multipart(file + mode + dedupe) 或 JSON body {sites, mode, dedupe} */
app.post('/api/sites/import', auth.requireAdmin, (req, res) => {
  /** 去重键：名称 + 坐标（6 位小数精度，兼容浮点误差） */
  const round6 = n => Math.round(Number(n) * 1e6) / 1e6;
  const keyOf = s => `${String(s.name).trim()}|${round6(s.lat)}|${round6(s.lng)}`;

  const doImport = (rawSites, mode, dedupe) => {
    if (!Array.isArray(rawSites)) return res.status(400).json({ error: '导入数据格式错误：应为数组' });
    const store = db.load('sites');
    let added = 0, updated = 0, skipped = 0;
    const errors = [];
    // 去重检测集合：先装入存量，再装入本批已接受的（防止批内重复）
    const existingKeys = new Set(dedupe ? store.sites.map(keyOf) : []);
    for (const raw of rawSites) {
      const site = typeof raw.images === 'string' ? csvUtil.rowToSite(raw) : { ...raw };
      if (!site.name || !String(site.name).trim()) { errors.push(`第 ${errors.length + added + updated + skipped + 1} 条：缺少必填字段 name`); continue; }
      const lat = Number(site.lat), lng = Number(site.lng);
      if (!isFinite(lat) || !isFinite(lng) || !lat || !lng) { errors.push(`${site.name}：缺少有效的 lat/lng`); continue; }
      if (dedupe) {
        const k = keyOf(site);
        if (existingKeys.has(k)) { skipped++; continue; }
        existingKeys.add(k);
      }
      if (mode === 'overwrite' && site.id && store.sites.some(s => s.id === site.id)) {
        const idx = store.sites.findIndex(s => s.id === site.id);
        store.sites[idx] = { ...store.sites[idx], ...site, id: site.id, fields: sanitizeFieldsInput(site.fields) };
        updated++;
      } else {
        const fresh = {
          ...site, id: db.genId(),
          images: site.images || [], surroundingPois: site.surroundingPois || [],
          fields: sanitizeFieldsInput(site.fields)
        };
        store.sites.push(fresh);
        added++;
      }
    }
    db.save('sites');
    res.json({ added, updated, skipped, errors, total: store.sites.length });
  };

  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    importUpload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: '请选择要导入的文件' });
      const mode = req.body.mode === 'append' ? 'append' : 'overwrite';
      const dedupe = req.body.dedupe === '1' || req.body.dedupe === 'true' || req.body.dedupe === true;
      const text = req.file.buffer.toString('utf8');
      const ext = path.extname(req.file.originalname).toLowerCase();
      try {
        const rawSites = ext === '.csv' ? csvUtil.parseCSV(text) : JSON.parse(text);
        doImport(rawSites, mode, dedupe);
      } catch (e) {
        res.status(400).json({ error: `文件解析失败：${e.message}` });
      }
    });
  } else {
    const { sites, mode, dedupe } = req.body || {};
    doImport(sites, mode === 'append' ? 'append' : 'overwrite', !!dedupe);
  }
});

/** 导出纯数据 */
app.get('/api/sites/export', auth.requireAdmin, (req, res) => {
  const fmt = req.query.format === 'csv' ? 'csv' : 'json';
  const { sites } = db.load('sites');
  if (fmt === 'csv') {
    const rows = sites.map(csvUtil.siteToRow);
    const cols = rows.length ? Object.keys(rows[0]) : ['name', 'lat', 'lng'];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sites-export.csv"');
    return res.send(csvUtil.toCSV(rows, cols));
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sites-export.json"');
  res.send(JSON.stringify(sites, null, 2));
});

/** 导出含媒体 ZIP：数据文件 + 按场地地址分文件夹的媒体文件 */
app.get('/api/sites/export-full', auth.requireAdmin, (req, res) => {
  const fmt = req.query.format === 'csv' ? 'csv' : 'json';
  const { sites } = db.load('sites');

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="sites-full-export.zip"');
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('warning', () => {});
  archive.on('error', (err) => { res.status(500).json({ error: `打包失败：${err.message}` }); });
  archive.pipe(res);

  // 数据文件
  if (fmt === 'csv') {
    const rows = sites.map(csvUtil.siteToRow);
    const cols = rows.length ? Object.keys(rows[0]) : ['name', 'lat', 'lng'];
    archive.append(csvUtil.toCSV(rows, cols), { name: 'data/sites.csv' });
  } else {
    archive.append(JSON.stringify(sites, null, 2), { name: 'data/sites.json' });
  }

  // 媒体文件按场地分文件夹
  const seen = new Set();
  for (const site of sites) {
    const folder = sanitizeFolder(site.address || site.name || site.id);
    for (const img of (site.images || [])) {
      if (!img.startsWith('/uploads/')) continue;
      const file = path.join(db.UPLOAD_DIR, path.basename(img));
      if (!fs.existsSync(file)) continue;
      const key = path.basename(img);
      if (seen.has(key)) continue;
      seen.add(key);
      archive.file(file, { name: `${folder}/${path.basename(img)}` });
    }
  }
  archive.finalize();
});

function sanitizeFolder(name) {
  return String(name).replace(/[\\/:*?"<>|\r\n\t]+/g, '_').slice(0, 60) || '未命名场地';
}

// ================= 5.7 AI 服务 =================
app.get('/api/ai/config', auth.requireAdmin, (req, res) => {
  const cfg = db.load('ai_config');
  res.json({ apiKey: cfg.apiKey || '', apiUrl: cfg.apiUrl || '', model: cfg.model || '', amapKey: cfg.amapKey || '' });
});

app.put('/api/ai/config', auth.requireAdmin, (req, res) => {
  const cfg = db.load('ai_config');
  const { apiKey, apiUrl, model, amapKey } = req.body || {};
  if (apiKey !== undefined) cfg.apiKey = String(apiKey);
  if (apiUrl !== undefined) cfg.apiUrl = String(apiUrl);
  if (model !== undefined) cfg.model = String(model);
  if (amapKey !== undefined) cfg.amapKey = String(amapKey);
  db.save('ai_config');
  res.json({ ok: true });
});

/** 生成建站分析报告 */
app.post('/api/sites/:id/analyze', auth.requireAdmin, async (req, res) => {
  const store = db.load('sites');
  const site = store.sites.find(s => s.id === req.params.id);
  if (!site) return res.status(404).json({ error: '场地不存在' });
  try {
    const report = await svc.analyzeSite(site);
    site.aiReport = report;
    site.aiReportDate = new Date().toISOString();
    db.save('sites');
    res.json({ report, date: site.aiReportDate });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** 生成周边可行性分析（先取高德 POI，再调用 AI） */
app.post('/api/sites/:id/analyze-surrounding', auth.requireAdmin, async (req, res) => {
  const store = db.load('sites');
  const site = store.sites.find(s => s.id === req.params.id);
  if (!site) return res.status(404).json({ error: '场地不存在' });
  try {
    const config = svc.getAIConfig();
    let pois = [];
    try {
      pois = await svc.fetchSurroundingPois(site.lng, site.lat, config.amapKey);
    } catch (e) {
      pois = site.surroundingPois || [];
    }
    const report = await svc.analyzeSurrounding(site, pois);
    site.surroundingReport = report;
    site.surroundingReportDate = new Date().toISOString();
    db.save('sites');
    res.json({ report, date: site.surroundingReportDate, pois });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================= 5.8 高德地图服务 =================
/** 周边 POI 搜索（表单「显示周边 5 公里站点」） */
app.post('/api/surrounding-pois', auth.requireAdmin, async (req, res) => {
  const { lng, lat, radius } = req.body || {};
  if (!isFinite(Number(lng)) || !isFinite(Number(lat))) return res.status(400).json({ error: '缺少有效的经纬度' });
  try {
    const config = svc.getAIConfig();
    const pois = await svc.fetchSurroundingPois(Number(lng), Number(lat), config.amapKey, Number(radius) || 5000);
    res.json(pois);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** 交通态势热力图数据（矩形范围） */
app.get('/api/traffic/heatmap', auth.requireAdmin, async (req, res) => {
  const { minLng, minLat, maxLng, maxLat } = req.query;
  if (![minLng, minLat, maxLng, maxLat].every(v => isFinite(Number(v)))) {
    return res.status(400).json({ error: '缺少有效的矩形范围参数' });
  }
  try {
    const config = svc.getAIConfig();
    const points = await svc.fetchTrafficHeatmap({
      minLng: Number(minLng), minLat: Number(minLat), maxLng: Number(maxLng), maxLat: Number(maxLat)
    }, config.amapKey);
    res.json(points);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================= 5.9 自定义字段（动态表单） =================
const FIELD_TYPES = ['text', 'textarea', 'number', 'radio', 'select', 'checkbox'];
const FIELD_ROLES = ['admin', 'user', 'guest'];

function validateField(body) {
  if (!body.label || !String(body.label).trim()) return '字段名称必填';
  if (!FIELD_TYPES.includes(body.type)) return '字段类型无效';
  if (['radio', 'select', 'checkbox'].includes(body.type)) {
    if (!Array.isArray(body.options) || !body.options.length) return '该字段类型至少需要一个选项';
    if (body.options.some(o => !String(o).trim())) return '选项内容不能为空';
  }
  if (!Array.isArray(body.visibleTo) || !body.visibleTo.length) return '至少选择一个可见角色';
  if (body.visibleTo.some(r => !FIELD_ROLES.includes(r))) return '可见角色配置无效';
  return null;
}

function buildField(body, existing) {
  return {
    id: existing ? existing.id : db.genId(),
    label: String(body.label).trim(),
    type: body.type,
    options: ['radio', 'select', 'checkbox'].includes(body.type)
      ? body.options.map(String).map(s => s.trim()).filter(Boolean)
      : [],
    placeholder: body.placeholder ? String(body.placeholder).trim() : '',
    required: !!body.required,
    visibleTo: [...new Set(body.visibleTo)],
    // internal 标记仅由系统预置（内置字段），API 创建的字段一律为普通自定义字段
    internal: existing ? !!existing.internal : false,
    order: existing ? existing.order : db.load('fields').fields.length
  };
}

/** 当前角色可见的字段（管理端返回全部；普通端按 visibleTo 过滤） */
app.get('/api/fields', auth.optionalAuth, (req, res) => {
  const { fields } = db.load('fields');
  const sorted = [...fields].sort((a, b) => a.order - b.order);
  const role = req.user ? req.user.role : 'guest';
  const list = role === 'admin' ? sorted : sorted.filter(f => f.visibleTo.includes(role));
  res.json(list.map(f => ({ id: f.id, label: f.label, type: f.type, options: f.options, placeholder: f.placeholder, required: f.required, internal: !!f.internal })));
});

/** 管理端：全部字段（含可见性配置，用于字段管理） */
app.get('/api/fields/admin', auth.requireAdmin, (req, res) => {
  const { fields } = db.load('fields');
  res.json([...fields].sort((a, b) => a.order - b.order));
});

app.post('/api/fields', auth.requireAdmin, (req, res) => {
  const err = validateField(req.body || {});
  if (err) return res.status(400).json({ error: err });
  const store = db.load('fields');
  const field = buildField(req.body);
  store.fields.push(field);
  db.save('fields');
  res.json(field);
});

app.put('/api/fields/:id', auth.requireAdmin, (req, res) => {
  const err = validateField(req.body || {});
  if (err) return res.status(400).json({ error: err });
  const store = db.load('fields');
  const idx = store.fields.findIndex(f => f.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '字段不存在' });
  store.fields[idx] = buildField(req.body, store.fields[idx]);
  db.save('fields');
  res.json(store.fields[idx]);
});

app.delete('/api/fields/:id', auth.requireAdmin, (req, res) => {
  const store = db.load('fields');
  const idx = store.fields.findIndex(f => f.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '字段不存在' });
  const [removed] = store.fields.splice(idx, 1);
  // 同步清理场地数据中的孤儿值（自定义字段清 fields 对象；内置字段清顶层属性）
  const sitesStore = db.load('sites');
  let changed = false;
  for (const s of sitesStore.sites) {
    if (removed.internal) {
      if (s[removed.id] !== undefined) { delete s[removed.id]; changed = true; }
    } else if (s.fields && removed.id in s.fields) {
      delete s.fields[removed.id]; changed = true;
    }
  }
  if (changed) db.save('sites');
  db.save('fields');
  res.json({ ok: true });
});

/** 调整字段顺序：body { ids: [字段id...] } */
app.post('/api/fields/reorder', auth.requireAdmin, (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) return res.status(400).json({ error: '参数错误' });
  const store = db.load('fields');
  const byId = new Map(store.fields.map(f => [f.id, f]));
  const ordered = [];
  for (const id of ids) {
    if (byId.has(id)) { ordered.push({ ...byId.get(id), order: ordered.length }); byId.delete(id); }
  }
  for (const f of byId.values()) ordered.push({ ...f, order: ordered.length });
  store.fields = ordered;
  db.save('fields');
  res.json(store.fields.sort((a, b) => a.order - b.order));
});

// ---------- 兜底路由 ----------
app.use((req, res) => res.status(404).json({ error: '接口不存在' }));
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

// ---------- 启动前数据迁移 ----------
/** 若字段表为空则写入系统预置的内置字段（仅首次启动/老数据升级时执行一次） */
function ensureInternalFields() {
  const store = db.load('fields');
  if (!store.fields.length) {
    store.fields = db.INTERNAL_FIELDS.map(f => ({ ...f }));
    db.save('fields');
    console.log('[migrate] 已写入内置字段定义:', store.fields.length, '个');
  }
}
ensureInternalFields();

app.listen(PORT, () => {
  console.log(`简舜科技建站信息聚合平台已启动: http://localhost:${PORT}`);
  console.log(`数据目录: ${db.DATA_DIR}`);
});
