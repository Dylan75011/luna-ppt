// 多 Agent 编排主逻辑
const OrchestratorAgent = require('../agents/orchestratorAgent');
const ResearchAgent = require('../agents/researchAgent');
const StrategyAgent = require('../agents/strategyAgent');
const CriticAgent = require('../agents/criticAgent');
const PptBuilderAgent = require('../agents/pptBuilderAgent');
const DocWriterAgent = require('../agents/docWriterAgent');
const ImageAgent = require('../agents/imageAgent');
const { generatePPT } = require('./pptGenerator');
const { renderToHtml } = require('./previewRenderer');
const taskManager = require('./taskManager');
const config = require('../config');
const workspaceManager = require('./workspaceManager');
const platformMemory = require('./platformMemory');

function push(taskId, stage, status, extra = {}) {
  taskManager.pushEvent(taskId, 'progress', { stage, status, ...extra });
  taskManager.updateTask(taskId, { currentStage: stage });
}

function pushArtifact(taskId, artifactType, payload = {}) {
  taskManager.pushEvent(taskId, 'artifact', { artifactType, payload });
}

/**
 * 为 Agent 实例注入运行时 API Keys
 */
function injectKeys(agent, apiKeys) {
  agent.apiKeys = apiKeys || {};
  return agent;
}

function syncSpaceIndexFromTask(taskId, payload = {}) {
  Promise.resolve().then(async () => {
    const task = taskManager.getTask(taskId);
    const spaceId = task?.userInput?.spaceId;
    if (!spaceId) return;

    await workspaceManager.upsertSpaceIndexFromTask({
      spaceId,
      taskId,
      userInput: task.userInput || {},
      apiKeys: task.savedApiKeys || {},
      ...payload
    });
  }).catch((err) => {
    console.warn('[space-index] sync failed:', err.message);
  });
}

