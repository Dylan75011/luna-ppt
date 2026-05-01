const { callLLMJson } = require('../utils/llmUtils');
const { buildIntentClassifierPrompt } = require('../prompts/intentClassifier');
const { normalizeIntentClassificationResult } = require('../utils/structuredOutput');

const DOC_SNIPPET_CHARS = 240;
const INTENT_CACHE_MAX = 32;

// 续接语：用户明显在让 Agent 沿用上一轮意图继续推进
const CONTINUATION_PATTERNS = [
  /^(继续|接着(做|搞|来|写|干)?|往下(走|做|推进)?|就这样(推进|做|吧)?|下一步|推进(一下)?|gogogo|go\s*on|continue)\s*[。.!！~～]*$/i,
  /^(ok|好的?|行|可以|嗯|没问题)[，,。.!！\s]*(继续|接着|推进|下一步|往下)/i
];

// LLM 失败时的兜底关键词启发。只在出现明确动作动词时才返回具体 type，否则交给澄清分支。
const FALLBACK_KEYWORDS = [
  { type: 'image_generate', re: /(生成|AI\s*生|重新生成|画(一张|个))\s*图/i },
  { type: 'image_search',   re: /(找|搜|要)(一些|几张|张)?(图|配图|背景图|效果图|素材图)/i },
  { type: 'ppt',            re: /(生成|做|出|改|优化|重排)\s*(一版|一份)?\s*(ppt|PPT|幻灯片|演示文稿)/ },
  { type: 'doc_edit',       re: /(润色|改写|续写|补(一|几)段|修改(这|该)(份|个)?(文档|稿子|提案))/ },
  { type: 'research',       re: /(查|搜|找)(一下)?(资料|案例|数据|趋势|行业|竞品)/ },
  { type: 'strategy',       re: /(做|出|写|给我)(一版|一份)?(策划(案)?|方案|创意方向|activation)/i }
];

function inferDocRole(doc) {
  if (doc && typeof doc.role === 'string' && doc.role.trim()) return doc.role.trim();
  const name = String(doc?.name || '').toLowerCase();
  if (/(需求|brief|requirement|rfp)/i.test(name)) return 'requirements';
  if (/(参考|reference|样例|example|benchmark)/i.test(name)) return 'reference';
  if (/(草稿|draft|待改|稿子|v\d+)/i.test(name)) return 'draft';
  return '';
}

function summarizeDocs(docs = []) {
  if (!Array.isArray(docs)) return [];
  return docs
    .filter((doc) => doc && (doc.name || doc.text || doc.docType))
    .slice(0, 6)
    .map((doc) => {
      const rawText = typeof doc.text === 'string' ? doc.text : '';
      return {
        name: String(doc.name || '').slice(0, 80),
        docType: doc.docType || (String(doc.name || '').toLowerCase().endsWith('.pptx') ? 'ppt' : 'document'),
        role: inferDocRole(doc),
        snippet: rawText.replace(/\s+/g, ' ').trim().slice(0, DOC_SNIPPET_CHARS)
      };
    });
}

function summarizeAttachments(attachments = []) {
  if (!Array.isArray(attachments)) return [];
  return attachments.slice(0, 6).map((item) => ({
    name: String(item?.name || '').slice(0, 80),
    mimeType: item?.mimeType || ''
  }));
}

function extractLastAssistantMessage(session) {
  const msgs = session?.messages;
  if (!Array.isArray(msgs)) return '';
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i];
    if (m && m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) {
      return m.content.replace(/\s+/g, ' ').trim().slice(0, 300);
    }
  }
  return '';
}

function isContinuationUtterance(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 24) return false;
  return CONTINUATION_PATTERNS.some((re) => re.test(t));
}

function cacheKey(text, priorIntentType) {
  return `${priorIntentType || ''}::${String(text || '').trim().slice(0, 200)}`;
}

function getCached(session, key) {
  const cache = session?._intentCache;
  if (!cache || typeof cache.get !== 'function') return null;
  return cache.get(key) || null;
}

function putCached(session, key, value) {
  if (!session) return;
  if (!session._intentCache || typeof session._intentCache.get !== 'function') {
    session._intentCache = new Map();
  }
  const cache = session._intentCache;
  cache.set(key, value);
  if (cache.size > INTENT_CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
}

function fallbackHeuristic(text) {
  const t = String(text || '');
  if (!t.trim()) return null;
  for (const rule of FALLBACK_KEYWORDS) {
    if (rule.re.test(t)) {
      return {
        type: rule.type,
        confidence: 0.6,
        reason: 'llm_failed_keyword_fallback',
        needsClarification: false
      };
    }
  }
  return null;
}

async function classifyTaskIntentWithLLM(text = '', { session = null, documents = [], workspaceDocs = [], attachments = [] } = {}) {
  // 兜底到 process.env.MINIMAX_API_KEY——和其它 LLM client（createMinimaxClient）一致。
  // 之前只看 session.apiKeys.minimaxApiKey，前端 localStorage 没填时（依赖服务端 env）
  // 这里会抛错，detectTaskIntent 兜成 chat，导致所有任务都被错分类成闲聊，
  // prompt 失去工具 nudge，模型把 function_call 输出成纯文本伪语法。
  const runtimeKey = session?.apiKeys?.minimaxApiKey || process.env.MINIMAX_API_KEY || '';
  const priorIntentType = session?.taskIntent?.type || '';
  const priorIntentLabel = session?.taskIntent?.label || '';

  // 1) 续接语短路：prior 是非 chat 任务 → 直接沿用，不再调 LLM
  if (priorIntentType && priorIntentType !== 'chat' && isContinuationUtterance(text)) {
    return {
      type: priorIntentType,
      confidence: 0.9,
      reason: 'continuation_of_prior_intent',
      needsClarification: false
    };
  }

  // 2) 会话缓存：同 session 同输入同 prior → 命中
  const key = cacheKey(text, priorIntentType);
  const cached = getCached(session, key);
  if (cached) return cached;

  if (!runtimeKey) {
    throw new Error('MINIMAX_API_KEY 未配置，无法执行 LLM 意图识别');
  }

  const { systemPrompt, userPrompt } = buildIntentClassifierPrompt({
    text,
    documents: summarizeDocs(documents),
    workspaceDocs: summarizeDocs(workspaceDocs),
    attachments: summarizeAttachments(attachments),
    hasBestPlan: !!session?.bestPlan,
    hasDraftDoc: !!session?.docHtml,
    lastSavedDocName: session?.lastSavedDocName || '',
    priorIntentType,
    priorIntentLabel,
    lastAssistantMessage: extractLastAssistantMessage(session)
  });

  try {
    const result = await callLLMJson(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      {
        model: 'minimax',
        runtimeKey,
        minimaxModel: session?.apiKeys?.minimaxModel,
        maxTokens: 1024,
        timeoutMs: 20000,
        temperature: 0,
        name: 'intent-classifier',
        validate: normalizeIntentClassificationResult,
        repairHint: '必须返回对象，包含 type、confidence、reason、needsClarification 四个字段。'
      }
    );
    putCached(session, key, result);
    return result;
  } catch (error) {
    // 3) LLM 失败兜底：明确关键词 → 返回轻量判断；否则向上抛让外层转澄清
    const fb = fallbackHeuristic(text);
    if (fb) return fb;
    throw error;
  }
}

module.exports = {
  classifyTaskIntentWithLLM,
  isContinuationUtterance,
  inferDocRole,
  __test: { fallbackHeuristic, extractLastAssistantMessage }
};
