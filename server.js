/* ============================================================
   CJ RASTREADORES — Servidor completo (backend próprio)
   Node.js PURO — zero dependências. Rode com:  node server.js
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ---------- banco de dados (arquivo data.json) ---------- */
const DATA = path.join(__dirname, 'data.json');
let db = { secret: crypto.randomBytes(24).toString('hex'), empresas: [], stateByEmp: {}, positions: {} };
if (fs.existsSync(DATA)) {
  try { db = Object.assign(db, JSON.parse(fs.readFileSync(DATA, 'utf8'))) } catch (e) { console.error('data.json inválido — começando limpo'); }
}
let saveT = null;
function persist() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try { fs.writeFileSync(DATA + '.tmp', JSON.stringify(db)); fs.renameSync(DATA + '.tmp', DATA); } catch (e) { console.error('erro ao salvar:', e.message) }
  }, 300);
}

/* ---------- credenciais do dono (mude via variáveis de ambiente) ---------- */
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'dono@cjrastreadores.com';
const ADMIN_SENHA = process.env.ADMIN_SENHA || 'admin123';

/* ---------- tokens assinados (HMAC) ---------- */
function sign(payload) {
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return b + '.' + crypto.createHmac('sha256', db.secret).update(b).digest('base64url');
}
function verify(tok) {
  if (!tok) return null;
  const [b, s] = String(tok).split('.');
  if (!b || !s) return null;
  if (s !== crypto.createHmac('sha256', db.secret).update(b).digest('base64url')) return null;
  try { return JSON.parse(Buffer.from(b, 'base64url').toString()) } catch (e) { return null }
}

const digits = s => String(s || '').replace(/\D/g, '');
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) };

function readBody(req) {
  return new Promise((ok, fail) => {
    let b = '', n = 0;
    req.on('data', c => { n += c.length; if (n > 2e6) { fail(new Error('grande demais')); req.destroy(); return } b += c });
    req.on('end', () => { try { ok(b ? JSON.parse(b) : {}) } catch (e) { fail(e) } });
    req.on('error', fail);
  });
}

/* mescla a última posição real recebida em cada veículo/celular */
function mergedVehicles(empId) {
  const st = db.stateByEmp[empId] || { vehicles: [], devices: [] };
  return (st.vehicles || []).map(v => {
    const p = v.real && db.positions[digits(v.plate)];
    return p ? { ...v, lastPos: [p.lat, p.lng], acc: p.acc, spd: p.spd, lastSeen: p.t } : v;
  });
}

