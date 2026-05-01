// 策略生成工具：run_strategy + review_strategy
// run_strategy：一次流式 LLM 调用同时产出 Markdown 文档（用户实时看）+ 结构化 JSON（系统用）
const { generatePlanDoc, critique } = require('../../skills');
const wm = require('../workspaceManager');
const { htmlToTiptap, markdownToTiptap } = require('../richText');
const { createStallWatcher, emitPlanArtifacts } = require('./helpers');
const { makeSkillStatusBridge } = require('./skillStatusBridge');

async function execRunStrategy(args, session, onEvent) {
  // 概念确认闸口：若当前 session 已有一版创意骨架但尚未确认，必须先确认
  // （没有 conceptProposal 的场景如"已有文档/已有 bestPlan"旁路，不在此拦截）
  if (session.conceptProposal && !session.conceptApproved) {
    return {
      success: false,
      error: '活动主体思路还没经过客户确认。请先用 ask_user 让客户在当前创意方向上明确态度：按这个方向继续 / 需要调整。客户确认后调用 approve_concept，再进 run_strategy；如果客户想调整，调用 propose_concept 并把反馈填入 user_feedback。'
    };
  }

  // 构建结构化 userInput
  const userInput = {
    brand: args.brand || '（未指定）',
    description: args.event_description || args.goal || '',
    goal: args.goal || '',
    audience: args.audience || '目标受众',
    budget: args.budget || '',
    tone: args.tone || '',
    requirements: args.requirements || '',
    topic: args.topic || args.event_description || '',
    brandColor: '1A1A1A',
    timeline: '',
    spaceId: session.spaceId || ''
  };

  const orchestratorOutput = {
    parsedGoal: args.goal || args.event_description,
    keyThemes: [],
    searchTasks: [],
    pptStructureHint: ''
  };

  // 从 researchStore 重建完整搜索记录
  const RESEARCH_CONTEXT_MAX_CHARS = 8000;
  const store = Array.isArray(session.researchStore) ? session.researchStore : [];
  let storedContext = '';
  if (store.length > 0) {
    const parts = [];
    let totalChars = 0;
    for (let i = store.length - 1; i >= 0; i--) {
      const entry = store[i];
      const block = `【搜索${i + 1}】${entry.query}\n` +
        entry.results.map((r, j) => `  [${j + 1}] ${r.title}\n  ${r.snippet}`).join('\n');
      if (totalChars + block.length > RESEARCH_CONTEXT_MAX_CHARS) break;
      parts.unshift(block);
      totalChars += block.length;
    }
    storedContext = parts.join('\n\n');
  }

  const finalResearchContext = [storedContext, args.research_context]
    .filter(s => s && s.trim() && s.trim() !== '（暂无搜索数据）')
    .join('\n\n---\n\n') || '（暂无搜索数据）';

  const researchResults = [{
    taskId: 'brain-research',
    focus: '综合研究',
    summary: finalResearchContext,
    keyFindings: [],
    inspirations: []
  }];

  session.userInput = userInput;
  session.brief = {
    ...(session.brief || {}),
    brand: userInput.brand,
    productCategory: session.brief?.productCategory || '',
    eventType: session.brief?.eventType || '',
    topic: session.brief?.topic || userInput.topic || '',
    goal: userInput.goal,
    audience: userInput.audience,
    scale: session.brief?.scale || '',
    budget: userInput.budget,
    style: session.brief?.style || '',
    tone: userInput.tone,
    requirements: userInput.requirements,
    assumptions: session.brief?.assumptions || []
  };
  onEvent('brief_update', { brief: session.brief });

  onEvent('tool_progress', { message: '策划方案生成中，右侧文档面板将实时展示...' });

  const watchdog = createStallWatcher(() => {
    onEvent('tool_progress', { message: '仍在生成，模型还在写方案...' });
  });

  const fallbackTitle = userInput.topic || `${userInput.brand} 策划方案`;
  let docTitle = fallbackTitle;
  let sectionPushCount = 0;

  // 如果用户已在上一步确认了创意方向，把那条"被选中的方向"作为硬约束传给方案生成
  // 新：支持多方向提案——优先使用 session.approvedDirection（被选中的单条方向）
  // 兼容：如果是旧单方向结构（没有 directions 字段），直接用 conceptProposal 本身
  let approvedConcept = null;
  if (session.conceptApproved) {
    if (session.approvedDirection) {
      approvedConcept = session.approvedDirection;
    } else if (session.conceptProposal && !Array.isArray(session.conceptProposal.directions)) {
      approvedConcept = session.conceptProposal;
    } else if (session.conceptProposal && Array.isArray(session.conceptProposal.directions) && session.conceptProposal.directions[0]) {
      // 兜底：approved 但没明确选中哪条，用 A
      approvedConcept = session.conceptProposal.directions[0];
    }
  }

  let plan, markdown, html;
  let totalSections = 0;
  let expandedDoneCount = 0;
  try {
    ({ plan, markdown, html } = await generatePlanDoc(
      {
        orchestratorOutput,
        researchResults,
        userInput,
        approvedConcept,
        round: 1,
        onStatus: makeSkillStatusBridge(onEvent, {
          skillLabel: '生成方案',
          // run_strategy 三阶段（skeleton / section_N / details / polish_grace）+ 每段
          // 美化的 streaming_heartbeat —— 用 onCustom 把消息文案做得更具进度感
          onCustom: (status, payload) => {
            watchdog.bump();
            if (status === 'streaming_heartbeat') {
              const name = payload.name || '';
              if (name === 'planSkeleton') {
                onEvent('tool_progress', { message: `梳理方案骨架中（${payload.chars || 0} 字）...` });
              } else if (name.startsWith('planSection_')) {
                const idx = name.replace('planSection_', '');
                onEvent('tool_progress', {
                  message: totalSections
                    ? `展开第 ${idx}/${totalSections} 章中（${payload.chars || 0} 字）...`
                    : `展开章节中（${payload.chars || 0} 字）...`
                });
              } else if (name === 'planDetails') {
                onEvent('tool_progress', { message: `补全预算/节奏/KPI 中（${payload.chars || 0} 字）...` });
              } else {
                onEvent('tool_progress', { message: `生成方案中（${payload.chars || 0} 字）...` });
              }
              return true;
            }
            if (status === 'skeleton_ready') {
              totalSections = payload.sectionCount || 0;
              onEvent('tool_progress', { message: `骨架已就绪，并发展开 ${totalSections} 章节...` });
              return true;
            }
            if (status === 'sections_start') {
              totalSections = payload.total || totalSections;
              return true;
            }
            if (status === 'details_start') {
              onEvent('tool_progress', { message: '章节正文已写完，补全预算/节奏/KPI/视觉...' });
              return true;
            }
            if (status === 'polish_grace_start') {
              if (payload.pending > 0) {
                onEvent('tool_progress', { message: `等待 ${payload.pending} 段后台润色收尾...` });
              }
              return true;
            }
            if (status === 'fallback_start') {
              const phase = payload.phase ? `${payload.phase} 阶段` : '生成';
              onEvent('tool_progress', { message: `${phase}失败，切换稳态兜底...` });
              return true;
            }
            return false;
          }
        }),
        // 单段就绪/美化完成回调：转成 plan_section artifact 立即推给前端
        onSectionExpanded: ({ index, total, section, polished, phase }) => {
          watchdog.bump();
          onEvent('artifact', {
            artifactType: 'plan_section',
            payload: {
              round: 1,
              index,
              total,
              title: section.title || `章节 ${index + 1}`,
              keyPoints: Array.isArray(section.keyPoints) ? section.keyPoints : [],
              content: { narrative: section.narrative || '' },
              executionDetails: Array.isArray(section.executionDetails) ? section.executionDetails : [],
              materials: Array.isArray(section.materials) ? section.materials : [],
              polished: !!polished,
              phase: phase || (polished ? 'polished' : 'expanded'),
              // artifactKey 只用 round + index：title 在 normalize 阶段会被 trim，
              // 用 title 拼 key 容易导致流式版本与最终版本 key 不一致 → artifacts 数组冗余。
              artifactKey: `plan_section_r1_${index}`
            }
          });
          if (phase === 'expanded' && !polished) {
            expandedDoneCount += 1;
            if (totalSections) {
              onEvent('tool_progress', {
                message: `已完成 ${expandedDoneCount}/${totalSections} 章节正文，后台润色中...`
              });
            }
          }
        },
        onSection: (accumulatedMarkdown) => {
          watchdog.bump();
          try {
            const firstHeading = accumulatedMarkdown.match(/^#\s+(.+)$/m);
            if (firstHeading) docTitle = firstHeading[1].trim() || fallbackTitle;
            const tiptap = markdownToTiptap(accumulatedMarkdown);
            sectionPushCount += 1;
            const progress = Math.min(92, 15 + sectionPushCount * 8);
            onEvent('doc_section_added', {
              title: docTitle,
              sectionTitle: '',
              progress,
              docContent: tiptap,
              provisional: false
            });
          } catch { /* 部分 markdown 转换失败时忽略 */ }
        }
      },
      session.apiKeys
    ));
  } finally {
    watchdog.stop();
  }

  // 以 plan.planTitle 为最终标题
  docTitle = plan?.planTitle || docTitle;

  // 降级路径：让用户知道这版是兜底稿
  if (plan?.degraded) {
    onEvent('tool_progress', {
      message: '模型结构化输出异常，已切换稳态兜底方案，内容偏保守，建议继续调整或重跑'
    });
  }

  // 推送产出物卡片 + session 持久化
  emitPlanArtifacts(onEvent, plan, 1);
  session.bestPlan = plan;
  session.bestScore = null;
  session.lastReview = null;
  // 关键节点立即落盘：bestPlan 是 build_ppt 的硬护栏依赖，丢失意味着
  // 用户必须重跑整个 run_strategy。
  try {
    require('../agentSession').flushAgentState(session.sessionId, { immediate: true });
  } catch {}

  const tiptapDoc = htmlToTiptap(html);
  session.docMarkdown = markdown;
  session.docHtml = html;
  session.docJson = tiptapDoc;

  // 最终完整文档快照（覆盖流式增量，确保内容完整）
  onEvent('doc_section_added', {
    title: docTitle,
    sectionTitle: '',
    progress: 98,
    docContent: tiptapDoc,
    provisional: false
  });

  onEvent('doc_ready', {
    docHtml: html,
    docContent: tiptapDoc,
    title: docTitle
  });

  // 自动保存到工作空间：多次迭代同一 session 时复用 folder + 原文档节点
  if (session.spaceId && html) {
    try {
      const planTitle = plan?.planTitle || `${userInput.brand || ''}策划方案`;
      const rawFolderName = (plan?.planTitle || userInput.topic || userInput.brand || '策划任务')
        .replace(/[\/\\:*?"<>|]/g, '').slice(0, 20).trim();

      let folderId = session.taskFolderId;
      let folderReused = false;
      // 验证 session.taskFolderId 是否仍有效
      if (folderId) {
        try { wm.getSpaceContext(session.spaceId); folderReused = true; }
        catch { folderId = null; }
      }
      if (!folderId) {
        const folder = wm.ensureTaskFolder(session.spaceId, rawFolderName);
        folderId = folder.id;
        session.taskFolderId = folderId;
      }

      // 尝试复用已有文档节点（迭代场景）
      let docId = session.lastSavedDocId;
      let docReused = false;
      if (docId) {
        try {
          wm.saveContent(docId, tiptapDoc, 'tiptap-json');
          docReused = true;
        } catch {
          docId = null;   // 节点已被删除或无效，走新建分支
        }
      }
      if (!docId) {
        const node = wm.createNode({ parentId: folderId, name: '策划方案', type: 'document', docType: 'document' });
        wm.saveContent(node.id, tiptapDoc, 'tiptap-json');
        docId = node.id;
      }

      session.lastSavedDocId = docId;
      session.lastSavedDocName = planTitle || '策划方案';
      try { session.spaceContext = wm.getSpaceContext(session.spaceId); } catch {}
      onEvent('workspace_updated', {
        spaceId: session.spaceId,
        folderId,
        folderName: rawFolderName,
        docId,
        docName: '策划方案',
        docType: 'document',
        reused: folderReused && docReused
      });
    } catch (e) {
      console.warn('[run_strategy] 自动保存策划文档失败:', e.message);
    }
  }

  return {
    success: true,
    planTitle: plan?.planTitle || '',
    sectionCount: (plan?.sections || []).length,
    hasDocument: !!html,
    degraded: !!plan?.degraded,
    reviewAvailable: true,
    nextStepHint: '方案已在右侧文档面板展示，不要在对话里复述亮点/核心策略；请简短告知用户并询问下一步（出 PPT / 评审 / 继续改）。'
  };
}

async function execReviewStrategy(args, session, onEvent) {
  const plan = session.bestPlan;
  if (!plan) {
    return { success: false, error: '尚未生成策划方案，请先运行 run_strategy。' };
  }

  const userInput = session.userInput || {};
  onEvent('tool_progress', { message: '专家评审中，请稍等...' });

  let review;
  try {
    review = await critique({
      plan, round: 1, userInput,
      onStatus: makeSkillStatusBridge(onEvent, { skillLabel: '专家评审' })
    }, session.apiKeys);
  } catch (err) {
    console.warn('[review_strategy] critique 失败:', err.message);
    return { success: false, error: err.message };
  }

  session.bestScore = review.score;
  session.lastReview = review;
  try {
    require('../agentSession').flushAgentState(session.sessionId, { immediate: true });
  } catch {}

  onEvent('artifact', {
    artifactType: 'review_feedback',
    payload: {
      round: 1,
      score: review.score,
      passed: !!review.passed,
      strengths: Array.isArray(review.strengths) ? review.strengths : [],
      weaknesses: Array.isArray(review.weaknesses) ? review.weaknesses : [],
      specificFeedback: review.specificFeedback || ''
    }
  });

  onEvent('tool_progress', { message: `评审完成，得分 ${review.score}` });

  return {
    success: true,
    score: review.score,
    passed: review.passed,
    strengths: (review.strengths || []).slice(0, 3),
    weaknesses: (review.weaknesses || []).slice(0, 3),
    specificFeedback: review.specificFeedback || ''
  };
}

module.exports = { execRunStrategy, execReviewStrategy };
