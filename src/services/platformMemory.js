const fs = require('fs');
const path = require('path');
const { callMinimax } = require('./llmClients');

const DATA_DIR = path.resolve('./data');
const MEMORY_FILE = path.join(DATA_DIR, 'platform-memory.json');

const MAX_ITEMS = {
  principles: 8,
  patterns: 8,
  pitfalls: 8,
  recentLearnings: 6
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function defaultMemoryRecord() {
  return {
    summary: '平台正在沉淀活动策划任务中的有效方法论，优先保留真正能提升方案判断质量的经验。',
    principles: [],
    patterns: [],
    pitfalls: [],
    recentLearnings: [],
    updatedAt: nowIso()
  };
}

function normalizeItem(item, fallbackDate = nowIso()) {
  if (!item) return null;
  if (typeof item === 'string') {
    const text = item.trim();
    if (!text) return null;
    return { text, lastUsedAt: fallbackDate, useCount: 1 };
  }
  const text = String(item.text || item.summary || item.title || '').trim();
  if (!text) return null;
  return {
    text,
    lastUsedAt: item.lastUsedAt || item.updatedAt || fallbackDate,
    useCount: Number(item.useCount || 1),
    taskId: item.taskId || '',
    score: item.score || ''
  };
}

function normalizeItems(items, fallbackDate = nowIso()) {
  if (!Array.isArray(items)) return [];
  return items.map(item => normalizeItem(item, fallbackDate)).filter(Boolean);
}

function parseStoredMemory(raw = {}) {
  const base = defaultMemoryRecord();
  return {
    ...base,
    ...raw,
    principles: normalizeItems(raw.principles, raw.updatedAt || base.updatedAt),
    patterns: normalizeItems(raw.patterns, raw.updatedAt || base.updatedAt),
    pitfalls: normalizeItems(raw.pitfalls, raw.updatedAt || base.updatedAt),
    recentLearnings: normalizeItems(raw.recentLearnings, raw.updatedAt || base.updatedAt)
  };
}

function readMemoryRecord() {
  ensureDir();
  if (!fs.existsSync(MEMORY_FILE)) {
    const initial = defaultMemoryRecord();
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(initial, null, 2));
    return parseStoredMemory(initial);
  }
  try {
    return parseStoredMemory(JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')));
  } catch {
    return parseStoredMemory(defaultMemoryRecord());
  }
}

function itemScore(item, now = Date.now()) {
  const lastUsed = new Date(item.lastUsedAt || 0).getTime() || now;
  const ageDays = Math.max(0, (now - lastUsed) / 86400000);
  const freshness = Math.max(0, 6 - ageDays / 20);
  const usage = Math.min(Number(item.useCount || 1), 8);
  return freshness + usage;
}

function dedupeItems(items = []) {
  const map = new Map();
  for (const item of items) {
    const key = String(item.text || '').trim();
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
      continue;
    }
    const existingScore = itemScore(existing);
    const nextScore = itemScore(item);
    map.set(key, nextScore > existingScore ? item : existing);
  }
  return [...map.values()];
}

function pruneItems(items = [], max = 8) {
  const now = Date.now();
  return dedupeItems(items)
    .sort((a, b) => itemScore(b, now) - itemScore(a, now))
    .slice(0, max);
}

function saveMemoryRecord(record) {
  ensureDir();
  const next = {
    ...defaultMemoryRecord(),
    ...record,
    principles: pruneItems(normalizeItems(record.principles, record.updatedAt || nowIso()), MAX_ITEMS.principles),
    patterns: pruneItems(normalizeItems(record.patterns, record.updatedAt || nowIso()), MAX_ITEMS.patterns),
    pitfalls: pruneItems(normalizeItems(record.pitfalls, record.updatedAt || nowIso()), MAX_ITEMS.pitfalls),
    recentLearnings: pruneItems(normalizeItems(record.recentLearnings, record.updatedAt || nowIso()), MAX_ITEMS.recentLearnings),
    updatedAt: nowIso()
  };
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(next, null, 2));
  return next;
}

