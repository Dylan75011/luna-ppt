const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const wm      = require('../services/workspaceManager');
const conversationStore = require('../services/conversationStore');
const { cleanupConversationTmp } = require('../services/outputRetention');
// lazy require: docx-preview is browser-only, only load when actually needed
let _docxToTiptapJson = null;
function getDocxConverter() {
  if (!_docxToTiptapJson) {
    _docxToTiptapJson = require('../services/docxPreviewConverter').docxToTiptapJson;
  }
  return _docxToTiptapJson;
}

// multer：内存模式，不落盘（Word 文件通常 < 10MB）
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// 获取完整树
router.get('/', (req, res) => {
  try {
    res.json({ success: true, data: wm.getTree() });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 新建 Space
router.post('/space', (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: '缺少 name' });
    const node = wm.createSpace(name);
    res.json({ success: true, node });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 获取某个空间下的会话列表
router.get('/:spaceId/conversations', (req, res) => {
  try {
    const conversations = conversationStore.listConversations(req.params.spaceId);
    res.json({ success: true, data: conversations });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 新建会话
router.post('/:spaceId/conversations', (req, res) => {
  try {
    const { title } = req.body || {};
    const conversation = conversationStore.createConversation(req.params.spaceId, title || '新对话');
    res.json({ success: true, data: conversation });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 获取会话详情与消息
router.get('/conversations/:id', (req, res) => {
  try {
    const conversation = conversationStore.getConversationDetail(req.params.id);
    if (!conversation) return res.status(404).json({ success: false, message: '会话不存在' });
    res.json({ success: true, data: conversation });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 保存会话快照
router.put('/conversations/:id', (req, res) => {
  try {
    const { title, status, state, messages, lastMessageAt } = req.body || {};
    const conversation = conversationStore.saveConversationSnapshot(req.params.id, {
      title,
      status,
      state,
      messages,
      lastMessageAt
    });
    res.json({ success: true, data: conversation });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 增量追加/更新单条消息（流式输出中使用，避免每次都全量重写）
router.post('/conversations/:id/messages', (req, res) => {
  try {
    const { message, state, title, status } = req.body || {};
    if (!message || !message.id) {
      return res.status(400).json({ success: false, message: '缺少 message 或 message.id' });
    }
    conversationStore.appendMessage(req.params.id, message, { state, title, status });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 删除会话：SQL 行 + 磁盘临时区一起清。先删 DB 再删盘 —— 即使盘清理失败，
// 用户视图层（依赖 conversations 表）已经看不到这条会话；磁盘上的临时区
// 目录最坏情况下会留作孤儿，由 retention 兜底（或下一次手工清理）。
router.delete('/conversations/:id', (req, res) => {
  try {
    const conversationId = req.params.id;
    conversationStore.deleteConversation(conversationId);
    try {
      cleanupConversationTmp(conversationId);
    } catch (cleanupErr) {
      console.warn('[workspace] cleanupConversationTmp 失败:', conversationId, cleanupErr.message);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 新建文件夹
router.post('/folder', (req, res) => {
  try {
    const { parentId, name } = req.body;
    if (!parentId || !name) return res.status(400).json({ success: false, message: '缺少 parentId 或 name' });
    const node = wm.createNode({ parentId, name, type: 'folder' });
    res.json({ success: true, node });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 新建文档
router.post('/document', (req, res) => {
  try {
    const { parentId, name, docType } = req.body;
    if (!parentId || !name) return res.status(400).json({ success: false, message: '缺少 parentId 或 name' });
    const node = wm.createNode({ parentId, name, type: 'document', docType: docType || 'document' });
    res.json({ success: true, node });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 重命名
router.put('/:id/rename', (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: '缺少 name' });
    wm.renameNode(req.params.id, name);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 设置文档 role（requirements / reference / draft / ''）
router.put('/:id/role', (req, res) => {
  try {
    const { role } = req.body || {};
    const node = wm.setDocumentRole(req.params.id, role);
    res.json({ success: true, node });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// 删除节点
router.delete('/:id', (req, res) => {
  try {
    const deletedIds = wm.deleteNode(req.params.id);
    if (String(req.params.id).startsWith('space_')) {
      // 删 space 会 cascade 掉它名下所有 conversation；磁盘上每条 conv 的临时区也得清，
      // 否则删 workspace 之后会留一堆 output/conversations/<convId>/ 孤儿。
      const purgedConvIds = conversationStore.deleteWorkspaceConversations(req.params.id) || [];
      purgedConvIds.forEach((cid) => {
        try { cleanupConversationTmp(cid); } catch (err) {
          console.warn('[workspace] cleanupConversationTmp 失败:', cid, err.message);
        }
      });
    }
    res.json({ success: true, deletedIds });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 获取文档内容
router.get('/:id/content', (req, res) => {
  try {
    const content = wm.getContent(req.params.id);
    res.json({ success: true, content });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 保存文档内容
router.put('/:id/content', (req, res) => {
  try {
    const { content, contentFormat } = req.body;
    if (content === undefined) return res.status(400).json({ success: false, message: '缺少 content' });
    const updatedAt = wm.saveContent(req.params.id, content, contentFormat);
    res.json({ success: true, updatedAt });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─── Word 导入：POST /api/workspace/:id/import-word ─────────────────
// 上传 .docx，解析为 HTML 并保存到指定文档节点
// 若 id = '_new'，则仅返回 html，由前端决定存储位置
router.post('/:id/import-word', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '请上传 .docx 文件' });
    if (!req.file.originalname.match(/\.docx?$/i)) {
      return res.status(400).json({ success: false, message: '仅支持 .docx 格式' });
    }

    const tiptapJson = await getDocxConverter()(req.file.buffer);

    // 如果是真实节点 ID，直接保存内容
    const { id } = req.params;
    if (id !== '_new') {
      wm.saveContent(id, tiptapJson, 'tiptap-json');
    }

    res.json({ success: true, content: tiptapJson });
  } catch (e) {
    console.error('[import-word]', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─── Word 导出：GET /api/workspace/:id/export-word ──────────────────
// 读取文档内容，转为 .docx 并下载
router.get('/:id/export-word', async (req, res) => {
  try {
    const content = wm.getContent(req.params.id);
    if (!content) return res.status(404).json({ success: false, message: '文档不存在' });

    const html   = contentToHtml(content.content, content.contentFormat);
    const title  = content.name || '策划文档';
    const buffer = await htmlToDocx(html, title);

    const filename = encodeURIComponent(title) + '.docx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.send(buffer);
  } catch (e) {
    console.error('[export-word]', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// 保存 PPT 到文档空间
router.post('/save-ppt', (req, res) => {
  try {
    const { spaceId, name, pptData, downloadUrl, previewSlides } = req.body;
    if (!spaceId || !name) return res.status(400).json({ success: false, message: '缺少 spaceId 或 name' });
    const node = wm.savePptToSpace({ spaceId, name, pptData, downloadUrl, previewSlides });
    res.json({ success: true, node });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
