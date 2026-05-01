// 浏览器桥接工具：借 Chrome Extension 以用户登录态搜索小红书等站点
const bridge = require('../browserBridge');
const { understandImage } = require('../visionMcp');

// 从 xhs URL 抽 noteId，用于 noteCache 兜底查找（brain 复制 URL 时偶尔会丢查询参数）
function noteIdFromUrl(url) {
  const m = String(url || '').match(/\/(?:search_result|explore|discovery\/item)\/([0-9a-f]{16,})/i);
  return m ? m[1] : null;
}

// 把 xhs CDN 原 URL 包成 /api/xhs-image 代理 URL，前端 <img> 加载时走 Node 端带 Referer 拉图
// 非 xhs CDN URL 原样返回（视频封面等），不需要代理
function proxyXhsImageUrl(originalUrl) {
  if (!originalUrl || typeof originalUrl !== 'string') return originalUrl;
  if (!/xhscdn\.com|xiaohongshu\.com/i.test(originalUrl)) return originalUrl;
  return `/api/xhs-image?url=${encodeURIComponent(originalUrl)}`;
}

function lookupNoteFromCache(cache, url) {
  if (!cache || !url) return null;
  if (cache[url]) return cache[url];
  const noteId = noteIdFromUrl(url);
  if (!noteId) return null;
  for (const k of Object.keys(cache)) {
    if (k.includes(noteId)) return cache[k];
  }
  return null;
}

async function execBrowserSearch(args, session, onEvent) {
  const platform = args.platform || 'xiaohongshu';
  const query = String(args.query || '').trim();
  const maxResults = Math.max(1, Math.min(30, args.max_results || 10));
  const fetchBodyTopN = Math.max(0, Math.min(10, args.fetch_body_top_n ?? 0));

  if (!query) {
    return { found: false, results: [], error: '缺少搜索关键词' };
  }

  if (!bridge.isConnected()) {
    onEvent('tool_progress', { message: '未检测到 Luna 浏览器扩展，请先在 Chrome 加载扩展并保持窗口打开' });
    return {
      found: false,
      results: [],
      error: 'Chrome Extension 未连接',
      hint: '参考 extensions/luna/README.md 加载未打包扩展'
    };
  }

  const platformLabel = platform === 'xiaohongshu' ? '小红书' : platform;
  onEvent('tool_progress', {
    message: fetchBodyTopN > 0
      ? `正在通过浏览器扩展搜索${platformLabel}：${query}（含 Top ${fetchBodyTopN} 条正文）`
      : `正在通过浏览器扩展搜索${platformLabel}：${query}（仅列表）`
  });

  let resp;
  try {
    resp = await bridge.send('browser_search', {
      platform,
      query,
      max_results: maxResults,
      fetch_body_top_n: fetchBodyTopN
    }, { timeoutMs: 90_000 });
  } catch (err) {
    onEvent('tool_progress', { message: `浏览器搜索失败：${err.message}` });
    const reason = /need_user_approval/i.test(err.message) ? 'need_user_approval'
      : /未连接|未认证/i.test(err.message) ? 'extension_disconnected'
      : /allowlist/i.test(err.message) ? 'host_not_allowed'
      : /超时/i.test(err.message) ? 'timeout'
      : 'error';
    return { found: false, results: [], reason, error: err.message };
  }

  const results = Array.isArray(resp?.results) ? resp.results : [];
  if (!results.length) {
    return {
      found: false,
      results: [],
      reason: resp?.reason || 'empty',
      warning: resp?.warning || '未获取到结果',
      hint: resp?.reason === 'login_required'
        ? '请在 Chrome 的小红书 tab 手动登录后重试；或改用 web_search 做兜底'
        : '可改用 web_search 兜底（走 Tavily/通用网页搜索）'
    };
  }

  // 累积到 researchStore，复用 run_strategy 的引用机制
  if (!Array.isArray(session.researchStore)) session.researchStore = [];
  session.researchStore.push({
    query,
    timestamp: Date.now(),
    results: results.map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet || r.desc || ''
    })),
    source: `browser:${platform}`
  });

  onEvent('tool_progress', { message: `找到 ${results.length} 条小红书笔记` });

  onEvent('artifact', {
    artifactType: 'research_result',
    payload: {
      focus: query,
      count: results.length,
      source: `browser:${platform}`,
      results: results.slice(0, 8).map(r => ({
        title: r.title || '',
        url: r.url || '',
        domain: r.author || platform,
        snippet: r.snippet || r.desc || '',
        cover: r.cover || ''
      }))
    }
  });

  const summary = results.map((r, i) => {
    const meta = [r.author, r.stats].filter(Boolean).join(' · ');
    const body = r.snippet || r.desc || '';
    const cover = r.cover ? `\n  封面图: ${r.cover}` : '';
    return `[${i + 1}] ${r.title || '(无标题)'}${meta ? `（${meta}）` : ''}${body ? `\n${body}` : ''}${cover}\n  链接: ${r.url}`;
  }).join('\n\n');

  return {
    found: true,
    count: results.length,
    summary,
    results,
    source: `browser:${platform}`
  };
}