async function runMultiAgent(taskId, userInput, apiKeys = {}) {
  // 每次任务创建新的 Agent 实例，注入运行时 Key
  const orchestratorAgent = injectKeys(new OrchestratorAgent(), apiKeys);
  const strategyAgent     = injectKeys(new StrategyAgent(), apiKeys);
  const criticAgent       = injectKeys(new CriticAgent(), apiKeys);
  const pptBuilderAgent   = injectKeys(new PptBuilderAgent(), apiKeys);

  taskManager.updateTask(taskId, { status: 'running' });

  try {
    const memory = platformMemory.getMemoryForPrompt();
    Object.assign(userInput, {
      platformMemorySummary: memory.summary || '',
      platformMemoryPrinciples: Array.isArray(memory.principles) ? memory.principles : [],
      platformMemoryPatterns: Array.isArray(memory.patterns) ? memory.patterns : [],
      platformMemoryPitfalls: Array.isArray(memory.pitfalls) ? memory.pitfalls : [],
      platformMemoryRecentLearnings: Array.isArray(memory.recentLearnings) ? memory.recentLearnings : []
    });

    // ─── 1. Orchestrator ─────────────────────────────────────────
    push(taskId, 'orchestrator', 'running', { message: '正在解析活动需求...' });
    const orchestratorOutput = await orchestratorAgent.run(userInput);
    push(taskId, 'orchestrator', 'completed', {
      message: `需求解析完成：${orchestratorOutput.parsedGoal}`,
      data: { parsedGoal: orchestratorOutput.parsedGoal, keyThemes: orchestratorOutput.keyThemes }
    });
    pushArtifact(taskId, 'task_brief', {
      parsedGoal: orchestratorOutput.parsedGoal,
      keyThemes: orchestratorOutput.keyThemes || [],
      searchTasks: orchestratorOutput.searchTasks || [],
      pptStructureHint: orchestratorOutput.pptStructureHint || ''
    });
    taskManager.updateTask(taskId, { progress: 15 });

    // ─── 2. Research × 3 并行 ────────────────────────────────────
    const searchTasks = orchestratorOutput.searchTasks || [];
    const researchAgents = searchTasks.map((_, i) => injectKeys(new ResearchAgent(i + 1), apiKeys));

    // 推送所有 research 任务开始
    searchTasks.forEach((t, i) => {
      push(taskId, 'research', 'running', {
        agentId: `research-${i + 1}`,
        message: `Research-${i + 1} 正在搜索：${t.focus}`
      });
    });

    const researchResults = await Promise.all(
      searchTasks.map((task, i) =>
        researchAgents[i].run({ task, orchestratorOutput }).then(result => {
          push(taskId, 'research', 'completed', {
            agentId: `research-${i + 1}`,
            message: `Research-${i + 1} 完成`
          });
          pushArtifact(taskId, 'research_result', {
            agentId: `research-${i + 1}`,
            focus: result.focus || task.focus,
            summary: result.summary || '',
            keyFindings: result.keyFindings || [],
            inspirations: result.inspirations || []
          });
          return result;
        }).catch(err => {
          push(taskId, 'research', 'failed', {
            agentId: `research-${i + 1}`,
            message: `Research-${i + 1} 失败：${err.message}`
          });
          return { taskId: task.id, focus: task.focus, summary: '搜索失败', keyFindings: [], inspirations: [] };
        })
      )
    );
    taskManager.updateTask(taskId, { progress: 40 });

    // ─── 3. Strategy + Critic 评审循环 ───────────────────────────
    let bestPlan = null;
    let bestScore = 0;
    let previousFeedback = null;
    const maxRounds = config.criticMaxRounds;

    for (let round = 1; round <= maxRounds; round++) {
      taskManager.updateTask(taskId, { round });

      // Strategy
      push(taskId, 'strategy', 'running', { round, message: `第${round}轮：正在制定策划方案...` });
      const plan = await strategyAgent.run({
        orchestratorOutput,
        researchResults,
        round,
        previousFeedback,
        userInput
      });
      push(taskId, 'strategy', 'completed', { round, message: `第${round}轮方案完成` });
      pushArtifact(taskId, 'plan_draft', {
        round,
        planTitle: plan.planTitle || '',
        coreStrategy: plan.coreStrategy || '',
        highlights: plan.highlights || [],
        sections: (plan.sections || []).map(section => ({
          title: section.title,
          keyPoints: section.keyPoints || []
        }))
      });
      (plan.sections || []).forEach((section, index) => {
        pushArtifact(taskId, 'plan_section', {
          round,
          index,
          title: section.title || `章节 ${index + 1}`,
          keyPoints: section.keyPoints || [],
          content: section.content || {}
        });
      });
      taskManager.updateTask(taskId, { progress: 40 + round * 12 });

      // Critic
      push(taskId, 'critic', 'running', { round, message: `第${round}轮：专家评审中（DeepSeek-R1）...` });
      const review = await criticAgent.run({ plan, round, userInput });
      push(taskId, 'critic', 'completed', {
        round,
        score: review.score,
        passed: review.passed,
        message: `第${round}轮评审完成，得分：${review.score}${review.passed ? '（通过）' : '（未通过）'}`
      });
      pushArtifact(taskId, 'review_feedback', {
        round,
        score: review.score,
        passed: review.passed,
        strengths: review.strengths || [],
        weaknesses: review.weaknesses || [],
        specificFeedback: review.specificFeedback || ''
      });
      taskManager.updateTask(taskId, { progress: 40 + round * 18 });

      if (review.score > bestScore) {
        bestScore = review.score;
        bestPlan = plan;
      }

      if (review.passed) break;

      previousFeedback = review;
    }

    // ─── 4. 生成策划文档 ────────────────────────────────────────
    const docWriterAgent = injectKeys(new DocWriterAgent(), apiKeys);
    push(taskId, 'building', 'running', { message: '正在整理策划文档...' });
    const { markdown, html: docHtml } = await docWriterAgent.run({
      plan: bestPlan,
      userInput,
      reviewFeedback: previousFeedback
    });
    push(taskId, 'building', 'completed', { message: '策划文档已生成' });

    // 把 bestPlan / userInput / apiKeys 存入 task，供后续 build-ppt 接口使用
    taskManager.updateTask(taskId, {
      status: 'awaiting_confirmation',
      progress: 90,
      bestPlan,
      bestScore,
      savedApiKeys: apiKeys,
      docMarkdown: markdown,
      docHtml
    });

    // 推送 doc_ready 事件，前端切换到文档确认面板
    taskManager.pushEvent(taskId, 'doc_ready', {
      docHtml,
      title: bestPlan?.planTitle || userInput.topic || '策划方案',
      score: bestScore
    });
    syncSpaceIndexFromTask(taskId, {
      status: 'doc_ready',
      planTitle: bestPlan?.planTitle || userInput.topic || '策划方案',
      summary: bestPlan?.coreStrategy || orchestratorOutput?.parsedGoal || '',
      highlights: bestPlan?.highlights || [],
      score: bestScore
    });
    platformMemory.updateMemoryFromTask({
      taskId,
      userInput,
      planTitle: bestPlan?.planTitle || userInput.topic || '策划方案',
      summary: bestPlan?.coreStrategy || orchestratorOutput?.parsedGoal || '',
      highlights: bestPlan?.highlights || [],
      score: bestScore || '',
      status: 'doc_ready',
      apiKeys: apiKeys || {}
    }).catch((err) => {
      console.warn('[platform-memory] doc_ready update failed:', err.message);
    });

    // 配图搜索由用户确认文档后手动触发（见 runImageSearch）

  } catch (err) {
    console.error(`[MultiAgent] 任务 ${taskId} 失败:`, err);
    taskManager.updateTask(taskId, { status: 'failed', error: err.message });
    taskManager.pushEvent(taskId, 'error', {
      stage: taskManager.getTask(taskId)?.currentStage || 'unknown',
      message: err.message,
      code: 'PIPELINE_ERROR'
    });
  }
}

/**
 * 从候选图中自动选取每个类别的最佳图（第一张，已由 ImageAgent 按相关性排序）
 */
