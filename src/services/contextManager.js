const TOOL_TRUNCATION_CONFIG = {
  web_search:    { maxChars: 3000, compactable: true },
  web_fetch:     { maxChars: 4000, compactable: true },
  search_images: { maxChars: 2000, compactable: true },
  run_strategy:  { maxChars: Infinity, compactable: false },
  build_ppt:     { maxChars: Infinity, compactable: false },
  update_brief:  { maxChars: Infinity, compactable: false },
  read_workspace_doc:    { maxChars: 3000, compactable: true },
  save_to_workspace:     { maxChars: 2000, compactable: true },
  update_workspace_doc:  { maxChars: 2000, compactable: true },
  generate_image:         { maxChars: 1500, compactable: true },
  review_uploaded_images: { maxChars: 2000, compactable: true },
  write_todos: { maxChars: 800, compactable: true },
};

const DEFAULT_TRUNCATION = { maxChars: 1000, compactable: true };

// 中文 token 估算系数：minimax abab 实测 ≈ 0.5-0.6 char/token，0.4 偏乐观会让
// CONTEXT_TOKEN_WARN 滞后触发，长对话直接撞模型上下文上限；改 0.55 更保守。
const TOKEN_PER_CHAR = 0.55;

// 触发主动压缩的阈值。minimax abab 上下文 ~100k，留一半给历史够用又能提前压缩。
// 走 env 覆盖，方便不同模型（更小 / 更大 context）做调优。
const CONTEXT_TOKEN_WARN = (() => {
  const fromEnv = Number.parseInt(process.env.LUNA_CONTEXT_TOKEN_WARN, 10);
  if (Number.isFinite(fromEnv) && fromEnv > 1000) return fromEnv;
  return 25000;
})();

function estimateTokens(text) {
  return Math.ceil((text || '').length * TOKEN_PER_CHAR);
}

function truncateToolResult(toolName, content) {
  if (typeof content !== 'string') return content;
  const config = TOOL_TRUNCATION_CONFIG[toolName] || DEFAULT_TRUNCATION;
  if (content.length <= config.maxChars) return content;
  const preview = content.slice(0, config.maxChars);
  return `${preview}\n...[${toolName} 结果已截断，保留前 ${config.maxChars} 字符]`;
}

function isCompactableTool(toolName) {
  const config = TOOL_TRUNCATION_CONFIG[toolName] || DEFAULT_TRUNCATION;
  return config.compactable;
}

