const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { callMinimax } = require('./llmClients');
const { htmlToTiptap } = require('./richText');
const { toOutputRelative, toOutputUrl, resolveOutputRelative } = require('./outputPaths');

const DATA_DIR = path.resolve('./data');
const WORKSPACE_FILE = path.join(DATA_DIR, 'workspaces.json');
const DOCS_DIR = path.join(DATA_DIR, 'docs');

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

// 写回 workspaces.json
function writeTree(tree) {
  ensureDirs();
  tree.updatedAt = new Date().toISOString();
  fs.writeFileSync(WORKSPACE_FILE, JSON.stringify(tree, null, 2));
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
  fs.writeFileSync(contentFile, JSON.stringify(initContent, null, 2));
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
  fs.writeFileSync(file, JSON.stringify(next, null, 2));

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

// 获取文档内容
function getContent(id) {
  const f = path.join(DOCS_DIR, id + '.json');
  if (!fs.existsSync(f)) throw new Error('文档不存在: ' + id);
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (data.docType === 'document' && !data.contentFormat) {
    data.contentFormat = typeof data.content === 'object' ? 'tiptap-json' : 'legacy-html';
  }
  if (data.docType === 'document' && data.contentFormat === 'legacy-html' && typeof data.content === 'string' && data.content.trim()) {
    try {
      data.content = htmlToTiptap(data.content);
      data.contentFormat = 'tiptap-json';
      fs.writeFileSync(f, JSON.stringify(data, null, 2));
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
  fs.writeFileSync(f, JSON.stringify(data, null, 2));

  // 同步更新树中的 updatedAt
  const tree = readTree();
  const found = findNode(tree.spaces, id);
  if (found) {
    found.node.updatedAt = data.updatedAt;
    writeTree(tree);
  }
  return data.updatedAt;
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
function savePptToSpace({ spaceId, parentId, name, pptData, downloadUrl, previewSlides }) {
  const targetParent = parentId || spaceId;
  const node = createNode({ parentId: targetParent, name, type: 'document', docType: 'ppt' });
  const f = path.join(DOCS_DIR, node.id + '.json');
  const filePath = normalizeManagedFilePath(downloadUrl);
  const outputRelativePath = filePath ? toOutputRelative(filePath) : '';
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
    filePath,
    outputRelativePath,
    downloadUrl: outputRelativePath ? `/api/files/download/${outputRelativePath}` : (downloadUrl || ''),
    createdAt: node.createdAt,
    updatedAt: node.updatedAt
  };
  fs.writeFileSync(f, JSON.stringify(content, null, 2));
  return node;
}

function saveAssetToSpace({ spaceId, parentId, name, docType = 'file', filePath = '', previewUrl = '', downloadUrl = '', meta = {} }) {
  const targetParent = parentId || spaceId;
  const node = createNode({ parentId: targetParent, name, type: 'document', docType });
  const f = path.join(DOCS_DIR, node.id + '.json');
  const resolvedFilePath = normalizeManagedFilePath(filePath || downloadUrl || previewUrl);
  const outputRelativePath = resolvedFilePath ? toOutputRelative(resolvedFilePath) : '';
  const normalizedPreviewUrl = previewUrl || (resolvedFilePath ? toOutputUrl(resolvedFilePath) : '');
  const normalizedDownloadUrl = downloadUrl || (outputRelativePath ? `/api/files/download/${outputRelativePath}` : '');
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
  fs.writeFileSync(f, JSON.stringify(content, null, 2));
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
  deleteNode,
  getContent,
  saveContent,
  savePptToSpace,
  saveAssetToSpace,
  ensureTaskFolder,
  getSpaceContext,
  ensureSpaceIndex,
  getSpaceIndex,
  saveSpaceIndex,
  upsertSpaceIndexFromTask
};
