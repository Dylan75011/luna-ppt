// 产出物生命周期管理：按"保留最近 N 个 + 最长保留时间"清理目录。
// 调用方在成功写入产出物后触发一次剪枝，防止 output/ 永久膨胀。

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getOutputRoot } = require('./outputPaths');

function safeRm(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
    return true;
  } catch (error) {
    console.warn('[outputRetention] 清理失败:', target, error.message);
    return false;
  }
}

// 按 mtime 倒序列出子条目，最新的在前
function listEntries(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => !entry.name.startsWith('.'))
    .map(entry => {
      const full = path.join(dir, entry.name);
      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(full).mtimeMs; } catch {}
      return { name: entry.name, full, isDirectory: entry.isDirectory(), mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// 通用剪枝：保留最近 keep 个，删除比 maxAgeMs 更老的条目
function pruneDirectory(dir, { keep = 0, maxAgeMs = 0, onlyType = null } = {}) {
  const entries = listEntries(dir).filter(e => {
    if (onlyType === 'directory') return e.isDirectory;
    if (onlyType === 'file') return !e.isDirectory;
    return true;
  });

  const now = Date.now();
  const removed = [];

  entries.forEach((entry, index) => {
    const tooMany = keep > 0 && index >= keep;
    const tooOld = maxAgeMs > 0 && entry.mtimeMs > 0 && (now - entry.mtimeMs) > maxAgeMs;
    if (tooMany || tooOld) {
      if (safeRm(entry.full)) removed.push(entry.name);
    }
  });

  if (removed.length) {
    console.log(`[outputRetention] ${path.relative(process.cwd(), dir)} 清理了 ${removed.length} 项`);
  }
  return removed;
}

function pruneRuns(options = {}) {
  const dir = path.join(getOutputRoot(), 'runs');
  const keep = options.keep ?? config.retention.runsKeep;
  const maxAgeMs = options.maxAgeMs ?? config.retention.runsMaxAge;
  return pruneDirectory(dir, { keep, maxAgeMs, onlyType: 'directory' });
}

function pruneAgentUploads(options = {}) {
  const dir = path.join(getOutputRoot(), 'agent-inputs');
  const keep = options.keep ?? config.retention.uploadsKeep;
  const maxAgeMs = options.maxAgeMs ?? config.retention.uploadsMaxAge;
  return pruneDirectory(dir, { keep, maxAgeMs, onlyType: 'file' });
}

// 删除一条会话的整个临时区目录（output/conversations/<conversationId>/）。
// 已经 promote 到 workspace 的资产物理上已经搬到 output/promoted/<docId>/，
// 不在这个目录里，所以 rm -rf 安全；调用方在 DELETE /conversations/:id 时触发。
function cleanupConversationTmp(conversationId) {
  if (!conversationId) return false;
  const safe = String(conversationId).replace(/[^\w.-]/g, '');
  if (!safe) return false;
  const dir = path.join(getOutputRoot(), 'conversations', safe);
  if (!fs.existsSync(dir)) return false;
  const ok = safeRm(dir);
  if (ok) console.log('[outputRetention] cleanupConversationTmp:', dir);
  return ok;
}

module.exports = {
  pruneRuns,
  pruneAgentUploads,
  pruneDirectory,
  cleanupConversationTmp,
};
