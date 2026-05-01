const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { callMinimax } = require('./llmClients');
const { htmlToTiptap } = require('./richText');
const { toOutputRelative, toOutputUrl, resolveOutputRelative, getPromotedDir, getOutputRoot } = require('./outputPaths');

const DATA_DIR = path.resolve('./data');
const WORKSPACE_FILE = path.join(DATA_DIR, 'workspaces.json');
const DOCS_DIR = path.join(DATA_DIR, 'docs');

// data/docs/*.json 文件级 schema 版本号。每次给 doc 增删字段、改 contentFormat
// 含义、或者修改 tiptap 节点结构时递增。读取处做兼容判定，超出已知版本的文件
// 仍可读但会 console.warn，便于及早发现需要写迁移。
const DOC_SCHEMA_VERSION = 1;

function createEmptyDocContent() {
  return {
    type: 'doc',
    content: [{ type: 'paragraph' }]
  };
}

function escapeHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isoNow() {
  return new Date().toISOString();
}

function createSpaceIndexHtml(spaceName, indexData = {}) {
  const summary = indexData.summary || `这个索引用于记录「${spaceName}」空间里真正有参考价值的上下文、关键资产和最近任务。`;
  const guidance = indexData.guidance || '';
  const focusAreas = Array.isArray(indexData.focusAreas) ? indexData.focusAreas : [];
  const assets = Array.isArray(indexData.assets) ? indexData.assets : [];
  const tasks = Array.isArray(indexData.recentTasks) ? indexData.recentTasks : [];

  const assetHtml = assets.length
    ? `<ul>${assets.map((item) => `<li><strong>${escapeHtml(item.name)}</strong>${item.docType ? ` <span>(${escapeHtml(item.docType)})</span>` : ''}${item.note ? `：${escapeHtml(item.note)}` : ''}</li>`).join('')}</ul>`
    : '<p>当前还没有稳定可复用的空间资产。</p>';

  const taskHtml = tasks.length
    ? tasks.map((item) => `
        <section>
          <h4>${escapeHtml(item.title || '未命名任务')}</h4>
          <p>${escapeHtml(item.summary || '暂无摘要')}</p>
          <p>状态：${escapeHtml(item.status || 'completed')}${item.score ? `｜评审分：${escapeHtml(item.score)}` : ''}${item.updatedAt ? `｜更新于：${escapeHtml(item.updatedAt)}` : ''}</p>
          ${item.highlights?.length ? `<p>亮点：${escapeHtml(item.highlights.slice(0, 3).join(' / '))}</p>` : ''}
        </section>
      `).join('')
    : '<p>当前还没有可回顾的任务记录。</p>';

  return `
    <h1>${escapeHtml(spaceName)} 空间索引</h1>
    <p>${escapeHtml(summary)}</p>
    ${guidance ? `<h2>当前判断</h2><p>${escapeHtml(guidance)}</p>` : ''}
    ${focusAreas.length ? `<h2>当前聚焦</h2><ul>${focusAreas.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
    <h2>关键资产</h2>
    ${assetHtml}
    <h2>最近任务</h2>
    ${taskHtml}
  `.trim();
}

function extractPlainText(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    return value
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (Array.isArray(value)) {
    return value.map(extractPlainText).filter(Boolean).join(' ');
  }
  if (typeof value === 'object') {
    const ownText = typeof value.text === 'string' ? value.text : '';
    const contentText = extractPlainText(value.content);
    return [ownText, contentText].filter(Boolean).join(' ').trim();
  }
  return '';
}

// 确保目录存在
function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
}

// 读取 workspaces.json，不存在则返回空结构
function readTree() {
  ensureDirs();
  if (!fs.existsSync(WORKSPACE_FILE)) {
    return { version: 1, updatedAt: new Date().toISOString(), spaces: [] };
  }
  return JSON.parse(fs.readFileSync(WORKSPACE_FILE, 'utf8'));
}

// Atomic write：先写到临时文件再 rename，保证宕机/并发场景下
// workspaces.json 不会出现半写状态。Node single-threaded 事件循环内同一
// tick 的多个 writeTree 调用彼此互斥，只要每个调用自己完整读-改-写即可。
function writeTree(tree) {
  ensureDirs();
  tree.updatedAt = new Date().toISOString();
  const tmpFile = `${WORKSPACE_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(tree, null, 2));
  fs.renameSync(tmpFile, WORKSPACE_FILE);
}

// Atomic write for any JSON file under data/docs (per-doc content files).
// 自动注入 schemaVersion，避免历史漏写。data 里如果显式带了 schemaVersion 会被尊重
// （比如未来要落 v2 文件），否则用当前版本号兜底。
function writeJsonAtomic(filePath, data) {
  const payload = data && typeof data === 'object' && !Array.isArray(data)
    ? { schemaVersion: DOC_SCHEMA_VERSION, ...data }
    : data;
  const tmpFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2));
  fs.renameSync(tmpFile, filePath);
}