function autoSelectImages(imageCandidates) {
  const map = {};
  for (const category of ['cover', 'content', 'end']) {
    const list = imageCandidates?.[category];
    if (list && list.length > 0 && list[0].localPath) {
      map[category] = list[0].localPath;
    }
  }
  map.pages = Object.fromEntries(
    (imageCandidates?.pages || [])
      .filter(item => item?.localPath && Number.isInteger(item.pageIndex))
      .map(item => [item.pageIndex, item])
  );
  return map;
}

/**
 * 用户确认文档后，触发 PPT 生成阶段
 * - 并行：图片搜索 + PPT outline 生成
 * - outline 完成后等图片搜索结果，自动选最佳图注入各页
 */
async function runPptBuilder(taskId, docContent) {
  const task = taskManager.getTask(taskId);
  if (!task) throw new Error('任务不存在');

  const { bestPlan, savedApiKeys: apiKeys, userInput } = task;

  // imageMap 是可变引用：outline 生成后、pages 生成前填充
  const imageMap = {};

  const pptBuilderAgent = injectKeys(new PptBuilderAgent(), apiKeys || {});

  taskManager.updateTask(taskId, { status: 'running', currentStage: 'building' });

  try {
    push(taskId, 'building', 'running', { message: '正在生成 PPT 大纲...' });

    const pptData = await pptBuilderAgent.run({
      plan: bestPlan,
      userInput,
      docContent,
      imageMap,  // 可变引用，onOutlineReady 中填充
      onOutlineReady: async (outline, total) => {
        push(taskId, 'building', 'running', { message: '正在为每页匹配视觉背景...' });
        const imageCandidates = await runImageSearch(taskId, outline).catch(err => {
          console.warn('[runPptBuilder] 配图搜索失败，将不带背景图生成:', err.message);
          return {};
        });
        const selected = autoSelectImages(imageCandidates || {});
        Object.assign(imageMap, selected);
        console.log('[runPptBuilder] 配图已注入:', Object.keys(imageMap));

        taskManager.pushEvent(taskId, 'artifact', {
          artifactType: 'ppt_outline',
          payload: { title: outline.title, total, pages: outline.pages || [] }
        });
      },
      onPageReady: (page, index, total, theme) => {
        const html = renderToHtml({ pages: [page], theme })[0];
        taskManager.pushEvent(taskId, 'slide_added', { html, index, total });
        taskManager.updateTask(taskId, {
          progress: 90 + Math.round((index + 1) / total * 8)
        });
      }
    });

    taskManager.updateTask(taskId, { progress: 98 });

    // 生成 PPTX 文件
    const filename = `ppt_${Date.now()}.pptx`;
    await generatePPT(pptData, filename);
    const downloadUrl = `/api/files/download/${filename}`;

    const previewSlides = renderToHtml(pptData);

    push(taskId, 'building', 'completed', { message: 'PPT 生成完成' });
    taskManager.updateTask(taskId, {
      status: 'completed',
      progress: 100,
      result: { filename, downloadUrl, previewSlides, previewData: pptData }
    });

    taskManager.pushEvent(taskId, 'done', { filename, downloadUrl, previewSlides, previewData: pptData });
    syncSpaceIndexFromTask(taskId, {
      status: 'completed',
      planTitle: bestPlan?.planTitle || userInput.topic || '策划方案',
      summary: bestPlan?.coreStrategy || task.docMarkdown || '',
      highlights: bestPlan?.highlights || [],
      score: task.bestScore || '',
      pptPageTotal: Array.isArray(pptData?.pages) ? pptData.pages.length : 0
    });
    platformMemory.updateMemoryFromTask({
      taskId,
      userInput,
      planTitle: bestPlan?.planTitle || userInput.topic || '策划方案',
      summary: bestPlan?.coreStrategy || task.docMarkdown || '',
      highlights: bestPlan?.highlights || [],
      score: task.bestScore || '',
      status: 'completed',
      apiKeys: apiKeys || {}
    }).catch((err) => {
      console.warn('[platform-memory] update failed:', err.message);
    });

  } catch (err) {
    console.error(`[runPptBuilder] 任务 ${taskId} PPT 生成失败:`, err);
    taskManager.updateTask(taskId, { status: 'failed', error: err.message });
    taskManager.pushEvent(taskId, 'error', {
      stage: 'building',
      message: err.message,
      code: 'PPT_BUILD_ERROR'
    });
  }
}

/**
 * 用户确认文档后手动触发配图搜索
 * 完成后通过 SSE 推送 images_ready 事件
 */
async function runImageSearch(taskId, pptOutline = null) {
  const task = taskManager.getTask(taskId);
  if (!task) throw new Error('任务不存在');

  const { bestPlan, userInput, savedApiKeys: apiKeys } = task;
  const imageAgent = injectKeys(new ImageAgent(), apiKeys || {});

  try {
    const imageCandidates = await imageAgent.run({ plan: bestPlan, userInput, taskId, pptOutline });

    taskManager.updateTask(taskId, { imageCandidates });
    console.log('[runImageSearch] 配图搜索完成');
    return imageCandidates;
  } catch (err) {
    console.warn('[runImageSearch] 搜索失败:', err.message);
    throw err;
  }
}

module.exports = { runMultiAgent, runPptBuilder, runImageSearch };
