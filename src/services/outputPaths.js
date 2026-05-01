const fs = require('fs');
const path = require('path');
const config = require('../config');

function getOutputRoot() {
  return path.resolve(config.outputDir);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

function sanitizeSegment(value, fallback = 'run') {
  return String(value || fallback)
    .trim()
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || fallback;
}

function getRunId(seed = null) {
  return sanitizeSegment(seed || `run_${Date.now()}`, 'run');
}

function getRunDir(runId) {
  return ensureDir(path.join(getOutputRoot(), 'runs', getRunId(runId)));
}

function getRunAssetDir(runId, assetType) {
  return ensureDir(path.join(getRunDir(runId), sanitizeSegment(assetType, 'misc')));
}

// 单条会话的"临时区"根目录。所有 agent 工作过程产出（截图、生图、搜图、PPT 草稿）
// 都应当落在这里；删除会话时整目录 rm -rf 即可清干净。已经 promote 到 workspace
// 的资产由 saveAssetToSpace 时移动到 output/promoted/<docId>/，不会受会话清理影响。
function getConversationTmpDir(conversationId) {
  const safe = sanitizeSegment(conversationId, '');
  if (!safe) {
    // 没拿到 conversationId 时退回旧 runs/ 兜底路径，避免新代码路径强依赖；
    // 真实生产路径都应当带 conversationId 进来。
    return ensureDir(path.join(getOutputRoot(), 'runs'));
  }
  return ensureDir(path.join(getOutputRoot(), 'conversations', safe));
}

function getConversationRunDir(conversationId, runId) {
  const safe = sanitizeSegment(conversationId, '');
  if (!safe) return getRunDir(runId);
  return ensureDir(path.join(getConversationTmpDir(conversationId), 'runs', getRunId(runId)));
}

function getConversationRunAssetDir(conversationId, runId, assetType) {
  return ensureDir(path.join(
    getConversationRunDir(conversationId, runId),
    sanitizeSegment(assetType, 'misc')
  ));
}

function getConversationUploadDir(conversationId) {
  const safe = sanitizeSegment(conversationId, '');
  if (!safe) return ensureDir(path.join(getOutputRoot(), 'agent-inputs'));
  return ensureDir(path.join(getConversationTmpDir(conversationId), 'agent-inputs'));
}

// "已 promote 资产"目录：每个 workspace 文档节点一个子目录，与 data/docs/<docId>.json
// 一一对应。saveAssetToSpace / savePptToSpace 把临时区文件 mv 到这里，删除 workspace
// 节点（removeManagedFiles）时整目录清理。这样会话 tmp 与永久资产物理分隔，互不污染。
function getPromotedDir(docId) {
  const safe = sanitizeSegment(docId, 'doc');
  return ensureDir(path.join(getOutputRoot(), 'promoted', safe));
}

function toOutputRelative(absolutePath) {
  if (!absolutePath) return '';
  const outputRoot = getOutputRoot();
  const resolved = path.resolve(absolutePath);
  if (!resolved.startsWith(outputRoot)) return '';
  return path.relative(outputRoot, resolved).split(path.sep).join('/');
}

function toOutputUrl(absolutePath) {
  const relative = toOutputRelative(absolutePath);
  return relative ? `/output/${relative}` : '';
}

// 生成公网可访问的绝对 URL（PUBLIC_BASE_URL 未设置时退化为相对路径，本地开发不受影响）
function toPublicUrl(absolutePath) {
  const relative = toOutputRelative(absolutePath);
  if (!relative) return '';
  const base = config.publicBaseUrl || '';
  return `${base}/output/${relative}`;
}

// 将任意相对 URL（/output/... 或 /api/...）转为绝对 URL
function toAbsoluteUrl(relativeUrl) {
  if (!relativeUrl) return '';
  if (relativeUrl.startsWith('http')) return relativeUrl;
  const base = config.publicBaseUrl || '';
  return `${base}${relativeUrl}`;
}

function resolveOutputRelative(relativePath = '') {
  const normalized = String(relativePath || '').replace(/^\/+/, '');
  return path.resolve(getOutputRoot(), normalized);
}

function createRunFilePath(runId, assetType, filename) {
  return path.join(getRunAssetDir(runId, assetType), filename);
}

module.exports = {
  getOutputRoot,
  ensureDir,
  getRunId,
  getRunDir,
  getRunAssetDir,
  getConversationTmpDir,
  getConversationRunDir,
  getConversationRunAssetDir,
  getConversationUploadDir,
  getPromotedDir,
  toOutputRelative,
  toOutputUrl,
  toPublicUrl,
  toAbsoluteUrl,
  resolveOutputRelative,
  createRunFilePath,
};