function getMemoryForPrompt() {
  const record = readMemoryRecord();
  return {
    summary: record.summary || '',
    principles: record.principles.map(item => item.text),
    patterns: record.patterns.map(item => item.text),
    pitfalls: record.pitfalls.map(item => item.text),
    recentLearnings: record.recentLearnings.map(item => item.text),
    updatedAt: record.updatedAt
  };
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

async function rewriteMemoryWithAI({ currentMemory, latestTask, apiKeys = {} }) {
  if (!apiKeys?.minimaxApiKey) return null;

  const systemPrompt = `你是活动策划平台的“方法论记忆整理器”。
- 你的任务是重写平台 memory，而不是堆叠笔记
- 只保留跨任务稳定有效、能提升活动策划专业度的经验
- 对过时、重复、弱相关、只适用于单一项目的内容要主动舍弃
- 让 memory 始终短、小、准，方便后续任务快速读取
- 不确定的内容宁可不写，也不要把空字段或半成品写出来
- recentLearnings 只保留最近最有价值的 4-6 条
- 输出必须是 JSON，不要解释`;

  const userPrompt = `当前平台 memory：
${JSON.stringify(currentMemory, null, 2)}

最新任务信息：
${JSON.stringify(latestTask, null, 2)}

请基于这次任务，重写一版更好的平台 memory，输出：
{
  "summary": "平台当前最值得保留的方法论概括，80字以内",
  "principles": ["跨任务稳定有效的策划原则"],
  "patterns": ["值得复用的结构/表达/策划模式"],
  "pitfalls": ["需要避免的常见失误或误判"],
  "recentLearnings": ["最近几次任务沉淀出的高价值经验"]
}`;

  const raw = await callMinimax([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], {
    runtimeKey: apiKeys.minimaxApiKey,
    minimaxModel: apiKeys.minimaxModel,
    temperature: 0.2,
    maxTokens: 700
  });

  return safeParseJson(raw);
}

function mergeRewrittenMemory(current, rewritten, latestTask) {
  const now = nowIso();
  const currentRecord = parseStoredMemory(current);
  const nextSummary = String(rewritten?.summary || '').trim() || currentRecord.summary;

  function mergeBucket(bucketName) {
    const currentItems = currentRecord[bucketName] || [];
    const rewrittenTexts = Array.isArray(rewritten?.[bucketName]) ? rewritten[bucketName] : null;
    if (!rewrittenTexts || !rewrittenTexts.length) {
      return currentItems;
    }
    return rewrittenTexts
      .map((text) => {
        const normalizedText = typeof text === 'string' ? text.trim() : String(text?.text || '').trim();
        if (!normalizedText) return null;
        const matched = currentItems.find(item => item.text === normalizedText);
        return {
          text: normalizedText,
          lastUsedAt: now,
          useCount: matched ? Math.max(1, matched.useCount || 1) + 1 : 1,
          taskId: bucketName === 'recentLearnings' ? latestTask.taskId : (matched?.taskId || ''),
          score: bucketName === 'recentLearnings' ? latestTask.score || '' : (matched?.score || '')
        };
      })
      .filter(Boolean);
  }

  return {
    summary: nextSummary,
    principles: mergeBucket('principles'),
    patterns: mergeBucket('patterns'),
    pitfalls: mergeBucket('pitfalls'),
    recentLearnings: mergeBucket('recentLearnings')
  };
}

async function updateMemoryFromTask({
  taskId,
  userInput = {},
  planTitle = '',
  summary = '',
  highlights = [],
  score = '',
  status = 'completed',
  apiKeys = {}
}) {
  const currentRecord = readMemoryRecord();
  const currentForPrompt = getMemoryForPrompt();
  const latestTask = {
    taskId,
    title: planTitle || userInput.topic || '未命名任务',
    brand: userInput.brand || '',
    productCategory: userInput.productCategory || '',
    eventType: userInput.eventType || '',
    scale: userInput.scale || '',
    budget: userInput.budget || '',
    summary: summary || '',
    highlights: Array.isArray(highlights) ? highlights.slice(0, 4) : [],
    score: score ? String(score) : '',
    status
  };

  const rewritten = await rewriteMemoryWithAI({
    currentMemory: currentForPrompt,
    latestTask,
    apiKeys
  });

  if (rewritten) {
    return saveMemoryRecord(mergeRewrittenMemory(currentRecord, rewritten, latestTask));
  }

  const fallback = {
    summary: currentRecord.summary || '平台正在沉淀活动策划中的有效方法论。',
    principles: [
      ...currentRecord.principles,
      ...(score && Number(score) < 7 ? [{ text: '方案要先把核心命题讲清楚，再展开结构和表达。', lastUsedAt: nowIso(), useCount: 1 }] : []),
      ...(highlights?.length ? [{ text: '亮点表达要具体、可感知，不要停留在泛化口号。', lastUsedAt: nowIso(), useCount: 1 }] : [])
    ],
    patterns: [
      ...currentRecord.patterns,
      ...(userInput.eventType ? [{ text: `${userInput.eventType}类任务要先明确目标，再决定内容结构。`, lastUsedAt: nowIso(), useCount: 1 }] : [])
    ],
    pitfalls: [
      ...currentRecord.pitfalls,
      { text: '不要把测试信息、弱相关信息或空间噪音强行带入方案。', lastUsedAt: nowIso(), useCount: 1 },
      { text: '不要只堆信息，先判断什么内容真的会影响策划结论。', lastUsedAt: nowIso(), useCount: 1 }
    ],
    recentLearnings: [
      { text: `${latestTask.title}：${latestTask.summary || '完成一次策划任务沉淀。'}`, lastUsedAt: nowIso(), useCount: 1, taskId, score: latestTask.score || '' },
      ...currentRecord.recentLearnings.filter(item => item.taskId !== taskId)
    ]
  };

  return saveMemoryRecord(fallback);
}

module.exports = {
  getMemoryForPrompt,
  updateMemoryFromTask
};