// 把单条工具结果浓缩成 1-2 行摘要供历史折叠用。
// 不同工具的关键信号位置不一样，按工具特化抽取，未列出的工具走通用 fallback。
function summarizeToolResult(toolName, content) {
  let parsed = content;
  if (typeof content === 'string') {
    try { parsed = JSON.parse(content); } catch { parsed = null; }
  }
  if (!parsed || typeof parsed !== 'object') {
    const text = typeof content === 'string' ? content : '';
    return text.slice(0, 200);
  }

  if (parsed.error) return `失败：${String(parsed.error).slice(0, 120)}`;
  if (parsed.backgrounded) return `转后台：${parsed.tool || toolName}`;

  switch (toolName) {
    case 'web_search': {
      const count = parsed.count || (Array.isArray(parsed.results) ? parsed.results.length : 0);
      const titles = Array.isArray(parsed.results)
        ? parsed.results.slice(0, 3).map(r => r.title || r.url || '').filter(Boolean)
        : [];
      return `web_search: ${count} 条${titles.length ? `；前几条：${titles.join(' / ').slice(0, 200)}` : ''}`;
    }
    case 'web_fetch':
      return `web_fetch: ${parsed.success ? `已读取${parsed.title ? `《${parsed.title.slice(0, 60)}》` : ''}` : '失败'}`;
    case 'browser_search': {
      const cards = Array.isArray(parsed.cards) ? parsed.cards.length : (parsed.count || 0);
      return `browser_search(${parsed.platform || 'xhs'}): ${cards} 条结果`;
    }
    case 'browser_read_notes': {
      const notes = Array.isArray(parsed.notes) ? parsed.notes : [];
      const titles = notes.slice(0, 3).map(n => n.title || '').filter(Boolean);
      return `browser_read_notes: ${notes.length} 篇${titles.length ? `；标题：${titles.join(' / ').slice(0, 200)}` : ''}`;
    }
    case 'analyze_note_images': {
      const ans = parsed.answer || parsed.analysis || '';
      return `analyze_note_images: ${String(ans).slice(0, 240)}${ans.length > 240 ? '...' : ''}`;
    }
    case 'search_images':
      return `search_images: ${parsed.count || 0} 张${parsed.intent ? `（意图：${parsed.intent.slice(0, 60)}）` : ''}`;
    case 'generate_image':
      return `generate_image: ${parsed.success ? `已生成${parsed.intent ? `（${parsed.intent.slice(0, 60)}）` : ''}` : '失败'}`;
    case 'update_brief':
      return `update_brief: brand=${parsed?.brief?.brand || '?'} / type=${parsed?.brief?.eventType || '?'} / topic=${(parsed?.brief?.topic || '').slice(0, 50)}`;
    case 'challenge_brief':
      return `challenge_brief: ${parsed.hasConcerns ? `${(parsed.concerns || []).length} 条红旗` : '无红旗'}`;
    case 'propose_concept': {
      const dirs = Array.isArray(parsed.directions) ? parsed.directions : [];
      const codes = dirs.map(d => `${d.label}.${d.codeName || d.theme || ''}`).filter(Boolean);
      return `propose_concept: ${codes.join(' / ').slice(0, 240)}`;
    }
    case 'approve_concept':
      return `approve_concept: 选中 ${parsed.direction_label || '?'}`;
    case 'run_strategy':
      return `run_strategy: ${parsed.success ? `方案已生成（${parsed.sectionCount || 0} 章节）${parsed.degraded ? '【降级】' : ''}` : '失败'}`;
    case 'review_strategy':
      return `review_strategy: 评分 ${parsed.score ?? '?'}${parsed.passed ? '（通过）' : '（待优化）'}`;
    case 'build_ppt':
      return `build_ppt: ${parsed.success ? `${parsed.pageCount || 0} 页` : '失败'}`;
    case 'read_workspace_doc':
      return `read_workspace_doc: ${parsed.name || parsed.doc_id || ''}`;
    case 'save_to_workspace':
      return `save_to_workspace: ${parsed.name || parsed.id || ''}`;
    case 'update_workspace_doc':
    case 'patch_workspace_doc_section':
    case 'append_workspace_doc':
      return `${toolName}: ${parsed.success ? '已更新' : '失败'}${parsed.name ? `（${parsed.name}）` : ''}`;
    case 'write_todos':
      return `write_todos: ${parsed.count || 0} 项`;
    case 'review_uploaded_images':
      return `review_uploaded_images: ${parsed.count || 0} 张`;
    case 'ask_user':
      return ''; // ask_user 的"答案"就是用户消息本身，不必单独列
    default: {
      const json = JSON.stringify(parsed);
      return `${toolName}: ${json.slice(0, 200)}${json.length > 200 ? '...' : ''}`;
    }
  }
}

// 把对话历史里 assistant 的 tool_calls 与紧跟着的 tool 结果配对成 [{ name, resultSummary }]
function pairToolCallsWithResults(messages) {
  const pairs = []; // 顺序保留
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || !Array.isArray(msg.tool_calls)) continue;
    for (const tc of msg.tool_calls) {
      const fnName = tc.function?.name || tc.name || 'unknown';
      // 在后续消息里找 tool_call_id 匹配的 tool result
      let resultSummary = '';
      for (let j = i + 1; j < messages.length; j++) {
        const cand = messages[j];
        if (cand.role === 'tool' && cand.tool_call_id === tc.id) {
          resultSummary = summarizeToolResult(fnName, cand.content);
          break;
        }
      }
      pairs.push({ name: fnName, resultSummary });
    }
  }
  return pairs;
}

