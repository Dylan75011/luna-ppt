// 把 skill 层的 onStatus({status, ...}) 桥接到 brainAgent 的 onEvent('tool_progress', ...)。
//
// 为什么要这一层：
// 1) 所有 skill（callLLMJson / callLLM / generatePlanDoc 等）都用 onStatus 通知
//    自己的进度类事件（streaming_heartbeat / blocking_wait_heartbeat / fallback_start /
//    repairing / retrying / beautifying 等）；
// 2) brainAgent 的 idle watchdog 看的是 onEvent('tool_progress', ...)；
// 3) 如果每个 tool 都自己写一个 switch，会有 6 个 tool 重复 5+ 个分支——容易遗漏
//    导致 idle 误判。统一在这里维护，所有 idle 类 tool 都用同一份 bridge。
//
// 用法（在 tool 实现里）：
//   const onStatus = makeSkillStatusBridge(onEvent, { skillLabel: '梳理方向' });
//   await someSkill({ ..., onStatus });

/**
 * @param {Function} onEvent  brainAgent 传给 tool 的 onEvent(type, data)
 * @param {object} opts
 *   skillLabel: 用于消息文案，比如 '梳理方向' / '生成方案' / '评审' 等
 *   onCustom:   自定义状态处理器 (status, payload) => boolean
 *               返回 true 表示已处理（bridge 不再走默认路径）
 *   onPartial:  partial 渲染钩子 (accumulatedText, payload) => void
 *               每次 streaming_heartbeat 触发时调用，accumulatedText 是当前累计的 LLM 原文，
 *               用于做 partial JSON 解析、emit 流式预览 artifact。
 *               异常会被 catch 吞掉，不影响心跳本身。
 * @returns {(payload: object) => void}
 */
function makeSkillStatusBridge(onEvent, opts = {}) {
  const { skillLabel = '处理', onCustom = null, onPartial = null } = opts;

  return function handleStatus(payload = {}) {
    const status = payload.status || '';
    if (typeof onCustom === 'function') {
      try { if (onCustom(status, payload)) return; } catch {}
    }

    switch (status) {
      // 流式 / 阻塞调用层的"还活着"信号 —— 关键：让 brainAgent idle watchdog 刷新
      case 'streaming_heartbeat': {
        const chars = payload.chars || 0;
        onEvent('tool_progress', { message: `${skillLabel}中（${chars} 字）...` });
        if (typeof onPartial === 'function' && payload.text) {
          try { onPartial(payload.text, payload); } catch {}
        }
        break;
      }
      case 'blocking_wait_heartbeat': {
        const attempt = payload.attempt > 1 ? `（第 ${payload.attempt} 次尝试）` : '';
        onEvent('tool_progress', { message: `${skillLabel}中，等待模型响应${attempt}...` });
        break;
      }

      // 重试 / 修复 / 兜底 —— 这些路径 caller 也想看到，给一致的反馈
      case 'retrying': {
        const attempt = payload.attempt || payload.previousAttempt || '?';
        onEvent('tool_progress', { message: `${skillLabel}失败，第 ${attempt} 次重试...` });
        break;
      }
      case 'repairing':
        onEvent('tool_progress', { message: `${skillLabel}的输出格式异常，正在修复...` });
        break;
      case 'fallback_start':
        onEvent('tool_progress', { message: `${skillLabel}稍慢，切换为稳态兜底方案...` });
        break;
      case 'fallback_failed':
        onEvent('tool_progress', { message: `${skillLabel}的兜底也失败，请稍后再试...` });
        break;
      case 'beautifying':
        onEvent('tool_progress', { message: '主体内容已完成，正在润色排版...' });
        break;

      // requesting / received / validating / parse_failed 通常太频繁/不重要，
      // 不主动推 tool_progress（避免噪音）；上层 caller 想要可以走 onCustom 自取
      default:
        break;
    }
  };
}

module.exports = { makeSkillStatusBridge };
