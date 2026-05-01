// Skill: 分阶段生成策划方案
//
// 三阶段架构（替代原来的"一次 8000 token 大调用"）：
//   1) 骨架：1 次 LLM call → planTitle / coreStrategy / highlights / sections 列表
//   2) 章节：N 个 sections **并发**展开 → 每段 narrative / executionDetails / materials
//   3) 详情：1 次 LLM call → budget / timeline / kpis / risks / visual
//
// 章节展开过程中每段写完立刻 emit（onSectionExpanded），同时 fire-and-forget
// 启动后台美化子任务 (polishSection)，主流程不等美化。美化完成后再 emit
// 一次 polished:true 的版本，前端按 index 替换。
//
// 优势：
// - 单次 LLM 调用最多 ~2000 token，挂死率断崖式下降
// - 失败粒度小：某段挂了只重试该段
// - 后台美化不阻塞主流程，总耗时只看主线
// - 用户进度可视化精确到"第 N/M 章节"
//
// 对外签名兼容：保留 generatePlanDoc(input, apiKeys) 的输入/输出，
// 新增 input.onSectionExpanded({ index, total, section, polished, phase }) 用于增量推送。
const { callLLMJson, stripThinkTags } = require('../utils/llmUtils');
const {
  buildSkeletonPrompt,
  buildSectionPrompt,
  buildDetailsPrompt,
  buildPolishSectionPrompt
} = require('../prompts/planDocWriter');
const { callMinimaxStreamText } = require('../services/llmClients');
const { markdownToHtml } = require('../services/richText');
const { normalizeStrategizeResult, StructuredOutputValidationError } = require('../utils/structuredOutput');
const { buildFallbackStrategy } = require('./strategize');

// ─── 阶段配置 ─────────────────────────────────────────────────────────
const SKELETON_MAX_TOKENS = 2000;
const SECTION_MAX_TOKENS = 1800;
const DETAILS_MAX_TOKENS = 2200;

// 后台美化任务的整体收尾上限：所有 section 的美化任务最多再等 15s
const POLISH_GRACE_MS = 15_000;
// 单段美化的超时（流式）
const POLISH_IDLE_MS = 10_000;
const POLISH_TOTAL_MS = 30_000;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function cleanPlanText(text = '') {
  return stripThinkTags(text)
    .replace(/^#+\s+.+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanStringArray(items = []) {
  return (Array.isArray(items) ? items : [])
    .map(item => cleanPlanText(item))
    .filter(Boolean);
}

// ─── 校验 / normalize ─────────────────────────────────────────────────
function normalizeSkeleton(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new StructuredOutputValidationError('skeleton 必须是对象');
  }
  const sections = Array.isArray(raw.sections) ? raw.sections : [];
  const normalizedSections = sections
    .map((s, i) => {
      if (!s || typeof s !== 'object') return null;
      const title = cleanPlanText(s.title || '');
      if (!title) return null;
      const keyPoints = Array.isArray(s.keyPoints)
        ? cleanStringArray(s.keyPoints).slice(0, 6)
        : [];
      const focus = cleanPlanText(s.focus || '');
      return { title, keyPoints, focus };
    })
    .filter(Boolean);
  if (normalizedSections.length === 0) {
    throw new StructuredOutputValidationError('skeleton.sections 不能为空');
  }
  const planTitle = cleanPlanText(raw.planTitle || '');
  if (!planTitle) {
    throw new StructuredOutputValidationError('skeleton.planTitle 不能为空');
  }
  return {
    planTitle,
    coreStrategy: cleanPlanText(raw.coreStrategy || ''),
    highlights: Array.isArray(raw.highlights)
      ? cleanStringArray(raw.highlights).slice(0, 6)
      : [],
    sections: normalizedSections.slice(0, 6),
    eventDate: cleanPlanText(raw.eventDate || ''),
    audienceProfile: cleanPlanText(raw.audienceProfile || '')
  };
}

function normalizeSectionExpansion(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new StructuredOutputValidationError('section 必须是对象');
  }
  const narrative = cleanPlanText(raw.narrative || '');
  if (!narrative) {
    throw new StructuredOutputValidationError('section.narrative 不能为空');
  }
  return {
    narrative,
    executionDetails: Array.isArray(raw.executionDetails)
      ? cleanStringArray(raw.executionDetails).slice(0, 6)
      : [],
    materials: Array.isArray(raw.materials)
      ? cleanStringArray(raw.materials).slice(0, 6)
      : []
  };
}

