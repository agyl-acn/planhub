// Planhub server. Zero dependencies: Node built-ins only.
// Storage is a single JSON file so local testing needs no database install.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'db.json');
const PUBLIC = path.join(__dirname, 'public');
const COLLECTIONS = ['kpis', 'items', 'projects', 'tasks', 'entries', 'dumps', 'logs'];

function load() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { const db = {}; COLLECTIONS.forEach(c => db[c] = []); return db; }
}
let db = load();
COLLECTIONS.forEach(c => { db[c] = db[c] || []; });

// Write to a temp file then rename, so a crash mid-write never corrupts the DB.
function save() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// Deleting a parent leaves children pointing at nothing; clear those references.
function cascade(col, id) {
  if (col === 'kpis') db.items = db.items.filter(i => i.kpi_id !== id);
  if (col === 'items') db.tasks.forEach(t => { if (t.item_id === id) t.item_id = null; });
  if (col === 'projects') db.tasks.forEach(t => { if (t.project_id === id) t.project_id = null; });
  if (col === 'tasks' || col === 'dumps') db.entries = db.entries.filter(e => e.source_id !== id);
}

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

async function api(req, res, parts) {
  if (parts[0] === 'export') return send(res, 200, db);
  if (parts[0] === 'import' && req.method === 'POST') {
    const body = await readBody(req);
    COLLECTIONS.forEach(c => { db[c] = Array.isArray(body[c]) ? body[c] : []; });
    save(); return send(res, 200, { ok: true });
  }
  const [col, id] = parts;
  if (!COLLECTIONS.includes(col)) return send(res, 404, { error: 'unknown collection' });
  const list = db[col];

  if (req.method === 'GET' && !id) return send(res, 200, list);
  if (req.method === 'POST' && !id) {
    const body = await readBody(req);
    const row = { ...body, id: crypto.randomUUID(), created_at: new Date().toISOString() };
    list.push(row); save(); return send(res, 201, row);
  }
  const idx = list.findIndex(r => r.id === id);
  if (idx < 0) return send(res, 404, { error: 'not found' });
  if (req.method === 'GET') return send(res, 200, list[idx]);
  if (req.method === 'PUT') {
    const body = await readBody(req);
    list[idx] = { ...list[idx], ...body, id }; save(); return send(res, 200, list[idx]);
  }
  if (req.method === 'DELETE') {
    list.splice(idx, 1); cascade(col, id); save(); return send(res, 204);
  }
  send(res, 405, { error: 'method not allowed' });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (parts[0] === 'api') return await api(req, res, parts.slice(1));
    let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    send(res, 400, { error: e.message });
  }
}).listen(PORT, HOST, () => console.log(`Planhub running at http://localhost:${PORT}`));