function compressOldMessages(olderMessages) {
  if (!olderMessages.length) return [];

  const summaryParts = [];

  for (const msg of olderMessages) {
    // 跳过系统注入消息（后台任务回执 / 软失败兜底）—— 它们伪装成 user role，
    // 但语义是系统状态，折叠时当成"用户原话"会污染历史让 brain 误回应
    if (msg._backgroundInject || msg._softFailInject) continue;

    if (msg.role === 'user') {
      const text = typeof msg.content === 'string' ? msg.content : '';
      // 历史 user 消息开头的 [系统注入｜...] 也跳过（防止 restore 后的旧消息已丢失 _flag）
      if (text.startsWith('[系统注入｜')) continue;
      if (text.length > 0) {
        summaryParts.push(`用户：${text.slice(0, 80)}${text.length > 80 ? '...' : ''}`);
      }
    } else if (msg.role === 'assistant') {
      const text = typeof msg.content === 'string' ? msg.content : '';
      if (text && text.trim()) {
        summaryParts.push(`助手：${text.slice(0, 80)}${text.length > 80 ? '...' : ''}`);
      }
    }
  }

  // 按工具调用 → 结果配对生成"工具执行轨迹"，保留每条结果的关键事实摘要
  const toolPairs = pairToolCallsWithResults(olderMessages);

  if (!summaryParts.length && !toolPairs.length) return [];

  const lines = ['[历史对话摘要]'];
  if (summaryParts.length) {
    lines.push(...summaryParts);
  }
  if (toolPairs.length) {
    lines.push('', '已执行工具与结果摘要：');
    for (const pair of toolPairs) {
      if (pair.resultSummary) {
        lines.push(`  - ${pair.name} → ${pair.resultSummary}`);
      } else {
        lines.push(`  - ${pair.name}`);
      }
    }
  }

  return [{
    role: 'system',
    content: lines.join('\n')
  }];
}

function extractKeyState(session) {
  const parts = [];

  if (session.brief) {
    const b = session.brief;
    const briefLines = ['[当前任务简报]'];
    if (b.brand) briefLines.push(`品牌：${b.brand}`);
    if (b.eventType) briefLines.push(`活动类型：${b.eventType}`);
    if (b.topic) briefLines.push(`主题：${b.topic}`);
    if (b.goal) briefLines.push(`目标：${b.goal}`);
    if (b.audience) briefLines.push(`受众：${b.audience}`);
    if (b.style) briefLines.push(`风格：${b.style}`);
    if (Array.isArray(b.assumptions) && b.assumptions.length) {
      briefLines.push(`假设：${b.assumptions.join('；')}`);
    }
    parts.push(briefLines.join('\n'));
  }

  if (session.bestPlan) {
    const p = session.bestPlan;
    const planLines = ['[当前策划方案摘要]'];
    if (p.planTitle) planLines.push(`标题：${p.planTitle}`);
    if (p.coreStrategy) planLines.push(`核心策略：${p.coreStrategy.slice(0, 120)}`);
    if (Array.isArray(p.highlights) && p.highlights.length) {
      planLines.push(`亮点：${p.highlights.slice(0, 3).join('；')}`);
    }
    parts.push(planLines.join('\n'));
  }

  return parts.length ? parts.join('\n\n') : null;
}

module.exports = {
  TOOL_TRUNCATION_CONFIG,
  DEFAULT_TRUNCATION,
  CONTEXT_TOKEN_WARN,
  estimateTokens,
  truncateToolResult,
  isCompactableTool,
  compressOldMessages,
  extractKeyState,
};
