// Luna 浏览器桥：本地 WebSocket 服务器，和 Chrome Extension 双向通信
// 协议：
//   server → ext: { id, op, payload }
//   ext → server 响应: { id, ok, result?, error? }
//   ext → server 通知: { type: 'hello'|'log', ... }
//
// 安全：
//   1. 仅接受 127.0.0.1/::1 连接
//   2. 握手要求 shared token（服务端首次启动生成到 ~/.luna/bridge.token，Extension popup 粘贴）
//   3. 域名 allowlist（Extension host_permissions 已限死，这层是服务端兜底）
//   4. session 级授权由 Extension popup 维护，服务端不代管
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const DEFAULT_PORT = 3399;
const DEFAULT_TIMEOUT_MS = 30_000;
const HELLO_TIMEOUT_MS = 5_000;

// 默认 allowlist：与 Extension manifest host_permissions 对齐（phase 1 只做小红书）
// 通过 LUNA_BRIDGE_ALLOWLIST 覆盖；Extension 侧 host_permissions 是硬限制，这里是服务端兜底
const DEFAULT_ALLOWLIST = [
  'xiaohongshu.com',
  'xhscdn.com',
  'bing.com'
];

let wss = null;
let activeSocket = null;
let activeMeta = null; // { version, connectedAt }
const pending = new Map(); // id -> { resolve, reject, timer, op }

let sharedToken = null;
let allowlist = DEFAULT_ALLOWLIST;

// 最近 N 个 op 的生命周期 ring buffer，用于 /api/browser-bridge/debug 排查"哪个 op 卡了多久"
const RECENT_OPS_LIMIT = 50;
const recentOps = [];

function recordOpStart(id, op, payload) {
  let summary = '';
  if (Array.isArray(payload?.urls)) summary = `urls=${payload.urls.length}`;
  else if (typeof payload?.url === 'string') summary = `url=${payload.url.slice(0, 60)}`;
  else if (typeof payload?.query === 'string') summary = `query="${payload.query.slice(0, 40)}"`;
  else if (typeof payload?.note_url === 'string') summary = `note_url=${payload.note_url.slice(0, 60)}`;
  const entry = { id, op, sentAt: Date.now(), payloadSummary: summary };
  recentOps.push(entry);
  if (recentOps.length > RECENT_OPS_LIMIT) recentOps.shift();
  return entry;
}

function recordOpEnd(id, ok, resultOrError) {
  const entry = recentOps.find((e) => e.id === id);
  if (!entry || entry.completedAt) return;
  entry.completedAt = Date.now();
  entry.durationMs = entry.completedAt - entry.sentAt;
  entry.ok = ok;
  if (ok) {
    const r = resultOrError;
    if (Array.isArray(r?.notes)) entry.resultSummary = `notes=${r.notes.length} ok=${r.notes.filter(n => !n.error).length}`;
    else if (Array.isArray(r?.results)) entry.resultSummary = `results=${r.results.length}`;
    else if (r?.content) entry.resultSummary = `content=${String(r.content).length}c`;
    else entry.resultSummary = 'ok';
  } else {
    entry.error = String(resultOrError?.message || resultOrError || '').slice(0, 240);
  }
}

function recent() {
  // 新的在前；进行中（无 completedAt）的也带上 elapsedMs 方便看卡了多久
  const now = Date.now();
  return recentOps.slice().reverse().map((e) => ({
    ...e,
    inFlight: !e.completedAt,
    elapsedMs: e.completedAt ? e.durationMs : (now - e.sentAt)
  }));
}

function tokenFilePath() {
  return path.join(os.homedir(), '.luna', 'bridge.token');
}

function loadOrCreateToken() {
  const file = tokenFilePath();
  try {
    const txt = fs.readFileSync(file, 'utf8').trim();
    if (txt && txt.length >= 32) return txt;
  } catch {}
  const t = crypto.randomBytes(24).toString('hex');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, t, { mode: 0o600 });
    console.log(`[browserBridge] 已生成 token → ${file}（请在 Luna Extension popup 粘贴）`);
  } catch (err) {
    console.warn('[browserBridge] 写入 token 文件失败，仅存内存:', err.message);
  }
  return t;
}

function isConnected() {
  return Boolean(activeSocket && activeSocket.readyState === 1 && activeSocket._lunaAuthed);
}

function rejectAllPending(reason) {
  for (const [id, p] of pending.entries()) {
    clearTimeout(p.timer);
    p.reject(new Error(reason));
    pending.delete(id);
  }
}

function hostAllowed(url) {
  if (!url) return false;
  let host;
  try { host = new URL(url).hostname; } catch { return false; }
  return allowlist.some((d) => host === d || host.endsWith(`.${d}`));
}

function handleIncoming(socket, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch {
    console.warn('[browserBridge] 非法 JSON:', String(raw).slice(0, 200));
    return;
  }

  // hello 必须带 token，authed 之前不接受其他消息
  if (msg.type === 'hello') {
    if (!sharedToken || msg.token !== sharedToken) {
      console.warn('[browserBridge] hello token 不匹配，拒绝');
      try { socket.send(JSON.stringify({ type: 'auth_error', error: 'token mismatch' })); } catch {}
      try { socket.close(4401, 'unauthorized'); } catch {}
      return;
    }
    socket._lunaAuthed = true;
    activeMeta = { version: msg.version || '?', connectedAt: Date.now() };
    console.log(`[browserBridge] extension 通过认证 v${activeMeta.version}`);
    try { socket.send(JSON.stringify({ type: 'auth_ok' })); } catch {}
    return;
  }

  if (!socket._lunaAuthed) {
    console.warn('[browserBridge] 未认证消息，忽略');
    return;
  }

  // 响应消息
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    clearTimeout(p.timer);
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error || 'browser op failed'));
    return;
  }

  if (msg.type === 'log') {
    console.log(`[ext:${msg.level || 'info'}]`, msg.message);
  }
}