/* ---------- rotas da API ---------- */
async function handleApi(req, res, url) {
  const user = verify((req.headers.authorization || '').replace('Bearer ', ''));

  if (req.method === 'POST' && url.pathname === '/api/login') {
    const { tipo, login, senha } = await readBody(req);
    if (tipo === 'admin') {
      if (String(login).trim().toLowerCase() === ADMIN_EMAIL.toLowerCase() && senha === ADMIN_SENHA)
        return json(res, 200, { token: sign({ role: 'admin' }), role: 'admin' });
      return json(res, 401, { erro: 'credenciais inválidas' });
    }
    const e = db.empresas.find(x => String(x.login).toLowerCase() === String(login).trim().toLowerCase() && x.senha === senha);
    if (!e) return json(res, 401, { erro: 'credenciais inválidas' });
    return json(res, 200, { token: sign({ role: 'empresa', empresaId: e.id }), role: 'empresa' });
  }

  if (req.method === 'POST' && url.pathname === '/api/pos') {
    const { fone, lat, lng, acc, spd } = await readBody(req);
    const f = digits(fone);
    if (!f || typeof lat !== 'number' || typeof lng !== 'number') return json(res, 400, { erro: 'dados inválidos' });
    if ((acc || 9999) > 250) return json(res, 422, { erro: 'sinal impreciso — ligue o GPS do aparelho' });
    let empId = null, dev = null;
    for (const e of db.empresas) {
      const st = db.stateByEmp[e.id]; if (!st) continue;
      const d = (st.devices || []).find(x => digits(x.ident) === f);
      if (d) { empId = e.id; dev = d; break }
    }
    if (!dev) return json(res, 404, { erro: 'número não cadastrado por nenhuma empresa' });
    dev.auth = 'autorizado'; dev.gps = 'on'; dev.status = 'Rastreando';
    db.positions[f] = { lat, lng, acc: acc || 0, spd: spd || 0, t: Date.now() };
    persist();
    broadcast(empId, { type: 'pos', empresaId: empId, fone: f, lat, lng, acc: acc || 0, spd: spd || 0, t: Date.now() });
    return json(res, 200, { ok: true });
  }

  if (!user) return json(res, 401, { erro: 'não autenticado' });

  if (req.method === 'GET' && url.pathname === '/api/state') {
    if (user.role === 'admin') {
      return json(res, 200, {
        empresas: db.empresas,
        vehicles: db.empresas.flatMap(e => mergedVehicles(e.id)),
        devices: db.empresas.flatMap(e => (db.stateByEmp[e.id] || { devices: [] }).devices || [])
      });
    }
    const e = db.empresas.find(x => x.id === user.empresaId);
    if (!e) return json(res, 404, { erro: 'empresa não encontrada' });
    return json(res, 200, { empresa: e, vehicles: mergedVehicles(e.id), devices: (db.stateByEmp[e.id] || { devices: [] }).devices || [] });
  }

  if (req.method === 'PUT' && url.pathname === '/api/state') {
    const b = await readBody(req);
    if (user.role === 'admin') {
      if (Array.isArray(b.empresas)) db.empresas = b.empresas;
    } else {
      const i = db.empresas.findIndex(x => x.id === user.empresaId);
      if (i < 0) return json(res, 404, { erro: 'empresa não encontrada' });
      if (b.empresa) db.empresas[i] = { ...db.empresas[i], ...b.empresa, id: db.empresas[i].id, login: db.empresas[i].login, senha: db.empresas[i].senha };
      db.stateByEmp[user.empresaId] = { vehicles: b.vehicles || [], devices: b.devices || [] };
    }
    persist();
    return json(res, 200, { ok: true });
  }

  json(res, 404, { erro: 'rota não encontrada' });
}

/* ---------- servidor HTTP + arquivos do painel ---------- */
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch(e => json(res, 500, { erro: 'erro interno: ' + e.message }));
    return;
  }
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  file = path.normalize(file).replace(/^(\.\.[\/\\])+/, '');
  const full = path.join(PUB, file);
  if (!full.startsWith(PUB) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    /* qualquer rota desconhecida abre o painel (ex.: /?autorizar=...) */
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(path.join(PUB, 'index.html')).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
});

/* ---------- WebSocket próprio (tempo real, sem dependências) ---------- */
const wsClients = new Set();
server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws') { socket.destroy(); return }
  const user = verify(url.searchParams.get('token'));
  const key = req.headers['sec-websocket-key'];
  if (!user || !key) { socket.destroy(); return }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.user = user;
  wsClients.add(socket);
  socket.on('data', buf => {
    const op = buf[0] & 0x0f;
    if (op === 8) { socket.end(); }                       /* close */
    else if (op === 9) { socket.write(Buffer.from([0x8A, 0x00])); } /* ping → pong */
  });
  const bye = () => wsClients.delete(socket);
  socket.on('close', bye); socket.on('error', bye); socket.on('end', bye);
});
function wsFrame(str) {
  const p = Buffer.from(str);
  let h;
  if (p.length < 126) h = Buffer.from([0x81, p.length]);
  else if (p.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(p.length, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(p.length), 2); }
  return Buffer.concat([h, p]);
}
function broadcast(empId, msg) {
  const frame = wsFrame(JSON.stringify(msg));
  for (const c of wsClients) {
    if (!c.destroyed && c.user && (c.user.role === 'admin' || c.user.empresaId === empId)) {
      try { c.write(frame) } catch (e) { }
    }
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('🛰️  CJ RASTREADORES no ar: http://localhost:' + PORT);
  console.log('👑 Login do dono: ' + ADMIN_EMAIL + ' · senha: ' + (process.env.ADMIN_SENHA ? '(definida por variável de ambiente)' : ADMIN_SENHA));
});