async function execBrowserReadPage(args, session, onEvent) {
  const url = String(args.url || '').trim();
  if (!url) return { success: false, reason: 'missing_url', error: '缺少 url' };

  if (!bridge.isConnected()) {
    return { success: false, reason: 'extension_disconnected', error: 'Chrome Extension 未连接' };
  }

  onEvent('tool_progress', { message: `正在通过浏览器扩展读取：${url}` });

  let resp;
  try {
    resp = await bridge.send('browser_read_page', { url }, { timeoutMs: 45_000 });
  } catch (err) {
    const reason = /need_user_approval/i.test(err.message) ? 'need_user_approval'
      : /allowlist/i.test(err.message) ? 'host_not_allowed'
      : /超时/i.test(err.message) ? 'timeout'
      : 'error';
    return { success: false, reason, error: err.message };
  }

  if (!resp || !resp.content) {
    return { success: false, reason: resp?.reason || 'empty', error: '页面无内容', hint: '可改用 web_fetch 兜底' };
  }

  // 质量信号：让 brain 看到 low_signal 时知道这条不可靠，可以换链或 fallback
  // 触发条件：正文过短 / 命中登录墙关键词 / 命中风控关键词
  const content = String(resp.content || '');
  const charCount = content.length;
  const lower = content.toLowerCase();
  const loginWall = /(请先登录|请登录后查看|login required|sign in to continue|verify you are human|verifying you are human|enable javascript|are you a robot|checking your browser)/i.test(content) || /captcha|cloudflare ray id/.test(lower);
  const tooShort = charCount < 300;
  const lowSignal = tooShort || loginWall;
  const meta = {
    charCount,
    lowSignal,
    ...(loginWall && { loginWall: true }),
    ...(tooShort && { tooShort: true })
  };

  onEvent('tool_progress', {
    message: lowSignal
      ? `页面读取完成但信号弱（${loginWall ? '疑似登录/风控' : `仅 ${charCount} 字`}）`
      : '页面读取完成'
  });

  return {
    success: true,
    title: resp.title || '',
    url: resp.url || url,
    content,
    meta,
    ...(lowSignal && {
      hint: loginWall
        ? '页面要求登录或被风控；如果是公开内容，建议换一条链接或用 web_fetch'
        : '页面正文过短，建议换一条搜索结果或用 web_fetch'
    })
  };
}