function normalizeDetails(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new StructuredOutputValidationError('details 必须是对象');
  }
  // visualTheme.style 是 normalizeStrategizeResult 的硬校验字段——LLM 可能返回 {style:""}，
  // 这里强制兜底，避免一个空字段导致整个方案被标 degraded。
  const rawVisualTheme = raw.visualTheme && typeof raw.visualTheme === 'object' ? raw.visualTheme : {};
  const visualTheme = {
    ...rawVisualTheme,
    style: String(rawVisualTheme.style || '').trim() || '稳重克制、有质感的当代风格'
  };
  return {
    budget: raw.budget && typeof raw.budget === 'object' ? raw.budget : { total: '', breakdown: [] },
    timeline: raw.timeline && typeof raw.timeline === 'object' ? raw.timeline : { eventDate: '', phases: [] },
    kpis: Array.isArray(raw.kpis) ? raw.kpis : [],
    riskMitigation: Array.isArray(raw.riskMitigation) ? raw.riskMitigation : [],
    visualTheme,
    visualExecutionHints: raw.visualExecutionHints && typeof raw.visualExecutionHints === 'object'
      ? raw.visualExecutionHints
      : { sceneTone: '', mustRenderScenes: [], spatialKeywords: [], avoidElements: [], onsiteDesignSuggestions: [] }
  };
}

// ─── 单段兜底（某章 expand 失败时用 keyPoints 拼一段最短叙事） ──────────
function buildFallbackSection(section, userInput = {}) {
  const brand = userInput.brand || '本次活动';
  const points = (section.keyPoints || []).filter(Boolean);
  const focus = section.focus || '';
  const narrative = points.length
    ? `围绕「${section.title}」，我们建议从 ${points.slice(0, 3).map((p, i) => `${i + 1}）${p}`).join('；')} 三个层面推进。${focus ? focus : '执行细节将在后续轮次进一步细化。'}`
    : `${brand}的「${section.title}」环节会以稳健的方式推进，确保品牌叙事连贯、用户感知清晰，具体执行点将在后续轮次细化。`;
  return {
    narrative,
    executionDetails: points.slice(0, 4),
    materials: []
  };
}

// ─── 后台美化（fire-and-forget） ─────────────────────────────────────
// 只润色 narrative 段落，不动 executionDetails / materials。
// 流式调用、独立超时、失败保留原版。
async function polishSection(section, expanded, apiKeys, { onStatus } = {}) {
  if (!expanded?.narrative || expanded.narrative.trim().length < 80) return null;

  const { systemPrompt, userPrompt } = buildPolishSectionPrompt({ section, expanded });

  const controller = new AbortController();
  let lastChunkAt = Date.now();
  let abortReason = '';
  const watchdog = setInterval(() => {
    if (controller.signal.aborted) return;
    const now = Date.now();
    if (now - lastChunkAt > POLISH_IDLE_MS) {
      abortReason = 'polish_idle_timeout';
      try { controller.abort('polish_idle_timeout'); } catch {}
    }
  }, 1000);
  if (typeof watchdog.unref === 'function') watchdog.unref();
  const totalTimer = setTimeout(() => {
    if (controller.signal.aborted) return;
    abortReason = 'polish_total_timeout';
    try { controller.abort('polish_total_timeout'); } catch {}
  }, POLISH_TOTAL_MS);
  if (typeof totalTimer.unref === 'function') totalTimer.unref();

  let accumulated = '';
  try {
    await callMinimaxStreamText(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      {
        runtimeKey: apiKeys.minimaxApiKey,
        minimaxModel: apiKeys.minimaxModel,
        maxTokens: 1200,
        temperature: 0.2,
        signal: controller.signal
      },
      (chunk) => {
        lastChunkAt = Date.now();
        accumulated += chunk;
      }
    );
  } catch (err) {
    if (controller.signal.aborted) {
      console.warn(`[polish:${section.title}] ${abortReason || 'aborted'}，保留原版`);
    } else {
      console.warn(`[polish:${section.title}] 失败，保留原版:`, err.message);
    }
    return null;
  } finally {
    clearInterval(watchdog);
    clearTimeout(totalTimer);
  }

  // 推理模型偶发会把 <think>...</think>（甚至只有半边）写进流，先剥掉再做长度兜底，
  // 否则 think 占的字符会让"结果过短"判断失真。
  const cleaned = cleanPlanText(accumulated);
  if (!cleaned) {
    console.warn(`[polish:${section.title}] 结果只包含思考痕迹，丢弃`);
    return null;
  }
  if (cleaned.length < expanded.narrative.length * 0.6) {
    console.warn(`[polish:${section.title}] 结果过短 (${cleaned.length} vs ${expanded.narrative.length})，丢弃`);
    return null;
  }
  return cleaned;
}

