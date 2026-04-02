// 消息分组逻辑 - 参考 deer-flow 设计

export const MessageGroupTypes = {
  USER: 'user',
  AI_FINAL: 'ai:final',
  AI_NARRATION: 'ai:narration',
  AI_TOOL_CALL: 'ai:tool-call',
  AI_THINKING: 'ai:thinking',
  AI_CLARIFICATION: 'ai:clarification',
  TASK_CARD: 'task:card',
  TASK_LOG_GROUP: 'task:log-group'
}

export function groupMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return []
  }

  const groups = []
  let currentGroup = null

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (currentGroup) groups.push(currentGroup)
      currentGroup = {
        type: MessageGroupTypes.USER,
        id: msg.id,
        messages: [msg]
      }
      continue
    }

    if (msg.role === 'ai') {
      const kind = msg.kind || 'narration'
      
      if (kind === 'task-card') {
        if (currentGroup) groups.push(currentGroup)
        currentGroup = {
          type: MessageGroupTypes.TASK_CARD,
          id: msg.id,
          messages: [msg],
          taskState: msg.taskState
        }
        continue
      }

      if (kind === 'task-log-group') {
        if (currentGroup) groups.push(currentGroup)
        currentGroup = {
          type: MessageGroupTypes.TASK_LOG_GROUP,
          id: msg.id,
          messages: [msg],
          group: msg.group
        }
        continue
      }

      if (kind === 'clarification') {
        if (currentGroup) groups.push(currentGroup)
        currentGroup = {
          type: MessageGroupTypes.AI_CLARIFICATION,
          id: msg.id,
          messages: [msg]
        }
        continue
      }

      if (kind === 'thinking') {
        if (currentGroup && currentGroup.type === MessageGroupTypes.AI_THINKING) {
          currentGroup.messages.push(msg)
        } else {
          if (currentGroup) groups.push(currentGroup)
          currentGroup = {
            type: MessageGroupTypes.AI_THINKING,
            id: msg.id,
            messages: [msg]
          }
        }
        continue
      }

      if (kind === 'tool-call') {
        if (currentGroup && currentGroup.type === MessageGroupTypes.AI_TOOL_CALL) {
          currentGroup.messages.push(msg)
        } else {
          if (currentGroup) groups.push(currentGroup)
          currentGroup = {
            type: MessageGroupTypes.AI_TOOL_CALL,
            id: msg.id,
            messages: [msg]
          }
        }
        continue
      }

      if (kind === 'narration' || !kind) {
        if (currentGroup) groups.push(currentGroup)
        currentGroup = {
          type: MessageGroupTypes.AI_NARRATION,
          id: msg.id,
          messages: [msg]
        }
        continue
      }

      if (currentGroup) groups.push(currentGroup)
      currentGroup = {
        type: MessageGroupTypes.AI_FINAL,
        id: msg.id,
        messages: [msg]
      }
    }
  }

  if (currentGroup) groups.push(currentGroup)

  return groups
}

export function shouldCollapseGroup(group, index, totalGroups) {
  if (!group || !group.messages || group.messages.length === 0) {
    return false
  }

  if (group.type === MessageGroupTypes.AI_THINKING) {
    return index < totalGroups - 2
  }

  if (group.type === MessageGroupTypes.AI_TOOL_CALL) {
    return group.messages.length > 3
  }

  return false
}

export function filterRedundantMessages(messages) {
  if (!Array.isArray(messages)) return []

  const filtered = []
  let lastThinkingTime = 0
  const THINKING_THROTTLE = 2000

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]

    if (msg.kind === 'thinking') {
      const now = Date.now()
      if (now - lastThinkingTime < THINKING_THROTTLE) {
        continue
      }
      lastThinkingTime = now
    }

    if (msg.kind === 'task-log-group' && msg.group?.logs) {
      const logs = msg.group.logs
      if (logs.length > 5) {
        msg.group = {
          ...msg.group,
          logs: logs.slice(0, 5),
          hasMore: logs.length - 5
        }
      }
    }

    filtered.push(msg)
  }

  return filtered
}

export function getVisibleToolSteps(toolCallMessages, maxVisible = 3) {
  if (!Array.isArray(toolCallMessages) || toolCallMessages.length === 0) {
    return { visible: [], collapsed: [] }
  }

  const sorted = [...toolCallMessages].reverse()
  const visible = sorted.slice(0, maxVisible)
  const collapsed = sorted.slice(maxVisible)

  return { visible, collapsed }
}
