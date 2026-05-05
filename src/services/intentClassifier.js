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
    // Post-process safety net：classifier 偶尔会把"询问具体事实"判成 chat 低置信。
    // 比如"YU7 反馈怎么样"被读成"用户表示任务完成"返回 chat 0.65。
    // 兜底：低置信 chat + 用户消息明显是事实查询 → 强制改判 research。
    let corrected = applyResearchSafetyNet(result, text);
    // 续问 safety net：上一轮已经在 research 中、本轮是短消息（"小米汽车呢"
    // / "在搜了么" / "好了么"）时，classifier 容易抽风判成 chat low-conf 触发
    // clarify，或者凭空幻觉"用户粘贴了上一轮 AI 回复"。这里强制沿用 research，
    // 保证 brain 进入 research_pipeline 而不是 direct_reply（tool_choice=none）。
    corrected = applyResearchFollowUpSafetyNet(corrected, text, priorIntentType);
    // 显式 AI 生图意图 safety net：classifier 偶尔会把"帮我AI生成一张展台图"
    // 判成 chat 中等置信（reason 还会幻觉成"用户说继续"之类）。命中显式 AI 生图
    // pattern 时强制 image_generate，让 brain 真去调 generate_image。
    corrected = applyImageGenerateSafetyNet(corrected, text);
    putCached(session, key, corrected);
    return corrected;
  } catch (error) {
    // 3) LLM 失败兜底：明确关键词 → 返回轻量判断；否则向上抛让外层转澄清
    const fb = fallbackHeuristic(text);
    if (fb) return fb;
    throw error;
  }
}

// classifier 把事实查询误判 chat 的 safety net
// 触发条件：classifier 返 chat + 置信 < 0.8 + 用户消息含明确事实查询信号
const RESEARCH_QUESTION_PATTERN = /(怎么样|如何|怎么|多少|何时|什么时候|有哪些|有没有|最近|最新|动态|消息|反馈|评价|口碑|销量|数据|趋势|案例|对比|对标)/u;
// 命中两类即视为有"具体目标"：
//   1) 中英字母+数字组合（车型/手机型号常见，如 M9 / SU7 / X1 / RTX4090）
//   2) 包含已知品牌名 / 行业类目名（避免常识题"一斤多少克""今天周几"被误升级）
const TYPICAL_RESEARCH_TARGET = /[a-zA-Z]+\d|(品牌|车型|产品|手机|电脑|笔记本|汽车|公司|发布会|车展|新车|新机|新品|股价|排名|榜单|趋势|行业|竞品|案例|事件)|(小米|华为|苹果|特斯拉|蔚来|理想|问界|比亚迪|奇瑞|奔驰|宝马|奥迪|大众|丰田|本田|通用|福特|腾讯|阿里|字节|百度|京东|美团|拼多多|网易|小红书|抖音|快手|微信|支付宝)/u;

// 用户在等研究结果时的状态询问（"在搜了么"/"好了吗"/"搜到了吗"等）。
// 这类短消息 LLM 容易判成 chat（"问 AI 状态" 表面上确实像闲聊），但意图明显是
// 沿用上一轮 research，让 brain 继续推进而不是切到 direct_reply 闲聊。
const RESEARCH_CHECKIN_PATTERN = /^[\s，,。.!！?？]*(在(搜|查|找|看)|搜(到|了)|查(到|了)|找(到|了)|搞(到|定)|完(了|成)|好(了)?|结果(出来)?|有(结果|消息)?)[了么吗呢嘛啊吧?？\s。.！!]*$/u;

// research 上下文里的"再来一批/还有别的/更多"类续问。
// 这类输入 classifier 容易因 userMessage 太短而幻觉成"用户提供了 XX 内容"，把
// 续问吞成 chat。但真实意图明显是要 brain 在同主题上多搜一轮 / 给更多角度。
const RESEARCH_MORE_PATTERN = /^[\s，,。.!！?？]*(还有|更多|其他|别的|再(来|给|查|搜|找|多)|多(给|来|查|搜|找)|多(几|一些)|换(一|几)?(个|批)|新的|别款)/u;

// 显式 AI 生图意图：动作词 + 量词 + 图。
// 必须三件齐全才升级，避免误抓"AI 生成的图标怎么样"/"生成图文方案"这类非生图语义：
//   - 动作词：AI 生/AI 画/AI 出 / 重新生成 / 画一张/一幅/一个 / 帮(我)?生成|画
//   - 量词：一张 / 一幅 / 一个 / 张 / 幅
//   - 名词：图 / 图片 / 图像
const EXPLICIT_IMAGE_GEN_PATTERN = /(AI\s*(生成|画|生|出)|重新生成|帮(我)?(生成|画|做)|画一张|画一幅|画一个|换一张图|改一张图)[\s\S]{0,30}(一张|一幅|一个|张|幅)[\s\S]{0,15}(图|图片|图像)/u;

