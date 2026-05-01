// PPT 生成工具：build_ppt（多 Agent 编排）
const PptBuilderAgent = require('../../agents/pptBuilder');
const ImageAgent = require('../../agents/imageAgent');
const EventVisualDesignerAgent = require('../../agents/eventVisualDesignerAgent');
const { generatePPT } = require('../pptGenerator');
const { renderToHtml } = require('../previewRenderer');
const wm = require('../workspaceManager');
const { toPublicUrl } = require('../outputPaths');
const { buildImageCanvasPayload } = require('../imageCanvas');
const { createStallWatcher } = require('./helpers');

async function execBuildPpt(args, session, onEvent) {
  const { bestPlan, userInput, apiKeys } = session;

  if (!bestPlan) {
    return { success: false, error: '还没有策划方案，请先调用 run_strategy' };
  }

  const pptBuilderAgent = new PptBuilderAgent(apiKeys);
  const imageAgent      = new ImageAgent(apiKeys);
  const visualDesignerAgent = new EventVisualDesignerAgent(apiKeys);

  const imageMap = {};
  let imageCandidates = {};

  // 兜底心跳：build_ppt 内部走多个 BaseAgent 子类（pptBuilder / imageAgent /
  // eventVisualDesigner），它们的 callLLMJson 不传 onStatus，无法接到底层 chunk
  // 心跳。25s 没 bump 就推一次 tool_progress 给 brainAgent，刷新它的 idle
  // watchdog（PROGRESS_EVENT_TYPES 包含 tool_progress），避免 60s idle budget
  // 误判 build_ppt 整体挂死。
  let stallStage = '正在生成 PPT';
  const stall = createStallWatcher(() => {
    onEvent('tool_progress', { message: `${stallStage}（仍在处理中）...` });
  });

  try {
    stallStage = '正在生成 PPT 大纲';
    onEvent('tool_progress', { message: '正在生成 PPT 大纲...' });
    stall.bump();

    const pptData = await pptBuilderAgent.run({
      plan: bestPlan,
      userInput,
      docContent: args.note || session.docHtml || '',
      imageMap,
      onOutlineReady: async (outline, total) => {
        stallStage = '正在设计活动现场效果图';
        onEvent('tool_progress', { message: '正在根据方案设计活动现场效果图建议...' });
        stall.bump();
        const visualPlan = await visualDesignerAgent.run({
          plan: bestPlan,
          pptOutline: outline,
          userInput,
          attachments: Array.isArray(session?.attachments) ? session.attachments : []
        }).catch(err => {
          console.warn('[build_ppt] 活动图设计失败:', err.message);
          return null;
        });
        stall.bump();

        if (visualPlan?.pages?.length) {
          outline.pages = (outline.pages || []).map((page, index) => ({
            ...page,
            visualAssetPlan: visualPlan.pages.find(item => item.pageIndex === index) || page.visualAssetPlan || null
          }));
        }

        stallStage = '正在匹配背景图';
        onEvent('tool_progress', { message: '正在结合策划内容与页面结构匹配背景图...' });
        stall.bump();
        imageCandidates = await imageAgent.run({
          plan: bestPlan,
          userInput,
          pptOutline: outline,
          visualPlan,
          conversationId: session.conversationId || ''
        })
          .catch(err => {
            console.warn('[build_ppt] 配图搜索失败:', err.message);
            return {};
          });
        stall.bump();
        for (const category of ['cover', 'content', 'end']) {
          const list = imageCandidates?.[category];
          if (list && list.length > 0 && list[0].localPath) {
            imageMap[category] = list[0].localPath;
          }
        }
        imageMap.pages = Object.fromEntries(
          (imageCandidates?.pages || [])
            .filter(item => item?.localPath && Number.isInteger(item.pageIndex))
            .map(item => [item.pageIndex, item])
        );
        onEvent('artifact', {
          artifactType: 'image_canvas',
          payload: buildImageCanvasPayload(imageCandidates, visualPlan, outline)
        });
        onEvent('artifact', {
          artifactType: 'ppt_outline',
          payload: { title: outline.title, total, pages: outline.pages || [] }
        });
      },
      onPageReady: (page, index, total, theme) => {
        stallStage = `正在生成第 ${index + 1}/${total} 页`;
        const html = renderToHtml({ pages: [page], theme })[0];
        onEvent('slide_added', { html, index, total });
        stall.bump();
      }
    });

    stallStage = '正在打包 PPT 文件';
    onEvent('tool_progress', { message: '页面已生成完毕，正在打包 PPT 文件...' });
    stall.bump();
    const filename = `ppt_${Date.now()}.pptx`;
    const result = await generatePPT(pptData, filename, {
      runId: session.spaceId || `tool_${Date.now()}`,
      conversationId: session.conversationId || ''
    });
    stall.bump();
    const downloadUrl = result.path;
    const previewSlides = renderToHtml(pptData);

    // 自动保存 PPT 到工作空间（优先放在与策划方案相同的任务文件夹）
    if (session.spaceId) {
      try {
        const brand = session.brief?.brand || session.userInput?.brand || 'PPT';
        const pptName = `${brand} PPT.pptx`;
        const targetParent = session.taskFolderId || session.spaceId;
        const savedNode = wm.savePptToSpace({
          spaceId: session.spaceId,
          parentId: targetParent,
          name: pptName,
          pptData,
          downloadUrl,
          previewSlides
        });

        const seenImagePaths = new Set();
        const candidateImages = [
          ...(Array.isArray(imageCandidates?.pages) ? imageCandidates.pages : []),
          ...(['cover', 'content', 'end']
            .flatMap((category) => Array.isArray(imageCandidates?.[category]) ? imageCandidates[category].slice(0, 1) : []))
        ];

        const imagesFolderId = wm.ensureChildFolder(targetParent, 'images').id;
        candidateImages.forEach((item, index) => {
          const localPath = String(item?.localPath || '').trim();
          if (!localPath || seenImagePaths.has(localPath)) return;
          seenImagePaths.add(localPath);
          const pageNo = Number.isInteger(item?.pageIndex) ? item.pageIndex + 1 : null;
          const baseLabel = item?.pageTitle || item?.role || item?.originQuery || `配图 ${index + 1}`;
          const imageName = pageNo
            ? `${brand} 配图 ${String(pageNo).padStart(2, '0')}.jpg`
            : `${brand} ${String(baseLabel).slice(0, 24) || `配图 ${index + 1}`}.jpg`;
          wm.saveAssetToSpace({
            spaceId: session.spaceId,
            parentId: imagesFolderId,
            name: imageName,
            docType: 'image',
            filePath: localPath,
            previewUrl: toPublicUrl(localPath),
            meta: {
              sourcePageTitle: item?.pageTitle || '',
              role: item?.role || '',
              caption: item?.originQuery || item?.query || '',
              pageIndex: Number.isInteger(item?.pageIndex) ? item.pageIndex : null,
              sceneType: item?.sceneType || '',
              assetType: item?.assetType || '',
              insertMode: item?.insertMode || ''
            }
          });
        });

        try { session.spaceContext = wm.getSpaceContext(session.spaceId); } catch {}
        onEvent('workspace_updated', { spaceId: session.spaceId, folderId: session.taskFolderId || null, docId: savedNode.id, docName: pptName, docType: 'ppt' });
      } catch (e) {
        console.warn('[build_ppt] 自动保存 PPT 失败:', e.message);
      }
    }

    onEvent('done', { filename: result.filename, downloadUrl, previewSlides, previewData: pptData });

    return { success: true, downloadUrl, pageCount: pptData?.pages?.length || 0 };
  } catch (err) {
    throw new Error(`PPT 生成失败：${err.message}`);
  } finally {
    stall.stop();
  }
}

module.exports = { execBuildPpt };