function start({ port = DEFAULT_PORT, allowlist: customAllowlist } = {}) {
  if (wss) return wss;

  // 环境变量优先级最高
  if (process.env.LUNA_BRIDGE_ALLOWLIST) {
    allowlist = process.env.LUNA_BRIDGE_ALLOWLIST.split(',').map(s => s.trim()).filter(Boolean);
  } else if (Array.isArray(customAllowlist) && customAllowlist.length) {
    allowlist = customAllowlist;
  }

  sharedToken = process.env.LUNA_BRIDGE_TOKEN || loadOrCreateToken();

  // 同端口同时提供 GET /token，让扩展免手动粘贴：
  //   防护层靠 loopback 绑定 + ~/.luna/bridge.token 的 0600 权限（Origin 检查对本机进程
  //   不成立，且 Chrome MV3 到 host_permissions 内地址的 fetch 不发 Origin 头）
  const server = http.createServer((req, res) => {
    if (req.url === '/token') {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': req.headers.origin || '*'
      });
      res.end(JSON.stringify({ token: sharedToken }));
      return;
    }
    res.writeHead(404); res.end();
  });

  server.on('error', (err) => {
    console.warn(`[browserBridge] 监听失败: ${err.message}`);
    rejectAllPending(`browser bridge listen failed: ${err.message}`);
    if (wss) {
      try { wss.close(); } catch {}
      wss = null;
    }
  });

  server.listen(port, '127.0.0.1');

  wss = new WebSocketServer({ server });
  console.log(`[browserBridge] 监听 ws://127.0.0.1:${port} (+ GET /token)  allowlist=[${allowlist.join(',')}]`);

  wss.on('connection', (socket, req) => {
    const addr = req.socket.remoteAddress;
    if (addr !== '127.0.0.1' && addr !== '::1' && addr !== '::ffff:127.0.0.1') {
      console.warn(`[browserBridge] 拒绝非本机连接: ${addr}`);
      socket.close(1008, 'local only');
      return;
    }

    // 进入"等待 hello"状态；超时未认证则踢掉
    socket._lunaAuthed = false;
    const helloTimer = setTimeout(() => {
      if (!socket._lunaAuthed) {
        console.warn('[browserBridge] hello 超时，断开');
        try { socket.close(4408, 'hello timeout'); } catch {}
      }
    }, HELLO_TIMEOUT_MS);

    if (activeSocket && activeSocket !== socket) {
      console.log('[browserBridge] 已有连接，关闭旧连接');
      try { activeSocket.close(1000, 'replaced'); } catch {}
    }
    activeSocket = socket;
    console.log('[browserBridge] extension 已连接（待认证）');

    socket.on('message', (raw) => handleIncoming(socket, raw));
    socket.on('close', () => {
      clearTimeout(helloTimer);
      if (activeSocket === socket) {
        activeSocket = null;
        activeMeta = null;
        rejectAllPending('extension disconnected');
        console.log('[browserBridge] extension 已断开');
      }
    });
    socket.on('error', (err) => console.warn('[browserBridge] socket error:', err.message));
  });

  return wss;
}

function send(op, payload = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    if (!isConnected()) {
      return reject(new Error('Chrome Extension 未连接或未认证，请检查 Luna 扩展已加载并填入 token'));
    }

    // 服务端兜底 allowlist：payload.url / payload.urls 必须在白名单
    if (payload && typeof payload.url === 'string') {
      if (!hostAllowed(payload.url)) return reject(new Error(`host 不在 allowlist: ${payload.url}`));
    }
    if (payload && Array.isArray(payload.urls)) {
      const bad = payload.urls.find((u) => typeof u !== 'string' || !hostAllowed(u));
      if (bad) return reject(new Error(`host 不在 allowlist: ${bad}`));
    }

    const id = `req_${crypto.randomBytes(6).toString('hex')}`;
    recordOpStart(id, op, payload);
    // 包装 resolve/reject，让 recordOpEnd 跟所有完成路径（response / timeout / disconnect）都对得上
    const wrappedResolve = (r) => { recordOpEnd(id, true, r); resolve(r); };
    const wrappedReject = (e) => { recordOpEnd(id, false, e); reject(e); };
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        wrappedReject(new Error(`browser op "${op}" 超时 ${timeoutMs}ms`));
      }
    }, timeoutMs);
    pending.set(id, { resolve: wrappedResolve, reject: wrappedReject, timer, op });
    try {
      activeSocket.send(JSON.stringify({ id, op, payload }));
    } catch (err) {
      pending.delete(id);
      clearTimeout(timer);
      wrappedReject(err);
    }
  });
}

function status() {
  return {
    listening: !!wss,
    connected: isConnected(),
    meta: activeMeta,
    pending: pending.size,
    allowlist,
    tokenFile: sharedToken ? tokenFilePath() : null
  };
}

function getToken() {
  return sharedToken;
}

module.exports = { start, send, status, isConnected, getToken, hostAllowed, recent };
