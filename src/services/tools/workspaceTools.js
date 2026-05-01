// 工作空间文档工具：read / save / update / append / list / search / create_folder / rename / set_role / delete
const wm = require('../workspaceManager');
const { markdownToTiptap } = require('../richText');

const AFFIRMATIVE_PATTERNS = [
  /^(确认|确定|同意|可以|好的?|是的?|没问题|删除|删掉|确认删除|yes|ok|y)\b/i,
  /确认删除|同意删除|可以删除|就删|删了吧/
];

// 任何"写型"工具（update / patch / find_replace / append）结束后无条件调用：
// 把完整 tiptap doc 推回前端预览面板，并把 session 的"当前文档"指针切到这份。
//
// 用 doc_preview_updated 这个**无副作用**事件——区别于 doc_ready / doc_section_added
// （那俩是 run_strategy 流式生成专用，handleDocReady 会 pushAiMessage、handleDocSectionAdded
// 会改 progressLabel）。如果 agent 在长对话里反复改文档，复用 doc_ready 会让前端不断
// 推"方案已整理到右侧"的重复 AI 消息。
//
// 同时把 session.lastSavedDocId 切到当前 docId——brain prompt 用这个字段提示"最新文档"，
// 用户改 doc_B 之后下一轮再说"再加一节"，brain 应该指向 doc_B 而不是更早的 doc_A。
function pushDocPreview(session, onEvent, docId, tiptapDoc, title) {
  if (!docId || !tiptapDoc || typeof tiptapDoc !== 'object') return;
  const displayTitle = title || session.lastSavedDocName || '策划方案';
  onEvent('doc_preview_updated', {
    docId,
    title: displayTitle,
    docContent: tiptapDoc
  });
  session.lastSavedDocId = docId;
  session.lastSavedDocName = displayTitle;
  session.docJson = tiptapDoc;
}

const DELETE_APPROVAL_TTL_MS = 5 * 60 * 1000;

function isAffirmativeAnswer(text = '') {
  const t = String(text || '').trim();
  if (!t) return false;
  return AFFIRMATIVE_PATTERNS.some((pattern) => pattern.test(t));
}

function extractPlainText(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  if (Array.isArray(value)) return value.map(extractPlainText).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    const own = typeof value.text === 'string' ? value.text : '';
    const inner = extractPlainText(value.content);
    return [own, inner].filter(Boolean).join(' ').trim();
  }
  return '';
}

// ─── 章节定位 / 局部 patch 工具函数 ────────────────────────────────
function headingBlockText(block) {
  if (!block || block.type !== 'heading') return '';
  return (Array.isArray(block.content) ? block.content : [])
    .map((n) => (typeof n?.text === 'string' ? n.text : extractPlainText(n)))
    .join('')
    .trim();
}