// 在树中递归查找节点，返回 { node, parent, parentList }
function findNode(spaces, id) {
  for (const space of spaces) {
    if (space.id === id) return { node: space, parent: null, parentList: spaces };
    if (space.children) {
      const result = findInChildren(space.children, id, space);
      if (result) return result;
    }
  }
  return null;
}

function findInChildren(children, id, parent) {
  for (const child of children) {
    if (child.id === id) return { node: child, parent, parentList: children };
    if (child.children) {
      const result = findInChildren(child.children, id, child);
      if (result) return result;
    }
  }
  return null;
}

// 收集节点及其所有子节点的 id（用于批量删除内容文件）
function collectDocIds(node) {
  const ids = [];
  if (node.type === 'document') ids.push(node.id);
  if (node.children) {
    for (const child of node.children) {
      ids.push(...collectDocIds(child));
    }
  }
  return ids;
}

function collectDocumentNodes(node) {
  const docs = [];
  if (node.type === 'document') docs.push(node);
  if (node.children) {
    for (const child of node.children) {
      docs.push(...collectDocumentNodes(child));
    }
  }
  return docs;
}

function normalizeManagedFilePath(filePath = '') {
  const input = String(filePath || '').trim();
  if (!input) return '';
  if (path.isAbsolute(input)) return path.resolve(input);
  const relative = input
    .replace(/^\/api\/files\/download\//, '')
    .replace(/^\/output\//, '');
  if (!relative) return '';
  return resolveOutputRelative(relative);
}

// 把临时区文件搬到 output/promoted/<docId>/。返回 promoted 后的绝对路径；
// 如果源文件已经在 promoted/<docId>/ 下、源不存在、或源在 promoted/ 下别的 docId（罕见）
// 则按情况降级为 noop / copy，避免破坏已有引用。
//   - 同盘 → fs.renameSync（即 mv）
//   - 跨盘 → copyFileSync + unlinkSync 兜底
//   - 同名冲突 → 自动加 ` (n)` 后缀
function promoteFileToDoc(absoluteSrcPath, docId) {
  if (!absoluteSrcPath || !docId) return absoluteSrcPath;
  const src = path.resolve(absoluteSrcPath);
  if (!fs.existsSync(src)) return src; // 源不存在，让上层按原路径写到 doc.json 即可
  const targetDir = getPromotedDir(docId);
  // 已经在自己的 promoted 目录里：no-op
  if (src.startsWith(targetDir + path.sep) || src === targetDir) return src;
  // 同名去重
  const baseName = path.basename(src);
  let destName = baseName;
  let dest = path.join(targetDir, destName);
  if (fs.existsSync(dest)) {
    const ext = path.extname(baseName);
    const stem = baseName.slice(0, baseName.length - ext.length);
    let n = 1;
    while (fs.existsSync(dest)) {
      destName = `${stem} (${n})${ext}`;
      dest = path.join(targetDir, destName);
      n += 1;
    }
  }
  try {
    fs.renameSync(src, dest);
  } catch (error) {
    // EXDEV：跨设备 rename 不被支持 → fallback 到 copy+unlink
    if (error && (error.code === 'EXDEV' || /cross-device/i.test(error.message))) {
      fs.copyFileSync(src, dest);
      try { fs.unlinkSync(src); } catch (unlinkErr) {
        console.warn('[workspaceManager] promoteFileToDoc unlink 源失败:', src, unlinkErr.message);
      }
    } else {
      console.warn('[workspaceManager] promoteFileToDoc rename 失败:', error.message);
      return src; // 不动，让 doc.json 按原路径走，至少不丢文件
    }
  }
  return dest;
}

function extractManagedFilePathsFromData(data = {}) {
  const candidates = [
    data.filePath,
    data.localPath,
    data.outputRelativePath,
    data.downloadUrl,
    data.previewUrl,
  ]
    .map(normalizeManagedFilePath)
    .filter(Boolean);
  return [...new Set(candidates)];
}

function removeManagedFiles(docIds = []) {
  const paths = new Set();
  docIds.forEach((docId) => {
    const f = path.join(DOCS_DIR, docId + '.json');
    if (!fs.existsSync(f)) return;
    try {
      const data = JSON.parse(fs.readFileSync(f, 'utf8'));
      extractManagedFilePathsFromData(data).forEach((item) => paths.add(item));
    } catch (error) {
      console.warn('[workspaceManager] 读取待删除产出物失败:', error.message);
    }
  });

  paths.forEach((targetPath) => {
    try {
      if (targetPath && fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
        fs.unlinkSync(targetPath);
      }
    } catch (error) {
      console.warn('[workspaceManager] 删除产出物文件失败:', targetPath, error.message);
    }
  });

  // 新布局下每个 doc 的资产都集中在 output/promoted/<docId>/，这里把整目录 rm
  // 干掉（含 doc.json 没记录但被同名后缀 / 衍生物占用的子文件），避免空目录残留。
  docIds.forEach((docId) => {
    const promotedDir = path.join(getOutputRoot(), 'promoted', docId);
    if (!fs.existsSync(promotedDir)) return;
    try {
      fs.rmSync(promotedDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('[workspaceManager] 删除 promoted 目录失败:', promotedDir, error.message);
    }
  });
}

function ensureAllSpaceIndexes(tree) {
  let changed = false;
  for (const space of tree.spaces || []) {
    const existingIndex = (space.children || []).find(child => child.type === 'document' && child.systemType === 'space_index');
    if (space.indexDocId && existingIndex?.id === space.indexDocId) continue;
    if (existingIndex) {
      space.indexDocId = existingIndex.id;
      changed = true;
      continue;
    }
    const indexNode = createDocumentNode('README', 'document', { system: true, systemType: 'space_index' });
    space.indexDocId = indexNode.id;
    if (!space.children) space.children = [];
    space.children.unshift(indexNode);
    writeDocumentFile(indexNode, {
      contentFormat: 'legacy-html',
      content: createSpaceIndexHtml(space.name, {}),
      indexData: {
        summary: '',
        assets: [],
        recentTasks: []
      }
    });
    changed = true;
  }
  if (changed) writeTree(tree);
  return tree;
}

function cloneWithoutSystemNodes(node) {
  const cloned = { ...node };
  if (Array.isArray(node.children)) {
    cloned.children = node.children
      .filter(child => !child.system)
      .map(cloneWithoutSystemNodes);
  }
  return cloned;
}

function createDocumentNode(name, docType = 'document', extra = {}) {
  const now = isoNow();
  return {
    id: 'doc_' + uuidv4().replace(/-/g, '').slice(0, 12),
    type: 'document',
    name,
    createdAt: now,
    updatedAt: now,
    docType,
    ...extra
  };
}

function writeDocumentFile(node, payload = {}) {
  const contentFile = path.join(DOCS_DIR, node.id + '.json');
  const initContent = {
    id: node.id,
    docType: node.docType,
    name: node.name,
    contentFormat: payload.contentFormat || (node.docType === 'ppt' ? 'ppt-json' : 'tiptap-json'),
    content: payload.content !== undefined ? payload.content : (node.docType === 'ppt' ? null : createEmptyDocContent()),
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    ...payload
  };
  writeJsonAtomic(contentFile, initContent);
}

function ensureSpaceIndex(spaceId) {
  const tree = readTree();
  const found = findNode(tree.spaces, spaceId);
  if (!found || found.node.type !== 'space') throw new Error('空间不存在: ' + spaceId);

  if (found.node.indexDocId) {
    const existing = findNode(tree.spaces, found.node.indexDocId);
    if (existing?.node?.type === 'document') {
      return existing.node;
    }
  }

  const existingIndex = (found.node.children || []).find(child => child.type === 'document' && child.systemType === 'space_index');
  if (existingIndex) {
    found.node.indexDocId = existingIndex.id;
    writeTree(tree);
    return existingIndex;
  }

  const node = createDocumentNode('README', 'document', { system: true, systemType: 'space_index' });
  if (!found.node.children) found.node.children = [];
  found.node.children.unshift(node);
  found.node.indexDocId = node.id;
  writeTree(tree);
  writeDocumentFile(node, {
    contentFormat: 'legacy-html',
    content: createSpaceIndexHtml(found.node.name, {}),
    indexData: {
      summary: '',
      assets: [],
      recentTasks: []
    }
  });
  return node;
}

function getSpaceIndex(spaceId) {
  const tree = readTree();
  const found = findNode(tree.spaces, spaceId);
  if (!found || found.node.type !== 'space') throw new Error('空间不存在: ' + spaceId);
  const indexNode = ensureSpaceIndex(spaceId);
  const data = getContent(indexNode.id);
  return {
    node: indexNode,
    data,
    text: extractPlainText(data.content),
    indexData: data.indexData || { summary: '', assets: [], recentTasks: [] },
    space: found.node
  };
}

function saveSpaceIndex(spaceId, { html, indexData }) {
  const indexNode = ensureSpaceIndex(spaceId);
  const file = path.join(DOCS_DIR, indexNode.id + '.json');
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const updatedAt = isoNow();
  const next = {
    ...current,
    id: indexNode.id,
    name: indexNode.name,
    docType: 'document',
    contentFormat: 'legacy-html',
    content: html,
    indexData,
    updatedAt
  };
  writeJsonAtomic(file, next);

  const tree = readTree();
  const found = findNode(tree.spaces, indexNode.id);
  if (found) {
    found.node.updatedAt = updatedAt;
    writeTree(tree);
  }

  return { node: indexNode, updatedAt };
}

function looksLikeNoiseText(text = '') {
  const normalized = String(text).trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.length < 40) return true;
  if (/^(test|demo|hello|123|abc|测试|示例|临时)/i.test(normalized)) return true;
  return false;
}

function looksLikeNoiseDoc(doc) {
  const name = String(doc?.name || '').trim().toLowerCase();
  const snippet = String(doc?.snippet || '').trim();
  if (!snippet) return true;
  if (/(^|[\s_-])(test|demo|tmp|temp|example|样例|测试|临时)([\s_-]|$)/i.test(name) && snippet.length < 200) {
    return true;
  }
  return looksLikeNoiseText(snippet);
}

function safeParseJson(text) {
  if (!text) return null;
  const cleaned = String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```json/gi, '```')
    .trim();
  const fenceMatch = cleaned.match(/```([\s\S]*?)```/);
  const candidate = (fenceMatch?.[1] || cleaned).trim();
  const jsonMatch = candidate.match(/\{[\s\S]*\}/);
  const payload = (jsonMatch?.[0] || candidate).trim();
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

async function rewriteSpaceIndexWithAI({ spaceName, currentIndexData, usefulDocs, recentTasks, apiKeys = {} }) {
  if (!apiKeys?.minimaxApiKey) return null;

  const systemPrompt = `你是活动策划平台的空间索引整理器。
- 你的任务不是追加流水账，而是重写一版更有用的空间索引
- 只保留真正稳定、可复用、和后续任务有关的内容
- 删除测试信息、占位信息、重复表达、弱相关内容
- recentTasks 只保留最有代表性的 4 条，并对表述做压缩
- assets 只保留最值得参考的 6 项
- 输出必须是 JSON，不要解释`;

  const userPrompt = `空间：${spaceName}

旧索引：
${JSON.stringify(currentIndexData || {}, null, 2)}

当前可用文档资产：
${JSON.stringify(usefulDocs || [], null, 2)}

最近任务候选：
${JSON.stringify(recentTasks || [], null, 2)}

请输出：
{
  "summary": "对这个空间当前沉淀的一句话概括，60字以内",
  "guidance": "后续任务启动前最值得先把握的判断，80字以内",
  "focusAreas": ["聚焦点1", "聚焦点2", "聚焦点3"],
  "assets": [{"name":"", "docType":"", "note":"为什么值得看，40字以内"}],
  "recentTasks": [{"taskId":"", "title":"", "summary":"压缩后的任务结论，50字以内", "status":"", "score":"", "highlights":["",""], "updatedAt":""}]
}`;

  const raw = await callMinimax([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], {
    runtimeKey: apiKeys.minimaxApiKey,
    minimaxModel: apiKeys.minimaxModel,
    temperature: 0.25,
    maxTokens: 700
  });

  return safeParseJson(raw);
}

async function upsertSpaceIndexFromTask({
  spaceId,
  taskId,
  userInput = {},
  status = 'completed',
  planTitle = '',
  summary = '',
  highlights = [],
  score = '',
  pptPageTotal = 0,
  apiKeys = {}
}) {
  if (!spaceId) return null;
  const index = getSpaceIndex(spaceId);
  const currentIndexData = index.indexData || { summary: '', guidance: '', focusAreas: [], assets: [], recentTasks: [] };
  const context = getSpaceContext(spaceId);

  const entry = {
    taskId,
    title: planTitle || userInput.topic || '未命名任务',
    summary: summary || userInput.requirements || '',
    status,
    score: score ? String(score) : '',
    highlights: Array.isArray(highlights) ? highlights.slice(0, 4) : [],
    updatedAt: isoNow(),
    budget: userInput.budget || '',
    scale: userInput.scale || '',
    brand: userInput.brand || '',
    eventType: userInput.eventType || '',
    pptPageTotal: pptPageTotal || 0
  };

  const previousTasks = Array.isArray(currentIndexData.recentTasks) ? currentIndexData.recentTasks : [];
  const recentTasks = [entry, ...previousTasks.filter(item => item.taskId !== taskId)].slice(0, 8);

  const usefulDocs = (context.documents || [])
    .filter(doc => doc.id !== index.node.id)
    .filter(doc => !looksLikeNoiseDoc(doc))
    .slice(0, 8)
    .map(doc => ({
      name: doc.name,
      docType: doc.docType,
      note: doc.snippet.slice(0, 80)
    }));

  const aiIndex = await rewriteSpaceIndexWithAI({
    spaceName: index.space.name,
    currentIndexData,
    usefulDocs,
    recentTasks,
    apiKeys
  });

  const nextIndexData = aiIndex ? {
    summary: String(aiIndex.summary || '').trim(),
    guidance: String(aiIndex.guidance || '').trim(),
    focusAreas: Array.isArray(aiIndex.focusAreas) ? aiIndex.focusAreas.slice(0, 4) : [],
    assets: Array.isArray(aiIndex.assets) ? aiIndex.assets.slice(0, 6) : usefulDocs,
    recentTasks: Array.isArray(aiIndex.recentTasks) ? aiIndex.recentTasks.slice(0, 4) : recentTasks.slice(0, 4)
  } : {
    summary: recentTasks.length
      ? `这个空间最近聚焦在${recentTasks[0].title}相关任务，优先参考最近几次沉淀下来的有效方案和资产。`
      : currentIndexData.summary || '',
    guidance: currentIndexData.guidance || '后续任务启动前，优先看最近一轮有效任务和稳定资产，不要把测试内容带进方案。',
    focusAreas: Array.from(new Set(recentTasks.slice(0, 3).map(item => item.title).filter(Boolean))).slice(0, 3),
    assets: usefulDocs,
    recentTasks: recentTasks.slice(0, 4)
  };

  return saveSpaceIndex(spaceId, {
    html: createSpaceIndexHtml(index.space.name, nextIndexData),
    indexData: nextIndexData
  });
}

// 获取完整树
function getTree() {
  const tree = ensureAllSpaceIndexes(readTree());
  return {
    ...tree,
    spaces: (tree.spaces || []).map(cloneWithoutSystemNodes)
  };
}

// 新建 Space（一级节点）
function createSpace(name) {
  const tree = readTree();
  const node = {
    id: 'space_' + uuidv4().replace(/-/g, '').slice(0, 12),
    type: 'space',
    name,
    createdAt: isoNow(),
    children: []
  };
  const indexNode = createDocumentNode('README', 'document', { system: true, systemType: 'space_index' });
  node.indexDocId = indexNode.id;
  node.children.push(indexNode);
  tree.spaces.push(node);
  writeTree(tree);
  writeDocumentFile(indexNode, {
    contentFormat: 'legacy-html',
    content: createSpaceIndexHtml(name, {}),
    indexData: {
      summary: '',
      assets: [],
      recentTasks: []
    }
  });
  return node;
}

// 新建文件夹或文档节点（挂载到 parentId 下）
function createNode({ parentId, name, type, docType }) {
  const tree = readTree();
  const prefix = type === 'folder' ? 'folder_' : 'doc_';
  const node = {
    id: prefix + uuidv4().replace(/-/g, '').slice(0, 12),
    type,
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (type === 'document') node.docType = docType || 'document';
  if (type === 'folder') node.children = [];

  const found = findNode(tree.spaces, parentId);
  if (!found) throw new Error('父节点不存在: ' + parentId);
  if (!found.node.children) found.node.children = [];
  found.node.children.push(node);
  writeTree(tree);

  // 如果是文档节点，初始化内容文件
  if (type === 'document') {
    writeDocumentFile(node);
  }

  return node;
}

// 重命名节点
function renameNode(id, newName) {
  const tree = readTree();
  const found = findNode(tree.spaces, id);
  if (!found) throw new Error('节点不存在: ' + id);
  found.node.name = newName;
  found.node.updatedAt = new Date().toISOString();
  writeTree(tree);
}

// 设置文档 role（requirements / reference / draft / ''），用于意图分类消歧
const ALLOWED_DOC_ROLES = ['requirements', 'reference', 'draft', ''];
function setDocumentRole(id, role) {
  const normalized = String(role || '').trim().toLowerCase();
  if (!ALLOWED_DOC_ROLES.includes(normalized)) {
    throw new Error(`role 必须是 ${ALLOWED_DOC_ROLES.filter(Boolean).join('/')} 或空`);
  }
  const tree = readTree();
  const found = findNode(tree.spaces, id);
  if (!found || found.node.type !== 'document') throw new Error('文档不存在: ' + id);
  found.node.role = normalized;
  found.node.updatedAt = new Date().toISOString();
  writeTree(tree);
  return found.node;
}

// 删除节点（递归删除子节点和内容文件）
function deleteNode(id) {
  const tree = readTree();

  // 顶层 space 删除
  const spaceIdx = tree.spaces.findIndex(s => s.id === id);
  if (spaceIdx !== -1) {
    const node = tree.spaces[spaceIdx];
    const docIds = collectDocIds(node);
    removeManagedFiles(docIds);
    docIds.forEach(docId => {
      const f = path.join(DOCS_DIR, docId + '.json');
      if (fs.existsSync(f)) fs.unlinkSync(f);
    });
    tree.spaces.splice(spaceIdx, 1);
    writeTree(tree);
    return docIds;
  }

  // 子节点删除
  const found = findNode(tree.spaces, id);
  if (!found) throw new Error('节点不存在: ' + id);
  const docIds = collectDocIds(found.node);
  removeManagedFiles(docIds);
  docIds.forEach(docId => {
    const f = path.join(DOCS_DIR, docId + '.json');
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
  const idx = found.parentList.indexOf(found.node);
  found.parentList.splice(idx, 1);
  writeTree(tree);
  return docIds;
}

// 检查文件 schemaVersion，超出当前 reader 已知范围时 warn 一次，提示需要写迁移；
// 缺失字段视为 v1（最初引入版本号之前的全部历史 doc）。
function checkDocSchemaVersion(data, id) {
  const v = Number(data?.schemaVersion);
  if (!Number.isFinite(v)) return; // 老文件，没有版本号，按 v1 处理
  if (v > DOC_SCHEMA_VERSION) {
    console.warn(
      `[workspaceManager] 文档 ${id} 的 schemaVersion=${v} 高于当前读取器支持的 ${DOC_SCHEMA_VERSION}，可能存在不兼容字段`
    );
  }
}

// 获取文档内容
function getContent(id) {
  const f = path.join(DOCS_DIR, id + '.json');
  if (!fs.existsSync(f)) throw new Error('文档不存在: ' + id);
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  checkDocSchemaVersion(data, id);
  if (data.docType === 'document' && !data.contentFormat) {
    data.contentFormat = typeof data.content === 'object' ? 'tiptap-json' : 'legacy-html';
  }
  if (data.docType === 'document' && data.contentFormat === 'legacy-html' && typeof data.content === 'string' && data.content.trim()) {
    try {
      data.content = htmlToTiptap(data.content);
      data.contentFormat = 'tiptap-json';
      writeJsonAtomic(f, data);
    } catch (error) {
      console.warn('[workspaceManager] legacy-html 转 tiptap-json 失败:', error.message);
    }
  }
  return data;
}

// 保存文档内容
function saveContent(id, content, contentFormat = 'tiptap-json') {
  const f = path.join(DOCS_DIR, id + '.json');
  if (!fs.existsSync(f)) throw new Error('文档不存在: ' + id);
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  data.content = content;
  data.contentFormat = contentFormat;
  data.updatedAt = new Date().toISOString();
  writeJsonAtomic(f, data);

  // 同步更新树中的 updatedAt
  const tree = readTree();
  const found = findNode(tree.spaces, id);
  if (found) {
    found.node.updatedAt = data.updatedAt;
    writeTree(tree);
  }
  return data.updatedAt;
}

// 确保子文件夹存在（在任意节点下按名称查找或创建）
function ensureChildFolder(parentId, folderName) {
  const tree = readTree();
  const found = findNode(tree.spaces, parentId);
  if (!found) throw new Error('父节点不存在: ' + parentId);
  const parent = found.node;
  const existing = (parent.children || []).find(c => c.type === 'folder' && c.name === folderName);
  if (existing) return existing;
  const now = new Date().toISOString();
  const folder = {
    id: 'folder_' + uuidv4().replace(/-/g, '').slice(0, 12),
    type: 'folder',
    name: folderName,
    children: [],
    createdAt: now,
    updatedAt: now
  };
  if (!parent.children) parent.children = [];
  parent.children.push(folder);
  writeTree(tree);
  return folder;
}

// 确保任务文件夹存在（按名称查找或创建）
function ensureTaskFolder(spaceId, folderName) {
  const tree = readTree();
  const found = findNode(tree.spaces, spaceId);
  if (!found) throw new Error('空间不存在: ' + spaceId);
  const parent = found.node;
  // 在直接子节点中找同名文件夹
  const existing = (parent.children || []).find(
    c => c.type === 'folder' && c.name === folderName && !c.system
  );
  if (existing) return existing;
  // 新建文件夹
  const now = new Date().toISOString();
  const folder = {
    id: 'folder_' + uuidv4().replace(/-/g, '').slice(0, 12),
    type: 'folder',
    name: folderName,
    children: [],
    createdAt: now,
    updatedAt: now
  };
  if (!parent.children) parent.children = [];
  parent.children.push(folder);
  writeTree(tree);
  return folder;
}

// 保存 Agent 生成的 PPT 到指定位置（parentId 优先，默认 spaceId）
// 文件本体从临时区（output/conversations/<convId>/runs/.../ 或老的 output/runs/...）
// 搬到 output/promoted/<docId>/，doc.json 记录的 outputRelativePath / downloadUrl 都
// 跟着指向 promoted 目录。这样：
//   - 删除 conversation 时直接 rm -rf output/conversations/<convId>/，不会误伤已存资产
//   - workspace 节点删除时 removeManagedFiles 也能精确清理 promoted/<docId>/
function savePptToSpace({ spaceId, parentId, name, pptData, downloadUrl, previewSlides }) {
  const targetParent = parentId || spaceId;
  const node = createNode({ parentId: targetParent, name, type: 'document', docType: 'ppt' });
  const f = path.join(DOCS_DIR, node.id + '.json');
  const srcFilePath = normalizeManagedFilePath(downloadUrl);
  const promotedPath = srcFilePath ? promoteFileToDoc(srcFilePath, node.id) : '';
  const outputRelativePath = promotedPath ? toOutputRelative(promotedPath) : '';
  const pptxFilename = outputRelativePath
    ? path.basename(outputRelativePath)
    : '';
  const content = {
    id: node.id,
    docType: 'ppt',
    name,
    pptData,
    previewSlides: previewSlides || [],
    pptxFilename,
    filePath: promotedPath || srcFilePath,
    outputRelativePath,
    downloadUrl: outputRelativePath ? `/api/files/download/${outputRelativePath}` : (downloadUrl || ''),
    createdAt: node.createdAt,
    updatedAt: node.updatedAt
  };
  writeJsonAtomic(f, content);
  return node;
}

function saveAssetToSpace({ spaceId, parentId, name, docType = 'file', filePath = '', previewUrl = '', downloadUrl = '', meta = {} }) {
  const targetParent = parentId || spaceId;
  const node = createNode({ parentId: targetParent, name, type: 'document', docType });
  const f = path.join(DOCS_DIR, node.id + '.json');
  const srcFilePath = normalizeManagedFilePath(filePath || downloadUrl || previewUrl);
  const promotedPath = srcFilePath ? promoteFileToDoc(srcFilePath, node.id) : '';
  const resolvedFilePath = promotedPath || srcFilePath;
  const outputRelativePath = resolvedFilePath ? toOutputRelative(resolvedFilePath) : '';
  // previewUrl / downloadUrl 如果上层显式传了，且不再指向 promoted 后的实际位置，
  // 重新基于 promoted 路径生成；调用方传的旧 URL 可能已经失效。
  const normalizedPreviewUrl = outputRelativePath
    ? toOutputUrl(resolvedFilePath)
    : (previewUrl || '');
  const normalizedDownloadUrl = outputRelativePath
    ? `/api/files/download/${outputRelativePath}`
    : (downloadUrl || '');
  const content = {
    id: node.id,
    docType,
    name,
    filePath: resolvedFilePath,
    outputRelativePath,
    previewUrl: normalizedPreviewUrl,
    downloadUrl: normalizedDownloadUrl,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    ...meta
  };
  writeJsonAtomic(f, content);
  return node;
}

function getSpaceContext(spaceId) {
  const tree = readTree();
  const found = findNode(tree.spaces, spaceId);
  if (!found || found.node.type !== 'space') throw new Error('空间不存在: ' + spaceId);
  const index = getSpaceIndex(spaceId);

  const docs = collectDocumentNodes(found.node)
    .map((node) => {
      const file = path.join(DOCS_DIR, node.id + '.json');
      if (!fs.existsSync(file)) return null;
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const rawText = data.docType === 'ppt'
        ? extractPlainText((data.previewSlides || []).join(' '))
        : data.docType === 'image'
          ? extractPlainText([data.name, data.caption, data.sourcePageTitle, data.outputRelativePath].filter(Boolean).join(' '))
          : extractPlainText(data.content);
      return {
        id: node.id,
        name: node.name,
        docType: node.docType || 'document',
        systemType: node.systemType || '',
        role: node.role || data.role || '',
        updatedAt: node.updatedAt || data.updatedAt || node.createdAt,
        snippet: rawText.slice(0, 1200)
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

  return {
    space: {
      id: found.node.id,
      name: found.node.name
    },
    index: {
      id: index.node.id,
      name: index.node.name,
      text: index.text,
      indexData: index.indexData
    },
    documents: docs,
    combinedText: docs
      .filter((doc) => doc.systemType !== 'space_index')
      .map((doc) => `【${doc.name}｜${doc.docType}】${doc.snippet}`)
      .join('\n\n')
      .slice(0, 8000)
  };
}

module.exports = {
  getTree,
  createSpace,
  createNode,
  renameNode,
  setDocumentRole,
  deleteNode,
  getContent,
  saveContent,
  savePptToSpace,
  saveAssetToSpace,
  ensureChildFolder,
  ensureTaskFolder,
  getSpaceContext,
  ensureSpaceIndex,
  getSpaceIndex,
  saveSpaceIndex,
  upsertSpaceIndexFromTask,
  // 暴露给迁移脚本 / 测试 —— 业务代码不要直接调，请走 saveAssetToSpace / savePptToSpace
  _promoteFileToDoc: promoteFileToDoc
};
