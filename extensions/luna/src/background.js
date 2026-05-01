// Luna Browser Bridge - service worker
// 职责：维护与 Node 后端的 WebSocket 连接，收到 op 后分发给对应 handler
import { searchXiaohongshu, readNotesByUrls, sweepOrphanTabs } from './extractors/xiaohongshu.js';
import { readPage } from './extractors/readPage.js';
import { searchBing } from './extractors/webSearch.js';

const DEFAULT_BRIDGE_URL = 'ws://127.0.0.1:3399';
const VERSION = '0.8.0';
const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];

let ws = null;
let reconnectAttempts = 0;
let manualStopped = false;

async function getBridgeUrl() {
  const { bridgeUrl } = await chrome.storage.local.get('bridgeUrl');
  return bridgeUrl || DEFAULT_BRIDGE_URL;
}

async function fetchTokenFromBridge() {
  try {
    const wsUrl = await getBridgeUrl();
    const httpUrl = wsUrl.replace(/^ws/, 'http').replace(/\/+$/, '') + '/token';
    const resp = await fetch(httpUrl);
    if (!resp.ok) {
      console.warn('[luna-bridge] /token 返回', resp.status);
      return '';
    }
    const data = await resp.json();
    return data?.token || '';
  } catch (err) {
    console.warn('[luna-bridge] 自动获取 token 失败:', err.message || err);
    return '';
  }
}

async function getBridgeToken() {
  const { bridgeToken } = await chrome.storage.local.get('bridgeToken');
  if (bridgeToken) return bridgeToken;
  const fetched = await fetchTokenFromBridge();
  if (fetched) {
    await chrome.storage.local.set({ bridgeToken: fetched });
    console.log('[luna-bridge] 已自动获取 token');
  }
  return fetched;
}

let authState = 'idle'; // idle | pending | authed | token_missing | token_bad

function scheduleReconnect() {
  if (manualStopped) return;
  const delay = RECONNECT_BACKOFF_MS[Math.min(reconnectAttempts, RECONNECT_BACKOFF_MS.length - 1)];
  reconnectAttempts += 1;
  console.log(`[luna-bridge] ${delay}ms 后重连（第 ${reconnectAttempts} 次）`);
  setTimeout(connect, delay);
}

function send(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(obj));
    return true;
  } catch (err) {
    console.warn('[luna-bridge] send failed:', err);
    return false;
  }
}

function hostFromUrl(u) {
  if (!u) return null;
  try { return new URL(u).hostname; } catch { return null; }
}

async function ensureGrant(host, mode = 'read') {
  if (!host) return true;
  const { sessionGrants = {}, autoAllowReadOnAllowlist = true } =
    await chrome.storage.session.get(['sessionGrants', 'autoAllowReadOnAllowlist']);

  const existing = sessionGrants[host];
  if (existing && (mode === 'read' || existing.mode === 'write')) return true;

  if (mode === 'read' && autoAllowReadOnAllowlist) {
    sessionGrants[host] = { mode: 'read', grantedAt: Date.now(), auto: true };
    await chrome.storage.session.set({ sessionGrants });
    try { chrome.runtime.sendMessage({ type: 'grants_changed' }); } catch {}
    return true;
  }
  return false;
}

async function dispatch(op, payload) {
  // 目标 host 解析（用于 session 授权检查）
  let host = null;
  if (op === 'browser_read_page') host = hostFromUrl(payload.url);
  else if (op === 'browser_read_notes') host = hostFromUrl((payload.urls || [])[0]);
  else if (op === 'browser_search') {
    const plat = payload.platform || 'xiaohongshu';
    host = plat === 'xiaohongshu' ? 'www.xiaohongshu.com' : null;
  }
  else if (op === 'browser_web_search') host = 'www.bing.com';

  if (host && !(await ensureGrant(host, 'read'))) {
    throw new Error(`need_user_approval: ${host}（请打开 Luna 扩展 popup，勾选 "allowlist 只读自动放行" 或手动授权）`);
  }

  switch (op) {
    case 'browser_search': {
      if (payload.platform === 'xiaohongshu') {
        const topN = payload.fetch_body_top_n;
        return await searchXiaohongshu(
          payload.query,
          payload.max_results || 10,
          typeof topN === 'number' ? topN : 5
        );
      }
      throw new Error(`unsupported platform: ${payload.platform}`);
    }
    case 'browser_web_search': {
      return await searchBing(payload.query, payload.max_results || 10);
    }
    case 'browser_read_page': {
      return await readPage(payload.url);
    }
    case 'browser_read_notes': {
      const platform = payload.platform || 'xiaohongshu';
      const urls = Array.isArray(payload.urls) ? payload.urls : [];
      if (urls.length === 0) throw new Error('urls empty');
      if (platform === 'xiaohongshu') return await readNotesByUrls(urls);
      throw new Error(`unsupported platform for read_notes: ${platform}`);
    }
    default:
      throw new Error(`unknown op: ${op}`);
  }
}