function applyResearchSafetyNet(result, text) {
  if (!result || result.type !== 'chat') return result;
  if (result.confidence >= 0.8) return result; // 高置信 chat 信任 classifier
  const t = String(text || '').trim();
  if (!t) return result;
  // 短回复（"嗯"/"好"等）和寒暄不动
  if (t.length < 6) return result;
  // 必须同时有"查询动作词"和"具体目标"，避免误升级
  if (!RESEARCH_QUESTION_PATTERN.test(t)) return result;
  if (!TYPICAL_RESEARCH_TARGET.test(t)) return result;
  return {
    type: 'research',
    confidence: 0.7,
    reason: `(safety-net) classifier 原判 chat ${result.confidence.toFixed(2)}，但消息含查询动作词+具体目标，改判 research`,
    needsClarification: false
  };
}

function applyImageGenerateSafetyNet(result, text) {
  if (!result) return result;
  if (result.type === 'image_generate') return result;
  // 高置信明确意图（image_search / ppt 等）就别强行抢——只在 chat / research /
  // strategy 这种容易把生图请求吃掉的类型上覆盖。
  if (!['chat', 'research', 'strategy', 'doc_edit'].includes(result.type)) return result;
  const t = String(text || '').trim();
  if (!t) return result;
  if (!EXPLICIT_IMAGE_GEN_PATTERN.test(t)) return result;
  return {
    type: 'image_generate',
    confidence: 0.85,
    reason: `(safety-net) classifier 原判 ${result.type} ${(Number(result.confidence) || 0).toFixed(2)}，但消息含显式 AI 生图动词+量词+图，改判 image_generate`,
    needsClarification: false
  };
}

// research 续问 safety net：上一轮已经判 research，本轮短消息要么是状态询问，
// 要么是带品牌/产品的子话题续问，都应该沿用 research，不要回退到 chat。
//
// 触发场景（实际 bug 来源）：
//   R1: "小米最近有什么活动么"     → research ✓
//   R2: "小米汽车呢"               → classifier 误判 chat 0.2 + needsClarification ✗
//   R3: "在搜了么"                 → classifier 误判 chat 0.7 ✗
// 两轮被路由到 direct_reply（tool_choice=none），brain 只能 narrate"我去搜了"
// 但调不了 web_search。
function applyResearchFollowUpSafetyNet(result, text, priorIntentType) {
  if (!result) return result;
  if (priorIntentType !== 'research') return result;
  if (result.type === 'research') return result; // 已经是 research，不动
  const t = String(text || '').trim();
  if (!t) return result;

  // 1) 状态询问（"在搜了么" / "好了吗" / "搜到了"）→ 沿用 research
  if (RESEARCH_CHECKIN_PATTERN.test(t)) {
    return {
      type: 'research',
      confidence: 0.85,
      reason: `(safety-net) 上轮 research 进行中，本轮是状态询问"${t.slice(0, 12)}"，沿用 research 继续推进`,
      needsClarification: false
    };
  }

  // 2) 短续问 + 品牌/产品 token（"小米汽车呢" / "YU7 呢" / "理想新车" 等）→ 沿用 research
  // 限制 ≤14 字 + 不带强动作动词，避免吞掉"小米最近做了一份策划方案"这种新任务
  if (t.length <= 14 && TYPICAL_RESEARCH_TARGET.test(t) && !/(生成|做|出|改|写|画)/u.test(t)) {
    return {
      type: 'research',
      confidence: 0.8,
      reason: `(safety-net) 上轮 research，本轮短续问含品牌/产品目标"${t.slice(0, 12)}"，沿用 research`,
      needsClarification: false
    };
  }

  // 3) "更多/还有/再来/其他/别的"类续问（"还有别的么" / "再来几个" / "更多案例"）
  // 限制 ≤12 字 + 不带强动作动词，避免吞"再写一份方案"这类换任务请求
  if (t.length <= 12 && RESEARCH_MORE_PATTERN.test(t) && !/(生成|做|出|改|写|画|做成)/u.test(t)) {
    return {
      type: 'research',
      confidence: 0.8,
      reason: `(safety-net) 上轮 research，本轮短续问"${t.slice(0, 12)}"是要更多结果，沿用 research`,
      needsClarification: false
    };
  }

  return result;
}

module.exports = {
  classifyTaskIntentWithLLM,
  isContinuationUtterance,
  inferDocRole,
  __test: { fallbackHeuristic, extractLastAssistantMessage }
};