function normalizeHeading(str = '') {
  return String(str)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[「」『』【】《》()（）\[\]<>,.，。;；:：!！?？'"'""`~·、\-—_*#]/g, '');
}

// 计算文档大纲：每个标题对应的块 index + 层级 + 文本
function computeOutline(tiptapDoc) {
  const blocks = Array.isArray(tiptapDoc?.content) ? tiptapDoc.content : [];
  return blocks
    .map((b, idx) => {
      if (!b || b.type !== 'heading') return null;
      const level = Number(b.attrs?.level) || 1;
      return { index: idx, level, text: headingBlockText(b) };
    })
    .filter(Boolean);
}

// 找到匹配的 section：返回 { start, end, heading } 或 null/ambiguous
// section 范围：[headingIndex, 下一个 level<=当前 level 的 heading index)
function findSection(tiptapDoc, query, preferredLevel = null) {
  const outline = computeOutline(tiptapDoc);
  if (!outline.length) return { error: '文档没有任何标题，无法按章节定位' };

  const normQuery = normalizeHeading(query);
  if (!normQuery) return { error: 'heading 为空' };

  const scored = outline
    .map((h) => {
      const normH = normalizeHeading(h.text);
      let score = 0;
      if (normH === normQuery) score = 3;
      else if (normH.startsWith(normQuery) || normQuery.startsWith(normH)) score = 2;
      else if (normH.includes(normQuery) || normQuery.includes(normH)) score = 1;
      return { ...h, score };
    })
    .filter((h) => h.score > 0);

  if (!scored.length) {
    return {
      error: `未找到标题包含 "${query}" 的章节`,
      availableHeadings: outline.map((h) => `${'#'.repeat(h.level)} ${h.text}`)
    };
  }

  let candidates = scored;
  if (preferredLevel) {
    const filtered = candidates.filter((c) => c.level === Number(preferredLevel));
    if (filtered.length) candidates = filtered;
  }

  const maxScore = Math.max(...candidates.map((c) => c.score));
  const best = candidates.filter((c) => c.score === maxScore);

  if (best.length > 1) {
    return {
      error: `"${query}" 匹配到多个章节，请在 heading 里用更完整标题或加 heading_level 消歧`,
      matches: best.map((h) => `${'#'.repeat(h.level)} ${h.text}`)
    };
  }

  const picked = best[0];
  const endOutline = outline.find((h) => h.index > picked.index && h.level <= picked.level);
  const blocks = Array.isArray(tiptapDoc.content) ? tiptapDoc.content : [];
  return {
    start: picked.index,
    end: endOutline ? endOutline.index : blocks.length,
    heading: picked
  };
}

// 把用户传入的 markdown 转成 tiptap 块数组
function markdownToBlocks(md) {
  const { markdownToTiptap } = require('../richText');
  const doc = markdownToTiptap(String(md || ''));
  return Array.isArray(doc?.content) ? doc.content : [];
}

function applySectionPatch(tiptapDoc, section, mode, newBlocks) {
  const blocks = Array.isArray(tiptapDoc.content) ? [...tiptapDoc.content] : [];
  const { start, end, heading } = section;
  const originalHeadingBlock = blocks[start];

  if (mode === 'delete') {
    blocks.splice(start, end - start);
  } else if (mode === 'replace') {
    const safe = (newBlocks || []).filter(Boolean);
    // 若用户没给新标题，保留原 heading 块，避免丢失章节名
    const hasHeading = safe[0]?.type === 'heading'
      && Number(safe[0].attrs?.level) === heading.level;
    const payload = hasHeading ? safe : [originalHeadingBlock, ...safe];
    blocks.splice(start, end - start, ...payload);
  } else if (mode === 'prepend') {
    // 插到标题之后、第一个 body 块之前
    blocks.splice(start + 1, 0, ...(newBlocks || []).filter(Boolean));
  } else if (mode === 'append') {
    blocks.splice(end, 0, ...(newBlocks || []).filter(Boolean));
  }

  return { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] };
}

async function execReadWorkspaceDoc(args, session, onEvent) {
  const docId = String(args.doc_id || '').trim();
  if (!docId) return { success: false, error: '请指定 doc_id' };

  try {
    const data = wm.getContent(docId);
    const rawContent = data.content;
    const text = extractPlainText(rawContent);

    // full=true 时不截断（用于局部编辑取基线）；默认 8k 兜底，避免超长文档塞爆 context
    const wantsFull = args.full === true || args.full === 'true';
    const MAX_CHARS = wantsFull ? 32000 : 8000;
    const truncated = text.length > MAX_CHARS;
    const displayText = truncated ? text.slice(0, MAX_CHARS) + '\n...[内容较长，已截断]' : text;

    // 大纲：帮助 agent 按章节定位，调用 patch_workspace_doc_section 时直接拿到可用标题列表
    let outline = [];
    if ((data.docType || 'document') === 'document' && rawContent && typeof rawContent === 'object') {
      outline = computeOutline(rawContent).map((h) => ({ level: h.level, text: h.text }));
    }

    onEvent('tool_progress', { message: `已读取文档：${data.name || docId}` });

    const wantsPreview = args.preview === true || args.preview === 'true';
    if (wantsPreview && (data.docType || 'document') === 'document') {
      const tiptapContent = (rawContent && typeof rawContent === 'object') ? rawContent : null;
      if (tiptapContent) {
        session.lastSavedDocId = docId;
        session.lastSavedDocName = data.name || docId;
        session.docJson = tiptapContent;
        onEvent('doc_opened', {
          docId,
          title: data.name || docId,
          docContent: tiptapContent
        });
      }
    }

    return {
      success: true,
      doc_id: docId,
      name: data.name || '',
      docType: data.docType || 'document',
      updatedAt: data.updatedAt || '',
      focus: args.focus || '',
      previewed: wantsPreview && (data.docType || 'document') === 'document',
      truncated,
      outline,
      content: displayText || '（文档内容为空）'
    };
  } catch (e) {
    return { success: false, error: `读取失败：${e.message}` };
  }
}

async function execPatchWorkspaceDocSection(args, session, onEvent) {
  const docId = String(args.doc_id || '').trim();
  const heading = String(args.heading || '').trim();
  const mode = String(args.mode || 'replace').trim().toLowerCase();
  const content = typeof args.content === 'string' ? args.content : '';
  const preferredLevel = args.heading_level ? Number(args.heading_level) : null;

  if (!docId) return { success: false, error: '请指定 doc_id' };
  if (!heading) return { success: false, error: '请指定 heading（要定位的章节标题，可以是部分关键词）' };
  if (!['replace', 'append', 'prepend', 'delete'].includes(mode)) {
    return { success: false, error: `mode 非法，应为 replace / append / prepend / delete 之一，收到 ${mode}` };
  }
  if (mode !== 'delete' && !content.trim()) {
    return { success: false, error: 'content 为空。replace/append/prepend 模式必须提供新的 Markdown 正文。' };
  }

  try {
    const data = wm.getContent(docId);
    if ((data.docType || 'document') !== 'document') {
      return { success: false, error: `该文档类型为 ${data.docType}，不支持章节级局部编辑` };
    }
    const tiptapDoc = (data.content && typeof data.content === 'object')
      ? data.content
      : { type: 'doc', content: [] };

    const located = findSection(tiptapDoc, heading, preferredLevel);
    if (located.error) {
      return {
        success: false,
        error: located.error,
        available_headings: located.availableHeadings,
        ambiguous_matches: located.matches
      };
    }

    const newBlocks = mode === 'delete' ? [] : markdownToBlocks(content);
    const patchedDoc = applySectionPatch(tiptapDoc, located, mode, newBlocks);
    wm.saveContent(docId, patchedDoc, 'tiptap-json');

    try { session.spaceContext = wm.getSpaceContext(session.spaceId); } catch {}

    const displayName = data.name || docId;
    const matchedHeading = `${'#'.repeat(located.heading.level)} ${located.heading.text}`;
    const actionLabel = { replace: '替换', append: '追加到', prepend: '前置到', delete: '删除' }[mode];
    onEvent('tool_progress', { message: `已${actionLabel}章节 "${located.heading.text}"` });
    onEvent('workspace_updated', {
      spaceId: session.spaceId,
      docId,
      docName: displayName,
      docType: 'document',
      action: `patch_${mode}`
    });
    pushDocPreview(session, onEvent, docId, patchedDoc, displayName);

    return {
      success: true,
      doc_id: docId,
      name: displayName,
      mode,
      matched_heading: matchedHeading,
      section_range: { start: located.start, end: located.end },
      affected_blocks: mode === 'delete' ? (located.end - located.start) : newBlocks.length,
      outline: computeOutline(patchedDoc).map((h) => ({ level: h.level, text: h.text }))
    };
  } catch (e) {
    return { success: false, error: `局部编辑失败：${e.message}` };
  }
}

// 在 tiptap blocks 范围内，对 text 节点的 text 字段做字符串替换
// 注意：跨 text 节点（如被 mark 切开的连续文本）不会匹配，属于已知约束
function replaceTextInBlocks(blocks, find, replace, { caseSensitive = true, maxReplacements = 50 } = {}) {
  if (!Array.isArray(blocks) || !find) return { count: 0, samples: [] };
  const escaped = find.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const re = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
  let count = 0;
  const samples = [];

  const traverse = (node) => {
    if (!node || count >= maxReplacements) return;
    if (node.type === 'text' && typeof node.text === 'string' && node.text) {
      const original = node.text;
      let localHits = 0;
      const replaced = original.replace(re, (match) => {
        if (count >= maxReplacements) return match;
        count += 1;
        localHits += 1;
        return replace;
      });
      if (replaced !== original) {
        node.text = replaced;
        if (samples.length < 5) {
          const trimmed = replaced.length > 100 ? replaced.slice(0, 100) + '…' : replaced;
          samples.push({ before: original.length > 100 ? original.slice(0, 100) + '…' : original, after: trimmed, hits: localHits });
        }
      }
    }
    if (Array.isArray(node?.content)) {
      for (const child of node.content) {
        if (count >= maxReplacements) break;
        traverse(child);
      }
    }
  };

  for (const block of blocks) {
    if (count >= maxReplacements) break;
    traverse(block);
  }
  return { count, samples };
}

async function execFindReplaceInDoc(args, session, onEvent) {
  const docId = String(args.doc_id || '').trim();
  const find = typeof args.find === 'string' ? args.find : '';
  const replace = typeof args.replace === 'string' ? args.replace : '';
  const scopeHeading = typeof args.scope_heading === 'string' ? args.scope_heading.trim() : '';
  const caseSensitive = args.case_sensitive !== false; // 默认大小写敏感
  const maxReplacements = Math.max(1, Math.min(200, Number(args.max_replacements) || 50));

  if (!docId) return { success: false, error: '请指定 doc_id' };
  if (!find) return { success: false, error: 'find 为空，必须指定要查找的字符串' };
  if (find === replace) return { success: false, error: 'find 与 replace 完全相同，无需替换' };

  try {
    const data = wm.getContent(docId);
    if ((data.docType || 'document') !== 'document') {
      return { success: false, error: `该文档类型为 ${data.docType}，不支持 find/replace` };
    }
    const tiptapDoc = (data.content && typeof data.content === 'object')
      ? JSON.parse(JSON.stringify(data.content))
      : { type: 'doc', content: [] };
    const blocks = Array.isArray(tiptapDoc.content) ? tiptapDoc.content : [];

    let targetBlocks = blocks;
    let scopeInfo = null;
    if (scopeHeading) {
      const located = findSection(tiptapDoc, scopeHeading, args.heading_level ? Number(args.heading_level) : null);
      if (located.error) {
        return {
          success: false,
          error: located.error,
          available_headings: located.availableHeadings,
          ambiguous_matches: located.matches
        };
      }
      targetBlocks = blocks.slice(located.start, located.end);
      scopeInfo = { heading: `${'#'.repeat(located.heading.level)} ${located.heading.text}`, start: located.start, end: located.end };
    }

    const { count, samples } = replaceTextInBlocks(targetBlocks, find, replace, { caseSensitive, maxReplacements });

    if (count === 0) {
      return {
        success: false,
        error: `未在${scopeHeading ? `章节"${scopeHeading}"内` : '文档中'}找到 "${find}"。可能原因：(1) 大小写或全半角不一致——试试 case_sensitive=false；(2) 该文本被加粗/高亮等格式拆分到不同 text 节点导致跨节点不匹配——这种情况改用 patch_workspace_doc_section；(3) 文档里确实没有这个词。`,
        replaced_count: 0
      };
    }

    wm.saveContent(docId, tiptapDoc, 'tiptap-json');
    try { session.spaceContext = wm.getSpaceContext(session.spaceId); } catch {}

    const displayName = data.name || docId;
    const truncated = count >= maxReplacements;
    onEvent('tool_progress', {
      message: `已替换 ${count} 处 "${find}" → "${replace}"${scopeHeading ? `（限定章节"${scopeHeading}"）` : ''}${truncated ? '（已达上限）' : ''}`
    });
    onEvent('workspace_updated', {
      spaceId: session.spaceId,
      docId,
      docName: displayName,
      docType: 'document',
      action: 'find_replace'
    });
    pushDocPreview(session, onEvent, docId, tiptapDoc, displayName);

    return {
      success: true,
      doc_id: docId,
      name: displayName,
      find,
      replace,
      replaced_count: count,
      truncated,
      scope: scopeInfo,
      samples
    };
  } catch (e) {
    return { success: false, error: `查找替换失败：${e.message}` };
  }
}

async function execUpdateWorkspaceDoc(args, session, onEvent) {
  const docId = String(args.doc_id || '').trim();
  const content = String(args.content || '').trim();
  if (!docId) return { success: false, error: '请指定 doc_id' };
  if (!content) {
    return {
      success: false,
      error: 'content 为空，更新被拒绝。请不要再次用空 content 重试；先用 read_workspace_doc 取回原文作为基线，然后在 content 字段里一次性传入完整的 Markdown 正文（标题 + 正文），不要把正文塞到其它字段或超长拼接导致 JSON 截断。'
    };
  }

  try {
    const data = wm.getContent(docId);
    const tiptapDoc = markdownToTiptap(content);
    wm.saveContent(docId, tiptapDoc, 'tiptap-json');

    if (args.title && String(args.title).trim() && String(args.title).trim() !== data.name) {
      wm.renameNode(docId, String(args.title).trim());
    }

    try { session.spaceContext = wm.getSpaceContext(session.spaceId); } catch {}

    const displayName = args.title || data.name || docId;
    onEvent('tool_progress', { message: `已更新文档：${displayName}` });
    onEvent('workspace_updated', { spaceId: session.spaceId, docId, docName: displayName, docType: 'document', action: 'update' });
    pushDocPreview(session, onEvent, docId, tiptapDoc, displayName);

    return { success: true, doc_id: docId, name: displayName };
  } catch (e) {
    return { success: false, error: `更新失败：${e.message}` };
  }
}

async function execSaveToWorkspace(args, session, onEvent) {
  if (!session.spaceId) return { success: false, error: '当前没有选中工作空间，无法保存' };

  const title = String(args.title || '').trim() || `AI生成文档_${new Date().toLocaleDateString('zh-CN')}`;
  const content = String(args.content || '').trim();
  if (!content) {
    return {
      success: false,
      error: 'content 为空，保存被拒绝。请不要再次用空 content 重试；先在思考中写出要保存的完整 Markdown 正文（标题 + 各章节），然后一次性传入 content 字段。如果需要沿用已有文档，请改用 read_workspace_doc 取回基线后再保存。避免因重复重试导致 tool_call JSON 过长被截断。'
    };
  }

  try {
    const node = wm.createNode({ parentId: session.spaceId, name: title, type: 'document', docType: 'document' });
    const tiptapDoc = markdownToTiptap(content);
    wm.saveContent(node.id, tiptapDoc, 'tiptap-json');
    try { session.spaceContext = wm.getSpaceContext(session.spaceId); } catch {}
    onEvent('tool_progress', { message: `已保存到工作空间：${title}` });
    onEvent('workspace_updated', { spaceId: session.spaceId, docId: node.id, docName: title, docType: 'document' });
    pushDocPreview(session, onEvent, node.id, tiptapDoc, title);

    return { success: true, doc_id: node.id, name: title };
  } catch (e) {
    return { success: false, error: `保存失败：${e.message}` };
  }
}

async function execAppendWorkspaceDoc(args, session, onEvent) {
  const docId = String(args.doc_id || '').trim();
  const content = String(args.content || '').trim();
  if (!docId) return { success: false, error: '请指定 doc_id' };
  if (!content) return { success: false, error: 'content 为空。请在 content 里传入要追加的 Markdown 片段。' };

  try {
    const data = wm.getContent(docId);
    if ((data.docType || 'document') !== 'document') {
      return { success: false, error: `该文档类型为 ${data.docType}，不支持追加，只有普通文档可以追加` };
    }

    const existingDoc = (data.content && typeof data.content === 'object') ? data.content : { type: 'doc', content: [] };
    const existingBlocks = Array.isArray(existingDoc.content) ? existingDoc.content : [];
    const appendedDoc = markdownToTiptap(content);
    const appendedBlocks = Array.isArray(appendedDoc?.content) ? appendedDoc.content : [];

    const mergedDoc = { type: 'doc', content: [...existingBlocks, ...appendedBlocks] };
    wm.saveContent(docId, mergedDoc, 'tiptap-json');

    try { session.spaceContext = wm.getSpaceContext(session.spaceId); } catch {}

    onEvent('tool_progress', { message: `已追加到文档：${data.name || docId}` });
    onEvent('workspace_updated', { spaceId: session.spaceId, docId, docName: data.name || docId, docType: 'document', action: 'append' });
    pushDocPreview(session, onEvent, docId, mergedDoc, data.name || docId);

    return { success: true, doc_id: docId, name: data.name || docId, appended_blocks: appendedBlocks.length };
  } catch (e) {
    return { success: false, error: `追加失败：${e.message}` };
  }
}

async function execListWorkspaceDocs(args, session, onEvent) {
  if (!session.spaceId) return { success: false, error: '当前没有选中工作空间' };
  try {
    const ctx = wm.getSpaceContext(session.spaceId);
    const docs = (ctx.documents || [])
      .filter((d) => d.systemType !== 'space_index')
      .map((d) => ({
        doc_id: d.id,
        name: d.name,
        docType: d.docType,
        role: d.role || '',
        updatedAt: d.updatedAt || '',
        snippet: (d.snippet || '').slice(0, 200)
      }));
    onEvent('tool_progress', { message: `空间内共 ${docs.length} 份文档` });
    return { success: true, space: ctx.space, count: docs.length, documents: docs };
  } catch (e) {
    return { success: false, error: `列表失败：${e.message}` };
  }
}

async function execSearchWorkspaceDocs(args, session, onEvent) {
  const keyword = String(args.keyword || '').trim();
  if (!keyword) return { success: false, error: '请提供 keyword' };
  if (!session.spaceId) return { success: false, error: '当前没有选中工作空间' };

  try {
    const ctx = wm.getSpaceContext(session.spaceId);
    const kw = keyword.toLowerCase();
    const limit = Math.max(1, Math.min(20, Number(args.limit) || 8));
    const hits = (ctx.documents || [])
      .filter((d) => d.systemType !== 'space_index')
      .map((d) => {
        const nameHit = String(d.name || '').toLowerCase().includes(kw);
        const snippet = String(d.snippet || '');
        const idx = snippet.toLowerCase().indexOf(kw);
        const snippetHit = idx >= 0;
        if (!nameHit && !snippetHit) return null;
        const excerpt = snippetHit
          ? snippet.slice(Math.max(0, idx - 60), Math.min(snippet.length, idx + 120))
          : snippet.slice(0, 160);
        return {
          doc_id: d.id,
          name: d.name,
          docType: d.docType,
          role: d.role || '',
          updatedAt: d.updatedAt || '',
          match: nameHit ? 'name' : 'content',
          excerpt
        };
      })
      .filter(Boolean)
      .slice(0, limit);

    onEvent('tool_progress', { message: `搜索"${keyword}"命中 ${hits.length} 份` });
    return { success: true, keyword, count: hits.length, results: hits };
  } catch (e) {
    return { success: false, error: `搜索失败：${e.message}` };
  }
}

async function execCreateWorkspaceFolder(args, session, onEvent) {
  if (!session.spaceId) return { success: false, error: '当前没有选中工作空间' };
  const name = String(args.name || '').trim();
  if (!name) return { success: false, error: '请指定文件夹名称 name' };

  const parentId = String(args.parent_id || '').trim() || session.spaceId;

  try {
    const folder = wm.ensureChildFolder(parentId, name);
    try { session.spaceContext = wm.getSpaceContext(session.spaceId); } catch {}
    onEvent('tool_progress', { message: `已创建文件夹：${name}` });
    onEvent('workspace_updated', { spaceId: session.spaceId, docId: folder.id, docName: name, docType: 'folder', action: 'create' });
    return { success: true, folder_id: folder.id, name: folder.name, parent_id: parentId };
  } catch (e) {
    return { success: false, error: `创建文件夹失败：${e.message}` };
  }
}

async function execRenameWorkspaceDoc(args, session, onEvent) {
  const docId = String(args.doc_id || '').trim();
  const newName = String(args.new_name || '').trim();
  if (!docId) return { success: false, error: '请指定 doc_id' };
  if (!newName) return { success: false, error: '请指定 new_name' };

  try {
    wm.renameNode(docId, newName);
    try { session.spaceContext = wm.getSpaceContext(session.spaceId); } catch {}
    onEvent('tool_progress', { message: `已重命名为：${newName}` });
    onEvent('workspace_updated', { spaceId: session.spaceId, docId, docName: newName, action: 'rename' });
    return { success: true, doc_id: docId, name: newName };
  } catch (e) {
    return { success: false, error: `重命名失败：${e.message}` };
  }
}

async function execSetWorkspaceDocRole(args, session, onEvent) {
  const docId = String(args.doc_id || '').trim();
  const role = String(args.role || '').trim().toLowerCase();
  if (!docId) return { success: false, error: '请指定 doc_id' };
  const allowed = ['requirements', 'reference', 'draft', ''];
  if (!allowed.includes(role)) {
    return { success: false, error: `role 必须是 ${allowed.filter(Boolean).join(' / ')} 或空字符串` };
  }

  try {
    const node = wm.setDocumentRole(docId, role);
    try { session.spaceContext = wm.getSpaceContext(session.spaceId); } catch {}
    onEvent('tool_progress', { message: `已设置文档角色：${role || '（清空）'}` });
    onEvent('workspace_updated', { spaceId: session.spaceId, docId, docName: node.name, action: 'role' });
    return { success: true, doc_id: docId, role };
  } catch (e) {
    return { success: false, error: `设置角色失败：${e.message}` };
  }
}

function findRecentDeleteApproval(session, docId) {
  const asked = Array.isArray(session.askedQuestions) ? session.askedQuestions : [];
  if (!asked.length) return null;
  // 只看最后一条已回答的确认问题
  for (let i = asked.length - 1; i >= 0; i -= 1) {
    const entry = asked[i];
    if (!entry || entry.answer == null) continue;
    if (entry.type && entry.type !== 'confirmation') return null;
    if (!isAffirmativeAnswer(entry.answer)) return null;
    const qText = `${entry.header || ''} ${entry.question || ''}`;
    if (!/删除|删掉|delete/i.test(qText)) return null;
    // 如果问题里出现了 docId 或 docId 的显示名，则匹配更严
    const mentionsDoc = qText.includes(docId);
    return { entry, mentionsDoc };
  }
  return null;
}

async function execDeleteWorkspaceDoc(args, session, onEvent) {
  const docId = String(args.doc_id || '').trim();
  if (!docId) return { success: false, error: '请指定 doc_id' };

  // 先取节点信息用于提示 & 关联确认
  let nodeInfo = null;
  try {
    nodeInfo = wm.getContent(docId);
  } catch {
    // 如果 getContent 失败（例如文件夹没有 docs/<id>.json），fallback 到 spaceContext
    try {
      const ctx = wm.getSpaceContext(session.spaceId);
      nodeInfo = (ctx.documents || []).find((d) => d.id === docId) || null;
    } catch {}
  }
  const displayName = nodeInfo?.name || docId;

  const confirmed = args.confirmed === true || args.confirmed === 'true';

  // 阶段 1：未携带 confirmed=true → 登记待确认，拒绝执行
  if (!confirmed) {
    const now = Date.now();
    session.pendingDeletion = { docId, docName: displayName, requestedAt: now };
    onEvent('tool_progress', { message: `删除请求待用户确认：${displayName}` });
    return {
      success: false,
      requires_confirmation: true,
      doc_id: docId,
      doc_name: displayName,
      error: `删除操作必须先经用户确认。请立刻调用 ask_user（type="confirmation"，header="确认删除"，options 至少包含"确认删除"和"取消"），明确说明将删除文档"${displayName}"，等用户明确回复"确认删除/确定/同意"后，再次调用本工具并带上 confirmed=true。严禁未确认就直接带 confirmed=true。`
    };
  }

  // 阶段 2：confirmed=true → 检查用户是否真的同意
  const approval = findRecentDeleteApproval(session, docId);
  const pending = session.pendingDeletion;
  const pendingMatches = pending && pending.docId === docId && (Date.now() - pending.requestedAt) < DELETE_APPROVAL_TTL_MS;

  if (!approval) {
    return {
      success: false,
      error: `没有找到用户对"${displayName}"删除操作的确认回复。请先调用 ask_user（type="confirmation"）向用户确认，等用户明确同意后再调用本工具。`
    };
  }

  if (!pendingMatches) {
    return {
      success: false,
      error: '删除请求已过期或与当前文档不一致，请重新发起无 confirmed 参数的调用，重新走一遍"请求确认 → ask_user → 带 confirmed 调用"流程。'
    };
  }

  try {
    const removedIds = wm.deleteNode(docId);
    session.pendingDeletion = null;
    try { session.spaceContext = wm.getSpaceContext(session.spaceId); } catch {}

    // 如果删的是正在预览/最近保存的文档，清掉 session 引用，避免后续误更新已删除文档
    if (session.lastSavedDocId && removedIds.includes(session.lastSavedDocId)) {
      session.lastSavedDocId = null;
      session.lastSavedDocName = null;
      session.docJson = null;
    }

    onEvent('tool_progress', { message: `已删除：${displayName}` });
    onEvent('workspace_updated', { spaceId: session.spaceId, docId, docName: displayName, action: 'delete' });

    return { success: true, doc_id: docId, name: displayName, removed_count: removedIds.length };
  } catch (e) {
    return { success: false, error: `删除失败：${e.message}` };
  }
}

module.exports = {
  execReadWorkspaceDoc,
  execUpdateWorkspaceDoc,
  execPatchWorkspaceDocSection,
  execFindReplaceInDoc,
  execSaveToWorkspace,
  execAppendWorkspaceDoc,
  execListWorkspaceDocs,
  execSearchWorkspaceDocs,
  execCreateWorkspaceFolder,
  execRenameWorkspaceDoc,
  execSetWorkspaceDocRole,
  execDeleteWorkspaceDoc
};