async function handleRequest(msg) {
  const { id, op, payload } = msg;
  if (!id || !op) return;
  try {
    const result = await dispatch(op, payload || {});
    send({ id, ok: true, result });
  } catch (err) {
    console.warn(`[luna-bridge] op ${op} failed:`, err);
    send({ id, ok: false, error: err.message || String(err) });
  }
}

async function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const url = await getBridgeUrl();
  console.log(`[luna-bridge] 连接 ${url}`);
  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.warn('[luna-bridge] new WebSocket 失败:', err);
    scheduleReconnect();
    return;
  }

  ws.onopen = async () => {
    reconnectAttempts = 0;
    console.log('[luna-bridge] socket 打开，开始认证');
    const token = await getBridgeToken();
    if (!token) {
      authState = 'token_missing';
      broadcastStatus('token_missing');
      console.warn('[luna-bridge] 未配置 token，请在 popup 粘贴 ~/.luna/bridge.token 的值');
      try { ws.close(1000, 'no token'); } catch {}
      return;
    }
    authState = 'pending';
    send({ type: 'hello', version: VERSION, token });
  };

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'auth_ok') {
      authState = 'authed';
      console.log('[luna-bridge] 已认证');
      broadcastStatus('connected');
      return;
    }
    if (msg.type === 'auth_error') {
      console.warn('[luna-bridge] 认证失败，清掉缓存 token 重新拉取:', msg.error);
      // Node 可能换了 token，把 chrome.storage 里的缓存清掉，下次重连会自动 refetch
      chrome.storage.local.remove('bridgeToken').catch(() => {});
      authState = 'token_bad';
      broadcastStatus('token_bad');
      return;
    }
    if (msg.id && msg.op) handleRequest(msg);
  };

  ws.onclose = (ev) => {
    console.log(`[luna-bridge] 连接关闭 code=${ev.code}`);
    ws = null;
    const display = authState === 'token_bad' ? 'token_bad'
      : authState === 'token_missing' ? 'token_missing'
      : 'disconnected';
    broadcastStatus(display);
    // 都走 backoff 重试：token 问题也可能是 Node 刚换了 token，缓存已清，下次会自动 refetch
    scheduleReconnect();
  };

  ws.onerror = (err) => {
    console.warn('[luna-bridge] socket error', err);
  };
}

function broadcastStatus(state) {
  chrome.runtime.sendMessage({ type: 'bridge_status', state }).catch(() => {});
  const badge = state === 'connected' ? 'ON'
    : state === 'token_missing' || state === 'token_bad' ? '!'
    : '';
  const color = state === 'connected' ? '#10b981'
    : state === 'token_missing' || state === 'token_bad' ? '#dc2626'
    : '#64748b';
  chrome.action.setBadgeText({ text: badge });
  chrome.action.setBadgeBackgroundColor({ color });
}

// 保活：MV3 service worker 会休眠，每 15s 触发 alarms 唤醒（抄自 opencode-browser 成熟值）
chrome.alarms.create('luna-keepalive', { periodInMinutes: 0.25 });
// 孤儿 tab 清扫：每 1 分钟清掉超过 60s 还没 forget 的 luna 临时 tab
// （正常 op ≤ 18s，60s 还在的就是 service worker 中途死了的孤儿）
chrome.alarms.create('luna-sweep-orphans', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'luna-keepalive') {
    if (!ws || ws.readyState !== WebSocket.OPEN) connect();
    return;
  }
  if (alarm.name === 'luna-sweep-orphans') {
    sweepOrphanTabs(60_000).catch((err) => console.warn('[luna-bg] sweepOrphanTabs failed:', err.message));
    return;
  }
});

// popup 交互
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'get_status') {
    sendResponse({
      connected: !!ws && ws.readyState === WebSocket.OPEN && authState === 'authed',
      authState,
      version: VERSION
    });
    return true;
  }
  if (msg.type === 'reconnect') {
    manualStopped = false;
    reconnectAttempts = 0;
    if (ws) { try { ws.close(); } catch {} }
    connect();
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'disconnect') {
    manualStopped = true;
    if (ws) { try { ws.close(); } catch {} }
    sendResponse({ ok: true });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  // 首次安装默认打开"allowlist 只读自动放行"，避免每个 agent 请求都要点
  const cur = await chrome.storage.session.get('autoAllowReadOnAllowlist');
  if (cur.autoAllowReadOnAllowlist === undefined) {
    await chrome.storage.session.set({ autoAllowReadOnAllowlist: true });
  }
  // 安装/重装时把上一会话残留的孤儿 tab 全部清掉
  sweepOrphanTabs(0).catch(() => {});
  connect();
});
chrome.runtime.onStartup.addListener(() => {
  // 浏览器启动时也清一遍（理论上 chrome.storage.session 已经清空，但保险起见）
  sweepOrphanTabs(0).catch(() => {});
  connect();
});

// service worker 冷启动也立刻清一遍：worker 在 idle 后被杀，重新激活时跑这里
sweepOrphanTabs(0).catch(() => {});
connect();