// ─── 拼接 Markdown（从结构化数据生成，不依赖模型直接吐 markdown） ──────
function renderPlanMarkdown(plan) {
  const lines = [];
  lines.push(`# ${cleanPlanText(plan.planTitle || '策划方案') || '策划方案'}`);
  lines.push('');

  if (plan.coreStrategy) {
    lines.push('## 核心策略');
    lines.push('');
    lines.push(cleanPlanText(plan.coreStrategy));
    lines.push('');
  }

  if (Array.isArray(plan.highlights) && plan.highlights.length) {
    lines.push('## 方案亮点');
    lines.push('');
    cleanStringArray(plan.highlights).forEach(h => lines.push(`- ${h}`));
    lines.push('');
  }

  (plan.sections || []).forEach(section => {
    const sectionTitle = cleanPlanText(section.title || '');
    if (!sectionTitle) return;
    lines.push(`## ${sectionTitle}`);
    lines.push('');
    if (Array.isArray(section.keyPoints) && section.keyPoints.length) {
      cleanStringArray(section.keyPoints).forEach(k => lines.push(`- **${k}**`));
      lines.push('');
    }
    if (section.narrative) {
      const narrative = cleanPlanText(section.narrative);
      if (narrative) {
        lines.push(narrative);
        lines.push('');
      }
    }
    if (Array.isArray(section.executionDetails) && section.executionDetails.length) {
      lines.push('### 执行细节');
      lines.push('');
      cleanStringArray(section.executionDetails).forEach(e => lines.push(`- ${e}`));
      lines.push('');
    }
    if (Array.isArray(section.materials) && section.materials.length) {
      lines.push('### 物料 / 视觉要素');
      lines.push('');
      cleanStringArray(section.materials).forEach(m => lines.push(`- ${m}`));
      lines.push('');
    }
  });

  if (plan.budget && Array.isArray(plan.budget.breakdown) && plan.budget.breakdown.length) {
    lines.push('## 预算框架');
    lines.push('');
    if (plan.budget.total) lines.push(`**总预算**：${cleanPlanText(plan.budget.total)}`);
    lines.push('');
    plan.budget.breakdown.forEach(item => {
      const meta = [cleanPlanText(item.amount), cleanPlanText(item.percentage)].filter(Boolean).join(' · ');
      lines.push(`- **${cleanPlanText(item.item) || '—'}**${meta ? `（${meta}）` : ''}：${cleanPlanText(item.rationale || '')}`);
    });
    lines.push('');
  }

  if (plan.timeline && Array.isArray(plan.timeline.phases) && plan.timeline.phases.length) {
    lines.push('## 执行节奏');
    lines.push('');
    if (plan.timeline.eventDate) {
      lines.push(`**活动日期**：${cleanPlanText(plan.timeline.eventDate)}`);
      lines.push('');
    }
    plan.timeline.phases.forEach(p => {
      const meta = p.duration ? `（${cleanPlanText(p.duration)}）` : '';
      lines.push(`- **${cleanPlanText(p.phase) || '—'}**${meta}：${cleanPlanText(p.milestone || '')}`);
    });
    lines.push('');
  }

  if (Array.isArray(plan.kpis) && plan.kpis.length) {
    lines.push('## 核心 KPI');
    lines.push('');
    plan.kpis.forEach(k => {
      const rationale = cleanPlanText(k.rationale || '');
      lines.push(`- **${cleanPlanText(k.metric) || '—'}**：目标 ${cleanPlanText(k.target) || '—'}${rationale ? `，${rationale}` : ''}`);
    });
    lines.push('');
  }

  if (Array.isArray(plan.riskMitigation) && plan.riskMitigation.length) {
    lines.push('## 风险应对');
    lines.push('');
    cleanStringArray(plan.riskMitigation).forEach(r => lines.push(`- ${r}`));
    lines.push('');
  }

  const veh = plan.visualExecutionHints;
  if (veh && (veh.sceneTone || (Array.isArray(veh.mustRenderScenes) && veh.mustRenderScenes.length) || (Array.isArray(veh.onsiteDesignSuggestions) && veh.onsiteDesignSuggestions.length))) {
    lines.push('## 现场视觉建议');
    lines.push('');
    if (veh.sceneTone) {
      lines.push(`**整体气质**：${cleanPlanText(veh.sceneTone)}`);
      lines.push('');
    }
    if (Array.isArray(veh.onsiteDesignSuggestions) && veh.onsiteDesignSuggestions.length) {
      veh.onsiteDesignSuggestions.forEach(s => {
        const goal = cleanPlanText(s.goal || '');
        lines.push(`- **${cleanPlanText(s.scene) || '—'}**${goal ? `（${goal}）` : ''}：${cleanPlanText(s.designSuggestion || '')}`);
      });
      lines.push('');
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ─── 主入口 ──────────────────────────────────────────────────────────
/**
 * 分阶段生成完整策划方案。
 * @param {object} input
 *   - orchestratorOutput / researchResults / userInput / approvedConcept / round
 *   - onStatus(payload)            状态心跳，会被透传到 callLLMJson
 *   - onSection(markdown)          累积 markdown 推送（用于前端 doc 面板流式预览）
 *   - onSectionExpanded(payload)   单段就绪通知 { index, total, section, polished, phase }
 *                                  phase: 'skeleton' | 'expanded' | 'polished'
 * @param {object} apiKeys
 * @returns {Promise<{ plan, markdown, html, degraded?, fallbackReason? }>}
 */
async function generatePlanDoc(input, apiKeys) {
  const { onStatus, onSection, onSectionExpanded } = input || {};
  const safeOnSection = typeof onSection === 'function' ? onSection : null;
  const safeOnExpanded = typeof onSectionExpanded === 'function' ? onSectionExpanded : null;
  const safeOnStatus = typeof onStatus === 'function' ? onStatus : null;

  const notify = (status, payload) => {
    if (safeOnStatus) {
      try { safeOnStatus({ status, ...(payload || {}) }); } catch {}
    }
  };

  const pushSection = (payload) => {
    if (safeOnExpanded) {
      try { safeOnExpanded(payload); } catch {}
    }
  };

  console.log('[skill:generatePlanDoc] 开始分阶段生成（骨架 → 章节并发 → 详情）...');

  // ── 阶段 1：骨架 ──────────────────────────────────────────────────
  notify('skeleton_start');
  const skeletonMessages = (() => {
    const { systemPrompt, userPrompt } = buildSkeletonPrompt(input);
    return [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }];
  })();

  let skeleton;
  let skeletonFailed = null;
  try {
    skeleton = await callLLMJson(skeletonMessages, {
      model: 'minimax',
      runtimeKey: apiKeys.minimaxApiKey,
      minimaxModel: apiKeys.minimaxModel,
      maxTokens: SKELETON_MAX_TOKENS,
      temperature: 0.4,
      streaming: true,
      name: 'planSkeleton',
      validate: normalizeSkeleton,
      repairHint: '必须含 planTitle、coreStrategy、highlights[]、sections[]{title, keyPoints[], focus}',
      debugLabel: 'planSkeleton',
      onStatus: safeOnStatus
    });
  } catch (err) {
    skeletonFailed = err;
    console.warn('[skill:generatePlanDoc] 骨架阶段失败，切换稳态兜底:', err.message);
  }

  // 骨架挂了：直接走完整 fallback，跳过后续阶段
  if (!skeleton) {
    notify('fallback_start', { phase: 'skeleton', error: skeletonFailed });
    const fallback = buildFallbackStrategy(input);
    const plan = { ...fallback, degraded: true, fallbackReason: skeletonFailed?.message || 'skeleton_failed' };
    const markdown = renderPlanMarkdown(plan);
    if (safeOnSection) { try { safeOnSection(markdown); } catch {} }
    return { plan, markdown, html: markdownToHtml(markdown), degraded: true, fallbackReason: plan.fallbackReason };
  }

  // 骨架就绪：先把 N 个占位 section 推给前端，让用户立刻看到大纲
  notify('skeleton_ready', { sectionCount: skeleton.sections.length });
  const total = skeleton.sections.length;
  skeleton.sections.forEach((s, idx) => {
    pushSection({
      index: idx,
      total,
      polished: false,
      phase: 'skeleton',
      section: { ...s, narrative: '', executionDetails: [], materials: [] }
    });
  });

  // 第一次推 markdown：只有标题 + 核心策略 + 章节列表（让前端 doc 面板有东西）
  if (safeOnSection) {
    const previewPlan = {
      planTitle: skeleton.planTitle,
      coreStrategy: skeleton.coreStrategy,
      highlights: skeleton.highlights,
      sections: skeleton.sections.map(s => ({ title: s.title, keyPoints: s.keyPoints, narrative: '' }))
    };
    try { safeOnSection(renderPlanMarkdown(previewPlan)); } catch {}
  }

  // ── 阶段 2：章节并发展开 ──────────────────────────────────────────
  notify('sections_start', { total });
  const polishTasks = [];
  const expandedSections = new Array(total);

  // 每次 expandedSections 变更后调一次：把当前已写的段落 + 未写段落的占位，
  // 拼成完整 markdown 推给前端文档面板，让用户能看到逐段填满。
  const pushDocPreview = () => {
    if (!safeOnSection) return;
    try {
      const previewPlan = {
        planTitle: skeleton.planTitle,
        coreStrategy: skeleton.coreStrategy,
        highlights: skeleton.highlights,
        sections: skeleton.sections.map((s, i) => expandedSections[i] || {
          title: s.title,
          keyPoints: s.keyPoints,
          narrative: '（生成中…）'
        })
      };
      safeOnSection(renderPlanMarkdown(previewPlan));
    } catch {}
  };

  await Promise.all(skeleton.sections.map(async (section, idx) => {
    const { systemPrompt, userPrompt } = buildSectionPrompt({
      skeleton, section, userInput: input.userInput, approvedConcept: input.approvedConcept
    });
    let expanded;
    try {
      expanded = await callLLMJson(
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        {
          model: 'minimax',
          runtimeKey: apiKeys.minimaxApiKey,
          minimaxModel: apiKeys.minimaxModel,
          maxTokens: SECTION_MAX_TOKENS,
          temperature: 0.5,
          streaming: true,
          name: `planSection_${idx + 1}`,
          validate: normalizeSectionExpansion,
          repairHint: '必须含 narrative（段落正文）、executionDetails（数组）、materials（数组）',
          debugLabel: `planSection_${idx + 1}`,
          onStatus: safeOnStatus
        }
      );
    } catch (err) {
      console.warn(`[skill:generatePlanDoc] section ${idx + 1} 失败，使用兜底:`, err.message);
      expanded = buildFallbackSection(section, input.userInput);
    }

    const merged = { ...section, ...expanded };
    expandedSections[idx] = merged;

    // 立刻推送：未美化版本（artifact + 文档面板）
    pushSection({ index: idx, total, polished: false, phase: 'expanded', section: merged });
    pushDocPreview();

    // 后台启动美化（不 await）
    polishTasks.push(
      polishSection(section, expanded, apiKeys)
        .then(polishedNarrative => {
          if (!polishedNarrative) return;
          const polishedSection = { ...merged, narrative: polishedNarrative };
          // 用美化版本覆盖（同 index）
          expandedSections[idx] = polishedSection;
          pushSection({ index: idx, total, polished: true, phase: 'polished', section: polishedSection });
          // 文档面板也刷新一次，让用户看到润色版本生效
          pushDocPreview();
        })
        .catch(err => {
          console.warn(`[skill:generatePlanDoc] polish ${idx + 1} 失败:`, err.message);
        })
    );
  }));

  // ── 阶段 3：详情 ─────────────────────────────────────────────────
  notify('details_start');
  let details;
  try {
    const { systemPrompt, userPrompt } = buildDetailsPrompt({
      skeleton, expandedSections, userInput: input.userInput
    });
    details = await callLLMJson(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      {
        model: 'minimax',
        runtimeKey: apiKeys.minimaxApiKey,
        minimaxModel: apiKeys.minimaxModel,
        maxTokens: DETAILS_MAX_TOKENS,
        temperature: 0.4,
        streaming: true,
        name: 'planDetails',
        validate: normalizeDetails,
        repairHint: '必须含 budget、timeline、kpis、riskMitigation、visualTheme、visualExecutionHints',
        debugLabel: 'planDetails',
        onStatus: safeOnStatus
      }
    );
  } catch (err) {
    console.warn('[skill:generatePlanDoc] 详情阶段失败，使用兜底:', err.message);
    const fallback = buildFallbackStrategy(input);
    details = {
      budget: fallback.budget,
      timeline: fallback.timeline,
      kpis: fallback.kpis,
      riskMitigation: fallback.riskMitigation,
      visualTheme: fallback.visualTheme,
      visualExecutionHints: fallback.visualExecutionHints
    };
  }

  // ── 等待美化收尾（带 grace） ─────────────────────────────────────
  notify('polish_grace_start', { pending: polishTasks.length });
  await Promise.race([
    Promise.allSettled(polishTasks),
    sleep(POLISH_GRACE_MS)
  ]);

  // ── 拼装最终 plan + 校验 ─────────────────────────────────────────
  const merged = {
    planTitle: skeleton.planTitle,
    coreStrategy: skeleton.coreStrategy,
    highlights: skeleton.highlights,
    sections: expandedSections.map(s => ({
      title: s.title,
      keyPoints: s.keyPoints || [],
      narrative: s.narrative || ''
    })),
    budget: details.budget,
    timeline: details.timeline,
    kpis: details.kpis,
    riskMitigation: details.riskMitigation,
    visualTheme: details.visualTheme,
    visualExecutionHints: details.visualExecutionHints
  };

  let plan;
  let degraded = false;
  let fallbackReason = '';
  try {
    plan = normalizeStrategizeResult(merged);
  } catch (err) {
    console.warn('[skill:generatePlanDoc] 最终 normalize 失败，启用兜底补全:', err.message);
    fallbackReason = err.message;
    degraded = true;
    // 用 fallback 补齐缺失字段，再 normalize 一次
    const fallback = buildFallbackStrategy(input);
    const patched = {
      planTitle: merged.planTitle || fallback.planTitle,
      coreStrategy: merged.coreStrategy || fallback.coreStrategy,
      highlights: merged.highlights.length ? merged.highlights : fallback.highlights,
      sections: merged.sections.length ? merged.sections : fallback.sections,
      budget: merged.budget || fallback.budget,
      timeline: merged.timeline || fallback.timeline,
      kpis: merged.kpis.length ? merged.kpis : fallback.kpis,
      riskMitigation: merged.riskMitigation.length ? merged.riskMitigation : fallback.riskMitigation,
      visualTheme: (merged.visualTheme && merged.visualTheme.style) ? merged.visualTheme : fallback.visualTheme,
      visualExecutionHints: merged.visualExecutionHints || fallback.visualExecutionHints
    };
    try {
      plan = normalizeStrategizeResult(patched);
    } catch {
      plan = { ...fallback };
    }
  }

  if (degraded) {
    plan.degraded = true;
    plan.fallbackReason = fallbackReason;
  }

  const markdown = renderPlanMarkdown(plan);
  if (safeOnSection) { try { safeOnSection(markdown); } catch {} }
  const html = markdownToHtml(markdown);

  console.log(`[skill:generatePlanDoc] 完成${degraded ? '（部分降级）' : ''}：${plan.sections.length} 章节，${markdown.length} 字`);
  return { plan, markdown, html, degraded, fallbackReason: degraded ? fallbackReason : '' };
}

module.exports = { generatePlanDoc, _private: { cleanPlanText, renderPlanMarkdown } };