async function execBrowserReadNotes(args, session, onEvent) {
  const platform = args.platform || 'xiaohongshu';
  const urls = Array.isArray(args.urls) ? args.urls.filter(u => typeof u === 'string' && u.trim()) : [];
  if (urls.length === 0) return { success: false, notes: [], error: '缺少 urls' };
  if (urls.length > 10) return { success: false, notes: [], error: 'urls 条数超过 10，建议分批' };

  if (!bridge.isConnected()) {
    return { success: false, notes: [], error: 'Chrome Extension 未连接' };
  }

  onEvent('tool_progress', { message: `正在抓取 ${urls.length} 条${platform === 'xiaohongshu' ? '小红书' : platform}笔记正文…` });

  let resp;
  try {
    resp = await bridge.send('browser_read_notes', { platform, urls }, { timeoutMs: 120_000 });
  } catch (err) {
    const reason = /need_user_approval/i.test(err.message) ? 'need_user_approval'
      : /未连接|未认证/i.test(err.message) ? 'extension_disconnected'
      : /allowlist/i.test(err.message) ? 'host_not_allowed'
      : /超时/i.test(err.message) ? 'timeout'
      : 'error';
    return { success: false, notes: [], reason, error: err.message };
  }

  const notes = Array.isArray(resp?.notes) ? resp.notes : [];
  console.log('[browser_read_notes] ←', JSON.stringify({
    urls: urls.length,
    notes: notes.map(n => ({
      noteId: n.noteId,
      type: n.noteType,
      titleLen: (n.title||'').length,
      bodyLen: (n.body||'').length,
      imgs: (n.images||[]).length,
      err: n.error
    })),
    warning: resp?.warning
  }));
  if (notes.length === 0) return { success: false, notes: [], warning: resp?.warning || '全部抓取失败' };

  // 给每条笔记算一个 status，给 brain 明确的信号判断是"真失败"还是"没正文但有其他内容"
  const annotated = notes.map((n) => {
    const hasBody = !!(n.body && n.body.trim());
    const hasImages = Array.isArray(n.images) && n.images.length > 0;
    let status;
    let statusHint = '';
    if (n.error) {
      status = 'failed';
      statusHint = n.error;
    } else if (hasBody) {
      status = 'ok';
    } else if (n.noteType === 'video') {
      status = 'video_no_caption';
      statusHint = '视频笔记，作者未写正文；可参考视频封面和标题';
    } else if (hasImages) {
      status = 'image_only';
      statusHint = '图文笔记，正文无文字（关键信息多半写在图里，需要看 images）';
    } else {
      status = 'empty';
      statusHint = '正文为空，可能是反爬遮罩或纯媒体笔记';
    }
    return { ...n, status, statusHint };
  });

  if (!Array.isArray(session.researchStore)) session.researchStore = [];
  session.researchStore.push({
    query: `browser_read_notes:${platform}`,
    timestamp: Date.now(),
    results: annotated.map(n => ({
      title: n.title || '',
      url: n.url || '',
      snippet: (n.body || '').slice(0, 500) || n.statusHint || ''
    })),
    source: `browser:${platform}:detail`
  });

  // 把完整 note（含 images[] 全部 URL）按 url 缓存，供 analyze_note_images 用 note_url 查回来
  // 解决 brain 复制 200+ 字符长 URL 时频繁截断/臆造的老问题
  if (!session.noteCache || typeof session.noteCache !== 'object') session.noteCache = {};
  for (const n of annotated) {
    if (n.url) session.noteCache[n.url] = n;
  }

  // 发 artifact 让前端能在对话里看到笔记内容（标题、正文、图片网格）
  // 图片走 /api/xhs-image 代理，前端 <img> 直接加载就能渲染（绕过 xhs CDN Referer 反爬）
  onEvent('artifact', {
    artifactType: 'note_detail',
    payload: {
      source: `browser:${platform}`,
      count: annotated.length,
      notes: annotated.map((n) => ({
        title: n.title || '',
        url: n.url || '',
        body: n.body || '',
        tags: Array.isArray(n.tags) ? n.tags : [],
        noteType: n.noteType || 'unknown',
        status: n.status || 'unknown',
        statusHint: n.statusHint || '',
        images: Array.isArray(n.images) ? n.images.map(proxyXhsImageUrl) : [],
        videoPoster: n.videoPoster ? proxyXhsImageUrl(n.videoPoster) : ''
      }))
    }
  });

  const okCount = annotated.filter(n => n.status === 'ok').length;
  const videoCount = annotated.filter(n => n.status === 'video_no_caption').length;
  const imageOnlyCount = annotated.filter(n => n.status === 'image_only').length;
  const failedCount = annotated.filter(n => n.status === 'failed').length;
  const progressParts = [`${okCount}/${notes.length} 有正文`];
  if (videoCount) progressParts.push(`${videoCount} 视频`);
  if (imageOnlyCount) progressParts.push(`${imageOnlyCount} 纯图`);
  if (failedCount) progressParts.push(`${failedCount} 失败`);
  onEvent('tool_progress', { message: `已抓取 ${progressParts.join('，')}` });

  const summary = annotated.map((n, i) => {
    let body;
    if (n.status === 'ok') body = n.body.slice(0, 600);
    else if (n.status === 'video_no_caption') body = '(视频笔记，无作者正文；封面可用作视觉参考)';
    else if (n.status === 'image_only') body = '(图文笔记，正文无文字；关键信息可能在图里)';
    else if (n.status === 'failed') body = `(抓取失败：${n.statusHint || '未知'})`;
    else body = '(正文为空)';

    const tags = n.tags && n.tags.length ? `\n标签: ${n.tags.join(', ')}` : '';
    const imgs = n.images && n.images.length ? `\n图片(${n.images.length}): ${n.images.slice(0, 3).join('  ')}${n.images.length > 3 ? ' …' : ''}` : '';
    const poster = n.videoPoster ? `\n视频封面: ${n.videoPoster}` : '';
    const type = n.noteType && n.noteType !== 'unknown' ? `【${n.noteType === 'video' ? '视频' : '图文'}】` : '';
    return `[${i + 1}] ${type}${n.title || '(无标题)'}\n${body}${tags}${imgs}${poster}\n链接: ${n.url}`;
  }).join('\n\n');

  return {
    success: true,
    count: notes.length,
    okCount,
    videoCount,
    imageOnlyCount,
    failedCount,
    summary,
    notes: annotated
  };
}

async function execAnalyzeNoteImages(args, session, onEvent) {
  const noteUrl = String(args.note_url || '').trim();
  const rawIndexes = Array.isArray(args.image_indexes) ? args.image_indexes : null;
  const fallbackUrls = Array.isArray(args.image_urls) ? args.image_urls : [];
  const question = String(args.question || '').trim() || '请描述这张图片的主体、场景、文字、品牌、风格与氛围，200 字内。';
  let noteTitle = String(args.note_title || '').trim();

  // 优先 note_url：从 session.noteCache 取完整 images[]，brain 不用复制长 URL，避免臆造
  let imageUrls = [];
  if (noteUrl) {
    const cache = session.noteCache && typeof session.noteCache === 'object' ? session.noteCache : {};
    const cached = lookupNoteFromCache(cache, noteUrl);
    if (!cached) {
      return {
        success: false,
        error: `noteCache 里没有 ${noteUrl}（连 noteId 兜底也没查到），请先调用 browser_read_notes(urls=[该 URL])`,
        hint: '或者直接传 image_urls 参数（不推荐，brain 容易复制错长 URL）'
      };
    }
    if (!noteTitle && cached.title) noteTitle = cached.title;
    const allImgs = Array.isArray(cached.images) ? cached.images.slice() : [];
    if (cached.videoPoster && !allImgs.includes(cached.videoPoster)) allImgs.unshift(cached.videoPoster);
    imageUrls = rawIndexes
      ? rawIndexes.map((i) => allImgs[i]).filter(Boolean)
      : allImgs;
  } else if (fallbackUrls.length > 0) {
    imageUrls = fallbackUrls
      .map((u) => String(u || '').trim())
      .filter((u) => /^https?:\/\//.test(u));
  } else {
    return { success: false, error: '缺少 note_url（推荐）或 image_urls（兜底）' };
  }
  // 小红书一条笔记最多 9 张图
  imageUrls = imageUrls.slice(0, 9);

  if (imageUrls.length === 0) {
    return { success: false, error: '没有可分析的图片（noteCache 里这条笔记 images[] 为空）' };
  }
  if (!session.apiKeys?.minimaxApiKey) {
    return { success: false, error: '未配置 MINIMAX_API_KEY，视觉分析不可用' };
  }

  onEvent('tool_progress', { message: `正在读 ${imageUrls.length} 张笔记图片…（每张约 3-5 秒）` });

  const prompt = [
    '你是活动策划的视觉理解助手，这张图来自小红书笔记。',
    noteTitle ? `笔记标题：${noteTitle}` : '',
    `用户关心的问题：${question}`,
    '请用简洁中文回答，聚焦策划可用信息：视觉风格、场景/展陈/设计元素、可辨识的品牌/产品/活动名、图中文字（OCR）、氛围关键词。控制在 150-220 字。'
  ].filter(Boolean).join('\n');

  // 并发 3 张，降低整体等待但别把 VLM 服务打爆
  const results = new Array(imageUrls.length);
  const queue = imageUrls.map((url, idx) => ({ url, idx }));
  const worker = async () => {
    while (queue.length) {
      const job = queue.shift();
      if (!job) break;
      try {
        // understandImage 内部会按域名给 xhs CDN 自动加 Referer，不用我们再 prefetch
        const analysis = await understandImage(prompt, job.url, {
          minimaxApiKey: session.apiKeys.minimaxApiKey
        });
        results[job.idx] = { url: job.url, analysis };
      } catch (err) {
        results[job.idx] = { url: job.url, analysis: '', error: err.message };
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  const okCount = results.filter((r) => r.analysis).length;
  onEvent('tool_progress', { message: `图片分析完成 ${okCount}/${results.length}` });

  const summary = results.map((r, i) => r.analysis
    ? `[图${i + 1}] ${r.analysis}`
    : `[图${i + 1}] 分析失败：${r.error || '未知'}`
  ).join('\n\n');

  return {
    success: okCount > 0,
    count: results.length,
    okCount,
    summary,
    images: results
  };
}

module.exports = { execBrowserSearch, execBrowserReadPage, execBrowserReadNotes, execAnalyzeNoteImages };
