<template>
  <div
    ref="layoutRef"
    class="chat-layout"
    :class="{ 'preview-open': previewVisible && !previewCollapsed, resizing: isResizing }"
    :style="{ '--preview-width': `${previewWidth}px`, '--conversation-width': `${conversationSidebarCollapsed ? 0 : 280}px` }"
  >
    <aside class="chat-conversation-sidebar" :class="{ collapsed: conversationSidebarCollapsed }">
      <div class="conversation-sidebar-head">
        <template v-if="!conversationSidebarCollapsed">
          <div class="conversation-sidebar-copy">
            <div class="conversation-sidebar-space-row">
              <span class="conversation-sidebar-space-label">当前空间</span>
              <a-select
                v-model="selectedSpaceId"
                size="small"
                class="conversation-sidebar-head-select"
                placeholder="选择工作空间"
              >
                <a-option v-for="s in spaces" :key="s.id" :value="s.id">{{ s.name }}</a-option>
              </a-select>
            </div>
          </div>
          <button
            type="button"
            class="conversation-create-btn"
            title="新建对话"
            @click="createNewConversation"
          >
            <PhPlus weight="bold" />
          </button>
        </template>
      </div>

      <div class="conversation-sidebar-body">
        <template v-if="!conversationSidebarCollapsed">
          <div class="conversation-sidebar-body-title">历史对话</div>

          <div v-if="conversations.length" class="conversation-sidebar-section">
            <a-input
              v-model="conversationSearch"
              size="small"
              allow-clear
              class="conversation-search"
              placeholder="搜索历史对话"
            >
              <template #prefix>
                <PhMagnifyingGlass />
              </template>
            </a-input>
          </div>

          <div v-if="conversations.length" class="conversation-sidebar-list">
            <div v-for="group in groupedConversations" :key="group.key" class="conversation-group">
              <div class="conversation-group-title">{{ group.title }}</div>
              <div class="conversation-group-stack">
                <button
                  v-for="item in group.items"
                  :key="item.id"
                  type="button"
                  class="conversation-pill"
                  :class="{ active: item.id === activeConversationId }"
                  @click="onConversationChange(item.id)"
                >
                  <span class="conversation-pill-copy">
                    <span class="conversation-pill-title">{{ item.title }}</span>
                    <span class="conversation-pill-meta">{{ formatConversationMeta(item) }}</span>
                  </span>
                  <a-dropdown trigger="click" @select="(key) => onConversationAction(key, item)">
                    <span class="conversation-pill-more" @click.stop>•••</span>
                    <template #content>
                      <a-doption value="rename">重命名</a-doption>
                      <a-doption value="delete" class="danger-option">删除</a-doption>
                    </template>
                  </a-dropdown>
                </button>
              </div>
            </div>
          </div>
          <div v-else class="conversation-list-empty">
            <div class="conversation-list-empty-title">暂无对话</div>
            <div class="conversation-list-empty-desc">新建后，后续策划过程会自动按当前空间保存。</div>
          </div>
        </template>

      </div>
    </aside>
    <button
      type="button"
      class="conversation-sidebar-rail-toggle"
      :class="{ collapsed: conversationSidebarCollapsed }"
      @click="conversationSidebarCollapsed = !conversationSidebarCollapsed"
      :title="conversationSidebarCollapsed ? '展开历史对话' : '收起历史对话'"
    >
      {{ conversationSidebarCollapsed ? '›' : '‹' }}
    </button>

    <!-- ── 左侧：聊天面板 ── -->
    <div class="chat-panel">
      <!-- 消息历史 -->
      <div class="chat-history" ref="historyRef" @click="onChatHistoryClick">
        <!-- 按时间顺序渲染所有消息 -->
        <div v-for="msg in displayMessages" :key="msg.id" class="bubble-wrap" :class="msg.role">
          
          <!-- 用户消息 -->
          <template v-if="msg.role === 'user'">
            <div class="bubble user" :class="{ 'bubble--not-sent': msg.notSent }">
              <span v-if="msg.notSent" class="bubble-not-sent-tag">未发送</span>
              <div v-if="msg.text">{{ msg.text }}</div>
              <div v-if="msg.attachments?.length" class="chat-image-grid">
                <a
                  v-for="item in msg.attachments"
                  :key="item.id || item.url || item.name"
                  class="chat-image-card"
                  :href="item.url"
                  target="_blank"
                  rel="noreferrer"
                >
                  <img :src="item.url" :alt="item.name || '用户图片'" class="chat-image-thumb" />
                  <span class="chat-image-name">{{ item.name || '图片' }}</span>
                </a>
              </div>
            </div>
          </template>
          
          <!-- AI消息 -->
          <template v-else>
            
            <!-- 思考过程 - 折叠显示 -->
            <template v-if="msg.kind === 'thinking'">
              <div class="thinking-bubble">
                <span class="thinking-dot" /><span class="thinking-dot" /><span class="thinking-dot" />
                <span v-if="msg.label" class="thinking-label">{{ msg.label }}</span>
              </div>
            </template>
            
            <!-- 工具调用 -->
            <template v-else-if="msg.kind === 'tool-call'">
              <div class="tool-call-card" :class="{ active: msg.progress }">
                <div class="tool-call-card-head">
                  <span class="tool-call-card-icon" :class="toolIconTone(msg.tool)">
                    <component :is="toolIcon(msg.tool)" />
                  </span>
                  <div class="tool-call-card-content">
                    <div class="tool-call-card-title">{{ msg.display }}</div>
                    <div v-if="msg.progress" class="tool-call-card-progress">{{ msg.progress }}</div>
                  </div>
                </div>
                <div v-if="msg.resultSummary" class="tool-call-card-result">
                  <div class="tool-call-card-result-summary">{{ msg.resultSummary }}</div>
                  <button
                    v-if="msg.resultDetails"
                    type="button"
                    class="tool-call-card-toggle"
                    @click="msg.expanded = !msg.expanded"
                  >
                    {{ msg.expanded ? '收起' : '查看详情' }}
                  </button>
                  <pre v-if="msg.expanded && msg.resultDetails" class="tool-call-card-details">{{ msg.resultDetails }}</pre>
                </div>
              </div>
            </template>
            
            <!-- 澄清问题 -->
            <template v-else-if="msg.kind === 'clarification'">
              <div class="clarification-card">
                <div class="clarification-icon">💬</div>
                <div class="clarification-copy">
                  <div v-if="msg.header" class="clarification-header">{{ msg.header }}</div>
                  <div class="clarification-question">{{ msg.question }}</div>
                </div>
              </div>
            </template>

            <!-- 任务理解卡片（对话内嵌，不进右侧面板）-->
            <template v-else-if="msg.kind === 'brief-card'">
              <div class="brief-card">
                <div class="brief-card-head">
                  <span class="brief-card-kicker">任务理解</span>
                  <span v-if="msg.payload?.brand" class="brief-card-brand">{{ msg.payload.brand }}</span>
                </div>
                <div v-if="msg.payload?.parsedGoal || msg.payload?.goal" class="brief-card-block">
                  <div class="brief-card-label">任务目标</div>
                  <div class="brief-card-text">{{ msg.payload.parsedGoal || msg.payload.goal }}</div>
                </div>
                <div v-if="msg.payload?.audience" class="brief-card-block brief-card-block--inline">
                  <span class="brief-card-label-inline">目标受众</span>
                  <span class="brief-card-text-inline">{{ msg.payload.audience }}</span>
                </div>
                <div v-if="msg.payload?.keyThemes?.length" class="brief-card-block">
                  <div class="brief-card-label">关键主题</div>
                  <div class="brief-card-chips">
                    <span v-for="t in msg.payload.keyThemes" :key="t" class="brief-card-chip">{{ t }}</span>
                  </div>
                </div>
                <div v-if="msg.payload?.assumptions?.length" class="brief-card-block">
                  <div class="brief-card-label">假设</div>
                  <ul class="brief-card-list">
                    <li v-for="(a, i) in msg.payload.assumptions" :key="i">{{ a }}</li>
                  </ul>
                </div>
              </div>
            </template>

            <!-- 创意方向卡片（对话内嵌，不进右侧面板）-->
            <template v-else-if="msg.kind === 'concept-card'">
              <div class="concept-card" :class="{ 'concept-card--degraded': msg.payload?.degraded }">
                <div class="concept-card-head">
                  <span class="concept-card-version">
                    创意方向对比 · 第 {{ msg.payload?.iteration || 1 }} 版
                  </span>
                  <span v-if="msg.payload?.differentiationAxis" class="concept-card-axis">{{ msg.payload.differentiationAxis }}</span>
                  <span v-if="msg.payload?.sharedContext" class="concept-card-shared">{{ msg.payload.sharedContext }}</span>
                </div>

                <div v-if="(msg.payload?.directions || []).length" class="concept-card-tabs">
                  <button
                    v-for="(d, i) in msg.payload.directions"
                    :key="d.label || i"
                    type="button"
                    class="concept-card-tab"
                    :class="{ 'concept-card-tab--active': getConceptActiveIndex(msg) === i }"
                    @click.stop="setConceptActiveIndex(msg, i)"
                  >
                    <span class="concept-card-tab-label">{{ d.label || String.fromCharCode(65 + i) }}</span>
                    <span class="concept-card-tab-name">{{ d.codeName || d.themeName || '—' }}</span>
                  </button>
                </div>

                <template v-if="msg.payload?.directions?.[getConceptActiveIndex(msg)]">
                  <div class="concept-card-direction" @click="openConceptDetail(msg.payload, getConceptActiveIndex(msg))">
                    <div class="concept-card-theme-row">
                      <span class="concept-card-theme">{{ msg.payload.directions[getConceptActiveIndex(msg)].themeName || '待定主题' }}</span>
                      <span v-if="msg.payload.directions[getConceptActiveIndex(msg)].positioning" class="concept-card-positioning">
                        {{ msg.payload.directions[getConceptActiveIndex(msg)].positioning }}
                      </span>
                    </div>
                    <div class="concept-card-trio">
                      <div v-if="msg.payload.directions[getConceptActiveIndex(msg)].upside" class="concept-card-trio-cell concept-card-trio-cell--up">
                        <div class="concept-card-trio-label">收益</div>
                        <div class="concept-card-trio-text">{{ msg.payload.directions[getConceptActiveIndex(msg)].upside }}</div>
                      </div>
                      <div v-if="msg.payload.directions[getConceptActiveIndex(msg)].risk" class="concept-card-trio-cell concept-card-trio-cell--risk">
                        <div class="concept-card-trio-label">风险</div>
                        <div class="concept-card-trio-text">{{ msg.payload.directions[getConceptActiveIndex(msg)].risk }}</div>
                      </div>
                      <div v-if="msg.payload.directions[getConceptActiveIndex(msg)].bestFor" class="concept-card-trio-cell concept-card-trio-cell--fit">
                        <div class="concept-card-trio-label">适用</div>
                        <div class="concept-card-trio-text">{{ msg.payload.directions[getConceptActiveIndex(msg)].bestFor }}</div>
                      </div>
                    </div>
                  </div>
                </template>

                <div v-if="msg.payload?.recommendation" class="concept-card-recommendation">
                  <span class="concept-card-rec-label">我的倾向</span>
                  <span class="concept-card-rec-text">{{ msg.payload.recommendation }}</span>
                </div>
                <div v-if="msg.payload?.degraded" class="concept-card-degraded-note">
                  （当前为兜底版本，建议补充信息后重新梳理）
                </div>
                <div class="concept-card-footer">
                  <span class="concept-card-cta" @click.stop="openConceptDetail(msg.payload, getConceptActiveIndex(msg))">点击查看完整详情 →</span>
                </div>
              </div>
            </template>

            <!-- brief 质疑卡片（Agent 主动提出的硬伤/红旗）-->
            <template v-else-if="msg.kind === 'challenge-card'">
              <div class="challenge-card" :class="{ 'challenge-card--clean': !msg.payload?.hasConcerns }">
                <div class="challenge-card-head">
                  <span class="challenge-card-kicker">{{ msg.payload?.hasConcerns ? '⚠️ Brief 审视 · 发现潜在硬伤' : '✓ Brief 审视 · 没有明显红旗' }}</span>
                  <span v-if="msg.payload?.overallAssessment" class="challenge-card-assessment">{{ msg.payload.overallAssessment }}</span>
                </div>
                <div v-if="msg.payload?.concerns?.length" class="challenge-card-list">
                  <div
                    v-for="(c, i) in msg.payload.concerns"
                    :key="i"
                    class="challenge-card-concern"
                    :class="`challenge-card-concern--${c.severity || 'medium'}`"
                  >
                    <div class="challenge-card-concern-head">
                      <span class="challenge-card-concern-sev">{{ severityLabel(c.severity) }}</span>
                      <span v-if="c.axis" class="challenge-card-concern-axis">{{ c.axis }}</span>
                    </div>
                    <div class="challenge-card-concern-issue">{{ c.issue }}</div>
                    <div v-if="c.why" class="challenge-card-concern-why">{{ c.why }}</div>
                    <div v-if="c.resolution" class="challenge-card-concern-resolution">
                      <span class="challenge-card-concern-resolution-label">建议</span>
                      <span>{{ c.resolution }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <!-- 产出物卡片 -->
            <template v-else-if="msg.kind === 'artifact-card'">
              <div class="artifact-msg-card" :class="[`artifact-msg-card--${msg.artifactType}`, { 'artifact-msg-card--active': selectedArtifactId === msg.artifactId }]" @click.stop="selectArtifact(msg)">
                <div class="artifact-msg-card-head">
                  <span class="artifact-msg-card-icon-wrap">
                    <component :is="artifactMsgIcon(msg.artifactType)" class="artifact-msg-card-icon" />
                  </span>
                  <div class="artifact-msg-card-copy">
                    <span class="artifact-msg-card-kicker">{{ artifactTypeLabel(msg.artifactType) }}</span>
                    <span class="artifact-msg-card-title">{{ msg.title }}</span>
                  </div>
                </div>
                <div v-if="msg.summary" class="artifact-msg-card-summary">{{ msg.summary }}</div>
                <div v-if="msg.chips?.length" class="artifact-msg-card-chips">
                  <span v-for="chip in msg.chips" :key="chip" class="artifact-msg-chip">{{ chip }}</span>
                </div>
                <div class="artifact-msg-card-footer">
                  <span class="artifact-msg-card-view-btn">在右侧查看</span>
                </div>
              </div>
            </template>

            <template v-else-if="msg.kind === 'task-log'">
              <div class="task-log">
                <span class="task-log-time">{{ msg.time || formatLogTime(msg.timestamp || Date.now()) }}</span>
                <span class="task-log-text">{{ msg.text }}</span>
              </div>
            </template>

            <template v-else-if="msg.kind === 'error-retry'">
              <div class="error-retry-card">
                <div class="error-retry-message">{{ msg.errorMessage }}</div>
                <button
                  type="button"
                  class="error-retry-btn"
                  :disabled="msg.retryUsed || isRunning"
                  @click="onRetryFailedTurn(msg)"
                >
                  {{ msg.retryUsed ? '已重试' : '🔄 重试上一轮' }}
                </button>
              </div>
            </template>

            <template v-else-if="msg.kind === 'process-summary'">
              <div class="process-summary-bubble">
                <button
                  type="button"
                  class="process-summary-head"
                  :class="{ expanded: !isProcessSummaryCollapsed(msg.summaryId, msg.collapsedByDefault) }"
                  @click="toggleProcessSummary(msg.summaryId)"
                >
                  <span class="process-summary-label">{{ msg.title }}</span>
                  <span class="process-summary-chevron" aria-hidden="true">›</span>
                </button>
                <div v-if="!isProcessSummaryCollapsed(msg.summaryId, msg.collapsedByDefault)" class="process-summary-list">
                  <div v-for="item in msg.logs" :key="item.id" class="process-summary-item">
                    <span class="process-summary-time">{{ item.time }}</span>
                    <span class="process-summary-text">{{ item.text }}</span>
                  </div>
                </div>
              </div>
            </template>

            <!-- 普通AI消息 -->
            <template v-else>
              <div class="ai-message-card" v-html="msg.html" />
            </template>
            
          </template>
        </div>
      </div>

      <!-- 输入区 -->
      <div class="chat-input-area">
        <div class="input-card-outer">
          <div v-if="quickReplyOptions.length" class="quick-reply-bar">
            <div class="quick-reply-label">{{ quickReplyLabel }}</div>
            <div v-if="quickReplyQuestion" class="quick-reply-question">{{ quickReplyQuestion }}</div>
            <div class="quick-reply-helper">选一项继续，或直接在下方输入你自己的要求。</div>
            <div class="quick-reply-list" role="listbox" :aria-label="quickReplyLabel || '下一步选择'">
              <button
                v-for="item in quickReplyOptions"
                :key="item.label"
                type="button"
                class="quick-reply-item"
                :disabled="isRunning"
                @click="sendQuickReply(item)"
              >
                <span class="quick-reply-item-title">{{ item.label }}</span>
                <span v-if="item.description" class="quick-reply-item-desc">{{ item.description }}</span>
              </button>
            </div>
          </div>

          <!-- @ 内联菜单 -->
          <div v-if="atMentionVisible && atMentionResults.length" class="at-mention-dropdown">
            <div
              v-for="(doc, i) in atMentionResults"
              :key="doc.id"
              class="at-mention-item"
              :class="{ active: i === atMentionIndex }"
              @mousedown.prevent="selectMention(doc)"
            >
              <PhFilePdf v-if="doc.docType === 'ppt'" class="at-mention-icon" />
              <PhFileText v-else class="at-mention-icon" />
              <div class="at-mention-info">
                <span class="at-mention-name">{{ doc.name }}</span>
                <span v-if="doc._folder" class="at-mention-folder">{{ doc._folder }}</span>
              </div>
            </div>
          </div>

          <!-- 工具直达 picker 下拉（挂在 input-card-outer 上，避免被 input-card 盖住） -->
          <div v-if="toolPickerVisible" class="tool-picker-dropdown">
            <div class="tool-picker-head">直接选择工具</div>
            <div class="tool-picker-list">
              <div
                v-for="mode in TOOL_MODES"
                :key="mode.key"
                class="tool-picker-item"
                :class="{ selected: activeToolMode?.key === mode.key }"
                @click="pickToolMode(mode)"
              >
                <span class="tool-picker-icon">
                  <PhImage v-if="mode.icon === 'image'" />
                  <PhSquaresFour v-else-if="mode.icon === 'layout'" />
                  <PhMagnifyingGlass v-else-if="mode.icon === 'search'" />
                  <PhLightbulb v-else />
                </span>
                <div class="tool-picker-meta">
                  <div class="tool-picker-label">{{ mode.label }}</div>
                  <div class="tool-picker-hint">{{ mode.hint }}</div>
                </div>
                <span v-if="activeToolMode?.key === mode.key" class="tool-picker-check">✓</span>
              </div>
            </div>
          </div>

          <!-- 空间文档 picker 下拉 -->
          <div v-if="workspacePickerVisible" class="ws-picker-dropdown">
            <div class="ws-picker-head">
              <input
                v-model="workspacePickerQuery"
                class="ws-picker-search"
                placeholder="搜索文档..."
                @keydown.stop
              />
              <span class="ws-picker-hint">点击引用 · 再次点击取消</span>
            </div>
            <div class="ws-picker-list">
              <div v-if="!workspacePickerGroups.length" class="ws-picker-empty">无匹配文档</div>
              <template v-for="group in workspacePickerGroups" :key="group.folder || '__root__'">
                <div v-if="group.folder" class="ws-picker-folder-header">
                  <PhFolder class="ws-picker-folder-icon" />
                  <span>{{ group.folder }}</span>
                </div>
                <div
                  v-for="doc in group.docs"
                  :key="doc.id"
                  class="ws-picker-item"
                  :class="{ selected: pendingWorkspaceRefs.some(r => r.id === doc.id), 'ws-picker-item--indented': !!group.folder }"
                  @click="pendingWorkspaceRefs.some(r => r.id === doc.id) ? removeWorkspaceRef(doc.id) : addWorkspaceRef(doc)"
                >
                  <PhFilePdf v-if="doc.docType === 'ppt'" class="ws-picker-icon" />
                  <PhFileText v-else class="ws-picker-icon" />
                  <span class="ws-picker-name">{{ doc.name }}</span>
                  <span v-if="pendingWorkspaceRefs.some(r => r.id === doc.id)" class="ws-picker-check">✓</span>
                </div>
              </template>
            </div>
          </div>

          <div class="input-card" :class="{ focused: inputFocused }">
          <!-- 工具直达模式 pill -->
          <div v-if="activeToolMode" class="tool-mode-pill">
            <span class="tool-mode-pill-dot" />
            <span class="tool-mode-pill-label">{{ activeToolMode.label }}</span>
            <span class="tool-mode-pill-hint">· {{ activeToolMode.hint }}</span>
            <button type="button" class="tool-mode-pill-remove" title="取消工具模式" @click="clearToolMode">
              <PhX weight="bold" />
            </button>
          </div>

          <input
            ref="imageInputRef"
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            multiple
            class="chat-image-input"
            @change="onFileInputChange"
          />

          <div v-if="pendingImages.length" class="pending-image-grid">
            <div v-for="item in pendingImages" :key="item.id" class="pending-image-card">
              <img :src="item.previewUrl" :alt="item.name" class="pending-image-thumb" />
              <div class="pending-image-meta">
                <div class="pending-image-name">{{ item.name }}</div>
                <div class="pending-image-size">{{ formatFileSize(item.size) }}</div>
              </div>
              <button type="button" class="pending-image-remove" @click="removePendingImage(item.id)">×</button>
            </div>
          </div>

          <div v-if="pendingDocs.length" class="pending-doc-list">
            <div v-for="item in pendingDocs" :key="item.id" class="pending-doc-chip">
              <PhFilePdf v-if="item.mimeType === 'application/pdf'" class="pending-doc-icon" />
              <PhFileText v-else class="pending-doc-icon" />
              <div class="pending-doc-meta">
                <div class="pending-doc-name">{{ item.name }}</div>
                <div class="pending-doc-size">{{ formatFileSize(item.size) }}</div>
              </div>
              <button type="button" class="pending-image-remove" @click="removePendingDoc(item.id)">×</button>
            </div>
          </div>

          <!-- 空间文档引用 chips -->
          <div v-if="pendingWorkspaceRefs.length" class="pending-ws-refs">
            <div v-for="ref in pendingWorkspaceRefs" :key="ref.id" class="pending-ws-ref-chip">
              <PhFilePdf v-if="ref.docType === 'ppt'" class="ws-ref-chip-icon" />
              <PhFileText v-else class="ws-ref-chip-icon" />
              <span class="ws-ref-chip-name">{{ ref.name }}</span>
              <button type="button" class="ws-ref-chip-remove" @click="removeWorkspaceRef(ref.id)">×</button>
            </div>
          </div>

          <!-- 文本输入 -->
          <a-textarea
            ref="textareaRef"
            v-model="inputText"
            class="chat-textarea"
            :auto-size="{ minRows: 2, maxRows: 6 }"
            :placeholder="waitingForClarification ? '请回答上述问题...' : '描述需求、上传策划方案文档，或输入 @ 引用空间文档...'"
            @focus="inputFocused = true"
            @blur="inputFocused = false; atMentionVisible = false"
            @compositionstart="isComposing = true"
            @compositionend="isComposing = false"
            @keydown.enter.exact="handleEnter"
            @keydown="handleTextareaKeydown"
            @input="onTextareaInput"
            @paste="onPaste"
          />

          <!-- 工具栏 -->
          <div class="input-toolbar">
            <!-- 工具直达（"+"按钮） -->
            <div v-if="!showStopButton" class="tool-picker-wrap">
              <button
                type="button"
                class="attach-btn tool-picker-btn"
                :class="{ active: toolPickerVisible || activeToolMode }"
                :disabled="isRunning"
                title="直接选择工具（跳过自动流程）"
                @click="toggleToolPicker"
              >
                <PhPlus weight="bold" />
              </button>
            </div>

            <!-- 从空间引用按钮 + picker -->
            <div v-if="!showStopButton" class="ws-picker-wrap">
              <button
                type="button"
                class="attach-btn"
                :class="{ active: workspacePickerVisible || pendingWorkspaceRefs.length }"
                :disabled="isRunning || !spaceDocsFlat.length"
                :title="spaceDocsFlat.length ? '引用空间文档' : '当前空间暂无文档'"
                @click="toggleWorkspacePicker"
              >
                <PhStackSimple weight="bold" />
              </button>
              <!-- 引用数 badge -->
              <span v-if="pendingWorkspaceRefs.length" class="ws-picker-badge">{{ pendingWorkspaceRefs.length }}</span>
            </div>

            <button
              v-if="!showStopButton"
              type="button"
              class="attach-btn"
              :disabled="isRunning"
              @click="triggerImagePicker"
            >
              <PhPaperclip weight="bold" />
            </button>

            <!-- 终止按钮（任务运行中显示） -->
            <button
              v-if="showStopButton"
              type="button"
              class="stop-btn"
              @click="stopTask"
            >
              <PhStop weight="fill" />
            </button>

            <!-- 发送按钮 -->
            <button
              v-else
              type="button"
              class="send-btn"
              :class="{ 'send-btn--active': inputText.trim() || pendingImages.length || pendingDocs.length }"
              :disabled="!inputText.trim() && !pendingImages.length && !pendingDocs.length"
              @click="send"
            >
              <PhArrowUp weight="bold" />
            </button>
          </div>
          </div><!-- /input-card -->
        </div><!-- /input-card-outer -->
      </div><!-- /chat-input-area -->
    </div>

    <div
      v-if="previewVisible"
      class="panel-resizer"
      :class="{ 'panel-resizer--collapsed': previewCollapsed }"
      @mousedown.prevent="!previewCollapsed && startResize($event)"
    >
      <div class="panel-resizer-line" />
      <button
        type="button"
        class="panel-resizer-toggle"
        :title="previewCollapsed ? '展开预览区' : '收起预览区'"
        @mousedown.stop
        @click.stop="previewCollapsed = !previewCollapsed"
      >{{ previewCollapsed ? '‹' : '›' }}</button>
    </div>

    <!-- ── 右侧：单一产出物面板 ── -->
    <div v-if="previewVisible && !previewCollapsed" class="ws-workspace">

      <!-- PPT 幻灯片（优先级最高，直接铺满） -->
      <template v-if="displayedArtifact?.artifactType === 'ppt_slides'">
        <div class="artifact-pane artifact-pane--ppt">
          <SlideViewer
            ref="slideViewerRef"
            :slides="resultSlides"
            :current-index="currentSlideIndex"
            :download-url="resultDownloadUrl"
            :show-save="wsState === 'done'"
            :is-building="isBuilding"
            :build-total="buildTotal"
            @update:current-index="onSlideIndexChange"
            @save="showSaveDialog"
            @open-editor="editorVisible = true"
          />
        </div>
      </template>

      <template v-else-if="showPlanDocumentPanel">
        <div class="ws-document">
          <PlanDocumentPanel
            :content="docContent"
            :title="docTitle || displayedArtifact?.title || '策划方案'"
            :spaces="spaces"
            :loading="isRunning || isDocStreaming"
            @review="onReviewRequest"
          />
        </div>
      </template>

      <!-- 具体产出物 -->
      <template v-else-if="displayedArtifact">
        <div class="artifact-pane">
          <!-- 面板头 -->
          <div class="artifact-pane-header">
            <div class="artifact-pane-title-row">
              <span class="artifact-pane-icon-wrap">
                <component :is="artifactMsgIcon(displayedArtifact.artifactType)" class="artifact-pane-icon" />
              </span>
              <div class="artifact-pane-title-stack">
                <span class="artifact-pane-kicker">{{ artifactTypeLabel(displayedArtifact.artifactType) }}</span>
                <span class="artifact-pane-title">{{ displayedArtifact.title || artifactTypeLabel(displayedArtifact.artifactType) }}</span>
              </div>
            </div>
            <div class="artifact-pane-actions">
              <button v-if="displayedArtifact.artifactType === 'research_result'" type="button" class="pane-action-btn" @click="openSaveResearch">保存</button>
            </div>
          </div>

          <!-- 面板内容 -->
          <div class="artifact-pane-body">
            <!-- task_brief -->
            <template v-if="displayedArtifact.artifactType === 'task_brief'">
              <div class="pane-section">
                <div class="pane-label">任务目标</div>
                <div class="pane-text">{{ displayedArtifact.payload?.parsedGoal || displayedArtifact.payload?.goal || '—' }}</div>
              </div>
              <div v-if="displayedArtifact.payload?.keyThemes?.length" class="pane-section">
                <div class="pane-label">关键主题</div>
                <div class="pane-chips">
                  <span v-for="t in displayedArtifact.payload.keyThemes" :key="t" class="pane-chip">{{ t }}</span>
                </div>
              </div>
            </template>

            <!-- research_result -->
            <template v-else-if="displayedArtifact.artifactType === 'research_result'">
              <div class="research-pane-head">
                <div class="research-pane-query">{{ displayedArtifact.payload?.focus || '—' }}</div>
                <div class="research-pane-meta">
                  <span v-if="displayedArtifact.payload?.count">共 {{ displayedArtifact.payload.count }} 条结果</span>
                  <span v-if="displayedArtifact.payload?.source" class="research-pane-source">{{ displayedArtifact.payload.source }}</span>
                </div>
              </div>
              <ol v-if="displayedArtifact.payload?.results?.length" class="research-pane-list">
                <li v-for="(r, i) in displayedArtifact.payload.results" :key="i" class="research-pane-item">
                  <div class="research-pane-item-head">
                    <span class="research-pane-index">{{ i + 1 }}</span>
                    <a v-if="r.url" :href="r.url" target="_blank" rel="noopener" class="research-pane-title">{{ r.title || r.url }}</a>
                    <span v-else class="research-pane-title">{{ r.title || '—' }}</span>
                  </div>
                  <div v-if="r.domain" class="research-pane-domain">{{ r.domain }}</div>
                  <div v-if="r.snippet" class="research-pane-snippet">{{ r.snippet }}</div>
                </li>
              </ol>
              <div v-else-if="displayedArtifact.payload?.keyFindings?.length" class="pane-section">
                <div class="pane-label">关键发现</div>
                <ul class="pane-list">
                  <li v-for="(f, i) in displayedArtifact.payload.keyFindings" :key="i">{{ stripHtmlText(f) }}</li>
                </ul>
              </div>
            </template>

            <!-- note_detail：browser_read_notes 的笔记详情，含图片网格 -->
            <template v-else-if="displayedArtifact.artifactType === 'note_detail'">
              <div class="research-pane-head">
                <div class="research-pane-query">{{ displayedArtifact.payload?.count || 0 }} 条笔记</div>
                <div class="research-pane-meta">
                  <span v-if="displayedArtifact.payload?.source" class="research-pane-source">{{ displayedArtifact.payload.source }}</span>
                </div>
              </div>
              <div v-if="displayedArtifact.payload?.notes?.length" class="note-detail-list">
                <article v-for="(n, i) in displayedArtifact.payload.notes" :key="n.url || i" class="note-detail-item">
                  <header class="note-detail-head">
                    <a v-if="n.url" :href="n.url" target="_blank" rel="noopener" class="note-detail-title">{{ n.title || '(无标题)' }}</a>
                    <span v-else class="note-detail-title">{{ n.title || '(无标题)' }}</span>
                    <span v-if="n.noteType && n.noteType !== 'unknown'" class="note-detail-badge">{{ n.noteType === 'video' ? '视频' : '图文' }}</span>
                  </header>
                  <p v-if="n.body" class="note-detail-body">{{ n.body }}</p>
                  <p v-else-if="n.statusHint" class="note-detail-body note-detail-body--hint">{{ n.statusHint }}</p>
                  <div v-if="n.tags?.length" class="note-detail-tags">
                    <span v-for="t in n.tags" :key="t" class="note-detail-tag">#{{ t }}</span>
                  </div>
                  <div v-if="n.images?.length || n.videoPoster" class="note-detail-images">
                    <a v-if="n.videoPoster" :href="n.url" target="_blank" rel="noopener" class="note-detail-image-cell note-detail-image-cell--video">
                      <img :src="n.videoPoster" :alt="`${n.title} 视频封面`" loading="lazy" />
                      <span class="note-detail-video-mark">视频</span>
                    </a>
                    <a v-for="(img, j) in n.images" :key="img" :href="img" target="_blank" rel="noopener" class="note-detail-image-cell">
                      <img :src="img" :alt="`${n.title} 图${j + 1}`" loading="lazy" />
                    </a>
                  </div>
                </article>
              </div>
            </template>

            <!-- concept_proposal：流式过程边写边显示，最终态保留供对照 -->
            <template v-else-if="displayedArtifact.artifactType === 'concept_proposal'">
              <div class="pane-section">
                <div class="pane-label concept-pane-label">
                  <span>创意方向对比 · 第 {{ displayedArtifact.payload?.iteration || 1 }} 版</span>
                  <span v-if="displayedArtifact.payload?.partial" class="concept-streaming">
                    <span class="concept-streaming-dot"></span>梳理中
                  </span>
                </div>
                <div v-if="displayedArtifact.payload?.differentiationAxis" class="pane-text">{{ displayedArtifact.payload.differentiationAxis }}</div>
              </div>
              <div v-if="displayedArtifact.payload?.sharedContext" class="pane-section">
                <div class="pane-label">共享判断</div>
                <div class="pane-text">{{ displayedArtifact.payload.sharedContext }}</div>
              </div>
              <div
                v-if="displayedArtifact.payload?.partial && !(displayedArtifact.payload?.directions?.length)"
                class="pane-section concept-skeleton"
              >
                <div class="concept-skeleton-row" v-for="n in 3" :key="n">
                  <div class="concept-skeleton-bar concept-skeleton-bar--label"></div>
                  <div class="concept-skeleton-bar"></div>
                  <div class="concept-skeleton-bar concept-skeleton-bar--short"></div>
                </div>
              </div>
              <div v-for="(d, i) in (displayedArtifact.payload?.directions || [])" :key="d.label || i" class="pane-section">
                <div class="pane-label">{{ d.label || String.fromCharCode(65 + i) }} · {{ d.codeName || '' }} · {{ d.themeName || '—' }}</div>
                <div v-if="d.positioning" class="pane-text" style="font-style: italic;">{{ d.positioning }}</div>
                <div v-if="d.coreIdea" class="pane-text">{{ d.coreIdea }}</div>
                <div style="display:flex; gap:12px; margin-top:6px; font-size:12px; flex-wrap:wrap;">
                  <div v-if="d.upside"><strong>收益：</strong>{{ d.upside }}</div>
                  <div v-if="d.risk"><strong>风险：</strong>{{ d.risk }}</div>
                  <div v-if="d.bestFor"><strong>适用：</strong>{{ d.bestFor }}</div>
                </div>
              </div>
              <div v-if="displayedArtifact.payload?.recommendation" class="pane-section">
                <div class="pane-label">Luna 的倾向</div>
                <div class="pane-text">{{ displayedArtifact.payload.recommendation }}</div>
              </div>
              <div v-if="displayedArtifact.payload?.degraded" class="pane-section">
                <div class="pane-text" style="color:#c77;">（当前为兜底版本，建议补充信息后重新梳理）</div>
              </div>
            </template>

            <!-- review_feedback -->
            <template v-else-if="displayedArtifact.artifactType === 'review_feedback'">
              <div class="pane-section">
                <div class="pane-label">评审结论</div>
                <div class="pane-score" :class="{ 'pane-score--pass': displayedArtifact.payload?.passed }">
                  <span class="pane-score-round">第 {{ displayedArtifact.payload?.round || 1 }} 轮</span>
                  <span class="pane-score-num">{{ displayedArtifact.payload?.score || 0 }}</span>
                  <span class="pane-score-label">分</span>
                  <span class="pane-score-status">{{ displayedArtifact.payload?.passed ? '通过' : '待优化' }}</span>
                </div>
              </div>
              <div v-if="displayedArtifact.payload?.strengths?.length" class="pane-section">
                <div class="pane-label">认可亮点</div>
                <ul class="pane-list">
                  <li v-for="(item, i) in displayedArtifact.payload.strengths" :key="i">{{ item }}</li>
                </ul>
              </div>
              <div v-if="!displayedArtifact.payload?.passed && displayedArtifact.payload?.weaknesses?.length" class="pane-section">
                <div class="pane-label">待优化项</div>
                <ul class="pane-list">
                  <li v-for="(w, i) in displayedArtifact.payload.weaknesses" :key="i">{{ w }}</li>
                </ul>
              </div>
              <div v-if="!displayedArtifact.payload?.passed && displayedArtifact.payload?.suggestions?.length" class="pane-section">
                <div class="pane-label">修改建议</div>
                <ul class="pane-list">
                  <li v-for="(s, i) in displayedArtifact.payload.suggestions" :key="i">{{ s }}</li>
                </ul>
              </div>
              <div class="pane-section">
                <div class="pane-label">{{ displayedArtifact.payload?.passed ? '通过理由' : '完整评语' }}</div>
                <div class="pane-text">{{ displayedArtifact.payload?.specificFeedback || '—' }}</div>
              </div>
            </template>

            <template v-else-if="displayedArtifact.artifactType === 'image_canvas' || displayedArtifact.artifactType === 'image_search_result'">
              <ImageCanvasPanel :payload="displayedArtifact.payload || {}" />
            </template>

            <template v-else-if="displayedArtifact.artifactType === 'generated_image'">
              <div class="generated-image-pane">
                <button
                  v-if="displayedArtifact.payload?.url"
                  type="button"
                  class="generated-image-card"
                  @click="openChatImageLightbox(normalizeChatImageUrl(displayedArtifact.payload.url), displayedArtifact.payload.intent || '生成图片')"
                >
                  <img
                    :src="normalizeChatImageUrl(displayedArtifact.payload.url)"
                    :alt="displayedArtifact.payload.intent || '生成图片'"
                    loading="lazy"
                  />
                </button>
                <div class="pane-section">
                  <div class="pane-label">用途</div>
                  <div class="pane-text">{{ displayedArtifact.payload?.intent || '生成图片' }}</div>
                </div>
                <div v-if="displayedArtifact.payload?.prompt" class="pane-section">
                  <div class="pane-label">Prompt</div>
                  <div class="pane-text">{{ displayedArtifact.payload.prompt }}</div>
                </div>
                <div v-if="displayedArtifact.payload?.url" class="generated-image-actions">
                  <a :href="normalizeChatImageUrl(displayedArtifact.payload.url)" target="_blank" rel="noopener">新标签打开</a>
                  <a :href="normalizeChatImageUrl(displayedArtifact.payload.url)" download>下载图片</a>
                </div>
              </div>
            </template>

            <!-- ppt_outline -->
            <template v-else-if="displayedArtifact.artifactType === 'ppt_outline'">
              <template v-if="isBuilding || resultSlides.length === 0">
                <div class="ppt-build-board">
                  <div class="ppt-build-hero">
                    <div class="ppt-build-hero-copy">
                      <div class="ppt-build-eyebrow">PPT 正在生成</div>
                      <div class="ppt-build-title">{{ displayedArtifact.payload?.title || 'PPT 大纲已确认' }}</div>
                      <div class="ppt-build-desc">
                        页面不会等全部完成后再一起出现。
                        现在会先展示整套页面骨架，再随着渲染完成逐页点亮。
                      </div>
                    </div>
                    <div class="ppt-build-metrics">
                      <div class="ppt-build-metric">
                        <span>已完成</span>
                        <strong>{{ resultSlides.length }} / {{ pptBuildPageCount }}</strong>
                      </div>
                      <div class="ppt-build-metric">
                        <span>当前进度</span>
                        <strong>{{ pptBuildProgress }}%</strong>
                      </div>
                    </div>
                  </div>

                  <div class="ppt-build-progress">
                    <div class="ppt-build-progress-track">
                      <div class="ppt-build-progress-fill" :style="{ width: `${pptBuildProgress}%` }" />
                    </div>
                    <div class="ppt-build-progress-text">
                      <template v-if="currentBuildingCard">
                        正在生成第 {{ currentBuildingCard.index + 1 }} 页：{{ currentBuildingCard.title }}
                      </template>
                      <template v-else>
                        正在准备页面渲染...
                      </template>
                    </div>
                  </div>

                  <div v-if="currentBuildingCard" class="ppt-build-stage">
                    <div class="ppt-build-stage-kicker">当前页面</div>
                    <div class="ppt-build-stage-title">{{ currentBuildingCard.title }}</div>
                    <div class="ppt-build-stage-meta">{{ currentBuildingCard.layout }}</div>
                    <div class="ppt-build-stage-shell">
                      <div class="ppt-build-stage-bar" />
                      <div class="ppt-build-stage-line short" />
                      <div class="ppt-build-stage-line" />
                      <div class="ppt-build-stage-grid">
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                  </div>

                  <div class="ppt-build-grid">
                    <div
                      v-for="card in pptBuildCards"
                      :key="card.index"
                      class="ppt-build-card"
                      :class="{
                        built: card.built,
                        active: card.active,
                        pending: card.pending
                      }"
                    >
                      <div class="ppt-build-card-head">
                        <span class="ppt-build-card-num">{{ card.index + 1 }}</span>
                        <span class="ppt-build-card-status">
                          {{ card.built ? '已完成' : (card.active ? '生成中' : '排队中') }}
                        </span>
                      </div>
                      <div class="ppt-build-card-layout">{{ card.layout }}</div>
                      <div class="ppt-build-card-title">{{ card.title }}</div>
                      <div class="ppt-build-card-shell">
                        <div class="ppt-build-card-line short" />
                        <div class="ppt-build-card-line" />
                        <div class="ppt-build-card-line" />
                      </div>
                    </div>
                  </div>
                </div>
              </template>

              <template v-else>
                <div class="pane-section">
                  <div class="pane-plan-title">{{ displayedArtifact.payload?.title || 'PPT 大纲' }}</div>
                  <div class="pane-text">共 {{ displayedArtifact.payload?.total || 0 }} 页</div>
                </div>
                <div v-if="displayedArtifact.payload?.pages?.length" class="pane-section">
                  <div class="pane-label">页面结构</div>
                  <div v-for="(p, i) in displayedArtifact.payload.pages" :key="i" class="pane-page-item">
                    <span class="pane-page-num">{{ i + 1 }}</span>
                    <span class="pane-page-layout">{{ pptLayoutLabel(p.layout || p.type) }}</span>
                    <span class="pane-page-title">{{ pptPageTitleLabel(p, i) }}</span>
                  </div>
                </div>
              </template>
            </template>

            <!-- 对话图片合集预览 -->
            <template v-else-if="displayedArtifact.artifactType === 'chat_image_set'">
              <div class="chat-image-set">
                <div class="chat-image-set-meta">共 {{ displayedArtifact.payload?.images?.length || 0 }} 张图片，点击放大查看。</div>
                <div class="chat-image-set-grid">
                  <button
                    v-for="img in (displayedArtifact.payload?.images || [])"
                    :key="img.id || img.url"
                    type="button"
                    class="chat-image-set-card"
                    @click="openChatImageLightbox(img.url, img.alt)"
                  >
                    <img :src="img.url" :alt="img.alt || ''" loading="lazy" />
                    <span v-if="img.alt" class="chat-image-set-cap">{{ img.alt }}</span>
                  </button>
                </div>
              </div>
            </template>

            <!-- fallback -->
            <template v-else>
              <pre class="pane-json">{{ JSON.stringify(displayedArtifact.payload, null, 2) }}</pre>
            </template>

          </div>
        </div>
      </template>

      <!-- 空状态 -->
      <template v-else>
        <div class="workspace-empty">
          <div class="empty-icon">📋</div>
          <div class="empty-text">{{ currentPreviewHint || '等待任务产出...' }}</div>
        </div>
      </template>
    </div>

    <!-- PPT 编辑器 -->
    <PptEditor
      v-if="editorVisible"
      :ppt-data="resultData"
      @close="editorVisible = false"
    />

    <!-- 创意方向完整详情弹窗 -->
    <a-modal
      v-model:visible="conceptDetailVisible"
      :footer="false"
      :mask-closable="true"
      :width="860"
      unmount-on-close
      modal-class="concept-detail-modal"
      @cancel="conceptDetailVisible = false"
    >
      <template #title>
        <div class="concept-detail-title">
          <span class="concept-detail-version">
            创意方向对比 · 第 {{ conceptDetailPayload?.iteration || 1 }} 版
          </span>
          <span v-if="conceptDetailPayload?.directions?.[conceptDetailActiveIndex]?.themeName" class="concept-detail-theme">
            {{ conceptDetailPayload.directions[conceptDetailActiveIndex].label || '' }} · {{ conceptDetailPayload.directions[conceptDetailActiveIndex].themeName }}
          </span>
          <span v-if="conceptDetailPayload?.differentiationAxis" class="concept-detail-axis">
            {{ conceptDetailPayload.differentiationAxis }}
          </span>
        </div>
      </template>
      <div v-if="conceptDetailPayload" class="concept-detail-body">
        <div v-if="(conceptDetailPayload.directions || []).length > 1" class="concept-detail-tabs">
          <button
            v-for="(d, i) in conceptDetailPayload.directions"
            :key="d.label || i"
            type="button"
            class="concept-detail-tab"
            :class="{ 'concept-detail-tab--active': conceptDetailActiveIndex === i }"
            @click="conceptDetailActiveIndex = i"
          >
            <span class="concept-detail-tab-label">{{ d.label || String.fromCharCode(65 + i) }}</span>
            <span class="concept-detail-tab-name">{{ d.codeName || d.themeName }}</span>
          </button>
        </div>

        <template v-if="conceptDetailPayload.directions?.[conceptDetailActiveIndex]">
          <div v-if="conceptDetailPayload.directions[conceptDetailActiveIndex].positioning" class="concept-detail-block">
            <div class="concept-detail-label">战略定位</div>
            <div class="concept-detail-text">{{ conceptDetailPayload.directions[conceptDetailActiveIndex].positioning }}</div>
          </div>
          <div v-if="conceptDetailPayload.directions[conceptDetailActiveIndex].coreIdea" class="concept-detail-block">
            <div class="concept-detail-label">核心方向</div>
            <div class="concept-detail-text">{{ conceptDetailPayload.directions[conceptDetailActiveIndex].coreIdea }}</div>
          </div>
          <div v-if="conceptDetailPayload.directions[conceptDetailActiveIndex].eventFramework?.length" class="concept-detail-block">
            <div class="concept-detail-label">活动框架</div>
            <ol class="concept-detail-framework">
              <li v-for="(f, i) in conceptDetailPayload.directions[conceptDetailActiveIndex].eventFramework" :key="i">{{ f }}</li>
            </ol>
          </div>
          <div v-if="conceptDetailPayload.directions[conceptDetailActiveIndex].creativeAngles?.length" class="concept-detail-block">
            <div class="concept-detail-label">创意亮点</div>
            <ul class="concept-detail-angles">
              <li v-for="(a, i) in conceptDetailPayload.directions[conceptDetailActiveIndex].creativeAngles" :key="i">{{ a }}</li>
            </ul>
          </div>
          <div class="concept-detail-trio">
            <div v-if="conceptDetailPayload.directions[conceptDetailActiveIndex].upside" class="concept-detail-trio-cell concept-detail-trio-cell--up">
              <div class="concept-detail-trio-label">收益</div>
              <div class="concept-detail-trio-text">{{ conceptDetailPayload.directions[conceptDetailActiveIndex].upside }}</div>
            </div>
            <div v-if="conceptDetailPayload.directions[conceptDetailActiveIndex].risk" class="concept-detail-trio-cell concept-detail-trio-cell--risk">
              <div class="concept-detail-trio-label">风险</div>
              <div class="concept-detail-trio-text">{{ conceptDetailPayload.directions[conceptDetailActiveIndex].risk }}</div>
            </div>
            <div v-if="conceptDetailPayload.directions[conceptDetailActiveIndex].bestFor" class="concept-detail-trio-cell concept-detail-trio-cell--fit">
              <div class="concept-detail-trio-label">适用</div>
              <div class="concept-detail-trio-text">{{ conceptDetailPayload.directions[conceptDetailActiveIndex].bestFor }}</div>
            </div>
          </div>
          <div v-if="conceptDetailPayload.directions[conceptDetailActiveIndex].toneAndStyle" class="concept-detail-block">
            <div class="concept-detail-label">整体调性</div>
            <div class="concept-detail-text">{{ conceptDetailPayload.directions[conceptDetailActiveIndex].toneAndStyle }}</div>
          </div>
        </template>

        <div v-if="conceptDetailPayload.recommendation" class="concept-detail-block concept-detail-recommendation">
          <div class="concept-detail-label concept-detail-recommendation-label">Luna 的倾向</div>
          <div class="concept-detail-text concept-detail-text--muted">{{ conceptDetailPayload.recommendation }}</div>
        </div>
        <div v-if="conceptDetailPayload.sharedContext" class="concept-detail-block">
          <div class="concept-detail-label">三方向共享判断</div>
          <div class="concept-detail-text concept-detail-text--muted">{{ conceptDetailPayload.sharedContext }}</div>
        </div>
        <div v-if="conceptDetailPayload.degraded" class="concept-detail-degraded">
          当前为兜底版本，建议补充信息后重新梳理
        </div>
      </div>
    </a-modal>

    <!-- 保存对话框 -->
    <a-modal
      v-model:visible="showSaveModal"
      title="保存到策划空间"
      @ok="doSave"
      @cancel="showSaveModal = false"
    >
      <a-form layout="vertical" :model="{ saveSpaceId, saveName }">
        <a-form-item label="选择工作空间">
          <a-select v-model="saveSpaceId" placeholder="选择空间">
            <a-option v-for="s in spaces" :key="s.id" :value="s.id">{{ s.name }}</a-option>
          </a-select>
        </a-form-item>
        <a-form-item label="方案名称">
          <a-input v-model="saveName" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 保存MD对话框 -->
    <a-modal
      v-model:visible="showSaveModalForMd"
      title="保存到策划空间 (Markdown)"
      @ok="doSaveMd"
      @cancel="showSaveModalForMd = false"
    >
      <a-form layout="vertical" :model="{ saveSpaceId, saveName }">
        <a-form-item label="选择工作空间">
          <a-select v-model="saveSpaceId" placeholder="选择空间">
            <a-option v-for="s in spaces" :key="s.id" :value="s.id">{{ s.name }}</a-option>
          </a-select>
        </a-form-item>
        <a-form-item label="文档名称">
          <a-input v-model="saveName" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 对话内图片放大预览 -->
    <a-modal
      v-model:visible="chatImageLightbox.visible"
      :footer="false"
      :width="980"
      :unmount-on-close="true"
      :mask-closable="true"
      class="chat-image-lightbox-modal"
    >
      <template #title>
        <div class="chat-image-lightbox-title">{{ chatImageLightbox.alt || '图片预览' }}</div>
      </template>
      <div v-if="chatImageLightbox.url" class="chat-image-lightbox-stage">
        <img :src="chatImageLightbox.url" :alt="chatImageLightbox.alt || ''" class="chat-image-lightbox-img" />
      </div>
      <div v-if="chatImageLightbox.url" class="chat-image-lightbox-actions">
        <a :href="chatImageLightbox.url" target="_blank" rel="noopener" class="chat-image-lightbox-btn">在新标签打开</a>
        <a :href="chatImageLightbox.url" download class="chat-image-lightbox-btn primary">下载图片</a>
      </div>
    </a-modal>

  </div>
</template>

<script setup>
import { ref, reactive, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { Message } from '@arco-design/web-vue'
import { useRouter, useRoute } from 'vue-router'
import { useSettingsStore } from '../stores/settings'
import { workspaceApi } from '../api/workspace'
import SlideViewer from '../components/SlideViewer.vue'
import PlanDocumentPanel from '../components/PlanDocumentPanel.vue'
import PptEditor from '../components/PptEditor.vue'
import ImageCanvasPanel from '../components/ImageCanvasPanel.vue'
import { IconMobile, IconCompass, IconCamera } from '@arco-design/web-vue/es/icon'
import {
  PhMagnifyingGlass, PhLightbulb, PhCheckCircle, PhClipboardText, PhPalette,
  PhImagesSquare, PhGlobe, PhWrench, PhFileText, PhFilePdf, PhFolder, PhX,
  PhPlus, PhStackSimple, PhPaperclip, PhStop, PhArrowUp, PhImage, PhSquaresFour,
  PhFrameCorners, PhRows, PhPresentationChart, PhNotePencil, PhSealQuestion,
  PhChatCircleText, PhSealCheck
} from '@phosphor-icons/vue'

const router   = useRouter()
const route    = useRoute()
const settings = useSettingsStore()
const layoutRef = ref(null)
const CONVERSATION_SIDEBAR_COLLAPSED_KEY = 'oc_conversation_sidebar_collapsed'
const PREVIEW_COLLAPSED_KEY = 'oc_preview_collapsed'

function loadConversationSidebarCollapsed() {
  try {
    return localStorage.getItem(CONVERSATION_SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function loadPreviewCollapsed() {
  try {
    return localStorage.getItem(PREVIEW_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

// ── Brain Agent 状态 ─────────────────────────────────────────────
const currentSessionId        = ref('')   // 当前 Brain 会话 ID
const waitingForClarification = ref(false) // Brain 正在等待用户回答
const clarificationReplyText  = ref('')    // 澄清回答输入框内容
const wasManuallyStopped      = ref(false) // 用户手动中止后，允许在同一会话继续
const processedStreamEvents = new Set()
const activeTaskIntent = ref(null)
const currentTaskTurnId = ref('')
const processSummaryState = ref({})

// 工具图标映射（Phosphor SVG）
function toolIcon(tool) {
  return {
    search_images: PhImagesSquare,
    web_search: PhMagnifyingGlass,
    web_fetch: PhGlobe,
    propose_concept: PhLightbulb,
    approve_concept: PhCheckCircle,
    run_strategy: PhClipboardText,
    build_ppt: PhPalette,
  }[tool] || PhWrench
}

// 工具图标语义色（轻底色 + 强调色）
function toolIconTone(tool) {
  return {
    search_images: 'tool-tone--violet',
    web_search:    'tool-tone--blue',
    web_fetch:     'tool-tone--blue',
    propose_concept: 'tool-tone--amber',
    approve_concept: 'tool-tone--green',
    run_strategy:  'tool-tone--slate',
    build_ppt:     'tool-tone--rose',
  }[tool] || 'tool-tone--slate'
}

function createTaskTurnId() {
  return `task_turn_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
}

function beginTaskTurn() {
  currentTaskTurnId.value = createTaskTurnId()
  return currentTaskTurnId.value
}

function resetProcessedStreamEvents() {
  processedStreamEvents.clear()
}

function streamEventKey(eventType, payload = {}) {
  if (!payload || typeof payload !== 'object') return ''
  const identity = [
    payload.timestamp ?? '',
    payload.toolCallId ?? '',
    payload.tool ?? '',
    payload.question ?? '',
    payload.text ?? '',
    payload.artifactType ?? '',
    payload.index ?? '',
    payload.display ?? '',
    payload.message ?? ''
  ].join('|')
  return identity ? `${currentSessionId.value}:${eventType}:${identity}` : ''
}

function shouldSkipStreamEvent(eventType, payload = {}) {
  const key = streamEventKey(eventType, payload)
  if (!key) return false
  if (processedStreamEvents.has(key)) return true
  processedStreamEvents.add(key)
  if (processedStreamEvents.size > 400) {
    const first = processedStreamEvents.values().next().value
    if (first) processedStreamEvents.delete(first)
  }
  return false
}

// 提交澄清回答
async function submitClarificationReply(msg) {
  const reply = clarificationReplyText.value.trim()
  const images = pendingImages.value.map(item => ({ ...item }))
  const docs   = pendingDocs.value.map(item => ({ ...item }))
  if (!reply && !images.length && !docs.length) return
  clarificationReplyText.value = ''
  msg.answered = true

  pushMsg('user', reply || (docs.length ? `（补充了 ${docs.length} 份文档）` : '（补充了图片）'), '', {
    taskTurnId: currentTaskTurnId.value || '',
    attachments: buildMessageAttachments(images),
    documents: docs.map(d => ({ id: d.id, name: d.name, size: d.size, mimeType: d.mimeType }))
  })
  clearPendingImages()
  waitingForClarification.value = false
  isRunning.value = true

  return new Promise(resolve => {
    const done = () => { resolveCurrent = null; resolve() }
    resolveCurrent = done

    // 与 runBrainTask 同样冻结 conversationId — 用户在 fetch 期间切走也不会导致
    // 澄清回复的 SSE 事件落到新对话上
    const taskConversationId = activeConversationId.value
    fetch(`/api/agent/${currentSessionId.value}/reply`, {
      method: 'POST',
      body: buildAgentFormData({ reply, apiKeys: settings.apiKeys, conversationId: taskConversationId || undefined, images, docs })
    }).then(r => r.json()).then(res => {
      if (!res.success) throw new Error(res.message)
      replaceLatestUserAttachments(res.attachments || [])
      connectBrainSSE(res.streamUrl, { onResolve: done, conversationId: taskConversationId })
    }).catch(err => {
      pushMsg('ai', '', `回复失败：${err.message}`)
      isRunning.value = false
      done()
    })
  })
}

// ── 聊天消息 ────────────────────────────────────────────────────
const messages  = ref([])
const inputText = ref('')
const imageInputRef = ref(null)
const pendingImages = ref([])
const pendingDocs   = ref([])
const historyRef = ref(null)
const isRunning  = ref(false)
const conversations = ref([])
const activeConversationId = ref(loadPersistedConversationId())
const lastBoundConversationId = ref('')
const quickReplyLabel = ref('你可以直接这样回复')
const quickReplyQuestion = ref('')
const quickReplyOptions = ref([])
const conversationSearch = ref('')
const conversationSidebarCollapsed = ref(loadConversationSidebarCollapsed())
const restoringConversation = ref(false)
let persistConversationTimer = null

function createMessageId(prefix = 'msg') {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
}

function defaultClarificationOptions(type = 'missing_info') {
  if (type === 'confirmation') {
    return [
      {
        label: '可以开始生成 PPT',
        value: '可以开始生成 PPT',
        description: '按当前确认过的方案继续往下生成汇报稿。'
      },
      {
        label: '继续优化方案',
        value: '先别生成 PPT，继续优化方案',
        description: '保留当前方向，但继续调整方案细节。'
      }
    ]
  }

  if (type === 'suggestion' || type === 'ambiguous') {
    return [
      {
        label: '按方向一继续',
        value: '按方向一继续',
        description: '沿着第一个方向继续深化。'
      },
      {
        label: '按方向二继续',
        value: '按方向二继续',
        description: '沿着第二个方向继续深化。'
      },
      {
        label: '我补充一下要求',
        value: '我再补充一下要求',
        description: '先补充限制条件，再决定方向。'
      }
    ]
  }

  return []
}

function setQuickReplies(label = '', options = [], question = '') {
  quickReplyLabel.value = label || '你可以直接这样回复'
  quickReplyQuestion.value = question || ''
  quickReplyOptions.value = options
    .filter(item => item && item.label && item.value)
    .map(item => ({
      label: item.label,
      value: item.value,
      description: item.description || ''
    }))
    .slice(0, 5)
}

function clearQuickReplies() {
  quickReplyLabel.value = '你可以直接这样回复'
  quickReplyQuestion.value = ''
  quickReplyOptions.value = []
}

function maybeSetQuickRepliesFromAiText(text = '') {
  if (quickReplyOptions.value.length || waitingForClarification.value) return

  const source = String(text || '').trim()
  if (!source) return

  const normalized = source
    .replace(/\s+/g, '')
    .replace(/[“”"'`]/g, '')

  const mentionsTwoDirections = /方向一[\s\S]{0,800}方向二/.test(source)
  const asksToChooseDirection =
    /你更想|你更倾向于|你倾向于|更偏向|选哪个|选哪一个|往哪个感觉靠|按哪个方向|混搭也行/.test(source)

  if (mentionsTwoDirections && asksToChooseDirection) {
    setQuickReplies('选择方向', defaultClarificationOptions('ambiguous'), source)
    return
  }

  const asksToStartPpt =
    /开始生成PPT|生成PPT可以吗|按这个开始生成PPT|是否按这版生成PPT|如果这版.*开始生成PPT/.test(normalized)

  if (asksToStartPpt) {
    setQuickReplies('下一步', defaultClarificationOptions('confirmation'), source)
  }
}

async function sendQuickReply(item) {
  if (!item?.value || isRunning.value) return
  inputText.value = item.value
  clearQuickReplies()
  await send()
}

function stripHtmlText(value = '') {
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function decodeHtmlEntities(value = '') {
  if (!value || typeof window === 'undefined' || typeof document === 'undefined') {
    return String(value || '')
  }
  const textarea = document.createElement('textarea')
  textarea.innerHTML = String(value)
  return textarea.value
}

function htmlToStructuredText(value = '') {
  if (!value || typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return String(value || '')
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(String(value), 'text/html')
  const chunks = []

  const walk = (node, listDepth = 0) => {
    if (!node) return
    if (node.nodeType === Node.TEXT_NODE) {
      chunks.push(node.textContent || '')
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return

    const tag = node.tagName.toLowerCase()
    if (tag === 'table') {
      chunks.push(`\n${node.outerHTML}\n`)
      return
    }
    if (tag === 'br') {
      chunks.push('\n')
      return
    }
    if (tag === 'hr') {
      chunks.push('\n---\n')
      return
    }
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1])
      chunks.push(`${'#'.repeat(level)} ${node.textContent || ''}\n\n`)
      return
    }
    if (tag === 'li') {
      const indent = '  '.repeat(Math.max(0, listDepth - 1))
      chunks.push(`${indent}- `)
      Array.from(node.childNodes).forEach(child => walk(child, listDepth))
      chunks.push('\n')
      return
    }
    if (tag === 'ul' || tag === 'ol') {
      chunks.push('\n')
      Array.from(node.childNodes).forEach(child => walk(child, listDepth + 1))
      chunks.push('\n')
      return
    }
    if (tag === 'pre') {
      const codeText = node.textContent || ''
      chunks.push(`\n\`\`\`\n${codeText}\n\`\`\`\n`)
      return
    }
    if (tag === 'code') {
      if (node.parentElement?.tagName?.toLowerCase() === 'pre') return
      chunks.push(`\`${node.textContent || ''}\``)
      return
    }

    Array.from(node.childNodes).forEach(child => walk(child, listDepth))

    if (['p', 'div', 'section', 'article', 'blockquote'].includes(tag)) {
      chunks.push('\n\n')
    }
  }

  Array.from(doc.body.childNodes).forEach(node => walk(node))

  return chunks.join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function parseInlineRichText(value = '') {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function isMarkdownTableDelimiter(line = '') {
  const trimmed = String(line || '').trim()
  if (!trimmed) return false
  const normalized = trimmed.replace(/^\||\|$/g, '')
  const cells = normalized.split('|').map(cell => cell.trim())
  if (!cells.length) return false
  return cells.every(cell => /^:?-{3,}:?$/.test(cell))
}

function splitMarkdownTableRow(line = '') {
  return String(line || '')
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map(cell => cell.trim())
}

function renderAiTextToHtml(value = '') {
  let source = String(value || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/\r\n/g, '\n')
    .trim()

  if (!source) return ''
  source = decodeHtmlEntities(source)

  if (/<table[\s\S]*?>/i.test(source)) return source
  if (/<[a-z][\s\S]*>/i.test(source)) {
    source = htmlToStructuredText(source)
  }

  source = source
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .trim()

  // 抽取 markdown 图片，避免被段落/转义流程吃掉，最后再替换回 <img>
  const inlineImages = []
  source = source.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_, alt, url) => {
      const idx = inlineImages.length
      inlineImages.push({ alt: String(alt || '').trim(), url: String(url || '').trim() })
      return `IMG${idx}`
    }
  )

  const lines = source.split('\n')
  const blocks = []
  let listItems = []
  let paragraph = []
  let codeFence = null
  let codeLines = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    // 先按行 escape + 解析 inline rich text，再用真实 <br /> 连接，避免 <br /> 被一并 escape
    blocks.push(`<p>${paragraph.map(line => parseInlineRichText(line)).join('<br />')}</p>`)
    paragraph = []
  }

  const flushList = () => {
    if (!listItems.length) return
    blocks.push(`<ul>${listItems.map(item => `<li>${parseInlineRichText(item)}</li>`).join('')}</ul>`)
    listItems = []
  }

  const flushCode = () => {
    if (!codeFence) return
    blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
    codeFence = null
    codeLines = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]
    const line = rawLine.trim()

    const fenceMatch = rawLine.match(/^```([\w-]+)?\s*$/)
    if (fenceMatch) {
      flushParagraph()
      flushList()
      if (codeFence) {
        flushCode()
      } else {
        codeFence = fenceMatch[1] || 'plain'
      }
      continue
    }

    if (codeFence) {
      codeLines.push(rawLine)
      continue
    }

    if (!line) {
      flushParagraph()
      flushList()
      continue
    }

    if (/^---+$/.test(line) || /^\*\*\*+$/.test(line)) {
      flushParagraph()
      flushList()
      blocks.push('<hr />')
      continue
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      flushParagraph()
      flushList()
      const level = headingMatch[1].length
      blocks.push(`<h${level}>${parseInlineRichText(headingMatch[2])}</h${level}>`)
      continue
    }

    const listMatch = line.match(/^[-*]\s+(.+)$/) || line.match(/^\d+\.\s+(.+)$/)
    if (listMatch) {
      flushParagraph()
      listItems.push(listMatch[1])
      continue
    }

    if (
      line.startsWith('|')
      && index + 1 < lines.length
      && isMarkdownTableDelimiter(lines[index + 1])
    ) {
      flushParagraph()
      flushList()

      const headers = splitMarkdownTableRow(line)
      const rows = []
      index += 2
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(splitMarkdownTableRow(lines[index].trim()))
        index += 1
      }
      index -= 1

      const thead = `<thead><tr>${headers.map(cell => `<th>${parseInlineRichText(cell)}</th>`).join('')}</tr></thead>`
      const tbody = rows.length
        ? `<tbody>${rows.map(row => `<tr>${headers.map((_, cellIndex) => `<td>${parseInlineRichText(row[cellIndex] || '')}</td>`).join('')}</tr>`).join('')}</tbody>`
        : ''
      blocks.push(`<div class="ai-table-wrap"><table>${thead}${tbody}</table></div>`)
      continue
    }

    flushList()
    paragraph.push(line)
  }

  flushParagraph()
  flushList()
  flushCode()
  let html = blocks.join('')

  if (inlineImages.length) {
    // 仅由图片占位（可被 <br /> 分隔）组成的段落直接拆出 <p>，避免成内联段落
    html = html.replace(
      /<p>\s*((?:IMG\d+(?:\s*<br\s*\/?>\s*)?)+)\s*<\/p>/g,
      (_, group) => group.replace(/<br\s*\/?>/gi, '')
    )
    const renderImg = (img) => {
      const safeUrl = escapeHtml(normalizeChatImageUrl(img.url))
      const safeAlt = escapeHtml(img.alt || '')
      return `<img class="ai-inline-image" src="${safeUrl}" alt="${safeAlt}" data-ai-image="1" loading="lazy" />`
    }
    html = html.replace(/IMG(\d+)/g, (_, idx) => {
      const img = inlineImages[Number(idx)]
      if (!img?.url) return ''
      return renderImg(img)
    })
    if (inlineImages.length > 2) {
      // 同一段连续 ≥3 张图聚合成横向 strip + "在右侧预览全部" 按钮
      const imgRe = /<img class="ai-inline-image"[^>]+>/
      const consecutive = new RegExp(
        `(?:${imgRe.source}\\s*){3,}`,
        'g'
      )
      html = html.replace(consecutive, (match) => {
        const urls = []
        match.replace(/src="([^"]+)"/g, (_, u) => { urls.push(u); return '' })
        return `<div class="ai-image-strip" data-image-strip="1">${match}<button type="button" class="ai-image-strip-cta" data-image-strip-cta="1">在右侧预览全部 ${urls.length} 张图片</button></div>`
      })
    }
  }

  return html
}

function normalizeChatImageUrl(url = '') {
  const raw = String(url || '').trim()
  if (!raw) return ''
  if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('/api/')) return raw
  if (raw.startsWith('/output/')) return raw
  const outputIndex = raw.indexOf('/output/')
  if (outputIndex >= 0) return raw.slice(outputIndex)
  const runsIndex = raw.indexOf('output/runs/')
  if (runsIndex >= 0) return `/${raw.slice(runsIndex)}`
  return raw
}

function resolveAiHtml(text = '', html = '') {
  const candidate = html || text || ''
  return renderAiTextToHtml(candidate)
}

function buildAiMessageMeta(text = '', html = '') {
  const plainText = stripHtmlText(html || text)
  const shouldCollapse = plainText.length > 220 || plainText.includes('1.') || plainText.includes('\n')
  return {
    summary: shouldCollapse
      ? `${plainText.slice(0, 120)}${plainText.length > 120 ? '…' : ''}`
      : '',
    collapsed: shouldCollapse,
    expanded: false
  }
}

function pushMsg(role, text, html, extra = {}) {
  const resolvedHtml = role === 'ai' ? resolveAiHtml(text, html) : (html || text || '')
  const nextMessage = {
    id: createMessageId(role),
    role,
    text: text || '',
    html: resolvedHtml,
    createdAt: new Date().toISOString(),
    taskTurnId: extra.taskTurnId ?? (role === 'ai' ? (currentTaskTurnId.value || '') : ''),
    ...extra
  }
  if (role === 'ai') Object.assign(nextMessage, buildAiMessageMeta(text, resolvedHtml))
  messages.value.push(nextMessage)
  scheduleConversationPersist()
  nextTick(() => {
    if (historyRef.value) historyRef.value.scrollTop = historyRef.value.scrollHeight
  })
}

// ── 对话内图片预览：单图 lightbox / 多图右侧面板 ──
const chatImageLightbox = reactive({ visible: false, url: '', alt: '' })

function openChatImageLightbox(url, alt = '') {
  if (!url) return
  chatImageLightbox.url = url
  chatImageLightbox.alt = alt
  chatImageLightbox.visible = true
}

function openChatImageSetInPane(images) {
  const list = (Array.isArray(images) ? images : [])
    .filter(item => item?.url)
    .map((item, idx) => ({
      id: `chat_img_${idx}_${item.url}`,
      url: item.url,
      alt: item.alt || ''
    }))
  if (!list.length) return
  activeArtifact.value = {
    artifactType: 'chat_image_set',
    title: `对话图片预览 · ${list.length} 张`,
    payload: { images: list }
  }
  previewCollapsed.value = false
}

function onChatHistoryClick(event) {
  const target = event.target
  if (!target || !(target instanceof HTMLElement)) return

  const cta = target.closest('[data-image-strip-cta]')
  if (cta) {
    event.preventDefault()
    const strip = cta.closest('[data-image-strip]')
    if (!strip) return
    const imgs = Array.from(strip.querySelectorAll('img.ai-inline-image')).map(img => ({
      url: img.getAttribute('src') || '',
      alt: img.getAttribute('alt') || ''
    }))
    openChatImageSetInPane(imgs)
    return
  }

  const img = target.closest('img.ai-inline-image')
  if (img) {
    event.preventDefault()
    openChatImageLightbox(img.getAttribute('src') || '', img.getAttribute('alt') || '')
  }
}

function pushAiMessage(message) {
  messages.value.push({
    id: createMessageId('ai'),
    role: 'ai',
    createdAt: new Date().toISOString(),
    taskTurnId: message.taskTurnId ?? (currentTaskTurnId.value || ''),
    ...message
  })
  scheduleConversationPersist()
  nextTick(() => {
    if (historyRef.value) historyRef.value.scrollTop = historyRef.value.scrollHeight
  })
}

function formatFileSize(size = 0) {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  if (size >= 1024) return `${Math.round(size / 1024)} KB`
  return `${size} B`
}

function clearImageInputValue() {
  if (imageInputRef.value) imageInputRef.value.value = ''
}

function revokePreviewUrl(url = '') {
  if (typeof url === 'string' && url.startsWith('blob:')) {
    URL.revokeObjectURL(url)
  }
}

function clearPendingImages() {
  pendingImages.value.forEach(item => revokePreviewUrl(item.previewUrl))
  pendingImages.value = []
  pendingDocs.value = []
  clearImageInputValue()
}

function removePendingDoc(id) {
  pendingDocs.value = pendingDocs.value.filter(item => item.id !== id)
  clearImageInputValue()
}

function triggerImagePicker() {
  imageInputRef.value?.click()
}

function removePendingImage(id) {
  const target = pendingImages.value.find(item => item.id === id)
  if (target) revokePreviewUrl(target.previewUrl)
  pendingImages.value = pendingImages.value.filter(item => item.id !== id)
  clearImageInputValue()
}

function processFiles(files) {
  if (!files.length) return

  const nextImages = []
  const nextDocs   = []

  for (const file of files) {
    if (/^image\/(png|jpeg|webp)$/.test(file.type)) {
      nextImages.push({
        id: createMessageId('img'),
        file,
        name: file.name,
        size: file.size,
        mimeType: file.type,
        previewUrl: URL.createObjectURL(file)
      })
    } else if (
      file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf') ||
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.name?.toLowerCase().endsWith('.docx')
    ) {
      nextDocs.push({
        id: createMessageId('doc'),
        file,
        name: file.name,
        size: file.size,
        mimeType: file.type || (file.name?.endsWith('.pdf') ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      })
    } else {
      Message.warning(`不支持的文件类型：${file.name}（支持图片、PDF、Word .docx）`)
    }
  }

  if (nextImages.length) {
    const merged = [...pendingImages.value, ...nextImages]
    if (merged.length > 4) Message.warning('图片最多 4 张')
    pendingImages.value = merged.slice(0, 4)
  }

  if (nextDocs.length) {
    const merged = [...pendingDocs.value, ...nextDocs]
    if (merged.length > 3) Message.warning('文档最多 3 份')
    pendingDocs.value = merged.slice(0, 3)
  }
}

function onFileInputChange(event) {
  const files = Array.from(event.target?.files || [])
  processFiles(files)
  clearImageInputValue()
}

function onPaste(event) {
  const items = Array.from(event.clipboardData?.items || [])
  const fileItems = items.filter(item => item.kind === 'file')
  if (!fileItems.length) return
  // 有文件类型时阻止默认粘贴行为（避免将文件路径粘贴成文本）
  const files = fileItems.map(item => item.getAsFile()).filter(Boolean)
  if (!files.length) return
  event.preventDefault()
  processFiles(files)
}

function buildMessageAttachments(items = []) {
  return items.map(item => ({
    id: item.id,
    name: item.name,
    size: item.size,
    mimeType: item.mimeType,
    url: item.url || item.previewUrl
  }))
}

function replaceLatestUserAttachments(attachments = []) {
  if (!attachments.length) return
  const target = [...messages.value].reverse().find(msg => msg.role === 'user')
  if (!target) return
  target.attachments = attachments.map(item => ({ ...item }))
  scheduleConversationPersist()
}

function buildAgentFormData(payload = {}) {
  const form = new FormData()
  if (payload.message !== undefined) form.append('message', payload.message)
  if (payload.reply !== undefined) form.append('reply', payload.reply)
  if (payload.spaceId !== undefined) form.append('spaceId', payload.spaceId)
  if (payload.sessionId !== undefined) form.append('sessionId', payload.sessionId)
  if (payload.conversationId !== undefined) form.append('conversationId', payload.conversationId)
  if (payload.restoreSession !== undefined) form.append('restoreSession', JSON.stringify(payload.restoreSession))
  form.append('apiKeys', JSON.stringify(payload.apiKeys || {}))
  if (payload.forceTool) form.append('forceTool', payload.forceTool)
  if ((payload.workspaceRefs || []).length) {
    form.append('workspaceRefs', JSON.stringify(payload.workspaceRefs.map(r => r.id)))
  }
  ;(payload.images || []).forEach((item) => {
    form.append('images', item.file, item.name)
  })
  ;(payload.docs || []).forEach((item) => {
    form.append('images', item.file, item.name)
  })
  return form
}

function formatTime(isoString) {
  if (!isoString) return ''
  const date = new Date(isoString)
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

// ── 工作区状态 ──────────────────────────────────────────────────
const wsState = ref('welcome') // 'welcome' | 'execution' | 'streaming' | 'done'
const progress = ref(0)
const progressLabel = ref('正在启动...')
const resultSlides  = ref([])
const resultDownloadUrl = ref('')
const resultData    = ref(null)
const previewWidth  = ref(760)
const previewCollapsed = ref(loadPreviewCollapsed())
const isResizing    = ref(false)
const activePreviewTab = ref('strategy')
const currentSlideIndex = ref(0)
// 流式生成状态
const isBuilding    = ref(false)
const buildTotal    = ref(0)
// 文档确认状态
const docContent    = ref('')
const docTitle      = ref('')
const docStreamProgress = ref(0)
const isDocStreaming = ref(false)
const docStreamPhase = ref('draft')
// SlideViewer 引用（用于调用 appendSlide）
const slideViewerRef = ref(null)
// 编辑器模式
const editorVisible = ref(false)
const currentTask = ref(null)
const taskMode = ref('idle')
const brainPlanItems = ref([])
const activeExecutionPlan = ref(null)
const activeTaskSpec = ref(null)
const routeToolSequence = ref([])
const failedReason = ref('')
const failedStage = ref('')
const artifacts = ref([])
const executionLogs = ref([])
const PROCESS_MESSAGE_KINDS = new Set(['thinking', 'tool-call', 'task-log', 'narration'])
const PROCESS_STREAM_VISIBLE_COUNT = 3
const COLLAPSIBLE_HISTORY_KINDS = new Set(['thinking', 'tool-call', 'task-log'])

// ── Steps ────────────────────────────────────────────────────────
const summarySteps = computed(() => {
  if (taskMode.value === 'brain') {
    const source = brainPlanItems.value.length ? brainPlanItems.value : defaultBrainPlan()
    return source
      .filter(item => item.status === 'completed')
      .map(item => ({ key: item.content, title: item.content }))
  }
  return []
})
const currentTaskSummary = computed(() => {
  if (!currentTask.value) return []
  const task = currentTask.value
  return [
    { label: '品牌', value: task.brand },
    { label: '类别', value: task.productCategory },
    { label: '活动', value: eventTypeLabel(task.eventType) },
    { label: '规模', value: task.scale },
    { label: '预算', value: task.budget },
    { label: '风格', value: task.style }
  ].filter(item => item.value)
})
const currentStageTitle = computed(() => {
  return '执行任务中'
})
const showStopButton = computed(() => {
  if (waitingForClarification.value) return false
  return isRunning.value || (hasActiveStream.value && ['execution', 'streaming'].includes(wsState.value))
})
const latestArtifact = computed(() => artifacts.value[0] || null)
const artifactTimeline = computed(() => artifacts.value.slice(0, 5))
const latestTaskBrief = computed(() => artifacts.value.find(item => item.artifactType === 'task_brief') || null)
const researchPreviewItems = computed(() => artifacts.value
  .filter(item => item.artifactType === 'research_result')
  .reduce((acc, item) => {
    if (!acc.find(existing => existing.payload.focus === item.payload.focus)) acc.push(item)
    return acc
  }, [])
  .slice(0, 3)
)
const latestPlanDraft = computed(() => artifacts.value.find(item => item.artifactType === 'plan_draft') || null)
const planSectionArtifacts = computed(() => artifacts.value
  .filter(item => item.artifactType === 'plan_section')
  .reduce((acc, item) => {
    if (!acc.find(existing => existing.payload.title === item.payload.title)) acc.push(item)
    return acc
  }, [])
  .sort((a, b) => (a.payload.index || 0) - (b.payload.index || 0))
)
const latestPlanSection = computed(() => planSectionArtifacts.value.at(-1) || null)
const latestReviewFeedback = computed(() => artifacts.value.find(item => item.artifactType === 'review_feedback') || null)
const latestPptOutline = computed(() => artifacts.value.find(item => item.artifactType === 'ppt_outline') || null)
const latestArtifactCardMessage = computed(() => {
  for (let i = messages.value.length - 1; i >= 0; i -= 1) {
    const msg = messages.value[i]
    if (msg?.kind === 'artifact-card') return msg
  }
  return null
})
const displayedArtifact = computed(() => {
  // 实时状态（不需要对应 message 卡片）：PPT 流式输出、文档流式预览、对话图片预览、创意方向流式预览
  if (activeArtifact.value?.artifactType === 'ppt_slides') return activeArtifact.value
  if (activeArtifact.value?.artifactType === 'plan_document') return activeArtifact.value
  if (activeArtifact.value?.artifactType === 'chat_image_set') return activeArtifact.value
  if (activeArtifact.value?.artifactType === 'concept_proposal') return activeArtifact.value
  // 其余产出物：先匹配已推入消息流的 artifact card，再降级到最新卡片
  if (activeArtifact.value?.artifactId) {
    const matched = messages.value.find(msg => msg.kind === 'artifact-card' && msg.artifactId === activeArtifact.value.artifactId)
    if (matched) return matched
  }
  if (latestArtifactCardMessage.value) return latestArtifactCardMessage.value
  if (resultSlides.value.length) return { artifactType: 'ppt_slides' }
  return null
})
const showPlanDocumentPanel = computed(() => {
  if (!docContent.value) return false
  if (!displayedArtifact.value) return wsState.value === 'document'
  return ['plan_document'].includes(displayedArtifact.value.artifactType)
})
const selectedArtifactId = computed(() => displayedArtifact.value?.artifactId || '')
const hasMatureStrategyPreview = computed(() =>
  !!focusedPlanDraft.value ||
  planSectionArtifacts.value.length > 0 ||
  !!latestReviewFeedback.value ||
  !!latestPptOutline.value
)
const hasStrategyPreview = computed(() =>
  !!latestTaskBrief.value ||
  researchPreviewItems.value.length > 0 ||
  !!focusedPlanDraft.value ||
  planSectionArtifacts.value.length > 0 ||
  !!latestReviewFeedback.value ||
  !!latestPptOutline.value ||
  artifacts.value.some(item =>
    item.artifactType === 'concept_proposal' ||
    item.artifactType === 'image_search_result' ||
    item.artifactType === 'generated_image' ||
    item.artifactType === 'image_canvas' ||
    item.artifactType === 'note_detail'
  )
)
const previewVisible = computed(() => {
  if (docContent.value || resultSlides.value.length > 0) return true
  if (activeArtifact.value?.artifactType === 'chat_image_set') return true
  if (activeArtifact.value?.artifactType === 'generated_image') return true
  return hasStrategyPreview.value
})
const focusedPlanDraft = computed(() => latestPlanDraft.value)
const focusedPlanSection = computed(() => latestPlanSection.value)

const strategySnapshotLabel = computed(() => {
  if (latestPptOutline.value) return '已进入 PPT 结构映射'
  if (latestReviewFeedback.value) return '已形成评审结论'
  if (latestPlanSection.value) return `已展开 ${latestPlanSection.value.payload.title}`
  if (focusedPlanDraft.value) return '已形成方案草稿'
  if (researchPreviewItems.value.length) return '已形成搜索研究'
  if (latestTaskBrief.value) return '已完成任务理解'
  return '正在准备'
})
const taskIntentLabel = computed(() => {
  return activeTaskIntent.value?.label || ''
})
const taskRouteLabel = computed(() => {
  return activeTaskSpec.value?.primaryRoute || activeExecutionPlan.value?.mode || ''
})
const routeSequenceLabel = computed(() => {
  if (!Array.isArray(routeToolSequence.value) || !routeToolSequence.value.length) return ''
  return routeToolSequence.value
    .slice(0, 3)
    .map(item => item.toolName)
    .join(' -> ')
})
const failedStageLabel = computed(() => {
  if (!failedStage.value) return '未知阶段'
  return failedStage.value
})
const currentPreviewHint = computed(() => {
  if (wsState.value === 'failed') {
    return '任务已中断，右侧保留当前阶段与最近产出，方便判断是配置问题还是方案质量问题。'
  }
  if (wsState.value === 'interrupted') {
    return '任务已手动中止，当前上下文会保留，你可以直接继续补充要求并接着推进。'
  }
  if (taskMode.value === 'brain') {
    if (taskIntentLabel.value && !isBuilding.value && !isDocStreaming.value && !waitingForClarification.value) {
      const routeText = taskRouteLabel.value ? `，主执行路径是「${taskRouteLabel.value}」` : ''
      const sequenceText = routeSequenceLabel.value ? `，默认序列是 ${routeSequenceLabel.value}` : ''
      return `当前识别到的任务类型是“${taskIntentLabel.value}”${routeText}${sequenceText}，系统会按这个方向优先调用合适的工具。`
    }
    if (waitingForClarification.value) return '正在等待你补充一个关键信息，收到后会继续推进。'
    if (wsState.value === 'document' && docContent.value) {
      return '策划文档已经生成。是否进入 PPT 会在对话里确认；如果还想优化方案，也可以直接继续聊。'
    }
    if (isDocStreaming.value) {
      return docStreamPhase.value === 'draft'
        ? `正在搭建策划文档初稿，章节结构已开始出现（${docStreamProgress.value}%）。`
        : `正在润色策划文档，章节内容会继续被更完整的版本替换（${docStreamProgress.value}%）。`
    }
    if (isBuilding.value) return '正在把方案转换成 PPT 页面，新的页面会在这里逐张出现。'
    if (brainPlanItems.value.some(item => item.status === 'in_progress')) {
      return '系统正在按计划推进任务，会把任务理解、搜索研究和方案草稿同步展示在这里。'
    }
  }
  return '系统正在准备可预览的中间产出。'
})
const pptBuildPayload = computed(() => {
  if (displayedArtifact.value?.artifactType === 'ppt_outline') return displayedArtifact.value.payload || {}
  return latestPptOutline.value?.payload || {}
})
const pptBuildPageCount = computed(() => {
  const payload = pptBuildPayload.value || {}
  return Number(payload.total || buildTotal.value || (Array.isArray(payload.pages) ? payload.pages.length : 0) || resultSlides.value.length || 0)
})
const pptBuildProgress = computed(() => {
  const total = pptBuildPageCount.value
  if (!total) return 0
  return Math.max(0, Math.min(100, Math.round((resultSlides.value.length / total) * 100)))
})
const pptBuildCards = computed(() => {
  const payload = pptBuildPayload.value || {}
  const pages = Array.isArray(payload.pages) ? payload.pages : []
  const total = pptBuildPageCount.value
  const cards = []
  for (let i = 0; i < total; i += 1) {
    const page = pages[i] || {}
    const built = i < resultSlides.value.length
    const active = isBuilding.value && i === resultSlides.value.length && i < total
    cards.push({
      index: i,
      title: pptPageTitleLabel(page, i),
      layout: pptLayoutLabel(page.layout || page.type),
      built,
      active,
      pending: !built && !active
    })
  }
  return cards
})
const currentBuildingCard = computed(() => {
  if (!pptBuildCards.value.length) return null
  return pptBuildCards.value.find(card => card.active) || pptBuildCards.value[Math.min(resultSlides.value.length, pptBuildCards.value.length - 1)] || null
})

function eventTypeLabel(eventType) {
  return {
    product_launch: '新品发布会',
    auto_show: '车展',
    exhibition: '展览',
    meeting: '峰会',
    simple: '活动策划'
  }[eventType] || eventType
}

function resetSteps() {
  progress.value = 0
  progressLabel.value = '正在启动...'
  // 重置流式状态，避免第二次任务时显示上一次残留
  isBuilding.value = false
  buildTotal.value  = 0
  isDocStreaming.value = false
  docStreamProgress.value = 0
  docStreamPhase.value = 'draft'
  resultSlides.value      = []
  resultDownloadUrl.value = ''
  resultData.value        = null
  docContent.value = ''
  docTitle.value = ''
  failedReason.value = ''
  failedStage.value = ''
  artifacts.value = []
  executionLogs.value = []
  activeArtifact.value = null
  taskMode.value = 'idle'
  brainPlanItems.value = []
  wasManuallyStopped.value = false
}

function statusLabel(s) {
  return { pending: '等待中', running: '进行中', completed: '完成', failed: '失败' }[s] || s
}

function artifactTypeLabel(type) {
  return {
    task_brief: '任务理解',
    research_result: '搜索研究',
    image_search_result: '找图结果',
    generated_image: '生成图片',
    note_detail: '笔记内容',
    concept_proposal: '创意方向对比',
    brief_challenge: 'Brief 审视',
    plan_draft: '方案草稿',
    plan_document: '策划文档',
    review_feedback: '评审意见',
    image_canvas: '图片画布',
    ppt_outline: 'PPT大纲',
    ppt_slides: 'PPT成稿',
    ppt_page: 'PPT页面'
  }[type] || '中间产物'
}

function artifactMsgIcon(type) {
  return {
    task_brief: PhLightbulb,
    research_result: PhMagnifyingGlass,
    image_search_result: PhImagesSquare,
    generated_image: PhImage,
    note_detail: PhFileText,
    concept_proposal: PhLightbulb,
    brief_challenge: PhSealQuestion,
    plan_draft: PhNotePencil,
    plan_document: PhFileText,
    review_feedback: PhChatCircleText,
    image_canvas: PhFrameCorners,
    ppt_outline: PhRows,
    ppt_slides: PhPresentationChart,
  }[type] || PhNotePencil
}

function pptLayoutLabel(layout) {
  return {
    immersive_cover: '沉浸式封面',
    cover: '封面页',
    toc: '目录页',
    editorial_quote: '引言观点页',
    data_cards: '数据卡片页',
    asymmetrical_story: '故事阐述页',
    end_card: '结束页',
    section: '章节过渡页',
    comparison: '对比分析页',
    metrics: '数据指标页',
    highlights: '亮点概览页',
    timeline: '时间节奏页'
  }[layout] || layout || '内容页'
}

function pptPageTitleLabel(page = {}, index = 0) {
  const explicitTitle = page?.content?.title || page?.content?.name || page?.title || ''
  if (explicitTitle) return explicitTitle
  return `第 ${index + 1} 页 · ${pptLayoutLabel(page?.layout || page?.type)}`
}

function artifactTimelineText(item) {
  const payload = item.payload || {}
  if (item.artifactType === 'task_brief') return payload.parsedGoal || '已完成任务拆解'
  if (item.artifactType === 'research_result') return payload.focus || payload.summary || '已完成一条搜索研究'
  if (item.artifactType === 'note_detail') {
    const totalImgs = (payload.notes || []).reduce((s, n) => s + (n.images?.length || 0) + (n.videoPoster ? 1 : 0), 0)
    return `已抓取 ${payload.count || 0} 条笔记 · ${totalImgs} 张图`
  }
  if (item.artifactType === 'image_search_result') return `已找到 ${payload.summary?.totalImages || 0} 张图片`
  if (item.artifactType === 'concept_proposal') {
    const dirs = Array.isArray(payload.directions) ? payload.directions : []
    const names = dirs.map(d => d.codeName || d.themeName || d.label).filter(Boolean).join(' / ')
    return `第 ${payload.iteration || 1} 版 · 3 条方向${names ? '：' + names : ''}`
  }
  if (item.artifactType === 'brief_challenge') return payload.hasConcerns ? `Brief 审视：${payload.concerns?.length || 0} 条风险点` : 'Brief 审视通过'
  if (item.artifactType === 'plan_draft') return payload.planTitle || payload.coreStrategy || '已生成方案草稿'
  if (item.artifactType === 'plan_document') return payload.title || '策划文档已生成'
  if (item.artifactType === 'review_feedback') return `第 ${payload.round} 轮评分 ${payload.score}${payload.passed ? '，通过' : '，待优化'}`
  if (item.artifactType === 'image_canvas') return `已收集 ${payload.summary?.totalImages || 0} 张图片，覆盖 ${payload.summary?.coveredPages || 0} 页`
  if (item.artifactType === 'ppt_outline') return `已生成 ${payload.total || 0} 页 PPT大纲`
  if (item.artifactType === 'ppt_page') return `第 ${payload.index + 1} / ${payload.total} 页：${payload.title}`
  return '已生成中间产物'
}

function processMessageLabel(message) {
  if (!message) return ''
  if (message.kind === 'thinking') return '正在思考下一步'
  if (message.kind === 'tool-call') {
    if (message.resultSummary) return `${message.display || message.tool} · ${message.resultSummary}`
    if (message.progress) return `${message.display || message.tool} · ${message.progress}`
    return message.display || message.tool || '执行工具'
  }
  if (message.kind === 'task-log') return message.text || '过程更新'
  if (message.kind === 'narration') return stripHtmlText(message.html || message.text || '')
  return message.text || ''
}

function isCollapsibleHistoryMessage(message) {
  return message?.role === 'ai' && COLLAPSIBLE_HISTORY_KINDS.has(message.kind)
}

function taskTurnSummaryTitle(segment = [], count = 0) {
  const userText = segment.find(item => item.role === 'user' && item.text)?.text?.trim() || ''
  const normalized = userText.replace(/^（/, '').replace(/）$/, '').trim()
  if (normalized) {
    return `上一轮任务过程 · ${normalized.slice(0, 28)}${normalized.length > 28 ? '…' : ''}`
  }
  return `上一轮任务过程 · ${count} 条`
}

function buildCollapsedHistorySegment(segment = []) {
  const logs = segment
    .filter(isCollapsibleHistoryMessage)
    .map(item => ({
      id: item.id,
      time: item.time || formatLogTime(item.timestamp || item.createdAt || Date.now()),
      text: processMessageLabel(item)
    }))
    .filter(item => item.text)

  if (!logs.length) return segment

  const summaryId = `process_summary_${segment[0]?.taskTurnId || segment[0]?.id || createMessageId('summary')}`
  const summaryItem = {
    id: summaryId,
    role: 'ai',
    kind: 'process-summary',
    summaryId,
    taskTurnId: segment[0]?.taskTurnId || '',
    title: taskTurnSummaryTitle(segment, logs.length),
    preview: logs[logs.length - 1]?.text || '',
    count: logs.length,
    logs,
    collapsedByDefault: true
  }

  const result = []
  let inserted = false
  segment.forEach((item) => {
    if (isCollapsibleHistoryMessage(item)) {
      if (!inserted) {
        result.push(summaryItem)
        inserted = true
      }
      return
    }
    result.push(item)
  })
  return result
}

const displayMessages = computed(() => {
  const orderedTurns = []
  messages.value.forEach((item) => {
    if (!item?.taskTurnId) return
    if (!orderedTurns.includes(item.taskTurnId)) orderedTurns.push(item.taskTurnId)
  })
  const latestTurnId = orderedTurns.at(-1) || ''

  const result = []
  let index = 0
  while (index < messages.value.length) {
    const message = messages.value[index]
    const turnId = message?.taskTurnId || ''
    if (!turnId || turnId === latestTurnId) {
      result.push(message)
      index += 1
      continue
    }

    const segment = []
    while (index < messages.value.length && messages.value[index]?.taskTurnId === turnId) {
      segment.push(messages.value[index])
      index += 1
    }
    result.push(...buildCollapsedHistorySegment(segment))
  }

  return result
})

function isProcessSummaryCollapsed(summaryId, defaultCollapsed = true) {
  const saved = processSummaryState.value[summaryId]
  return typeof saved === 'boolean' ? saved : defaultCollapsed
}

function toggleProcessSummary(summaryId) {
  const next = !isProcessSummaryCollapsed(summaryId, true)
  processSummaryState.value = {
    ...processSummaryState.value,
    [summaryId]: next
  }
}

function humanizeActivityText(text) {
  if (!text) return ''
  const normalized = String(text).trim()
  if (!normalized) return ''

  let match

  // ── 策划方案轮次 ──────────────────────────────────────────────────────────────
  match = normalized.match(/^第\s*(\d+)\s*轮：专家评审中/)
  if (match) return `第 ${match[1]} 轮专家评审中，检查亮点、风险和可落地性`

  match = normalized.match(/^第\s*(\d+)\s*轮评审完成，得分\s*([0-9.]+)(.*)$/)
  if (match) {
    const passed = !match[3]?.includes('继续优化')
    return `第 ${match[1]} 轮评审完成，得分 ${match[2]}${passed ? ' · 已过线' : ' · 继续优化'}`
  }

  match = normalized.match(/^第\s*(\d+)\s*轮：启用稳态兜底方案/)
  if (match) return `第 ${match[1]} 轮已切到稳态兜底方案，先保证流程继续`

  match = normalized.match(/^第\s*(\d+)\s*轮：已切换稳态方案/)
  if (match) return `第 ${match[1]} 轮已切到稳态方案，正在补全文档结构`

  // ── 文档整理 ──────────────────────────────────────────────────────────────────
  if (normalized === '正在整理策划文档...') return '正在整理策划文档，右侧会实时更新'
  if (/文档整理稍慢/.test(normalized)) return '文档整理稍慢，已切换为快速成稿继续往下走'

  // ── PPT ───────────────────────────────────────────────────────────────────────
  if (normalized === '正在生成 PPT 大纲...') return '正在生成 PPT 页面结构'
  if (normalized === '正在结合策划内容与页面结构匹配背景图...') return '正在为每一页匹配背景图和视觉氛围'
  if (normalized.startsWith('开始生成 PPT')) return '开始生成 PPT，页面会逐张出现在右侧'

  // ── 工作空间 ──────────────────────────────────────────────────────────────────
  match = normalized.match(/^已读取文档：(.+)$/)
  if (match) return `已载入空间文档：${match[1]}`

  match = normalized.match(/^已更新文档：(.+)$/)
  if (match) return `已同步文档更新：${match[1]}`

  match = normalized.match(/^已保存到工作空间：(.+)$/)
  if (match) return `已保存到策划空间：${match[1]}`

  // ── 任务启动 ──────────────────────────────────────────────────────────────────
  if (normalized.startsWith('开始制定策划方案')) return '开始制定策划方案，先收拢方向再写正文'

  return normalized.replace(/\.\.\.$/, '')
}

function shouldSurfaceProgressMessage(text) {
  if (!text) return false
  return [
    // ── 策划方案阶段 ──────────────────────────────────────────
    /制定策划方案/,
    /生成方案骨架中/,
    /专家评审中/,
    /评审完成/,
    /启用稳态兜底方案/,
    /已切换稳态方案/,
    // ── 文档整理（只记录开始和异常，不记录每个章节）─────────────
    /^正在整理策划文档/,
    /文档整理稍慢/,
    // ── PPT 生成 ───────────────────────────────────────────────
    /正在生成 PPT 大纲/,
    /正在结合策划内容与页面结构匹配背景图/,
    // ── 工作空间 ──────────────────────────────────────────────
    /^已读取文档：/,
    /^已更新文档：/,
    /^已保存到工作空间：/
  ].some(pattern => pattern.test(text))
}

function formatLogTime(ts = Date.now()) {
  const date = new Date(ts)
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function addExecutionLog(text, ts = Date.now()) {
  if (!text) return
  const displayText = humanizeActivityText(text)
  const prev = executionLogs.value[0]
  if (prev?.text === displayText) return
  const log = {
    id: `${ts}_${Math.random().toString(16).slice(2, 8)}`,
    time: formatLogTime(ts),
    text: displayText
  }
  executionLogs.value.unshift(log)
  executionLogs.value = executionLogs.value.slice(0, 24)
  scheduleConversationPersist()
}

function pushTaskLog(text, ts = Date.now()) {
  if (!text) return
  const displayText = humanizeActivityText(text)
  const lastMsg = messages.value[messages.value.length - 1]
  if (lastMsg?.role === 'ai' && lastMsg?.kind === 'task-log' && lastMsg?.text === displayText) return
  pushAiMessage({
    kind: 'task-log',
    text: displayText,
    time: formatLogTime(ts),
    timestamp: ts
  })
}

function publishActivity(text, ts = Date.now()) {
  addExecutionLog(text, ts)
  pushTaskLog(text, ts)
}

function defaultBrainPlan() {
  return [
    { content: '整理需求与约束', status: 'in_progress' },
    { content: '补充案例与趋势参考', status: 'pending' },
    { content: '形成方案并确认方向', status: 'pending' },
    { content: '确认后生成 PPT', status: 'pending' }
  ]
}

// ── 工作空间 ────────────────────────────────────────────────────
const SELECTED_SPACE_KEY = 'oc_selected_space_id'
const ACTIVE_CONVERSATION_KEY = 'oc_active_conversation_id'

function loadPersistedSpaceId() {
  try { return localStorage.getItem(SELECTED_SPACE_KEY) || '' } catch { return '' }
}
function loadPersistedConversationId() {
  try { return localStorage.getItem(ACTIVE_CONVERSATION_KEY) || '' } catch { return '' }
}

const spaces = ref([])
const selectedSpaceId = ref(loadPersistedSpaceId())

// ── 工作空间文档引用 ─────────────────────────────────────────────
const pendingWorkspaceRefs = ref([])       // [{id, name, docType}]
const workspacePickerVisible = ref(false)  // 按钮选择器
const workspacePickerQuery = ref('')       // 选择器搜索词
const atMentionVisible = ref(false)        // @ 内联菜单
const atMentionQuery = ref('')             // @ 后的匹配词
const atMentionIndex = ref(0)              // 键盘高亮项
const textareaRef = ref(null)              // a-textarea 组件 ref

// ── 工具直达模式（"+"按钮）────────────────────────────────────────
// 选中后跳过 brain 的意图分类，直接指定工具；下一次及后续发送都保持该模式，× 可取消
const TOOL_MODES = [
  { key: 'generate_image', label: '生图', hint: 'AI 直接生图', icon: 'image' },
  { key: 'build_ppt',      label: 'PPT',   hint: '生成 / 美化自动判定', icon: 'layout' },
  { key: 'web_search',     label: '网页搜索', hint: '搜资料 / 案例', icon: 'search' },
  { key: 'propose_concept',label: '创意方向', hint: '给 3 个方向', icon: 'bulb' }
]
const toolPickerVisible = ref(false)
const activeToolMode = ref(null)           // null | TOOL_MODES[i]

function toggleToolPicker() {
  toolPickerVisible.value = !toolPickerVisible.value
}

function pickToolMode(mode) {
  activeToolMode.value = mode
  toolPickerVisible.value = false
}

function clearToolMode() {
  activeToolMode.value = null
}

function flattenDocs(nodes, result = [], folderName = null) {
  for (const node of nodes || []) {
    if (node.type === 'document') result.push({ ...node, _folder: folderName })
    if (node.children?.length) flattenDocs(node.children, result, node.type === 'folder' ? node.name : folderName)
  }
  return result
}

const spaceDocsFlat = computed(() => {
  if (!selectedSpaceId.value) return []
  const space = spaces.value.find(s => s.id === selectedSpaceId.value)
  return space ? flattenDocs(space.children || []) : []
})

const atMentionResults = computed(() => {
  const q = atMentionQuery.value.toLowerCase()
  return spaceDocsFlat.value
    .filter(d => !q || d.name.toLowerCase().includes(q))
    .slice(0, 8)
})

const workspacePickerResults = computed(() => {
  const q = workspacePickerQuery.value.toLowerCase()
  return spaceDocsFlat.value
    .filter(d => !q || d.name.toLowerCase().includes(q))
})

const workspacePickerGroups = computed(() => {
  if (!selectedSpaceId.value) return []
  const space = spaces.value.find(s => s.id === selectedSpaceId.value)
  if (!space) return []
  const q = workspacePickerQuery.value.toLowerCase()
  const groups = []
  const rootDocs = (space.children || [])
    .filter(n => n.type === 'document' && !n.system && (!q || n.name.toLowerCase().includes(q)))
  if (rootDocs.length) groups.push({ folder: null, docs: rootDocs.map(d => ({ ...d, _folder: null })) })
  for (const node of (space.children || [])) {
    if (node.type === 'folder') {
      const docs = flattenDocs(node.children || []).filter(d => !d.system && (!q || d.name.toLowerCase().includes(q)))
      if (docs.length) groups.push({ folder: node.name, docs })
    }
  }
  return groups
})

function addWorkspaceRef(doc) {
  if (!pendingWorkspaceRefs.value.find(r => r.id === doc.id)) {
    pendingWorkspaceRefs.value.push({ id: doc.id, name: doc.name, docType: doc.docType || 'document' })
  }
}

function removeWorkspaceRef(id) {
  pendingWorkspaceRefs.value = pendingWorkspaceRefs.value.filter(r => r.id !== id)
}

function toggleWorkspacePicker() {
  workspacePickerVisible.value = !workspacePickerVisible.value
  if (workspacePickerVisible.value) workspacePickerQuery.value = ''
}

// 检测 textarea 中 @ 触发
function onTextareaInput() {
  const ta = textareaRef.value?.$el?.querySelector('textarea') ?? textareaRef.value?.$el
  // 优先读取 native textarea 的当前值和光标位置，避免 Arco v-model 更新延迟
  const text = ta?.value ?? inputText.value
  const cursor = ta?.selectionStart ?? text.length
  const before = text.slice(0, cursor)
  const match = before.match(/@([^\s@]*)$/)
  if (match) {
    atMentionQuery.value = match[1]
    atMentionVisible.value = true
    atMentionIndex.value = 0
  } else {
    atMentionVisible.value = false
    atMentionQuery.value = ''
  }
}

function selectMention(doc) {
  if (!doc) return
  // 删除输入框里的 @query 文字
  const ta = textareaRef.value?.$el?.querySelector('textarea') ?? textareaRef.value?.$el
  const cursor = ta?.selectionStart ?? inputText.value.length
  const before = inputText.value.slice(0, cursor)
  const match = before.match(/@([^\s@]*)$/)
  if (match) {
    const start = cursor - match[0].length
    inputText.value = inputText.value.slice(0, start) + inputText.value.slice(cursor)
  }
  addWorkspaceRef(doc)
  atMentionVisible.value = false
  atMentionQuery.value = ''
  // 焦点还给 textarea
  nextTick(() => ta?.focus())
}
const activeConversationTitle = computed(() => conversations.value.find(item => item.id === activeConversationId.value)?.title || '')
const filteredConversations = computed(() => {
  const keyword = conversationSearch.value.trim().toLowerCase()
  if (!keyword) return conversations.value
  return conversations.value.filter(item =>
    String(item.title || '').toLowerCase().includes(keyword)
  )
})
function conversationTs(item) {
  return new Date(item.updatedAt || item.lastMessageAt || item.createdAt || 0).getTime()
}
const groupedConversations = computed(() => {
  const now = Date.now()
  const groups = [
    { key: 'today', title: '今天', items: [] },
    { key: 'week', title: '近 7 天', items: [] },
    { key: 'earlier', title: '更早', items: [] }
  ]
  // 先做一次稳定排序：时间倒序，时间相同用 id 倒序兜底，避免后端时间戳并列时顺序漂移
  const sorted = [...filteredConversations.value].sort((a, b) => {
    const diff = conversationTs(b) - conversationTs(a)
    if (diff !== 0) return diff
    return String(b.id || '').localeCompare(String(a.id || ''))
  })
  sorted.forEach((item) => {
    const ts = conversationTs(item)
    const diffDays = Math.floor((now - ts) / 86400000)
    if (diffDays <= 0) groups[0].items.push(item)
    else if (diffDays < 7) groups[1].items.push(item)
    else groups[2].items.push(item)
  })
  return groups.filter(group => group.items.length)
})
const inputFocused  = ref(false)
const isComposing   = ref(false)  // IME 合成中（中文/日文输入法）

function handleEnter(e) {
  if (isComposing.value) return
  if (atMentionVisible.value) {
    e.preventDefault()
    selectMention(atMentionResults.value[atMentionIndex.value])
    return
  }
  e.preventDefault()
  send()
}

function handleTextareaKeydown(e) {
  if (!atMentionVisible.value) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    atMentionIndex.value = Math.min(atMentionIndex.value + 1, atMentionResults.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    atMentionIndex.value = Math.max(atMentionIndex.value - 1, 0)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    atMentionVisible.value = false
  }
}

async function loadSpaces() {
  try {
    const res = await workspaceApi.getTree()
    spaces.value = ((res.data?.spaces) || []).filter(n => n.type === 'space')
    if (!spaces.value.length) return

    // 选择优先级：URL > localStorage > 第一个
    const urlSpaceId = route.params.spaceId || ''
    const savedId    = selectedSpaceId.value
    const candidate  = (urlSpaceId && spaces.value.some(s => s.id === urlSpaceId))
      ? urlSpaceId
      : (savedId && spaces.value.some(s => s.id === savedId))
        ? savedId
        : spaces.value[0].id
    const urlConvId  = route.params.conversationId || ''

    if (candidate !== selectedSpaceId.value) {
      // URL/默认 与 localStorage 不一致 → 写入触发 watcher（watcher 会带上 URL conversationId）
      selectedSpaceId.value = candidate
    } else {
      // 没变化，watcher 不会触发，手动拉
      await loadConversationsForSpace(candidate, urlConvId)
      scheduleAgentRouteSync()
    }
  } catch {}
}
loadSpaces()

function serializeState() {
  return {
    currentSessionId: currentSessionId.value,
    currentTaskTurnId: currentTaskTurnId.value,
    wasManuallyStopped: wasManuallyStopped.value,
    taskMode: taskMode.value,
    activeTaskIntent: activeTaskIntent.value,
    activeExecutionPlan: activeExecutionPlan.value,
    activeTaskSpec: activeTaskSpec.value,
    routeToolSequence: routeToolSequence.value,
    brainPlanItems: brainPlanItems.value,
    wsState: wsState.value,
    progress: progress.value,
    progressLabel: progressLabel.value,
    resultSlides: resultSlides.value,
    resultDownloadUrl: resultDownloadUrl.value,
    resultData: resultData.value,
    activePreviewTab: activePreviewTab.value,
    currentSlideIndex: currentSlideIndex.value,
    isBuilding: isBuilding.value,
    buildTotal: buildTotal.value,
    docContent: docContent.value,
    docTitle: docTitle.value,
    isDocStreaming: isDocStreaming.value,
    docStreamProgress: docStreamProgress.value,
    docStreamPhase: docStreamPhase.value,
    currentTask: currentTask.value,
    failedReason: failedReason.value,
    failedStage: failedStage.value,
    artifacts: artifacts.value,
    executionLogs: executionLogs.value
  }
}

function serializeMessages() {
  return messages.value.map((msg) => {
    const next = {
      ...msg,
      id: msg.id || createMessageId('msg'),
      createdAt: msg.createdAt || new Date().toISOString()
    }
    if (msg.taskState) next.taskState = JSON.parse(JSON.stringify(msg.taskState))
    if (msg.group) next.group = JSON.parse(JSON.stringify(msg.group))
    return next
  })
}

function extractRestorableMessages() {
  return messages.value.flatMap((msg) => {
    if (msg.role === 'user') {
      const attachmentText = Array.isArray(msg.attachments) && msg.attachments.length
        ? `\n\n用户上传图片：${msg.attachments.map(item => item.name || '图片').join('、')}`
        : ''
      const content = `${msg.text || ''}${attachmentText}`.trim()
      return content
        ? [{
            role: 'user',
            content,
            attachments: Array.isArray(msg.attachments) ? msg.attachments.map(item => ({ ...item })) : []
          }]
        : []
    }

    if (msg.role !== 'ai') return []

    if (msg.kind === 'clarification') {
      return msg.question ? [{ role: 'assistant', content: msg.question }] : []
    }

    if (!msg.kind || msg.kind === 'narration') {
      const content = stripHtmlText(msg.html || msg.text || '')
      if (!content) return []
      // Mark partial (interrupted) streams so the LLM knows it was cut off.
      const prefix = msg.streamStatus === 'partial' ? '（上一轮生成被中断，以下是已产出的片段）\n' : ''
      return [{ role: 'assistant', content: prefix + content }]
    }

    // Preserve tool calls as compact assistant annotations so the LLM keeps
    // continuity on what actions were already taken.
    if (msg.kind === 'tool-call') {
      const parts = [`[工具] ${msg.tool || msg.display || 'tool'}`]
      if (msg.progress) parts.push(String(msg.progress).slice(0, 120))
      if (msg.resultSummary) parts.push(`结果：${String(msg.resultSummary).slice(0, 200)}`)
      return [{ role: 'assistant', content: parts.join(' — ') }]
    }

    return []
  }).slice(-60)
}

function buildRestoreSessionPayload() {
  const latestPlan = latestPlanDraft.value?.payload
  const uniqueAttachments = []
  const seenAttachmentIds = new Set()

  messages.value.forEach((msg) => {
    ;(msg.attachments || []).forEach((item) => {
      const key = item.id || item.url || item.name
      if (!key || seenAttachmentIds.has(key)) return
      seenAttachmentIds.add(key)
      uniqueAttachments.push({
        id: item.id,
        name: item.name,
        mimeType: item.mimeType,
        size: item.size,
        url: item.url
      })
    })
  })

  return {
    messages: extractRestorableMessages(),
    bestPlan: latestPlan ? { ...latestPlan } : null,
    userInput: currentTask.value ? { ...currentTask.value } : null,
    docHtml: docContent.value || '',
    brief: currentTask.value ? { ...currentTask.value } : null,
    taskIntent: activeTaskIntent.value ? { ...activeTaskIntent.value } : null,
    executionPlan: activeExecutionPlan.value ? { ...activeExecutionPlan.value } : null,
    taskSpec: activeTaskSpec.value ? { ...activeTaskSpec.value } : null,
    routeToolSequence: Array.isArray(routeToolSequence.value)
      ? routeToolSequence.value.map(item => ({ ...item }))
      : [],
    planItems: Array.isArray(brainPlanItems.value)
      ? brainPlanItems.value.map(item => ({ ...item }))
      : [],
    attachments: uniqueAttachments
  }
}

function restoreFromConversation(detail) {
  const state = detail?.state || {}
  restoringConversation.value = true
  processSummaryState.value = {}
  messages.value = Array.isArray(detail?.messages)
    ? detail.messages.map(msg => ({
        ...msg,
        attachments: Array.isArray(msg.attachments) ? msg.attachments : [],
        id: msg.id || createMessageId('msg'),
        createdAt: msg.createdAt || new Date().toISOString()
      }))
    : []

  currentSessionId.value = state.currentSessionId || ''
  currentTaskTurnId.value = state.currentTaskTurnId
    || [...messages.value].reverse().find(msg => msg.taskTurnId)?.taskTurnId
    || ''
  wasManuallyStopped.value = !!state.wasManuallyStopped
  currentTask.value = state.currentTask || null
  taskMode.value = state.taskMode || 'idle'
  activeTaskIntent.value = state.activeTaskIntent || null
  activeExecutionPlan.value = state.activeExecutionPlan || null
  activeTaskSpec.value = state.activeTaskSpec || null
  routeToolSequence.value = Array.isArray(state.routeToolSequence) ? state.routeToolSequence : []
  brainPlanItems.value = Array.isArray(state.brainPlanItems) ? state.brainPlanItems : []
  progress.value = state.progress || 0
  progressLabel.value = state.progressLabel || '已恢复历史对话'
  resultSlides.value = Array.isArray(state.resultSlides) ? state.resultSlides : []
  resultDownloadUrl.value = state.resultDownloadUrl || ''
  resultData.value = state.resultData || null
  activePreviewTab.value = state.activePreviewTab || 'strategy'
  currentSlideIndex.value = Number(state.currentSlideIndex || 0)
  isBuilding.value = false
  buildTotal.value = state.buildTotal || 0
  docContent.value = state.docContent || ''
  docTitle.value = state.docTitle || ''
  isDocStreaming.value = !!state.isDocStreaming
  docStreamProgress.value = Number(state.docStreamProgress || 0)
  docStreamPhase.value = state.docStreamPhase || 'draft'
  failedReason.value = state.failedReason || ''
  failedStage.value = state.failedStage || ''
  artifacts.value = Array.isArray(state.artifacts) ? state.artifacts : []
  executionLogs.value = Array.isArray(state.executionLogs) ? state.executionLogs : []
  activeArtifact.value = resultSlides.value.length ? { artifactType: 'ppt_slides' } : null

  const savedWsState = state.wsState || 'welcome'
  wsState.value = ['execution', 'streaming', 'document'].includes(savedWsState)
    ? (resultSlides.value.length ? 'done' : 'failed')
    : savedWsState
  if (['execution', 'streaming'].includes(savedWsState) && !failedReason.value) {
    failedReason.value = '这是一次已恢复的历史会话，原任务执行过程不会自动继续。'
  }
  // 如果最后一条 AI 消息的流式输出曾被中断，明确提示用户
  const lastAi = [...messages.value].reverse().find(msg => msg.role === 'ai' && (msg.kind === 'narration' || !msg.kind))
  if (lastAi && lastAi.streamStatus === 'partial' && !failedReason.value) {
    failedReason.value = '上次 AI 回复在流式输出中被中断，已保留可见片段。发送「继续」可让它接着写。'
  }

  isRunning.value = false
  waitingForClarification.value = messages.value.some(msg => msg.role === 'ai' && msg.kind === 'clarification' && !msg.answered)
  // 切换会话时清空"+"工具直达模式：pill 属于当前操作上下文，不跨会话保留
  activeToolMode.value = null
  toolPickerVisible.value = false
  syncQuickRepliesFromMessages()

  // 用户上次切走时后端 session 可能还在跑（前端 SSE 已断）。回到这个对话后
  // 异步问下后端 status，活的就重连 SSE，让 backlog 把切走期间漏掉的 tool_call /
  // text_delta / done 等事件全回放出来。否则 UI 会停在"半截"的最后状态。
  if (currentSessionId.value) {
    reattachBrainSSE(currentSessionId.value, activeConversationId.value)
  }

  nextTick(() => {
    restoringConversation.value = false
    if (historyRef.value) historyRef.value.scrollTop = historyRef.value.scrollHeight
  })
}

// 切回历史对话时尝试重新订阅后端 SSE。后端 /status 告诉我们 session 是否还活着 +
// 当前 status；活的就 connectBrainSSE，让 backlog 把漏掉的事件回放出来。
async function reattachBrainSSE(sessionId, conversationId) {
  if (!sessionId) return false
  try {
    const r = await fetch(`/api/agent/${sessionId}/status`)
    if (!r.ok) return false
    const s = await r.json()
    if (!s.alive) return false
    if (s.status !== 'running' && s.status !== 'waiting_for_user') return false
    // 守一下：后端绑定的 conversation 必须跟前端当前活跃对话一致，避免把别的对话
    // 的事件灌进来
    if (s.conversationId && conversationId && s.conversationId !== conversationId) return false

    isRunning.value = true
    if (wsState.value === 'welcome' || wsState.value === 'failed') wsState.value = 'execution'
    progressLabel.value = s.status === 'waiting_for_user' ? '等待你的回复...' : '继续推进...'

    const url = s.streamUrl || `/api/agent/stream/${sessionId}`
    connectBrainSSE(url, { onResolve: () => {}, conversationId })
    return true
  } catch (err) {
    console.warn('[reattachBrainSSE] failed:', err.message)
    return false
  }
}

function clearConversationView() {
  // 优先把 sseGeneration++ 并切断现存 SSE：
  // 否则旧 SSE 排队中的 text_delta / tool_call 会试图 find/push 已被清空的 messages，
  // 出现"清完又冒出残影"或 isRunning 卡死。
  closeSseConnection()
  restoringConversation.value = true
  messages.value = []
  processSummaryState.value = {}
  clearPendingImages()
  clearQuickReplies()
  currentSessionId.value = ''
  currentTaskTurnId.value = ''
  isRunning.value = false           // 若清空时还有 isRunning 残留，旧 done/error 已被 myGen 守卫吃掉，这里手动收尾
  waitingForClarification.value = false
  wasManuallyStopped.value = false
  currentTask.value = null
  taskMode.value = 'idle'
  activeTaskIntent.value = null
  activeExecutionPlan.value = null
  activeTaskSpec.value = null
  routeToolSequence.value = []
  brainPlanItems.value = []
  resetSteps()
  wsState.value = 'welcome'
  currentSlideIndex.value = 0
  failedReason.value = ''
  failedStage.value = ''
  activeArtifact.value = null
  activeToolMode.value = null
  toolPickerVisible.value = false
  nextTick(() => {
    restoringConversation.value = false
  })
}

function syncQuickRepliesFromMessages() {
  const pendingClarification = [...messages.value]
    .reverse()
    .find(msg => msg.role === 'ai' && msg.kind === 'clarification' && !msg.answered)

  if (!pendingClarification) {
    clearQuickReplies()
    return
  }

  setQuickReplies(
    pendingClarification.header || '请选择下一步',
    Array.isArray(pendingClarification.options) && pendingClarification.options.length
      ? pendingClarification.options
      : defaultClarificationOptions(pendingClarification.questionType),
    pendingClarification.question || ''
  )
  if (!quickReplyOptions.value.length) clearQuickReplies()
}

async function loadConversationsForSpace(spaceId, preferConversationId = '') {
  if (!spaceId) {
    conversations.value = []
    activeConversationId.value = ''
    clearConversationView()
    return
  }
  try {
    const res = await workspaceApi.listConversations(spaceId)
    conversations.value = res.data || []
    if (conversations.value.length) {
      // 优先级：URL 指定 > 当前 active（仍存在） > 列表第一项
      const preferred = preferConversationId
        && conversations.value.find(item => item.id === preferConversationId)?.id
      const sticky = conversations.value.find(item => item.id === activeConversationId.value)?.id
      const nextId = preferred || sticky || conversations.value[0].id
      await openConversation(nextId)
    } else {
      activeConversationId.value = ''
      clearConversationView()
    }
  } catch {
    Message.error('加载历史对话失败')
  }
}

async function openConversation(conversationId) {
  if (!conversationId) {
    activeConversationId.value = ''
    clearConversationView()
    return
  }
  // 切走前先 flush 当前对话挂起的 450ms 持久化定时器，防止旧对话最近的 UI 状态丢失
  if (persistConversationTimer && activeConversationId.value && activeConversationId.value !== conversationId) {
    try { await persistConversationSnapshot(true) } catch {}
  }
  // 切到新对话时，先把当前 SSE 失效化：避免之前对话还在跑的 text_delta / tool_call
  // 把状态写到刚打开的新对话视图（旧 listener 仍能跑，但 myGen 会失配自动 bail）。
  closeSseConnection()
  try {
    const res = await workspaceApi.getConversation(conversationId)
    activeConversationId.value = conversationId
    lastBoundConversationId.value = conversationId
    restoreFromConversation(res.data)
  } catch {
    Message.error('加载对话失败')
  }
}

async function ensureActiveConversation(seedTitle = '') {
  if (activeConversationId.value) return activeConversationId.value
  if (!selectedSpaceId.value) {
    Message.warning('请先选择一个工作空间')
    return ''
  }
  const title = seedTitle || '新对话'
  const res = await workspaceApi.createConversation(selectedSpaceId.value, title)
  const conversation = res.data
  conversations.value = [conversation, ...conversations.value]
  activeConversationId.value = conversation.id
  lastBoundConversationId.value = conversation.id
  return conversation.id
}

async function createNewConversation() {
  if (!selectedSpaceId.value) {
    Message.warning('请先选择一个工作空间')
    return
  }
  try {
    clearConversationView()
    const res = await workspaceApi.createConversation(selectedSpaceId.value, '新对话')
    const conversation = res.data
    conversations.value = [conversation, ...conversations.value]
    activeConversationId.value = conversation.id
    lastBoundConversationId.value = conversation.id
    await persistConversationSnapshot(true)
  } catch {
    Message.error('新建对话失败')
  }
}

async function removeActiveConversation() {
  if (!activeConversationId.value) return
  try {
    await workspaceApi.removeConversation(activeConversationId.value)
    conversations.value = conversations.value.filter(item => item.id !== activeConversationId.value)
    const nextId = conversations.value[0]?.id || ''
    activeConversationId.value = ''
    if (nextId) {
      await openConversation(nextId)
    } else {
      clearConversationView()
    }
  } catch {
    Message.error('删除对话失败')
  }
}

async function onConversationChange(id) {
  await openConversation(id)
}

function formatConversationMeta(item) {
  const updatedAt = item?.updatedAt || item?.lastMessageAt
  const messageCount = Number(item?.messageCount || 0)
  if (!updatedAt) return messageCount ? `${messageCount} 条消息` : '刚创建'
  const diff = Date.now() - new Date(updatedAt).getTime()
  const minutes = Math.max(1, Math.floor(diff / 60000))
  const ago = minutes < 60
    ? `${minutes} 分钟前`
    : minutes < 1440
      ? `${Math.floor(minutes / 60)} 小时前`
      : `${Math.floor(minutes / 1440)} 天前`
  return messageCount ? `${messageCount} 条消息 · ${ago}` : ago
}

function onSlideIndexChange(index) {
  currentSlideIndex.value = Number(index || 0)
  scheduleConversationPersist()
}

function onConversationAction(action, item) {
  if (action === 'rename') {
    renameConversation(item)
    return
  }
  if (action === 'delete') {
    removeConversation(item)
  }
}

function renameConversation(item) {
  const nextTitle = window.prompt('重命名对话', item.title)
  if (!nextTitle || nextTitle.trim() === item.title) return
  const payloadPromise = item.id === activeConversationId.value
    ? Promise.resolve({
        title: nextTitle.trim(),
        status: item.status || 'active',
        state: serializeState(),
        messages: serializeMessages(),
        lastMessageAt: item.lastMessageAt || item.updatedAt || new Date().toISOString()
      })
    : workspaceApi.getConversation(item.id).then((res) => ({
        title: nextTitle.trim(),
        status: res.data?.status || item.status || 'active',
        state: res.data?.state || {},
        messages: res.data?.messages || [],
        lastMessageAt: res.data?.lastMessageAt || item.lastMessageAt || item.updatedAt || new Date().toISOString()
      }))

  payloadPromise.then((payload) => workspaceApi.saveConversation(item.id, payload)).then(() => {
    conversations.value = conversations.value.map(conv =>
      conv.id === item.id ? { ...conv, title: nextTitle.trim() } : conv
    )
  }).catch(() => {
    Message.error('重命名失败')
  })
}

async function removeConversation(item) {
  try {
    await workspaceApi.removeConversation(item.id)
    conversations.value = conversations.value.filter(conv => conv.id !== item.id)
    if (item.id === activeConversationId.value) {
      const nextId = conversations.value[0]?.id || ''
      activeConversationId.value = ''
      if (nextId) {
        await openConversation(nextId)
      } else {
        clearConversationView()
      }
    }
  } catch {
    Message.error('删除对话失败')
  }
}

function deriveConversationTitle() {
  const firstUserText = messages.value.find(msg => msg.role === 'user')?.text?.trim()
  return currentTask.value?.topic || firstUserText || activeConversationTitle.value || '新对话'
}

// 持久化串行队列：同一对话内的 saveConversation / appendConversationMessage 必须按
// 调用顺序落库；否则旧请求晚到 resolve 会用过期数据覆盖新数据，造成 lastMessageAt
// 倒退、消息丢失或 sort_order 错乱。每个对话单独一条链，互不相干。
const conversationWriteQueues = new Map()  // conversationId -> Promise
function enqueueConversationWrite(conversationId, builder) {
  if (!conversationId) return Promise.resolve()
  const previous = conversationWriteQueues.get(conversationId) || Promise.resolve()
  const next = previous
    .catch(() => {})  // 单次失败不连累后续
    .then(() => builder())
  conversationWriteQueues.set(conversationId, next)
  next.finally(() => {
    if (conversationWriteQueues.get(conversationId) === next) {
      conversationWriteQueues.delete(conversationId)
    }
  })
  return next
}

function scheduleConversationPersist() {
  if (restoringConversation.value || !activeConversationId.value) return
  clearTimeout(persistConversationTimer)
  persistConversationTimer = setTimeout(() => {
    persistConversationSnapshot().catch((err) => {
      console.error('[conversation] persist failed', err)
    })
  }, 450)
}

async function persistConversationSnapshot(immediate = false) {
  if (restoringConversation.value || !activeConversationId.value) return
  if (!immediate) clearTimeout(persistConversationTimer)
  // 在队列里捕获 conversationId 与一份消息快照：用户可能在网络往返期间切到别的对话，
  // builder 要写的是"当时活跃"的那个，不是 await 之后的 activeConversationId。
  const targetConversationId = activeConversationId.value
  lastBoundConversationId.value = targetConversationId
  const payload = {
    title: deriveConversationTitle(),
    status: wsState.value === 'failed' ? 'failed' : wsState.value === 'done' ? 'completed' : 'active',
    state: serializeState(),
    messages: serializeMessages(),
    lastMessageAt: messages.value.at(-1)?.createdAt || new Date().toISOString()
  }
  await enqueueConversationWrite(targetConversationId, async () => {
    await workspaceApi.saveConversation(targetConversationId, payload)
    conversations.value = conversations.value.map(item =>
      item.id === targetConversationId
        ? {
            ...item,
            title: payload.title,
            status: payload.status,
            updatedAt: payload.lastMessageAt,
            lastMessageAt: payload.lastMessageAt,
            messageCount: payload.messages.length
          }
        : item
    ).sort((a, b) => new Date(b.updatedAt || b.lastMessageAt || 0) - new Date(a.updatedAt || a.lastMessageAt || 0))
  })
}

function flushConversationOnUnload() {
  if (restoringConversation.value || !activeConversationId.value) return
  clearTimeout(persistConversationTimer)
  const payload = {
    title: deriveConversationTitle(),
    status: wsState.value === 'failed' ? 'failed' : wsState.value === 'done' ? 'completed' : 'active',
    state: serializeState(),
    messages: serializeMessages(),
    lastMessageAt: messages.value.at(-1)?.createdAt || new Date().toISOString()
  }
  workspaceApi.saveConversationBeacon(activeConversationId.value, payload)
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushConversationOnUnload)
  window.addEventListener('beforeunload', flushConversationOnUnload)
}

watch(selectedSpaceId, async (spaceId, prevId) => {
  if (spaceId === prevId) return
  try { localStorage.setItem(SELECTED_SPACE_KEY, spaceId || '') } catch {}
  // 切空间时若 URL 指定了 conversationId 且属于该空间，优先打开它
  await loadConversationsForSpace(spaceId, route.params.conversationId || '')
  scheduleAgentRouteSync()
})

watch(activeConversationId, (id) => {
  try { localStorage.setItem(ACTIVE_CONVERSATION_KEY, id || '') } catch {}
  scheduleAgentRouteSync()
})

// ── URL ↔ space/conversation 双向同步 ─────────────────────────
let agentRouteSyncScheduled = false
function scheduleAgentRouteSync() {
  if (agentRouteSyncScheduled) return
  agentRouteSyncScheduled = true
  nextTick(() => {
    agentRouteSyncScheduled = false
    syncRouteFromAgentState()
  })
}

function syncRouteFromAgentState() {
  const spaceId        = selectedSpaceId.value || null
  const conversationId = activeConversationId.value || null
  const currParams     = route.params || {}
  // URL 已经一致 → skip（同时打破 watch(route) → state → watch(state) → push 的回环）
  if ((currParams.spaceId || null) === spaceId &&
      (currParams.conversationId || null) === conversationId) return

  // 当前 URL 缺 spaceId → 这是"进入页面后补完 URL"，用 replace 不污染历史
  // 当前 URL 已有 spaceId 但与 state 不一致 → 用户主动切换，用 push 让浏览器后退能回到上一个
  const isFillIn = !currParams.spaceId
  const navigate = isFillIn ? router.replace : router.push

  if (spaceId && conversationId) {
    navigate({ name: 'agent-conversation', params: { spaceId, conversationId } })
  } else if (spaceId) {
    navigate({ name: 'agent', params: { spaceId } })
  } else {
    navigate({ name: 'agent' })
  }
}

// 浏览器前进/后退/外部链接 → state
watch(() => [route.params.spaceId, route.params.conversationId], ([rSpace, rConv]) => {
  // 只在 agent 路由下生效（避免离开页面时还跑这个 watch）
  if (!route.name || (route.name !== 'agent' && route.name !== 'agent-conversation')) return

  const sSpace = selectedSpaceId.value || ''
  const sConv  = activeConversationId.value || ''

  if (rSpace && rSpace !== sSpace) {
    // 改 selectedSpaceId 会触发它自己的 watcher：内部会读 route.params.conversationId 优先打开
    selectedSpaceId.value = rSpace
    return
  }
  if (rConv && rConv !== sConv) {
    openConversation(rConv)
  }
})

watch(conversationSidebarCollapsed, (value) => {
  try {
    localStorage.setItem(CONVERSATION_SIDEBAR_COLLAPSED_KEY, value ? '1' : '0')
  } catch {}
})

watch(previewCollapsed, (value) => {
  try {
    localStorage.setItem(PREVIEW_COLLAPSED_KEY, value ? '1' : '0')
  } catch {}
})

// ── 示例卡片 ────────────────────────────────────────────────────
const examples = [
  { icon: IconMobile,  label: '小米 14 Ultra 发布会，大型，预算800万', text: '小米 14 Ultra 发布会，大型活动，预算800万，高端科技感风格' },
  { icon: IconCompass, label: '理想汽车上海车展参展策划，预算300万',  text: '理想汽车上海车展参展策划，中型，预算300万，商务专业风格' },
  { icon: IconCamera,  label: '大疆 Mavic 发布会，科技感，预算200万', text: '大疆 Mavic 发布会，大型活动，科技感风格，预算200万' }
]

function fillExample(text) {
  inputText.value = text
}

async function submitFollowupMessage(text) {
  inputText.value = text
  return send()
}

function clampPreviewWidth(nextWidth) {
  const total = layoutRef.value?.clientWidth || window.innerWidth
  const minWidth = total < 1200 ? 360 : 480
  const maxWidth = Math.max(minWidth, total - 360)
  return Math.min(Math.max(nextWidth, minWidth), maxWidth)
}

function syncPreviewWidth() {
  previewWidth.value = clampPreviewWidth(previewWidth.value)
}

function onResizeMove(event) {
  if (!isResizing.value || !layoutRef.value) return
  const rect = layoutRef.value.getBoundingClientRect()
  previewWidth.value = clampPreviewWidth(rect.right - event.clientX)
}

function stopResize() {
  if (!isResizing.value) return
  isResizing.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', stopResize)
}

function startResize() {
  if (!previewVisible.value) return
  isResizing.value = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', stopResize)
}

let   sse        = null      // SSE 连接实例（必须声明，防止全局污染）
let   resolveCurrent = null  // 当前 agent 任务的 resolve，用于外部终止
const hasActiveStream = ref(false)

// SSE 代次：每次 closeSseConnection / clearConversationView / openConversation
// 都会自增，所有 SSE 事件回调都用建连时捕获的 myGen 与全局对比，过滤"已被取代"
// 的旧连接残留事件。EventSource.close() 不会同步取消已派发到 JS 队列的事件，
// 没有这个守卫就会出现"切到 B 后 A 的 text_delta 还在写入"。
let sseGeneration = 0
let stopInProgress = false  // 防抖：避免快速点两次"停止"造成重复 POST 与状态错乱

// connectBrainSSE 注册"在 close 前最后落盘 streaming 半截文本"的钩子。
// 没有它的话，closeSseConnection() 增 sseGeneration 之后，1s 节流定时器即使还没跑，
// 它的 isCurrentSse() 守卫也会 bail——streamingText 永久留在闭包内存里、不写 DB。
// 用户在 SSE 跑到一半切走/关 tab/网络断了，最后那 0-1 秒的 token 就这么丢了，
// 重连后看到的是"半截字"或者完全没有。
let pendingStreamFlushHook = null

function closeSseConnection() {
  // 1) 先 flush——必须在 sseGeneration++ 之前，否则 hook 内部 isCurrentSse 会失配返回
  if (typeof pendingStreamFlushHook === 'function') {
    try { pendingStreamFlushHook('partial'); } catch {}
    pendingStreamFlushHook = null
  }
  sseGeneration += 1
  if (sse) {
    sse.close()
    sse = null
  }
  hasActiveStream.value = false
}

// 发送：直接走 Brain Agent，不再做前置意图解析
async function send() {
  const text = inputText.value.trim()
  const images = pendingImages.value.map(item => ({ ...item }))
  const docs   = pendingDocs.value.map(item => ({ ...item }))
  if ((!text && !images.length && !docs.length) || isRunning.value) return
  inputText.value = ''
  clearQuickReplies()

  // 兜底：如果当前页面仍保留着上下文，但 activeConversationId 被意外清空，
  // 优先继续绑定最近一次活跃对话，避免把“继续确认/继续优化”误建成新对话。
  const hasLiveContext = !!(
    currentSessionId.value ||
    docContent.value ||
    messages.value.length ||
    currentTask.value
  )
  if (!activeConversationId.value && hasLiveContext && lastBoundConversationId.value) {
    activeConversationId.value = lastBoundConversationId.value
  }

  // 如果正在等待澄清回答
  if (waitingForClarification.value) {
    const clarificationMsg = messages.value.find(msg => 
      msg.role === 'ai' && msg.kind === 'clarification' && !msg.answered
    )
    if (clarificationMsg) {
      clarificationReplyText.value = text
      await submitClarificationReply(clarificationMsg)
      return
    }
  }

  // 如果 PPT 已生成完成，开新对话；否则在同一对话内继续。
  // 注意：以前 failed 状态也会自动清掉 activeConversationId，但 brain 的 L2 软失败
  // 会发出有用的兜底叙述（"上次响应失败，下一步建议..."），用户的下一句多半是
  // 在那条叙述上继续推进。这里把 failed 分支去掉——hard fail 的话用户可以手动
  // 点"新建对话"，不靠隐式清状态。
  const pptDone = wsState.value === 'done' && (resultDownloadUrl.value || resultSlides.value.length > 0)
  if (pptDone) {
    activeConversationId.value = ''
    currentSessionId.value = ''
  }

  const conversationId = await ensureActiveConversation(
    (text || docs[0]?.name || images[0]?.name || '文件对话').slice(0, 24)
  )
  if (!conversationId) {
    inputText.value = text
    return
  }

  const wsRefs = pendingWorkspaceRefs.value.map(r => ({ ...r }))
  const displayText = text || (docs.length ? `（发送了 ${docs.length} 份文档）` : wsRefs.length ? `（引用了 ${wsRefs.length} 份空间文档）` : '（发送了图片）')
  const taskTurnId = beginTaskTurn()
  pushMsg('user', displayText, '', {
    taskTurnId,
    attachments: buildMessageAttachments(images),
    documents: docs.map(d => ({ id: d.id, name: d.name, size: d.size, mimeType: d.mimeType })),
    workspaceRefs: wsRefs
  })
  clearPendingImages()
  workspacePickerVisible.value = false
  await nextTick()
  if (historyRef.value) historyRef.value.scrollTop = historyRef.value.scrollHeight

  await runBrainTask(text, images, docs, wsRefs, activeToolMode.value?.key || '')
}

function retryCurrentTask() {
  const text = currentTask.value?.requirements || currentTask.value?.topic
  if (!text || isRunning.value) return
  inputText.value = text
  send()
}

function restoreTaskToInput() {
  if (currentTask.value?.requirements) {
    inputText.value = currentTask.value.requirements
  }
}

// ── 终止当前任务 ───────────────────────────────────────────────────
function stopTask() {
  if (stopInProgress) return  // 防抖：连续点击/键盘触发只发一次 stop
  stopInProgress = true
  // 真正的"完成"标记由 SSE done/error 或这里 isRunning=false 收尾，但避免锁死
  setTimeout(() => { stopInProgress = false }, 800)

  const sessionId = currentSessionId.value
  const stopConversationId = activeConversationId.value
  if (sessionId) {
    fetch(`/api/agent/${sessionId}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: stopConversationId || undefined })
    }).catch(() => {})
  }
  closeSseConnection()
  isRunning.value  = false
  isBuilding.value = false
  waitingForClarification.value = false
  wasManuallyStopped.value = true
  failedReason.value = '用户已停止任务'
  progressLabel.value = '任务已终止'
  progress.value = 0
  if (wsState.value === 'execution' || wsState.value === 'streaming') {
    wsState.value = 'interrupted'
  }
  // 移除残留的 loading/thinking 气泡，并清理未完成工具调用的进度文案
  messages.value = messages.value.filter(m => m.kind !== 'thinking')
  messages.value.forEach(m => {
    if (m.kind === 'tool-call' && m.progress && !m.resultSummary) {
      m.progress = ''
      m.resultSummary = '已终止'
    }
  })
  // 取消排队中的持久化，避免 450ms 后把中断态写成 active
  clearTimeout(persistConversationTimer)
  // resolve 挂起的 Promise，让队列处理器正常退出
  if (resolveCurrent) { resolveCurrent(); resolveCurrent = null }
  pushMsg('ai', '', '已终止当前任务。')
  // 立即落一次快照，带上 interrupted 状态
  scheduleConversationPersist()
}

// ── Brain Agent 任务 ──────────────────────────────────────────────
async function runBrainTask(text, images = [], docs = [], workspaceRefs = [], forceTool = '') {
  const shouldReuseSession = !!currentSessionId.value  // 是否复用现有后端上下文
  const isContinuingTask = wsState.value === 'execution' || wsState.value === 'streaming' || waitingForClarification.value
  const taskSeed = text || docs[0]?.name || images[0]?.name || '文件需求'
  isRunning.value = true
  waitingForClarification.value = false
  wasManuallyStopped.value = false
  resetProcessedStreamEvents()
  if (!shouldReuseSession) {
    resetSteps()
    brainPlanItems.value = defaultBrainPlan()
    currentTask.value = {
      topic: taskSeed.slice(0, 32),
      requirements: text || (docs.length ? `用户上传了文档：${docs.map(d => d.name).join('、')}` : '用户上传了图片，希望结合视觉内容继续分析')
    }
  }
  taskMode.value = 'brain'
  progress.value = shouldReuseSession ? Math.max(progress.value, 8) : 8
  progressLabel.value = isContinuingTask ? '继续推进...' : '正在理解需求...'
  wsState.value = 'execution'
  publishActivity(isContinuingTask ? `继续任务：${taskSeed.slice(0, 48)}` : `收到消息：${taskSeed.slice(0, 48)}`)

  // 立即显示 loading 气泡，不等 SSE 连上
  pushAiMessage({ kind: 'thinking' })

  return new Promise(resolve => {
    const timeoutId = setTimeout(() => {
      closeSseConnection()
      isRunning.value = false
      wsState.value = wsState.value !== 'done' ? 'failed' : wsState.value
      pushMsg('ai', '', '任务执行超时，已自动终止。')
      resolve()
    }, 30 * 60 * 1000)

    const done = () => { clearTimeout(timeoutId); resolveCurrent = null; resolve() }
    resolveCurrent = done

    // 在 fetch 前冻结 conversationId，防止启动期间用户切走后 SSE 把事件路由到错对话
    const taskConversationId = activeConversationId.value
    fetch('/api/agent/start', {
      method: 'POST',
      body: buildAgentFormData({
        message: text,
        spaceId: selectedSpaceId.value,
        apiKeys: settings.apiKeys,
        sessionId: currentSessionId.value || undefined,
        conversationId: taskConversationId || undefined,
        restoreSession: currentSessionId.value ? buildRestoreSessionPayload() : undefined,
        images,
        docs,
        workspaceRefs,
        forceTool
      })
    }).then(r => r.json()).then(res => {
      if (!res.success) {
        // 409 + 已有的 streamUrl：后端有别的 session 还在跑（用户上一轮中途切了路由
        // 没收尾），把它当成"重新接续"而不是"启动失败"——重订阅 SSE，让 backlog
        // 把漏掉的事件回放出来。这条消息本身没发出去，提示用户。
        if (res.streamUrl && res.sessionId && (res.status === 'running' || res.status === 'waiting_for_user')) {
          currentSessionId.value = res.sessionId
          // 1) 把这一轮提前 push 的 task-log（"收到消息：xxx"/"继续任务：xxx"）回滚——
          //    任务都没真发出去，不该在过程时间轴里留下虚假的"任务已收到"。
          // 2) 把用户消息气泡视觉降级（mark notSent），让用户清楚知道"这条没发"——
          //    避免用户对照 AI 后续输出（其实是上一轮在跑）以为 AI 在回这一轮。
          // 3) 移除 thinking 占位。
          const taskLogText = isContinuingTask ? `继续任务：${taskSeed.slice(0, 48)}` : `收到消息：${taskSeed.slice(0, 48)}`
          messages.value = messages.value.filter(m => {
            if (m.kind === 'thinking') return false
            if (m.kind === 'task-log' && m.text === taskLogText) return false
            return true
          })
          // 标记最近一条 user 消息为"未发送"——前端有 m.notSent 的 UI 处理（dim + 标签）
          const lastUserIdx = (() => {
            for (let i = messages.value.length - 1; i >= 0; i--) {
              if (messages.value[i]?.role === 'user') return i
            }
            return -1
          })()
          if (lastUserIdx >= 0) {
            messages.value[lastUserIdx] = { ...messages.value[lastUserIdx], notSent: true }
          }
          const note = res.status === 'waiting_for_user'
            ? '上面这条消息没发出去——会话还在等你回上一个澄清，请回完澄清再继续，或先点终止。'
            : '上面这条消息没发出去——会话还有任务在跑，等它结束再发，或先点终止。已重新订阅事件流接续看进度。'
          pushMsg('ai', '', note)
          connectBrainSSE(res.streamUrl, { onResolve: done, conversationId: taskConversationId })
          return
        }
        throw new Error(res.message || '启动失败')
      }
      currentSessionId.value = res.sessionId
      replaceLatestUserAttachments(res.attachments || [])
      connectBrainSSE(res.streamUrl, { onResolve: done, conversationId: taskConversationId })
    }).catch(err => {
      // catch 里也把 thinking 占位移掉——否则会留一个永远转的 loading 气泡
      messages.value = messages.value.filter(m => m.kind !== 'thinking')
      pushMsg('ai', '', `启动失败：${err.message}`)
      isRunning.value = false
      wsState.value = 'welcome'
      done()
    })
  })
}

function connectBrainSSE(url, resolveOrOptions = () => {}, maybeConversationId) {
  // 兼容旧签名 connectBrainSSE(url, doneFn)
  const resolve = typeof resolveOrOptions === 'function' ? resolveOrOptions : (resolveOrOptions?.onResolve || (() => {}))
  const explicitConversationId = typeof resolveOrOptions === 'object' && resolveOrOptions
    ? resolveOrOptions.conversationId
    : maybeConversationId

  closeSseConnection()
  const myGen = sseGeneration  // closeSseConnection 已自增，capture 取代后任何旧事件都过滤
  sse = new EventSource(url)
  hasActiveStream.value = true

  // 锁定本次流所属的会话 ID：用户中途切到别的对话时，SSE 事件绝不能把消息/工具进度
  // 写到当前视图，也不能把持久化 PATCH 到错误的 conversation。
  // Why: 之前用 activeConversationId.value，切换后 text_delta / flushStreamingPartial
  // 会落到用户新打开的对话里，出现"AI 回复错位"。
  const taskConversationId = explicitConversationId || activeConversationId.value
  // myGen 守卫：closeSseConnection / clearConversationView / openConversation 都会
  // 让 sseGeneration++，老 SSE 排队中的回调一律失效，不再写状态也不再持久化。
  const isCurrentSse = () => myGen === sseGeneration
  const isActiveTask = () => isCurrentSse() && activeConversationId.value === taskConversationId
  // 终止后 SSE 关闭前已 dispatch 的事件仍会走 listener；用这个守卫阻止写入状态。
  const isLiveTask = () => isActiveTask() && !wasManuallyStopped.value

  // 移除上一条 thinking 气泡的辅助函数（只影响当前视图）
  function popThinking() {
    if (!isActiveTask()) return
    messages.value = messages.value.filter(m => m.kind !== 'thinking')
  }

  // brain 主循环 done 时如果还有 propose_concept / run_strategy 之类的工具被转后台，
  // 后端继续推 background_done / artifact / clarification。这里维护剩余计数 +
  // 暂缓收尾，等所有后台任务回收完毕再真正关 SSE / 解锁输入框。否则用户看到的
  // 就是"输入框解锁了但右边永远没出方案"。
  let pendingBgCount = 0
  let doneDeferredData = null
  function finalizeDone() {
    if (isActiveTask()) {
      popThinking()
      handleDone(doneDeferredData || { mode: 'brain' })
    }
    closeSseConnection()
    isRunning.value = false
    resolve()
  }

  sse.addEventListener('thinking', () => {
    if (!isLiveTask() || !isRunning.value) return
    popThinking()
    pushAiMessage({ kind: 'thinking' })
  })

  sse.addEventListener('tool_call', e => {
    const d = JSON.parse(e.data)
    if (!isLiveTask()) return
    popThinking()
    progress.value = Math.min(progress.value + 8, 92)
    progressLabel.value = d.display || '正在执行工具...'
    pushAiMessage({
      kind: 'tool-call',
      tool: d.tool,
      display: d.display,
      toolCallId: d.toolCallId,
      progress: '',
      resultSummary: '',
      resultDetails: '',
      expanded: false
    })
    // 只对用户可感知的核心工具记录活动（内部调度工具静默）
    if (['run_strategy', 'build_ppt'].includes(d.tool)) {
      publishActivity(`开始${d.display || d.tool}`)
    }
  })

  sse.addEventListener('tool_progress', e => {
    const d = JSON.parse(e.data)
    if (!isLiveTask()) return
    // 更新最后一个 tool-call 气泡的 progress 字段
    const lastToolCall = [...messages.value].reverse().find(m => m.kind === 'tool-call')
    if (lastToolCall) lastToolCall.progress = d.message
    if (d.message) {
      progressLabel.value = d.message
      if (shouldSurfaceProgressMessage(d.message)) {
        publishActivity(d.message, d.timestamp || Date.now())
      }
    }
  })

  // 后台任务回收：之前因预算超时被转后台的工具，现在真实结果回来了。
  // 后端会同时把结果作为系统注入的 user message push 进 session.messages，
  // 下一轮 LLM 调用模型会看到——前端这里只负责把"已完成"提示给用户看。
  sse.addEventListener('background_done', e => {
    const d = JSON.parse(e.data)
    if (!isLiveTask()) return
    const elapsedSec = d.elapsedMs ? Math.round(d.elapsedMs / 1000) : null
    const elapsedTxt = elapsedSec != null ? `（耗时 ${elapsedSec}s）` : ''
    const text = d.status === 'success'
      ? `${d.toolName} 后台任务已完成${elapsedTxt}，结果将在下一轮提供给 AI`
      : `${d.toolName} 后台任务失败${elapsedTxt}`
    publishActivity(text, d.timestamp || Date.now())
    // 精准更新对应 tool-call 气泡的 progress 字段（不再是"运行中"）
    const matched = [...messages.value].reverse().find(m => m.kind === 'tool-call' && m.toolCallId === d.toolCallId)
    if (matched) matched.progress = text

    // 如果之前 done 因有后台任务被推迟收尾，这里倒计；归零时正式收尾。
    if (pendingBgCount > 0) {
      pendingBgCount -= 1
      // 更新 thinking 占位的副标题
      const thinking = messages.value.find(m => m.kind === 'thinking')
      if (thinking) {
        thinking.label = pendingBgCount > 0
          ? `后台还在跑 ${pendingBgCount} 项任务...`
          : '后台任务完成，整理结果...'
      }
      if (pendingBgCount === 0) finalizeDone()
    }
  })

  sse.addEventListener('text', e => {
    const d = JSON.parse(e.data)
    if (!isLiveTask()) return
    popThinking()
    if (d.text) {
      pushMsg('ai', '', d.text, { kind: 'narration' })
      maybeSetQuickRepliesFromAiText(d.text)
    }
  })

  // 流式文字：用本地 buffer 累加 token，即便用户切走也不丢数据；
  // 持久化始终写回 taskConversationId，UI 只在活跃时镜像。
  let streamingMsgId = null
  let streamingText = ''
  let streamingMeta = null
  let streamingPartialTimer = null
  const flushStreamingPartial = (finalStatus) => {
    if (!streamingMsgId || !taskConversationId) return
    if (wasManuallyStopped.value && finalStatus !== 'complete') return
    // close-before-flush 路径：closeSseConnection 调本钩子时还没自增 sseGeneration，
    // 所以 isCurrentSse() 仍然 true，正常走持久化。新 SSE 取代场景才需要 bail。
    if (!isCurrentSse()) return
    const snapshot = {
      id: streamingMsgId,
      role: 'ai',
      text: streamingText,
      html: resolveAiHtml(streamingText),
      kind: 'narration',
      streamStatus: finalStatus || 'partial',
      taskTurnId: streamingMeta?.taskTurnId || '',
      createdAt: streamingMeta?.createdAt || new Date().toISOString()
    }
    // 走串行队列，避免与 persistConversationSnapshot 同时写同一对话造成时间戳/排序错乱
    enqueueConversationWrite(taskConversationId, () =>
      workspaceApi.appendConversationMessage(taskConversationId, {
        message: snapshot,
        status: 'active'
      }).catch(() => {})
    )
  }

  // 把 flush 钩子挂到模块级变量，让 closeSseConnection 在 SSE 关闭前能 force flush
  // 当前未及落盘的 streaming partial（比如 1s 节流还没跑、用户 SSE 已断）。
  pendingStreamFlushHook = flushStreamingPartial

  sse.addEventListener('text_delta', e => {
    const { delta } = JSON.parse(e.data)
    if (!delta) return
    if (wasManuallyStopped.value) return
    if (!isCurrentSse()) return  // 老 SSE 在 close 后排队事件继续触发，丢弃即可

    if (!streamingMsgId) {
      streamingMsgId = createMessageId('ai')
      streamingText = ''
      streamingMeta = {
        taskTurnId: currentTaskTurnId.value || '',
        createdAt: new Date().toISOString()
      }
    }
    streamingText += delta

    if (isActiveTask()) {
      let msg = messages.value.find(m => m.id === streamingMsgId)
      if (!msg) {
        // 首次进入或用户切回来后 restoreFromConversation 未带上该 msg，都要补一条占位气泡
        popThinking()
        msg = {
          id: streamingMsgId,
          role: 'ai',
          text: '',
          html: '',
          kind: 'narration',
          streamStatus: 'partial',
          taskTurnId: streamingMeta.taskTurnId,
          createdAt: streamingMeta.createdAt
        }
        messages.value.push(msg)
      }
      msg.text = streamingText
      msg.html = resolveAiHtml(streamingText)
      // 仅在用户未向上滚动时才自动滚底
      const el = historyRef.value
      if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
        el.scrollTop = el.scrollHeight
      }
    }

    // Throttle partial persist: 每 ~1s flush 一次，避免刷新丢整条流式回复
    if (!streamingPartialTimer) {
      streamingPartialTimer = setTimeout(() => {
        streamingPartialTimer = null
        flushStreamingPartial('partial')
      }, 1000)
    }
  })

  sse.addEventListener('text_end', () => {
    if (!isCurrentSse()) return
    if (wasManuallyStopped.value) {
      if (streamingPartialTimer) { clearTimeout(streamingPartialTimer); streamingPartialTimer = null }
      streamingMsgId = null
      streamingText = ''
      streamingMeta = null
      return
    }
    if (streamingMsgId) {
      if (isActiveTask()) {
        let msg = messages.value.find(m => m.id === streamingMsgId)
        if (!msg) {
          msg = {
            id: streamingMsgId,
            role: 'ai',
            text: streamingText,
            html: resolveAiHtml(streamingText),
            kind: 'narration',
            streamStatus: 'complete',
            taskTurnId: streamingMeta?.taskTurnId || '',
            createdAt: streamingMeta?.createdAt || new Date().toISOString()
          }
          messages.value.push(msg)
        } else {
          msg.text = streamingText
          msg.html = resolveAiHtml(streamingText)
          msg.streamStatus = 'complete'
        }
        Object.assign(msg, buildAiMessageMeta(msg.text, msg.html))
        maybeSetQuickRepliesFromAiText(msg.text)
      }
      if (streamingPartialTimer) { clearTimeout(streamingPartialTimer); streamingPartialTimer = null }
      flushStreamingPartial('complete')
      if (isActiveTask()) scheduleConversationPersist()
      streamingMsgId = null
      streamingText = ''
      streamingMeta = null
    }
  })

  sse.addEventListener('clarification', e => {
    const d = JSON.parse(e.data)
    if (shouldSkipStreamEvent('clarification', d)) return
    if (!isLiveTask()) return
    popThinking()
    waitingForClarification.value = true
    isRunning.value = false
    pushAiMessage({
      kind: 'clarification',
      header: d.header || '',
      question: d.question,
      questionType: d.type,
      options: Array.isArray(d.options) ? d.options : [],
      answered: false
    })
    const options = Array.isArray(d.options) && d.options.length ? d.options : defaultClarificationOptions(d.type)
    setQuickReplies(
      d.header || (d.type === 'confirmation' ? '下一步' : d.type === 'missing_info' ? '补充信息' : '选择方向'),
      options,
      d.question || ''
    )
    if (!options.length) clearQuickReplies()
    scheduleConversationPersist()
  })

  sse.addEventListener('plan_update', e => {
    const d = JSON.parse(e.data)
    if (!isLiveTask()) return
    brainPlanItems.value = Array.isArray(d.items) ? d.items : []
    progress.value = Math.max(progress.value, 15)
    progressLabel.value = '正在执行计划'
    // 不 publishActivity：计划步骤是内部调度信息，不需要出现在 chat 时间轴
  })

  sse.addEventListener('execution_plan', e => {
    const d = JSON.parse(e.data)
    if (!isLiveTask()) return
    activeExecutionPlan.value = d.plan || null
    // 不 publishActivity：执行规划是内部信息
    scheduleConversationPersist()
  })

  sse.addEventListener('task_spec', e => {
    const d = JSON.parse(e.data)
    if (!isLiveTask()) return
    activeTaskSpec.value = d.taskSpec || null
    // 不 publishActivity：主路径是内部路由信息
    scheduleConversationPersist()
  })

  sse.addEventListener('route_update', e => {
    const d = JSON.parse(e.data)
    if (!isLiveTask()) return
    routeToolSequence.value = Array.isArray(d.toolSequence) ? d.toolSequence : []
    // 不 publishActivity：工具序列是内部路由信息
    scheduleConversationPersist()
  })

  sse.addEventListener('brief_update', e => {
    const d = JSON.parse(e.data)
    if (!isLiveTask()) return
    currentTask.value = {
      ...(currentTask.value || {}),
      ...(d.brief || {})
    }
    // 任务简报静默更新，不产生 chat 条目（startBrain 的"收到新任务"已足够）
  })

  sse.addEventListener('task_intent', e => {
    const d = JSON.parse(e.data)
    if (shouldSkipStreamEvent('task_intent', d)) return
    if (!isLiveTask()) return
    activeTaskIntent.value = d.taskIntent || null
    // 不 publishActivity：意图识别结果在预览区 hint 里已有体现
    scheduleConversationPersist()
  })

  sse.addEventListener('tool_result', e => {
    const d = JSON.parse(e.data)
    if (!isLiveTask()) return
    const matched = [...messages.value].reverse().find((msg) => msg.kind === 'tool-call' && msg.tool === d.tool && !msg.resultSummary)
    if (matched) {
      matched.resultSummary = d.summary || (d.ok ? '执行完成' : '执行失败')
      matched.resultDetails = d.details || ''
    } else {
      pushAiMessage({
        kind: 'tool-call',
        tool: d.tool,
        display: d.tool,
        progress: '',
        resultSummary: d.summary || (d.ok ? '执行完成' : '执行失败'),
        resultDetails: d.details || '',
        expanded: false
      })
    }
    if (!matched?.resultSummary || d.ok === false) {
      publishActivity(d.summary || `${d.tool} 已完成`, d.timestamp || Date.now())
    }
    scheduleConversationPersist()
  })

  // 空间文档更新（auto-save / save_to_workspace）— 全局事件，切会话也应触发
  sse.addEventListener('workspace_updated', e => {
    const d = JSON.parse(e.data)
    // 刷新空间文档列表
    loadSpaces()
    // 通知 WorkspaceView 刷新（BroadcastChannel 跨组件通信）
    try {
      const bc = new BroadcastChannel('oc_workspace_updated')
      bc.postMessage(d)
      bc.close()
    } catch {}
    // 标记最近保存/读取的文档
    if (d.docId) {
      recentlySavedDocIds.value = new Set([d.docId, ...recentlySavedDocIds.value])
      setTimeout(() => {
        recentlySavedDocIds.value = new Set([...recentlySavedDocIds.value].filter(id => id !== d.docId))
      }, 4000)
    }
  })

  // 复用现有事件处理 — handleArtifact / handleDoc* / handleSlide* / handleDone
  // 都会写 messages / artifacts / docContent 等绑定到当前视图的状态，切走后必须跳过
  sse.addEventListener('artifact', e => {
    if (!isLiveTask()) return
    handleArtifact(JSON.parse(e.data))
  })
  sse.addEventListener('doc_section_added', e => {
    if (!isLiveTask()) return
    handleDocSectionAdded(JSON.parse(e.data))
  })
  sse.addEventListener('doc_ready', e => {
    if (!isLiveTask()) return
    handleDocReady(JSON.parse(e.data))
  })
  sse.addEventListener('doc_opened', e => {
    if (!isLiveTask()) return
    handleDocOpened(JSON.parse(e.data))
  })
  sse.addEventListener('doc_preview_updated', e => {
    if (!isLiveTask()) return
    handleDocPreviewUpdated(JSON.parse(e.data))
  })
  sse.addEventListener('slide_added', e => {
    if (!isLiveTask()) return
    handleSlideAdded(JSON.parse(e.data))
  })
  sse.addEventListener('done', e => {
    if (!isCurrentSse()) return
    streamingMsgId = null
    streamingText = ''
    streamingMeta = null
    const data = (() => { try { return JSON.parse(e.data || '{}') } catch { return {} } })()

    // brain 主循环结束但后台还有 propose_concept / run_strategy 在跑：
    // 推迟收尾。否则关了 SSE 后续 artifact / clarification 推回来都丢了。
    const bgCount = Number(data.backgroundPending || 0)
    if (bgCount > 0) {
      pendingBgCount = bgCount
      doneDeferredData = data
      if (isActiveTask()) {
        popThinking()
        pushAiMessage({ kind: 'thinking', label: `后台还在跑 ${bgCount} 项任务...` })
      }
      return
    }

    if (isActiveTask()) {
      popThinking()
      handleDone(data)
    }
    closeSseConnection()
    isRunning.value = false
    resolve()
  })

  sse.addEventListener('error', e => {
    if (!isCurrentSse()) return
    streamingMsgId = null
    streamingText = ''
    streamingMeta = null
    if (isActiveTask()) {
      popThinking()
      if (e.data) {
        try {
          const d = JSON.parse(e.data)
          if (d.message) pushMsg('ai', '', d.message)
          failedReason.value = d.message || '任务执行出错'
          // 后端给了 retryable + lastUserMessage：渲染一个"重试上一轮"按钮，
          // 用户点了就用同一条消息重发，免去手动复制
          if (d.retryable && d.lastUserMessage) {
            pushAiMessage({
              kind: 'error-retry',
              errorMessage: d.message || 'AI 调用失败',
              lastUserMessage: d.lastUserMessage,
              retryUsed: false
            })
          }
        } catch {}
      } else if (!failedReason.value) {
        failedReason.value = '任务连接中断，请重试。'
      }
      if (wsState.value !== 'done') wsState.value = 'failed'
    }
    closeSseConnection()
    isRunning.value = false
    resolve()
  })
}

function handleArtifact(d) {
  const payload = d.payload || {}

  // 任务理解：只在对话内渲染，不进右侧预览面板
  if (d.artifactType === 'task_brief') {
    const existingBriefIdx = messages.value.findIndex(msg => msg.kind === 'brief-card')
    const briefMsg = { kind: 'brief-card', payload }
    if (existingBriefIdx >= 0) {
      Object.assign(messages.value[existingBriefIdx], briefMsg)
    } else {
      pushAiMessage(briefMsg)
    }
    return
  }

  // 创意方向：
  // - 流式 partial 阶段（payload.partial === true）：只更新右侧 artifacts 数组驱动预览，
  //   不动对话流，避免对话卡反复闪烁。
  // - 最终态：照常渲染对话内 concept-card；artifacts 也保留同步，让右侧预览继续可见。
  if (d.artifactType === 'concept_proposal') {
    const iteration = payload.iteration || 1
    const existingArtIdx = artifacts.value.findIndex(
      item => item.artifactType === 'concept_proposal' && (item.payload?.iteration || 1) === iteration
    )
    const conceptArtifact = existingArtIdx >= 0
      ? { ...artifacts.value[existingArtIdx], payload }
      : { id: `concept_${iteration}_${Date.now()}`, artifactType: 'concept_proposal', payload }
    if (existingArtIdx >= 0) artifacts.value.splice(existingArtIdx, 1)
    artifacts.value.unshift(conceptArtifact)
    activeArtifact.value = conceptArtifact

    if (!payload.partial) {
      const existingConceptIdx = messages.value.findIndex(
        msg => msg.kind === 'concept-card' && msg.iteration === iteration
      )
      const conceptMsg = {
        kind: 'concept-card',
        iteration,
        activeDirectionIndex: 0,
        payload
      }
      if (existingConceptIdx >= 0) {
        Object.assign(messages.value[existingConceptIdx], conceptMsg)
      } else {
        pushAiMessage(conceptMsg)
      }
    }
    return
  }

  // brief 质疑：Agent 对 brief 的主动挑战，直接在对话里渲染
  if (d.artifactType === 'brief_challenge') {
    const challengeMsg = {
      kind: 'challenge-card',
      payload
    }
    pushAiMessage(challengeMsg)
    return
  }

  const existingIndex = payload.artifactKey
    ? artifacts.value.findIndex(item => item.artifactType === d.artifactType && item.payload?.artifactKey === payload.artifactKey)
    : -1
  const artifact = existingIndex >= 0
    ? {
        ...artifacts.value[existingIndex],
        artifactType: d.artifactType,
        payload
      }
    : {
        id: `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        artifactType: d.artifactType,
        payload
      }
  if (existingIndex >= 0) {
    artifacts.value.splice(existingIndex, 1)
  }
  artifacts.value.unshift(artifact)
  if (d.artifactType === 'ppt_page') return

  // 在对话流中插入产出物卡片，并自动切换右侧面板
  const cardTypes = ['research_result', 'note_detail', 'image_search_result', 'generated_image', 'review_feedback', 'image_canvas', 'ppt_outline']
  if (cardTypes.includes(d.artifactType)) {
    const cardMsg = existingIndex >= 0
      ? messages.value.find(msg => msg.kind === 'artifact-card' && msg.artifactId === artifact.id)
      : null
    const nextCard = {
      kind: 'artifact-card',
      artifactType: d.artifactType,
      artifactId: artifact.id,
      title: artifactCardTitle(d.artifactType, payload),
      summary: artifactCardSummary(d.artifactType, payload),
      chips: artifactCardChips(d.artifactType, payload),
      payload
    }
    if (cardMsg) {
      Object.assign(cardMsg, nextCard)
    } else {
      pushAiMessage(nextCard)
    }
    // 自动切换右侧面板到最新产出物
    activeArtifact.value = cardMsg || nextCard
  }
  if (d.artifactType === 'ppt_outline') {
    isBuilding.value = true
    buildTotal.value = Number(d.payload?.total || (Array.isArray(d.payload?.pages) ? d.payload.pages.length : 0) || 0)
    progressLabel.value = buildTotal.value
      ? `PPT 结构已确认，开始生成 ${buildTotal.value} 页内容...`
      : 'PPT 结构已确认，开始生成页面...'
    if (wsState.value !== 'done') wsState.value = 'execution'
  }
  if (['plan_draft', 'review_feedback', 'image_canvas', 'image_search_result', 'generated_image', 'ppt_outline'].includes(d.artifactType)) {
    publishActivity(`${artifactTypeLabel(d.artifactType)}已更新：${artifactTimelineText({ artifactType: d.artifactType, payload: d.payload || {} })}`, d.timestamp || Date.now())
  }

}

function artifactCardTitle(type, payload) {
  if (type === 'task_brief') return `任务理解：${payload.brand || payload.topic || '已整理'}`
  if (type === 'research_result') return `搜索研究：${payload.focus || '行业资讯'}`
  if (type === 'note_detail') {
    const n0 = Array.isArray(payload.notes) ? payload.notes[0] : null;
    return payload.count > 1
      ? `笔记内容：${payload.count} 条`
      : `笔记内容：${n0?.title || '已抓取'}`;
  }
  if (type === 'image_search_result') return `找图结果：${payload.summary?.totalImages || 0} 张候选图`
  if (type === 'generated_image') return `生成图片：${payload.intent || '已生成'}`
  if (type === 'concept_proposal') {
    const dirs = Array.isArray(payload.directions) ? payload.directions : []
    return `创意方向对比 · 第 ${payload.iteration || 1} 版（${dirs.length || 3} 条方向）`
  }
  if (type === 'brief_challenge') return payload.hasConcerns ? `Brief 审视 · ${payload.concerns?.length || 0} 条风险` : 'Brief 审视 · 无红旗'
  if (type === 'plan_draft') return `方案草稿：${payload.planTitle || '已生成'}`
  if (type === 'plan_document') return `策划文档：${payload.title || '已生成'}`
  if (type === 'review_feedback') return `评审意见：第 ${payload.round || 1} 轮，评分 ${payload.score || 0}`
  if (type === 'image_canvas') return `图片画布：${payload.summary?.totalImages || 0} 张候选图`
  if (type === 'ppt_outline') return `PPT大纲：共 ${payload.total || 0} 页`
  if (type === 'ppt_slides') return `PPT成稿：共 ${payload.pageCount || 0} 页`
  return artifactTypeLabel(type)
}

function artifactCardSummary(type, payload) {
  if (type === 'task_brief') return payload.parsedGoal || payload.goal || ''
  if (type === 'research_result') {
    if (Array.isArray(payload.results) && payload.results.length) {
      return stripHtmlText(payload.results[0]?.snippet || payload.results[0]?.title || '')
    }
    return stripHtmlText(payload.summary || '')
  }
  if (type === 'note_detail') {
    const n0 = Array.isArray(payload.notes) ? payload.notes[0] : null
    if (!n0) return ''
    const imgCount = (n0.images?.length || 0) + (n0.videoPoster ? 1 : 0)
    const body = stripHtmlText(n0.body || n0.statusHint || '').slice(0, 60)
    return imgCount > 0 ? `${imgCount} 张图${body ? ' · ' + body : ''}` : body
  }
  if (type === 'image_search_result') return payload.summaryText || `已找到 ${payload.summary?.totalImages || 0} 张图片，可在右侧继续筛选。`
  if (type === 'generated_image') return payload.prompt || '图片已生成，可在右侧预览和下载。'
  if (type === 'concept_proposal') {
    const dirs = Array.isArray(payload.directions) ? payload.directions : []
    if (dirs.length) return dirs.map(d => `${d.label || ''} ${d.codeName || d.themeName || ''}`).filter(s => s.trim()).join(' / ')
    return payload.differentiationAxis || ''
  }
  if (type === 'brief_challenge') return payload.overallAssessment || ''
  if (type === 'plan_draft') return payload.coreStrategy || ''
  if (type === 'plan_document') return payload.summary || '完整策划方案文档已生成，可在右侧继续编辑和确认。'
  if (type === 'review_feedback') {
    if (payload.passed) return payload.specificFeedback || '方案通过评审，当前可以进入下一步。'
    return payload.weaknesses?.[0] || payload.suggestions?.[0] || '方案待优化'
  }
  if (type === 'image_canvas') {
    const summary = payload.summary || {}
    return `已汇总 ${summary.totalImages || 0} 张图片，其中生图 ${summary.generatedImages || 0} 张、搜图 ${summary.searchedImages || 0} 张。`
  }
  if (type === 'ppt_outline') {
    const pages = Array.isArray(payload.pages) ? payload.pages : []
    if (!pages.length) return payload.title || 'PPT结构已生成，可在右侧查看页面结构。'
    return pages
      .slice(0, 3)
      .map((page, index) => pptPageTitleLabel(page, index))
      .join(' · ')
  }
  if (type === 'ppt_slides') {
    return payload.downloadUrl
      ? '最终 PPT 已生成，可在右侧预览、翻页并下载。'
      : '最终 PPT 预览已生成，可在右侧查看完整页面。'
  }
  return ''
}

function artifactCardChips(type, payload) {
  if (type === 'task_brief') return (payload.keyThemes || []).slice(0, 3)
  if (type === 'concept_proposal') {
    const dirs = Array.isArray(payload.directions) ? payload.directions : []
    return dirs.map(d => `${d.label || ''} ${d.codeName || d.themeName || ''}`.trim()).filter(Boolean).slice(0, 3)
  }
  if (type === 'plan_draft') return (payload.highlights || []).slice(0, 3)
  if (type === 'plan_document') return (payload.highlights || []).slice(0, 3)
  if (type === 'image_canvas') {
    const chips = []
    if (payload.summary?.coveredPages) chips.push(`覆盖${payload.summary.coveredPages}页`)
    if (payload.summary?.generatedImages) chips.push(`${payload.summary.generatedImages}张生图`)
    if (payload.summary?.searchedImages) chips.push(`${payload.summary.searchedImages}张搜图`)
    return chips.slice(0, 3)
  }
  if (type === 'image_search_result') {
    const chips = []
    if (payload.intent) chips.push(payload.intent)
    if (payload.summary?.totalImages) chips.push(`${payload.summary.totalImages}张图`)
    if (payload.summary?.searchedImages) chips.push(`${payload.summary.searchedImages}张搜图`)
    return chips.slice(0, 3)
  }
  if (type === 'generated_image') {
    return [payload.intent || 'AI 生图'].filter(Boolean).slice(0, 3)
  }
  if (type === 'ppt_outline') {
    return (Array.isArray(payload.pages) ? payload.pages : [])
      .slice(0, 3)
      .map(page => pptLayoutLabel(page?.layout || page?.type))
  }
  if (type === 'ppt_slides') {
    const chips = []
    if (payload.pageCount) chips.push(`${payload.pageCount}页`)
    if (payload.downloadUrl) chips.push('可下载')
    if (payload.fileName) chips.push(payload.fileName)
    return chips.slice(0, 3)
  }
  return []
}

// 写型工具（patch / find_replace / append / update / save）结束后无副作用刷新预览
// 区别于 handleDocReady：不 pushAiMessage，不改 progressLabel，不设 quickReplies
// 区别于 handleDocOpened：不创建新的 artifact-card，仅在已经在预览这份文档时静默刷新；
// 如果用户当前看的是别的内容（图/PPT），切到 document 视图但不打扰对话流
function handleDocPreviewUpdated(d) {
  if (!d?.docContent) return
  docContent.value = d.docContent
  if (d.title) docTitle.value = d.title
  isDocStreaming.value = false
  docStreamProgress.value = 100
  docStreamPhase.value = 'final'
  // 只有当前不在 ppt/image 等其他预览状态时才切到 document，避免 agent 后台改文档
  // 把用户正在看的 PPT 预览给抢走
  if (wsState.value !== 'ppt' && wsState.value !== 'image') {
    wsState.value = 'document'
    previewCollapsed.value = false
  }
}

function handleDocOpened(d) {
  // 从空间读取已有文档并推到右侧预览面板（区别于 handleDocReady：不 push AI 消息、不设 quickReplies）
  if (!d?.docContent) return
  docContent.value = d.docContent
  docTitle.value = d.title || '文档'
  isDocStreaming.value = false
  docStreamProgress.value = 100
  docStreamPhase.value = 'final'
  wsState.value = 'document'
  previewCollapsed.value = false
  const artifact = {
    kind: 'artifact-card',
    artifactType: 'plan_document',
    artifactId: createMessageId('artifact'),
    title: d.title || '文档',
    summary: `已打开空间文档：${d.title || d.docId || ''}`,
    chips: [],
    payload: {
      title: d.title || '',
      docId: d.docId || ''
    }
  }
  activeArtifact.value = artifact
  publishActivity(`已打开文档：${d.title || d.docId || ''}`, Date.now())
}

function handleDocReady(d) {
  docContent.value = d.docContent || d.docHtml || ''
  docTitle.value = d.title || currentTask.value?.topic || '策划方案'
  isDocStreaming.value = false
  docStreamProgress.value = 100
  docStreamPhase.value = 'final'
  progress.value = Math.max(progress.value, 88)
  progressLabel.value = '策划文档已生成，等待对话确认下一步'
  wsState.value = 'document'
  const documentCard = {
    kind: 'artifact-card',
    artifactType: 'plan_document',
    artifactId: createMessageId('artifact'),
    title: artifactCardTitle('plan_document', {
      title: d.title || docTitle.value,
      summary: latestPlanDraft.value?.payload?.coreStrategy || '',
      highlights: latestPlanDraft.value?.payload?.highlights || []
    }),
    summary: artifactCardSummary('plan_document', {
      summary: latestPlanDraft.value?.payload?.coreStrategy || ''
    }),
    chips: artifactCardChips('plan_document', {
      highlights: latestPlanDraft.value?.payload?.highlights || []
    }),
    payload: {
      title: d.title || docTitle.value,
      summary: latestPlanDraft.value?.payload?.coreStrategy || '',
      highlights: latestPlanDraft.value?.payload?.highlights || []
    }
  }
  pushAiMessage(documentCard)
  activeArtifact.value = documentCard
  isRunning.value = false
  // 把 run_strategy 的 tool-call 气泡标成完成（否则会停在"正在搭建策划文档初稿..."）
  const lastStrategyCall = [...messages.value].reverse().find(m => m.kind === 'tool-call' && (m.tool === 'run_strategy' || String(m.display || '').includes('制定策划方案')))
  if (lastStrategyCall) {
    lastStrategyCall.progress = '策划文档已整理完成'
    lastStrategyCall.status = 'done'
  }
  publishActivity('策划文档已生成', d.timestamp || Date.now())
  pushMsg('ai', '', '方案已整理到右侧，你看看方向对不对 👉')
  setQuickReplies('下一步', [
    {
      label: '开始生成 PPT',
      value: '可以开始生成 PPT',
      description: '按当前这版方案直接出 PPT。'
    },
    {
      label: '专家评审',
      value: '请对这版方案进行专家评审，给出评分和改进建议',
      description: 'AI 专家对方案打分，指出优点和不足。'
    },
    {
      label: '继续调整',
      value: '先别生成 PPT，我想再调整一下',
      description: '说说要收紧哪里，或补充新的限制条件。'
    }
  ], '下一步想怎么走？')
}

function onReviewRequest() {
  if (isRunning.value) return
  sendMessage('请对这版方案进行专家评审，给出评分和改进建议')
}

// 用户点"重试上一轮"按钮：把上次的输入填回 inputText，再触发一次 send()。
// 这样能复用全部现有发送逻辑（attachments 不能 retry，但文本类失败这是最常见的 90%+）
function onRetryFailedTurn(msg) {
  if (msg.retryUsed || isRunning.value) return
  msg.retryUsed = true
  inputText.value = msg.lastUserMessage || ''
  // 触发 send()——会按现有逻辑接到当前会话或新建
  send()
}

function handleDocSectionAdded(d) {
  docContent.value = d.docContent || docContent.value
  docTitle.value = d.title || docTitle.value || currentTask.value?.topic || '策划方案'
  docStreamProgress.value = Number(d.progress || 0)
  isDocStreaming.value = docStreamProgress.value < 100
  docStreamPhase.value = d.provisional ? 'draft' : 'final'
  progress.value = Math.max(progress.value, 72)

  // 构造进度标签，显示在工具气泡里
  const sectionLabel = d.sectionTitle
    ? `${d.provisional ? '起草' : '润色'}中：${d.sectionTitle}`
    : (d.provisional ? '正在搭建策划文档初稿...' : '正在润色策划文档...')
  progressLabel.value = sectionLabel

  // 把当前章节进度反映到最后一个 tool-call 气泡（inline 更新，不创建新条目）
  const lastToolCall = [...messages.value].reverse().find(m => m.kind === 'tool-call')
  if (lastToolCall) lastToolCall.progress = sectionLabel

  wsState.value = 'document'
  previewCollapsed.value = false

  // 只在首次进入文档状态时建立 activeArtifact，后续只更新字段，避免面板反复重建闪烁
  if (!activeArtifact.value || activeArtifact.value.artifactType !== 'plan_document') {
    const payload = {
      title: docTitle.value,
      summary: latestPlanDraft.value?.payload?.coreStrategy || ''
    }
    // 优先复用消息流里已有的 plan_document 卡片（及其 artifactId），避免 activeArtifact 与卡片 id 错位
    const existingCard = messages.value.find(m => m.kind === 'artifact-card' && m.artifactType === 'plan_document')
    const artifactId = existingCard?.artifactId || createMessageId('artifact')
    activeArtifact.value = {
      artifactType: 'plan_document',
      artifactId,
      title: docTitle.value,
      payload
    }
    if (!existingCard) {
      // 推一张 artifact-card 到消息流，作为流式过程中用户切走后切回预览面板的入口
      pushAiMessage({
        kind: 'artifact-card',
        artifactType: 'plan_document',
        artifactId,
        title: artifactCardTitle('plan_document', payload),
        summary: artifactCardSummary('plan_document', payload),
        chips: [],
        payload
      })
    }
  } else if (activeArtifact.value.title !== docTitle.value) {
    activeArtifact.value = { ...activeArtifact.value, title: docTitle.value }
    // 同步更新已有卡片的标题，保持一致
    const existingCard = messages.value.find(m => m.kind === 'artifact-card' && m.artifactId === activeArtifact.value.artifactId)
    if (existingCard) {
      existingCard.title = artifactCardTitle('plan_document', { title: docTitle.value, summary: existingCard.payload?.summary || '' })
      existingCard.payload = { ...(existingCard.payload || {}), title: docTitle.value }
    }
  }
  // ✗ 不再对每个章节调用 publishActivity —— 右侧预览区已在实时展示，chat 不需要流水账
}

function handleSlideAdded(d) {
  // 第一张页到来时切换到 streaming 状态，右侧切换到 PPT 视图
  if (wsState.value !== 'streaming' && wsState.value !== 'done') {
    wsState.value = 'streaming'
    isBuilding.value = true
    activeArtifact.value = { artifactType: 'ppt_slides' }
    previewCollapsed.value = false
  }
  buildTotal.value = d.total || 0
  const current = d.index + 1
  const total = d.total || 0
  const shouldLogPage = total > 0
    ? (total <= 8 || current === 1 || current === total || current % 3 === 0)
    : true
  if (shouldLogPage) {
    publishActivity(
      total > 0
        ? `PPT 已推进到 ${current} / ${total} 页${d.title ? `：${d.title}` : ''}`
        : `已生成第 ${current} 页${d.title ? `：${d.title}` : ''}`,
      d.timestamp || Date.now()
    )
  }
  resultSlides.value = [...resultSlides.value, d.html]
  scheduleConversationPersist()
  // 调用 SlideViewer 的 appendSlide 方法
  slideViewerRef.value?.appendSlide(d.html)
}

function handleDone(d) {
  const isBrainOnly = d?.mode === 'brain' && !d?.previewSlides?.length && !d?.downloadUrl
  const isPptDone = !!(d?.previewSlides?.length || d?.downloadUrl)
  progress.value = 100
  progressLabel.value = isBrainOnly
    ? '本轮任务已完成'
    : (isPptDone ? 'PPT 生成完成！' : '策划方案生成完成！')
  brainPlanItems.value = (brainPlanItems.value.length ? brainPlanItems.value : defaultBrainPlan()).map((item) => ({
    ...item,
    status: 'completed'
  }))

  isBuilding.value = false
  resultSlides.value       = d.previewSlides || []
  resultDownloadUrl.value  = d.downloadUrl   || ''
  resultData.value         = d
  if (isPptDone) {
    const pptCard = {
      kind: 'artifact-card',
      artifactType: 'ppt_slides',
      artifactId: createMessageId('artifact'),
      title: artifactCardTitle('ppt_slides', {
        pageCount: d.previewSlides?.length || d.previewData?.pages?.length || 0
      }),
      summary: artifactCardSummary('ppt_slides', {
        downloadUrl: d.downloadUrl || ''
      }),
      chips: artifactCardChips('ppt_slides', {
        pageCount: d.previewSlides?.length || d.previewData?.pages?.length || 0,
        downloadUrl: d.downloadUrl || '',
        fileName: d.filename || ''
      }),
      payload: {
        pageCount: d.previewSlides?.length || d.previewData?.pages?.length || 0,
        downloadUrl: d.downloadUrl || '',
        fileName: d.filename || ''
      }
    }
    pushAiMessage(pptCard)
    activeArtifact.value = pptCard
  }
  if (d.brief) {
    currentTask.value = {
      ...(currentTask.value || {}),
      ...d.brief
    }
  }
  if (d.previewData?.title && currentTask.value) {
    currentTask.value = { ...currentTask.value, topic: d.previewData.title }
  }

  if (isBrainOnly) {
    // 模型自己的回复已经在消息流里，这里不再追加任何尾巴消息
    wsState.value = docContent.value
      ? 'document'
      : (hasStrategyPreview.value ? 'done' : 'welcome')
  } else {
    pushMsg('ai', '', isPptDone
      ? 'PPT 已生成完成，可在右侧直接预览、翻页并下载。'
      : '策划方案已生成完成！可在右侧预览，或点击"进入编辑器"精修。')
    clearQuickReplies()
    wsState.value = 'done'
  }
  // brain-only 时模型自己的回复已经在消息流里，无需再追加 activity 尾巴
  // 若 handleDocReady 已处理过本轮完成，也跳过 activity 重复写入
  const docReadyAlreadyHandled = isBrainOnly && !!docContent.value && quickReplyOptions.value.length > 0
  if (!isBrainOnly && !docReadyAlreadyHandled) {
    publishActivity(
      isPptDone ? 'PPT 已生成完成，支持右侧预览和下载。' : '任务已完成，支持预览、编辑和保存。'
    )
  }
  isRunning.value = false
  waitingForClarification.value = false
  wasManuallyStopped.value = false
  failedReason.value = ''
  failedStage.value = ''
  // resolve 由 connectSSE 的 done 监听器调用
}

// ── 保存 PPT ─────────────────────────────────────────────────────
const showSaveModal = ref(false)
const showSaveModalForMd = ref(false)
const conceptDetailVisible = ref(false)
const conceptDetailPayload = ref(null)
const conceptDetailActiveIndex = ref(0)

function openConceptDetail(payload, activeIndex = 0) {
  if (!payload) return
  conceptDetailPayload.value = payload
  conceptDetailActiveIndex.value = Math.max(0, Math.min(activeIndex, (payload.directions || []).length - 1))
  conceptDetailVisible.value = true
}

function getConceptActiveIndex(msg) {
  if (!msg) return 0
  if (typeof msg.activeDirectionIndex === 'number') return msg.activeDirectionIndex
  return 0
}

function setConceptActiveIndex(msg, index) {
  if (!msg) return
  msg.activeDirectionIndex = index
}

function severityLabel(severity) {
  if (severity === 'high') return '高'
  if (severity === 'low') return '低'
  return '中'
}
const mdContentToSave = ref('')
const saveSpaceId   = ref('')
const saveName      = ref('')

// ── 产出物面板（单一活跃产出物）──────────────────────────────────
const activeArtifact = ref(null)  // { artifactType, title, payload, artifactId } | { artifactType: 'ppt_slides' }

function selectArtifact(msg) {
  activeArtifact.value = msg
  previewCollapsed.value = false
}

function openSaveResearch() {
  if (!spaces.value.length) {
    Message.warning('请先在策划空间创建工作空间')
    return
  }
  const researchItems = researchPreviewItems.value
  if (!researchItems.length) return
  const mdContent = researchItems.map(item => `# ${item.payload.focus || '搜索研究'}\n\n${item.payload.summary || ''}\n\n## 关键发现\n\n${(item.payload.keyFindings || []).map(f => `- ${f}`).join('\n')}`).join('\n\n---\n\n')
  const title = '搜索研究_' + new Date().toLocaleDateString('zh-CN')
  saveName.value = title
  showSaveModalForMd.value = true
  mdContentToSave.value = mdContent
}

function openSavePlanDraft() {
  if (!spaces.value.length) {
    Message.warning('请先在策划空间创建工作空间')
    return
  }
  if (!latestPlanDraft.value) return
  const draft = latestPlanDraft.value.payload
  let mdContent = `# ${draft.planTitle || '策划方案草稿'}\n\n## 核心策略\n\n${draft.coreStrategy || ''}\n\n`
  if (draft.highlights?.length) {
    mdContent += `## 活动亮点\n\n${draft.highlights.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n\n`
  }
  if (draft.sections?.length) {
    mdContent += `## 方案结构\n\n`
    draft.sections.forEach((s, i) => {
      mdContent += `### ${i + 1}. ${s.title}\n\n${(s.keyPoints || []).map(p => `- ${p}`).join('\n')}\n\n`
    })
  }
  saveName.value = draft.planTitle || '策划方案草稿'
  showSaveModalForMd.value = true
  mdContentToSave.value = mdContent
}


function showSaveDialog() {
  if (!spaces.value.length) {
    Message.warning('请先在策划空间创建工作空间')
    return
  }
  saveSpaceId.value = selectedSpaceId.value || spaces.value[0]?.id || ''
  saveName.value    = resultData.value?.topic || '活动策划方案'
  showSaveModal.value = true
}

async function doSave() {
  if (!saveSpaceId.value || !saveName.value) return
  try {
    const d = resultData.value || {}
    const res = await fetch('/api/workspace/save-ppt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spaceId:      saveSpaceId.value,
        name:         saveName.value,
        pptData:      d.pptData      || {},
        downloadUrl:  d.downloadUrl  || '',
        previewSlides: d.previewSlides || []
      })
    }).then(r => r.json())

    showSaveModal.value = false
    if (res.success) {
      Message.success('已保存到策划空间')
      pushMsg('ai', '', '策划方案已保存到策划空间。')
    } else {
      Message.error(res.message || '保存失败')
    }
  } catch (err) {
    Message.error('保存失败：' + err.message)
  }
}

async function doSaveMd() {
  if (!saveSpaceId.value || !saveName.value || !mdContentToSave.value) return
  try {
    const res = await workspaceApi.createDocument(saveSpaceId.value, saveName.value, 'document')
    const nodeId = res.data?.node?.id || res.data?.id
    if (nodeId) {
      await workspaceApi.saveContent(nodeId, mdContentToSave.value, 'markdown')
    }
    showSaveModalForMd.value = false
    Message.success('已保存到策划空间')
    mdContentToSave.value = ''
  } catch (err) {
    Message.error('保存失败：' + err.message)
  }
}

watch(previewVisible, (visible) => {
  if (!visible) return
  nextTick(() => {
    const total = layoutRef.value?.clientWidth || window.innerWidth
    previewWidth.value = clampPreviewWidth(Math.round(total * 0.52))
  })
})

watch(wsState, (state) => {
  if (state === 'streaming' || state === 'done') {
    activePreviewTab.value = 'ppt'
  } else {
    activePreviewTab.value = 'strategy'
  }
  scheduleConversationPersist()
})

function onDocumentMousedown(e) {
  if (workspacePickerVisible.value) {
    const pickerEl = document.querySelector('.ws-picker-dropdown')
    const wrapEl = document.querySelector('.ws-picker-wrap')
    if (!pickerEl?.contains(e.target) && !wrapEl?.contains(e.target)) {
      workspacePickerVisible.value = false
    }
  }
  if (toolPickerVisible.value) {
    const dropEl = document.querySelector('.tool-picker-dropdown')
    const wrapEl = document.querySelector('.tool-picker-wrap')
    if (!dropEl?.contains(e.target) && !wrapEl?.contains(e.target)) {
      toolPickerVisible.value = false
    }
  }
  if (atMentionVisible.value) {
    const dropEl = document.querySelector('.at-mention-dropdown')
    const taEl = textareaRef.value?.$el
    if (!dropEl?.contains(e.target) && !taEl?.contains(e.target)) {
      atMentionVisible.value = false
    }
  }
}

onMounted(() => {
  window.addEventListener('resize', syncPreviewWidth)
  document.addEventListener('mousedown', onDocumentMousedown)
})

onUnmounted(() => {
  clearPendingImages()
  closeSseConnection()
  stopResize()
  clearTimeout(persistConversationTimer)
  window.removeEventListener('resize', syncPreviewWidth)
  document.removeEventListener('mousedown', onDocumentMousedown)
})
</script>

<style scoped>
/* ── 整体布局 ── */
.chat-layout {
  display: flex;
  height: 100%;
  overflow: hidden;
  position: relative;
  background: #fff;
}

/* ── 思考过程分组 ── */
.thinking-group {
  margin: 8px 0;
  overflow: hidden;
}

.thinking-toggle {
  width: 100%;
  padding: 12px 16px;
  border: none;
  background: transparent;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
  color: #57534e;
  transition: background 0.2s;
}

.thinking-toggle:hover {
  background: rgba(68,64,60,0.06);
}

.thinking-icon {
  font-size: 18px;
}

.thinking-steps {
  padding: 0 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.thinking-step {
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 6px;
  font-size: 13px;
}

.thinking-step-time {
  font-size: 11px;
  color: #a8a29e;
  margin-bottom: 4px;
}

.thinking-step-content {
  color: #57534e;
  line-height: 1.5;
}

/* ── 工具调用分组 ── */
.tool-calls-group {
  margin: 12px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tool-calls-summary {
  overflow: hidden;
}

.tool-calls-toggle {
  width: 100%;
  padding: 10px 16px;
  border: none;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  font-size: 13px;
  color: #57534e;
  transition: background 0.2s;
}

.tool-calls-toggle:hover {
  background: rgba(68,64,60,0.1);
}

.tool-calls-chevron {
  font-size: 10px;
  transition: transform 0.2s;
}

.previous-tool-calls {
  padding: 0 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tool-call-mini {
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.tool-call-mini-icon {
  font-size: 14px;
}

.tool-call-mini-text {
  color: #57534e;
  flex: 1;
}

.current-tool-call {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tool-call-card {
  padding: 4px 0;
  max-width: 85%;
  transition: all 0.2s;
}

.tool-call-card.active {
}

.tool-call-card-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tool-call-card-icon {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.05);
  color: #475569;
  font-size: 14px;
  flex-shrink: 0;
  transition: background 0.25s ease, color 0.25s ease, transform 0.25s ease;
}
.tool-call-card.active .tool-call-card-icon {
  transform: scale(1.04);
}

/* ── Icon 语义色调（Phosphor 容器） ───────────────────────────── */
.tool-tone--blue   { background: rgba(59, 130, 246, 0.10); color: #2563eb; }
.tool-tone--violet { background: rgba(139, 124, 246, 0.12); color: #7c5cff; }
.tool-tone--amber  { background: rgba(245, 158, 11, 0.12); color: #d97706; }
.tool-tone--green  { background: rgba(16, 185, 129, 0.12); color: #059669; }
.tool-tone--rose   { background: rgba(244, 63, 94, 0.10); color: #e11d48; }
.tool-tone--slate  { background: rgba(15, 23, 42, 0.06); color: #475569; }

.tool-call-card-content {
  flex: 1;
  min-width: 0;
}

.tool-call-card-title {
  font-size: 13px;
  font-weight: 500;
  color: #57534e;
}

.tool-call-card-progress {
  font-size: 12px;
  color: #a8a29e;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.tool-call-card-result {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(0, 0, 0, 0.04);
}

.tool-call-card-result-summary {
  font-size: 13px;
  color: #44403c;
  line-height: 1.5;
}

.tool-call-card-toggle {
  margin-top: 8px;
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.04);
  color: #a8a29e;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.tool-call-card-toggle:hover {
  background: rgba(0, 0, 0, 0.08);
  color: #44403c;
}

.tool-call-card-details {
  margin-top: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 8px;
  font-size: 12px;
  color: #a8a29e;
  overflow-x: auto;
  max-height: 280px;
  line-height: 1.6;
}

/* ── AI 消息 ── */
.ai-message-card {
  font-size: 14px;
  line-height: 1.7;
  color: #44403c;
  padding: 4px 0;
  max-width: 85%;
  word-break: break-word;
}

.ai-message-card :deep(p) {
  margin-bottom: 8px;
}

.ai-message-card :deep(p:last-child) {
  margin-bottom: 0;
}

.ai-message-card :deep(h1),
.ai-message-card :deep(h2),
.ai-message-card :deep(h3) {
  margin: 0 0 8px;
  color: #1c1917;
  line-height: 1.45;
}

.ai-message-card :deep(h1) {
  font-size: 17px;
}

.ai-message-card :deep(h2) {
  font-size: 15px;
}

.ai-message-card :deep(h3) {
  font-size: 14px;
}

.ai-message-card :deep(ul) {
  margin-bottom: 8px;
  padding-left: 20px;
}

.ai-message-card :deep(hr) {
  border: 0;
  border-top: 1px solid rgba(68, 64, 60, 0.12);
  margin: 12px 0;
}

.ai-message-card :deep(li) {
  margin-bottom: 4px;
}

.ai-message-card :deep(strong) {
  color: #1c1917;
  font-weight: 700;
}

.ai-message-card :deep(code) {
  padding: 1px 6px;
  border-radius: 6px;
  background: rgba(68,64,60,0.06);
  color: #44403c;
  font-size: 12px;
}

.ai-message-card :deep(pre) {
  margin: 10px 0;
  padding: 12px 14px;
  border-radius: 10px;
  background: #1c1917;
  color: #f5f5f4;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.65;
}

.ai-message-card :deep(pre code) {
  padding: 0;
  border-radius: 0;
  background: transparent;
  color: inherit;
  font-size: inherit;
}

.ai-message-card :deep(.ai-table-wrap) {
  margin: 10px 0;
  overflow-x: auto;
}

.ai-message-card :deep(table) {
  width: 100%;
  border-collapse: collapse;
  min-width: 420px;
  background: rgba(255, 255, 255, 0.82);
}

.ai-message-card :deep(th),
.ai-message-card :deep(td) {
  padding: 8px 10px;
  border: 1px solid rgba(68, 64, 60, 0.12);
  text-align: left;
  vertical-align: top;
}

.ai-message-card :deep(th) {
  background: rgba(68, 64, 60, 0.05);
  color: #1c1917;
  font-weight: 700;
}

/* ── 对话内联图片 ── */
.ai-message-card :deep(img.ai-inline-image) {
  display: block;
  max-width: min(100%, 420px);
  width: auto;
  height: auto;
  margin: 10px 0;
  border-radius: 12px;
  border: 1px solid rgba(68, 64, 60, 0.08);
  background: #f5f5f4;
  cursor: zoom-in;
  transition: transform .14s ease, box-shadow .14s ease;
}

.ai-message-card :deep(img.ai-inline-image:hover) {
  transform: translateY(-1px);
  box-shadow: 0 12px 24px rgba(28, 25, 23, 0.10);
}

.ai-message-card :deep(.ai-image-strip) {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
  margin: 12px 0;
  padding: 12px;
  border-radius: 14px;
  background: rgba(245, 239, 231, 0.45);
  border: 1px solid rgba(68, 64, 60, 0.08);
}

.ai-message-card :deep(.ai-image-strip img.ai-inline-image) {
  margin: 0;
  width: 100%;
  max-width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: 10px;
}

.ai-message-card :deep(.ai-image-strip-cta) {
  grid-column: 1 / -1;
  margin-top: 4px;
  padding: 9px 14px;
  border: 1px solid rgba(28, 25, 23, 0.85);
  background: #1c1917;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  border-radius: 999px;
  cursor: pointer;
  justify-self: end;
  transition: background .14s ease, transform .14s ease;
}

.ai-message-card :deep(.ai-image-strip-cta:hover) {
  background: #292524;
  transform: translateY(-1px);
}

/* ── 对话图片 lightbox ── */
.chat-image-lightbox-modal :deep(.arco-modal-body) {
  padding: 16px;
}

.chat-image-lightbox-title {
  font-size: 14px;
  color: #1c1917;
  font-weight: 600;
  max-width: 760px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-image-lightbox-stage {
  display: flex;
  justify-content: center;
  align-items: center;
  background: #1c1917;
  border-radius: 12px;
  padding: 18px;
  min-height: 320px;
}

.chat-image-lightbox-img {
  display: block;
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
  border-radius: 8px;
}

.chat-image-lightbox-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}

.chat-image-lightbox-btn {
  padding: 8px 16px;
  border-radius: 999px;
  border: 1px solid rgba(68, 64, 60, 0.18);
  background: #fff;
  color: #1c1917;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  transition: background .14s ease;
}

.chat-image-lightbox-btn:hover {
  background: #fafaf9;
}

.chat-image-lightbox-btn.primary {
  background: #1c1917;
  color: #fff;
  border-color: #1c1917;
}

.chat-image-lightbox-btn.primary:hover {
  background: #292524;
}

/* ── 右侧面板：对话图片合集 ── */
.chat-image-set {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 2px 18px;
}

.chat-image-set-meta {
  font-size: 12px;
  color: #78716c;
}

.chat-image-set-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}

.chat-image-set-card {
  position: relative;
  padding: 0;
  border: none;
  background: #fafaf9;
  border-radius: 14px;
  overflow: hidden;
  cursor: zoom-in;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  transition: transform .14s ease, box-shadow .14s ease;
}

.chat-image-set-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 24px rgba(28, 25, 23, 0.10);
}

.chat-image-set-card img {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  background: #e7e5e4;
}

.chat-image-set-cap {
  display: block;
  padding: 8px 12px 10px;
  font-size: 12px;
  color: #1c1917;
  text-align: left;
  line-height: 1.4;
  background: #fff;
}

/* ── 右侧面板：生成图片 ── */
.generated-image-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.generated-image-card {
  display: block;
  width: 100%;
  padding: 0;
  border: 1px solid rgba(68, 64, 60, 0.10);
  border-radius: 12px;
  overflow: hidden;
  background: #f5f5f4;
  cursor: zoom-in;
  box-shadow: 0 1px 3px rgba(28, 25, 23, 0.06);
}

.generated-image-card img {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
}

.generated-image-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.generated-image-actions a {
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid rgba(68, 64, 60, 0.18);
  background: #fff;
  color: #1c1917;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
}

/* ── 澄清卡片 ── */
.clarification-card {
  padding: 4px 0;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  max-width: 85%;
}

.clarification-icon {
  font-size: 18px;
  flex-shrink: 0;
  margin-top: 2px;
}

.clarification-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.clarification-header {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #a8a29e;
}

.clarification-question {
  font-size: 14px;
  color: #44403c;
  line-height: 1.7;
  white-space: pre-wrap;
  flex: 1;
}

/* ── 创意方向完整详情弹窗 ── */
/* 注意：.arco-modal-body/.arco-modal-header/.arco-modal-title 的覆盖见文件底部的全局 <style>，
   因 Arco 弹窗 teleport 到 body，scoped :deep() 无法命中其内部类 */

.concept-detail-title {
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
  padding: 4px 0;
  width: 100%;
  min-width: 0;
}

.concept-detail-version {
  display: inline-block;
  align-self: flex-start;
  font-size: 10.5px;
  color: #a1a1aa;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  font-weight: 500;
  line-height: 1;
  margin-bottom: 2px;
}

.concept-detail-theme {
  display: block;
  font-size: 26px;
  font-weight: 600;
  color: #09090b;
  line-height: 1.2;
  letter-spacing: -0.018em;
  word-break: break-word;
}

.concept-detail-axis {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  color: #71717a;
  line-height: 1.6;
  font-weight: 400;
  word-break: break-word;
  max-width: 100%;
  margin-top: 2px;
}

.concept-detail-body {
  display: flex;
  flex-direction: column;
  gap: 34px;
  max-height: 72vh;
  overflow-y: auto;
  padding: 8px 8px 16px;
  scrollbar-width: thin;
  scrollbar-color: rgba(24,24,27,0.18) transparent;
}
.concept-detail-body::-webkit-scrollbar {
  width: 6px;
}
.concept-detail-body::-webkit-scrollbar-thumb {
  background: rgba(24,24,27,0.16);
  border-radius: 3px;
}
.concept-detail-body::-webkit-scrollbar-track {
  background: transparent;
}

.concept-detail-block {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.concept-detail-label {
  font-size: 10.5px;
  font-weight: 600;
  color: #a1a1aa;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  padding-bottom: 0;
  border-bottom: none;
}

.concept-detail-text {
  font-size: 14px;
  line-height: 1.8;
  color: #27272a;
  padding: 0;
}

.concept-detail-text--muted {
  color: #52525b;
  font-size: 13.5px;
}

.concept-detail-framework,
.concept-detail-angles {
  margin: 0;
  padding: 0 0 0 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.concept-detail-framework li,
.concept-detail-angles li {
  font-size: 13.5px;
  line-height: 1.75;
  color: #27272a;
  padding-left: 6px;
}

.concept-detail-framework li::marker {
  color: #18181b;
  font-weight: 600;
}

.concept-detail-angles li::marker {
  color: #a1a1aa;
}

.concept-detail-degraded {
  font-size: 12.5px;
  color: #9f1239;
  padding: 10px 14px;
  background: rgba(159, 18, 57, 0.04);
  border-left: 2px solid #9f1239;
  border-radius: 0 2px 2px 0;
  letter-spacing: 0.01em;
}

/* ── 搜索研究右侧列表 ── */
.research-pane-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 0 14px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
  margin-bottom: 14px;
}

.research-pane-query {
  font-size: 15px;
  font-weight: 600;
  color: #1A1A1A;
  line-height: 1.4;
}

.research-pane-meta {
  display: flex;
  gap: 10px;
  font-size: 12px;
  color: rgba(0,0,0,0.5);
}

.research-pane-source {
  padding: 2px 9px;
  background: rgba(15, 23, 42, 0.05);
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  color: #475569;
  letter-spacing: 0.02em;
}

.research-pane-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.research-pane-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  background: #fbfbfd;
  border: 1px solid rgba(15, 23, 42, 0.05);
  border-radius: 10px;
  transition: background 0.25s ease, border-color 0.25s ease,
              box-shadow 0.25s ease, transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.research-pane-item:hover {
  background: #ffffff;
  border-color: rgba(var(--arcoblue-6), 0.22);
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06);
  transform: translateY(-1px);
}

.research-pane-item-head {
  display: flex;
  gap: 8px;
  align-items: baseline;
}

.research-pane-index {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  color: rgba(0,0,0,0.4);
  min-width: 14px;
}

.research-pane-title {
  font-size: 13.5px;
  font-weight: 600;
  color: #1A1A1A;
  line-height: 1.45;
  text-decoration: none;
  word-break: break-word;
}

a.research-pane-title:hover {
  color: rgb(var(--arcoblue-6));
  text-decoration: underline;
}

.research-pane-domain {
  font-size: 11px;
  color: rgb(var(--arcoblue-6));
  padding-left: 22px;
  word-break: break-all;
}

.research-pane-snippet {
  font-size: 12.5px;
  line-height: 1.6;
  color: rgba(0,0,0,0.65);
  padding-left: 22px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ── note_detail：browser_read_notes 笔记详情面板（小红书风） ── */
.note-detail-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.note-detail-item {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px 22px 22px;
  background: #fff;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03),
              0 4px 14px rgba(15, 23, 42, 0.04);
  transition: border-color 0.3s cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 0.3s cubic-bezier(0.16, 1, 0.3, 1),
              transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.note-detail-item:hover {
  border-color: rgba(15, 23, 42, 0.10);
  box-shadow: 0 2px 4px rgba(15, 23, 42, 0.04),
              0 12px 28px rgba(15, 23, 42, 0.08);
  transform: translateY(-2px);
}

.note-detail-head {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.note-detail-title {
  font-size: 17px;
  font-weight: 700;
  color: #15161a;
  line-height: 1.4;
  letter-spacing: -0.2px;
  text-decoration: none;
  word-break: break-word;
  flex: 1 1 auto;
  transition: color 0.15s;
}

a.note-detail-title:hover {
  color: #ff2442;
  text-decoration: none;
}

.note-detail-badge {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 9px;
  background: #fff1f3;
  color: #ff2442;
  border-radius: 999px;
  letter-spacing: 0.2px;
}

.note-detail-body {
  margin: 0;
  font-size: 14px;
  line-height: 1.75;
  color: #3d3d45;
  white-space: pre-wrap;
  word-break: break-word;
}

.note-detail-body--hint {
  color: rgba(0,0,0,0.4);
  font-style: italic;
}

.note-detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 8px;
  margin-top: 2px;
}

.note-detail-tag {
  display: inline-block;
  font-size: 12px;
  font-weight: 500;
  color: #6f6f78;
  background: #f4f4f6;
  padding: 3px 11px;
  border-radius: 999px;
  letter-spacing: 0.1px;
  transition: background 0.15s, color 0.15s;
}

.note-detail-tag:hover {
  background: #fff1f3;
  color: #ff2442;
}

.note-detail-images {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 6px;
}

.note-detail-image-cell {
  position: relative;
  display: block;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  border-radius: 10px;
  background: #f4f4f6;
  cursor: zoom-in;
  transition: box-shadow 0.2s;
}

.note-detail-image-cell:hover {
  box-shadow: 0 4px 16px rgba(0,0,0,0.08);
}

.note-detail-image-cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.3s ease;
}

.note-detail-image-cell:hover img {
  transform: scale(1.06);
}

.note-detail-video-mark {
  position: absolute;
  bottom: 6px;
  right: 6px;
  font-size: 10.5px;
  font-weight: 500;
  padding: 2px 8px;
  background: rgba(0,0,0,0.55);
  backdrop-filter: blur(4px);
  color: #fff;
  border-radius: 999px;
  letter-spacing: 0.3px;
}

/* ── 任务理解对话内卡片 ── */
.brief-card {
  width: min(85%, 700px);
  background: #fff;
  border: 1px solid rgba(0,0,0,0.08);
  border-left: 3px solid #8b7cf6;
  border-radius: 4px;
  padding: 12px 14px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.brief-card-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
}

.brief-card-kicker {
  font-size: 11px;
  font-weight: 600;
  color: #8b7cf6;
  letter-spacing: 0.5px;
}

.brief-card-brand {
  font-size: 14px;
  font-weight: 600;
  color: #1A1A1A;
}

.brief-card-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.brief-card-block--inline {
  flex-direction: row;
  gap: 8px;
  align-items: baseline;
  flex-wrap: wrap;
}

.brief-card-label {
  font-size: 11px;
  font-weight: 600;
  color: rgba(0,0,0,0.5);
  letter-spacing: 0.3px;
}

.brief-card-label-inline {
  font-size: 11px;
  font-weight: 600;
  color: rgba(0,0,0,0.5);
  flex-shrink: 0;
}

.brief-card-text {
  font-size: 13px;
  line-height: 1.6;
  color: #2a2a2a;
}

.brief-card-text-inline {
  font-size: 13px;
  line-height: 1.5;
  color: #2a2a2a;
}

.brief-card-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.brief-card-chip {
  display: inline-block;
  padding: 3px 9px;
  font-size: 12px;
  color: #5b4fc7;
  background: rgba(139, 124, 246, 0.08);
  border: 1px solid rgba(139, 124, 246, 0.2);
  border-radius: 10px;
}

.brief-card-list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.brief-card-list li {
  font-size: 12.5px;
  line-height: 1.55;
  color: rgba(0,0,0,0.7);
}

/* ── 创意方向对话内卡片 ── */
.concept-card {
  width: min(92%, 850px);
  background: #ffffff;
  border: 1px solid rgba(24,24,27,0.08);
  border-radius: 10px;
  padding: 18px 20px 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  transition:
    border-color 0.35s cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 0.35s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.concept-card:hover {
  border-color: rgba(24,24,27,0.14);
  box-shadow: 0 10px 30px -12px rgba(24,24,27,0.1);
}

.concept-card .concept-card-direction {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.concept-card-head {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.concept-card-version {
  display: inline-block;
  align-self: flex-start;
  font-size: 10px;
  color: #a1a1aa;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  font-weight: 500;
  line-height: 1;
}

.concept-card-axis {
  font-size: 13px;
  line-height: 1.6;
  color: #3f3f46;
  font-weight: 500;
  letter-spacing: -0.005em;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.concept-card-shared {
  font-size: 12.5px;
  line-height: 1.65;
  color: #71717a;
  font-style: normal;
  padding-top: 2px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 方向切换 tab — segmented control */
.concept-card-tabs {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  background: #f4f4f5;
  border-radius: 8px;
  border: 1px solid rgba(24,24,27,0.04);
  align-self: flex-start;
  max-width: 100%;
}

.concept-card-tab {
  flex: 0 1 auto;
  display: flex;
  align-items: center;
  gap: 7px;
  background: transparent;
  border: none;
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
  transition:
    background 0.35s cubic-bezier(0.16, 1, 0.3, 1),
    color 0.3s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.15s cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  font-family: inherit;
  text-align: left;
  min-width: 0;
  color: #52525b;
}

.concept-card-tab:hover {
  color: #09090b;
}

.concept-card-tab:active {
  transform: translateY(0.5px) scale(0.99);
}

.concept-card-tab--active {
  background: #ffffff;
  color: #09090b;
  box-shadow:
    0 1px 2px rgba(24,24,27,0.06),
    0 0 0 1px rgba(24,24,27,0.04),
    inset 0 1px 0 rgba(255,255,255,0.6);
}

.concept-card-tab-label {
  font-size: 12px;
  font-weight: 600;
  color: inherit;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}

.concept-card-tab-name {
  font-size: 12.5px;
  color: inherit;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.concept-card-theme-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.concept-card-theme {
  font-size: 17px;
  font-weight: 600;
  color: #09090b;
  line-height: 1.3;
  letter-spacing: -0.012em;
}

.concept-card-positioning {
  font-size: 12.5px;
  color: #52525b;
  font-style: normal;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.concept-card-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.concept-card-block--inline {
  flex-direction: row;
  gap: 10px;
  align-items: baseline;
  flex-wrap: wrap;
}

.concept-card-label {
  font-size: 10px;
  font-weight: 600;
  color: #a1a1aa;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.concept-card-label-inline {
  font-size: 10px;
  font-weight: 600;
  color: #a1a1aa;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  flex-shrink: 0;
}

.concept-card-text {
  font-size: 13.5px;
  line-height: 1.7;
  color: #27272a;
}

.concept-card-text-inline {
  font-size: 13px;
  line-height: 1.6;
  color: #27272a;
}

.concept-card-framework,
.concept-card-angles {
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.concept-card-framework li,
.concept-card-angles li {
  font-size: 13px;
  line-height: 1.65;
  color: #27272a;
  padding-left: 4px;
}

.concept-card-framework li::marker {
  color: #18181b;
  font-weight: 600;
}

.concept-card-angles li::marker {
  color: #a1a1aa;
}

/* trio — divided row, no boxed cards */
.concept-card-trio {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  margin: 4px 0 2px;
  border-top: 1px solid rgba(24,24,27,0.08);
  border-bottom: 1px solid rgba(24,24,27,0.08);
}

.concept-card-trio-cell {
  padding: 12px 14px 12px 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: transparent;
  border: none;
  border-radius: 0;
}

.concept-card-trio-cell + .concept-card-trio-cell {
  padding-left: 14px;
  border-left: 1px solid rgba(24,24,27,0.08);
}

.concept-card-trio-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.concept-card-trio-label::before {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.78;
}

.concept-card-trio-cell--up .concept-card-trio-label { color: #15803d; }
.concept-card-trio-cell--risk .concept-card-trio-label { color: #9f1239; }
.concept-card-trio-cell--fit .concept-card-trio-label { color: #3f3f46; }

.concept-card-trio-text {
  font-size: 12.5px;
  line-height: 1.65;
  color: #27272a;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* recommendation — editorial pull-quote, neutral ink */
.concept-card-recommendation {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  background: #fafaf9;
  border-left: 2px solid #18181b;
  border-radius: 0 3px 3px 0;
}

.concept-card-rec-label {
  font-size: 10px;
  font-weight: 600;
  color: #18181b;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.concept-card-rec-text {
  font-size: 12.5px;
  line-height: 1.65;
  color: #27272a;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.concept-card-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
  border-top: 1px solid rgba(24,24,27,0.06);
  margin-top: 2px;
}

.concept-card-cta {
  cursor: pointer;
  font-size: 11.5px;
  color: #71717a;
  letter-spacing: 0.02em;
  transition: color 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.concept-card .concept-card-direction:hover ~ .concept-card-footer .concept-card-cta,
.concept-card-cta:hover {
  color: #09090b;
}

.concept-card--degraded {
  border-color: rgba(159, 18, 57, 0.25);
  background: #ffffff;
}

.concept-card-degraded-note {
  font-size: 12px;
  color: #9f1239;
  padding: 8px 12px;
  background: rgba(159, 18, 57, 0.04);
  border-left: 2px solid #9f1239;
  border-radius: 0 3px 3px 0;
  letter-spacing: 0.01em;
}

/* ── brief 质疑卡片 ── */
.challenge-card {
  width: min(92%, 800px);
  background: #FFFBEB;
  border: 1px solid rgba(251, 191, 36, 0.35);
  border-left: 3px solid rgb(217, 119, 6);
  border-radius: 4px;
  padding: 14px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.challenge-card--clean {
  background: #F0FDF4;
  border-color: rgba(34, 197, 94, 0.25);
  border-left-color: rgb(22, 163, 74);
}

.challenge-card-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
}

.challenge-card-kicker {
  font-size: 12px;
  font-weight: 600;
  color: rgb(180, 83, 9);
  letter-spacing: 0.3px;
}

.challenge-card--clean .challenge-card-kicker {
  color: rgb(22, 101, 52);
}

.challenge-card-assessment {
  font-size: 13.5px;
  line-height: 1.55;
  color: #1A1A1A;
  font-weight: 500;
}

.challenge-card-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.challenge-card-concern {
  padding: 10px 12px;
  background: #fff;
  border: 1px solid rgba(0,0,0,0.08);
  border-left: 3px solid rgba(251, 191, 36, 0.6);
  border-radius: 3px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.challenge-card-concern--high {
  border-left-color: rgb(220, 38, 38);
  background: #FEF2F2;
}

.challenge-card-concern--medium {
  border-left-color: rgb(217, 119, 6);
}

.challenge-card-concern--low {
  border-left-color: rgba(0,0,0,0.2);
}

.challenge-card-concern-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.challenge-card-concern-sev {
  font-size: 10.5px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 8px;
  background: rgba(0,0,0,0.08);
  color: rgba(0,0,0,0.6);
}

.challenge-card-concern--high .challenge-card-concern-sev {
  background: rgb(220, 38, 38);
  color: #fff;
}

.challenge-card-concern--medium .challenge-card-concern-sev {
  background: rgb(217, 119, 6);
  color: #fff;
}

.challenge-card-concern-axis {
  font-size: 11.5px;
  color: rgba(0,0,0,0.55);
  font-weight: 500;
}

.challenge-card-concern-issue {
  font-size: 13.5px;
  line-height: 1.55;
  color: #1A1A1A;
  font-weight: 500;
}

.challenge-card-concern-why {
  font-size: 12.5px;
  line-height: 1.55;
  color: rgba(0,0,0,0.65);
}

.challenge-card-concern-resolution {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding-top: 4px;
  border-top: 1px dashed rgba(0,0,0,0.06);
  margin-top: 2px;
}

.challenge-card-concern-resolution-label {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.3px;
  color: rgb(37, 99, 235);
  flex-shrink: 0;
}

.challenge-card-concern-resolution span:last-child {
  font-size: 12.5px;
  line-height: 1.55;
  color: #2a2a2a;
}

/* ── concept-detail 弹窗：segmented tabs + divided trio ── */
.concept-detail-tabs {
  display: inline-flex;
  gap: 2px;
  margin-bottom: 26px;
  padding: 3px;
  background: #f4f4f5;
  border-radius: 9px;
  border: 1px solid rgba(24,24,27,0.04);
  align-self: flex-start;
}

.concept-detail-tab {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  border: none;
  border-radius: 6px;
  padding: 7px 14px;
  cursor: pointer;
  transition:
    background 0.35s cubic-bezier(0.16, 1, 0.3, 1),
    color 0.3s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.15s cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  font-family: inherit;
  text-align: left;
  color: #52525b;
}

.concept-detail-tab:hover {
  color: #09090b;
}

.concept-detail-tab:active {
  transform: translateY(0.5px) scale(0.99);
}

.concept-detail-tab--active {
  background: #ffffff;
  color: #09090b;
  box-shadow:
    0 1px 2px rgba(24,24,27,0.06),
    0 0 0 1px rgba(24,24,27,0.04),
    inset 0 1px 0 rgba(255,255,255,0.6);
}

.concept-detail-tab-label {
  font-size: 12.5px;
  font-weight: 600;
  color: inherit;
  letter-spacing: 0.04em;
}

.concept-detail-tab-name {
  font-size: 13px;
  color: inherit;
  font-weight: 500;
}

.concept-detail-trio {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  margin: 6px 0;
  border-top: 1px solid rgba(24,24,27,0.08);
  border-bottom: 1px solid rgba(24,24,27,0.08);
}

.concept-detail-trio-cell {
  padding: 16px 20px 16px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: transparent;
  border: none;
  border-radius: 0;
}

.concept-detail-trio-cell + .concept-detail-trio-cell {
  padding-left: 20px;
  border-left: 1px solid rgba(24,24,27,0.08);
}

.concept-detail-trio-label {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.concept-detail-trio-label::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.78;
}

.concept-detail-trio-cell--up .concept-detail-trio-label { color: #15803d; }
.concept-detail-trio-cell--risk .concept-detail-trio-label { color: #9f1239; }
.concept-detail-trio-cell--fit .concept-detail-trio-label { color: #3f3f46; }

.concept-detail-trio-text {
  font-size: 13px;
  line-height: 1.7;
  color: #27272a;
}

.concept-detail-recommendation {
  padding: 18px 20px;
  background: #fafaf9;
  border-left: 2px solid #18181b;
  border-radius: 0 3px 3px 0;
  margin-top: 10px;
}

.concept-detail-recommendation-label {
  color: #18181b;
  font-weight: 600;
}

/* ── 产出物消息卡片 ── */
.artifact-msg-card {
  width: min(85%, 700px);
  background: #fff;
  border: 1px solid rgba(0,0,0,0.06);
  border-radius: 0;
  border-left-width: 3px;
  padding: 12px 14px 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.artifact-msg-card:hover {
  border-color: rgb(var(--arcoblue-6));
  box-shadow: 0 2px 10px rgba(37, 99, 235, 0.08);
}

.artifact-msg-card--active {
  border-color: rgb(var(--arcoblue-6));
  background: #EFF6FF;
}

.artifact-msg-card-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.artifact-msg-card-icon-wrap {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #eef1f5;
  border-radius: 8px;
  transition: background 0.25s ease, transform 0.25s ease;
}

.artifact-msg-card-icon {
  font-size: 15px;
  color: #64748B;
  transition: color 0.25s ease;
}

.artifact-msg-card:hover .artifact-msg-card-icon-wrap {
  background: #e2e8f0;
  transform: translateY(-1px);
}

.artifact-msg-card-copy {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.artifact-msg-card-kicker {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #94A3B8;
}

.artifact-msg-card--active .artifact-msg-card-icon {
  color: rgb(var(--arcoblue-6));
}

.artifact-msg-card--active .artifact-msg-card-icon-wrap {
  background: rgba(var(--arcoblue-6), 0.14);
}

.artifact-msg-card-title {
  font-size: 13px;
  font-weight: 600;
  color: #1E293B;
  line-height: 1.4;
}

.artifact-msg-card--active .artifact-msg-card-title {
  color: rgb(var(--arcoblue-6));
}

.artifact-msg-card-summary {
  font-size: 12px;
  color: #64748B;
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.artifact-msg-card-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.artifact-msg-card-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 2px;
  padding-top: 2px;
  border-top: 1px solid #F1F5F9;
}

.artifact-msg-card-view-btn {
  font-size: 11px;
  font-weight: 500;
  color: rgb(var(--arcoblue-6));
  padding: 3px 8px;
  border: 1px solid rgba(var(--arcoblue-6), 0.3);
  border-radius: 5px;
  background: rgba(var(--arcoblue-6), 0.05);
  transition: background 0.15s;
}

.artifact-msg-card:hover .artifact-msg-card-view-btn {
  background: rgba(var(--arcoblue-6), 0.12);
}

.artifact-msg-card--active .artifact-msg-card-view-btn {
  background: rgb(var(--arcoblue-6));
  color: #fff;
  border-color: rgb(var(--arcoblue-6));
}

.artifact-msg-chip {
  font-size: 11px;
  padding: 2px 8px;
  background: #F8FAFC;
  color: #57534e;
  border: 1px solid rgba(0,0,0,0.06);
  border-radius: 999px;
  white-space: nowrap;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── 产出物详情弹窗 ── */
.artifact-modal-content {
  max-height: 60vh;
  overflow-y: auto;
  padding: 4px 0;
}

.artifact-modal-section {
  margin-bottom: 20px;
}

.artifact-modal-section:last-child {
  margin-bottom: 0;
}

.artifact-modal-label {
  font-size: 12px;
  font-weight: 600;
  color: #a8a29e;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.artifact-modal-text {
  font-size: 14px;
  color: #1c1917;
  line-height: 1.6;
}

.artifact-modal-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.artifact-modal-chip {
  font-size: 12px;
  padding: 4px 10px;
  background: rgba(59, 130, 246, 0.08);
  color: #2563eb;
  border-radius: 20px;
}

.artifact-modal-highlights {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.artifact-modal-highlight {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(68,64,60,0.03);
  border-radius: 8px;
  font-size: 13px;
  color: #44403c;
  line-height: 1.5;
}

.highlight-num {
  width: 20px;
  height: 20px;
  background: #2563eb;
  color: #fff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.artifact-modal-sections {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.artifact-modal-section-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  background: rgba(68,64,60,0.03);
  border-radius: 8px;
}

.section-num {
  font-size: 12px;
  font-weight: 700;
  color: #2563eb;
  flex-shrink: 0;
}

.section-info {
  flex: 1;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: #1c1917;
  margin-bottom: 2px;
}

.section-points {
  font-size: 12px;
  color: #a8a29e;
}

.artifact-modal-list {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  color: #44403c;
  line-height: 1.8;
}

.artifact-modal-score {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 16px;
  background: #fef3c7;
  border-radius: 10px;
}

.artifact-modal-score.pass {
  background: #d1fae5;
}

.score-num {
  font-size: 36px;
  font-weight: 700;
  color: #d97706;
}

.artifact-modal-score.pass .score-num {
  color: #059669;
}

.score-label {
  font-size: 14px;
  color: #92400e;
}

.artifact-modal-score.pass .score-label {
  color: #065f46;
}

.score-status {
  margin-left: auto;
  font-size: 13px;
  font-weight: 600;
  padding: 4px 10px;
  background: rgba(0,0,0,0.08);
  border-radius: 20px;
}

.artifact-modal-pages {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 300px;
  overflow-y: auto;
}

.artifact-modal-page-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: rgba(68,64,60,0.03);
  border-radius: 6px;
  font-size: 12px;
}

.page-num {
  width: 22px;
  height: 22px;
  background: rgba(0,0,0,0.06);
  color: #44403c;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  flex-shrink: 0;
}

.page-layout {
  padding: 2px 8px;
  background: rgba(59, 130, 246, 0.1);
  color: #2563eb;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
}

.page-title {
  flex: 1;
  color: #44403c;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artifact-modal-json {
  background: rgba(68,64,60,0.06);
  padding: 12px;
  border-radius: 8px;
  font-size: 12px;
  color: #44403c;
  overflow-x: auto;
  line-height: 1.5;
}

/* ── 任务摘要卡片 ── */
.task-summary-card {
  border-radius: 10px;
  border: 1px solid rgba(59, 130, 246, 0.15);
  background: #ffffff;
  padding: 16px;
}

.task-summary-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.task-summary-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.task-summary-dot.running {
  background: #3b82f6;
  animation: pulse 2s infinite;
}

.task-summary-dot.completed {
  background: #059669;
}

.task-summary-dot.failed {
  background: #dc2626;
}

.task-summary-content {
  flex: 1;
  min-width: 0;
}

.task-summary-title {
  font-size: 15px;
  font-weight: 600;
  color: #1c1917;
  margin-bottom: 4px;
}

.task-summary-subtitle {
  font-size: 13px;
  color: #57534e;
}

.task-summary-progress {
  margin-top: 8px;
}

.chat-layout.resizing {
  cursor: col-resize;
}

/* ── 左侧聊天面板 ── */
.chat-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;   /* 子元素水平居中 */
  background: #fff;
  overflow: hidden;
}

.chat-conversation-sidebar {
  width: var(--conversation-width);
  min-width: var(--conversation-width);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #faf9f7;
  border-right: 1px solid rgba(15, 23, 42, 0.06);
  transition: width 0.22s ease, min-width 0.22s ease;
  overflow: hidden;
}

.chat-conversation-sidebar.collapsed {
  border-right: none;
}

.conversation-sidebar-head {
  padding: 12px 14px 10px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex-shrink: 0;
  background: transparent;
  border-bottom: 1px solid rgba(15, 23, 42, 0.04);
}

.conversation-create-btn {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #a8a29e;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s ease, color 0.2s ease, transform 0.18s ease;
}
.conversation-create-btn:active { transform: scale(0.94); }

.conversation-sidebar-rail-toggle {
  position: absolute;
  top: 14px;
  left: calc(var(--conversation-width) - 12px);
  z-index: 5;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: #ffffff;
  color: #a8a29e;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08), inset 0 0 0 1px rgba(15, 23, 42, 0.06);
  cursor: pointer;
  transition: left 0.22s ease, background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
}

.conversation-sidebar-rail-toggle:hover {
  background: #faf9f7;
  color: #57534e;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.1), inset 0 0 0 1px rgba(15, 23, 42, 0.08);
}

.conversation-sidebar-rail-toggle.collapsed {
  left: 8px;
}

.conversation-create-btn:hover {
  background: rgba(15, 23, 42, 0.04);
  color: #57534e;
}

.conversation-sidebar-copy {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.conversation-sidebar-space-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.conversation-sidebar-space-label {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 500;
  color: #a8a29e;
}

.conversation-sidebar-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 16px 12px 14px;
}

.conversation-sidebar-body-title {
  padding: 0 2px 12px;
  font-size: 13px;
  font-weight: 700;
  color: #1c1917;
}

.conversation-sidebar-section + .conversation-sidebar-section {
  margin-top: 14px;
}

.conversation-sidebar-head-select,
.conversation-search {
  width: 100%;
}

:deep(.conversation-sidebar-head-select .arco-select-view) {
  min-height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.55);
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.04);
  transition: background 0.18s ease, box-shadow 0.18s ease;
}

:deep(.conversation-sidebar-head-select .arco-select-view:hover),
:deep(.conversation-sidebar-head-select.arco-select-open .arco-select-view) {
  background: rgba(255, 255, 255, 0.9);
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08);
}

:deep(.conversation-sidebar-head-select .arco-select-view-value) {
  font-size: 12px;
  font-weight: 600;
  color: #57534e;
}

:deep(.conversation-sidebar-head-select .arco-select-view-icon) {
  color: #b6c0cd;
}

:deep(.conversation-search .arco-input-wrapper) {
  border: none;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.78);
  box-shadow: inset 0 0 0 1px rgba(68,64,60,0.12);
  transition: background 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}

:deep(.conversation-search .arco-input-wrapper:hover),
:deep(.conversation-search .arco-input-wrapper.arco-input-focus) {
  background: rgba(255, 255, 255, 0.96);
  box-shadow: inset 0 0 0 1px rgba(68,64,60,0.22);
}

:deep(.conversation-search .arco-input) {
  font-size: 12px;
  color: #44403c;
}

:deep(.conversation-search .arco-input::placeholder) {
  color: #a8a29e;
}

:deep(.conversation-search .arco-input-prefix) {
  margin-right: 6px;
  color: #b6c0cd;
  font-size: 13px;
}

.conversation-sidebar-list {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.conversation-group-title {
  font-size: 11px;
  font-weight: 600;
  color: #a8a29e;
  padding: 0 2px 6px;
  text-transform: none;
  letter-spacing: 0.01em;
}

.conversation-group-stack {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.conversation-list-empty {
  margin-top: 18px;
  padding: 12px 4px;
}

.conversation-list-empty-title {
  font-size: 12px;
  font-weight: 700;
  color: #1c1917;
}

.conversation-list-empty-desc {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: #a8a29e;
}

.conversation-pill {
  width: 100%;
  padding: 10px 11px;
  border: none;
  border-radius: 8px;
  background: transparent;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
  transition: background 0.22s ease, box-shadow 0.22s ease,
              color 0.22s ease, transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  text-align: left;
}

.conversation-pill:hover {
  background: rgba(255, 255, 255, 0.65);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
  transform: translateX(2px);
}

.conversation-pill.active {
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06),
              inset 0 0 0 1px rgba(15, 23, 42, 0.05);
  transform: none;
}

.conversation-pill-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
  flex: 1;
}

.conversation-pill-title {
  font-size: 13px;
  font-weight: 700;
  color: #1c1917;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.conversation-pill-meta {
  font-size: 11px;
  color: #a8a29e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.conversation-pill-more {
  flex-shrink: 0;
  color: #b6c0cd;
  line-height: 1;
  padding: 2px 0 0;
}

.task-hud {
  width: 100%;
  max-width: 720px;
  margin-top: 14px;
  padding: 14px 16px;
  border: 1px solid rgba(0,0,0,0.06);
  border-radius: 18px;
  background: linear-gradient(180deg, #ffffff 0%, #fbfcff 100%);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.04);
  flex-shrink: 0;
}

.chat-layout.preview-open .task-hud {
  max-width: none;
  margin: 14px 20px 0;
}

.task-hud-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.task-hud-title-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.task-hud-dot {
  width: 10px;
  height: 10px;
  margin-top: 5px;
  border-radius: 50%;
  background: rgb(var(--arcoblue-6));
  box-shadow: 0 0 0 6px rgba(var(--arcoblue-6), 0.12);
  animation: queue-pulse 1.4s ease-in-out infinite;
  flex-shrink: 0;
}

.task-hud-dot.failed {
  background: rgb(var(--red-6));
  box-shadow: 0 0 0 6px rgba(var(--red-6), 0.12);
  animation: none;
}

.task-hud-dot.done {
  background: rgb(var(--green-6));
  box-shadow: 0 0 0 6px rgba(var(--green-6), 0.12);
  animation: none;
}

.task-hud-copy {
  min-width: 0;
}

.task-hud-title {
  font-size: 15px;
  font-weight: 700;
  color: #1c1917;
}

.task-hud-subtitle {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: #57534e;
}

.task-hud-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.task-hud-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border-radius: 999px;
  background: #f7f8fa;
  color: #57534e;
  font-size: 12px;
}

.task-hud-chip b {
  color: #a8a29e;
  font-weight: 700;
}

.task-hud-log-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.task-hud-log-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 12px;
  background: #f7f8fa;
}

.task-hud-log-time {
  flex-shrink: 0;
  min-width: 54px;
  font-size: 11px;
  font-weight: 700;
  color: #a8a29e;
}

.task-hud-log-text {
  font-size: 12px;
  line-height: 1.6;
  color: #57534e;
}

.chat-layout.preview-open .chat-panel {
  min-width: 420px;
  align-items: stretch;
}

.chat-layout.preview-open .chat-history,
.chat-layout.preview-open .chat-input-area {
  max-width: none;
}

.panel-resizer {
  width: 10px;
  flex-shrink: 0;
  position: relative;
  cursor: col-resize;
  background: transparent;
}

.panel-resizer--collapsed {
  cursor: default;
  width: 10px;
}

.panel-resizer-line {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  transform: translateX(-50%);
  background: rgba(226, 232, 240, 0.95);
  transition: background 0.2s ease, box-shadow 0.2s ease;
}

.panel-resizer:hover .panel-resizer-line,
.chat-layout.resizing .panel-resizer-line {
  background: rgba(var(--arcoblue-6), 0.5);
  box-shadow: 0 0 0 3px rgba(var(--arcoblue-6), 0.08);
}

.panel-resizer-toggle {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  width: 20px;
  height: 48px;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #78716c;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 1;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
  z-index: 10;
  padding: 0;
  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
}

.panel-resizer-toggle:hover {
  color: rgb(var(--arcoblue-6));
  border-color: rgba(var(--arcoblue-6), 0.4);
  background: #f8faff;
  box-shadow: 0 2px 8px rgba(var(--arcoblue-6), 0.12);
}

.chat-history {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: none;
  width: 100%;
  max-width: 900px;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chat-history::-webkit-scrollbar {
  display: none;
}

/* 气泡 */
.bubble-wrap {
  display: flex;
  animation: bubble-enter 0.24s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.bubble-wrap.user { justify-content: flex-end; }
.bubble-wrap.ai   { justify-content: flex-start; }

@keyframes bubble-enter {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .bubble-wrap { animation: none; }
}

.bubble {
  max-width: 85%;
  padding: 4px 0;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
}

.bubble.user {
  color: #1c1917;
  font-weight: 500;
}

/* 用户消息发送失败（如 409：会话忙碌时这条消息没真发出去）的视觉降级 */
.bubble.user.bubble--not-sent {
  opacity: 0.55;
  position: relative;
}

.bubble-not-sent-tag {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  margin-right: 6px;
  border-radius: 4px;
  background: rgba(220, 38, 38, 0.12);
  color: #dc2626;
  letter-spacing: 0.4px;
}

.bubble.ai {
  color: #44403c;
}

.chat-image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.chat-image-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-decoration: none;
}

.chat-image-thumb {
  width: 100%;
  height: 110px;
  object-fit: cover;
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,0.06);
  background: #faf9f7;
}

.chat-image-name {
  font-size: 12px;
  color: #57534e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-card {
  min-width: 320px;
}

.task-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.task-card-title-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.task-card-dot {
  width: 10px;
  height: 10px;
  margin-top: 4px;
  border-radius: 50%;
  background: rgb(var(--arcoblue-6));
  box-shadow: 0 0 0 6px rgba(var(--arcoblue-6), 0.12);
  flex-shrink: 0;
}

.task-card-dot.failed {
  background: rgb(var(--red-6));
  box-shadow: 0 0 0 6px rgba(var(--red-6), 0.12);
}

.task-card-dot.completed {
  background: rgb(var(--green-6));
  box-shadow: 0 0 0 6px rgba(var(--green-6), 0.12);
}

.task-card-dot.streaming {
  animation: queue-pulse 1.2s ease-in-out infinite;
}

.task-card-copy {
  min-width: 0;
}

.task-card-title {
  font-size: 14px;
  font-weight: 700;
  color: #1c1917;
}

.task-card-subtitle {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: #57534e;
}

.task-card-progress {
  margin-top: 12px;
}

.task-card-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.task-card-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid rgba(0,0,0,0.06);
  font-size: 12px;
  color: #57534e;
}

.task-card-chip b {
  color: #a8a29e;
  font-weight: 700;
}

.task-card-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
  font-size: 11px;
  color: #a8a29e;
}

.task-card-focus {
  margin-top: 12px;
  padding: 12px;
  border-radius: 14px;
  background: rgba(230, 238, 255, 0.5);
}

.task-card-focus-label {
  font-size: 11px;
  font-weight: 700;
  color: #a8a29e;
}

.task-card-focus-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 8px;
}

.task-card-focus-text {
  font-size: 13px;
  line-height: 1.5;
  color: #1c1917;
  font-weight: 600;
}

.task-card-focus-status {
  flex-shrink: 0;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  background: #fff;
  color: #a8a29e;
  border: 1px solid rgba(0,0,0,0.06);
}

.task-card-focus-status.running {
  color: rgb(var(--arcoblue-6));
  border-color: rgba(var(--arcoblue-6), 0.22);
}

.task-card-focus-status.completed {
  color: rgb(var(--green-6));
  border-color: rgba(var(--green-6), 0.24);
}

.task-card-focus-status.failed {
  color: rgb(var(--red-6));
  border-color: rgba(var(--red-6), 0.24);
}

.task-card-toggle {
  margin-top: 12px;
  padding: 0;
  border: none;
  background: transparent;
  color: rgb(var(--arcoblue-6));
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.task-card-detail {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px dashed #d9dde4;
}

.task-card-section + .task-card-section {
  margin-top: 12px;
}

.task-card-section-title {
  font-size: 12px;
  font-weight: 700;
  color: #1c1917;
}

.task-card-steps,
.task-card-logs {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.task-card-step,
.task-card-log-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  background: #fff;
}

.task-card-step.pending { opacity: 0.55; }
.task-card-step.running { background: rgba(230, 238, 255, 0.6); }
.task-card-step.completed { }
.task-card-step.failed { background: rgba(255, 230, 230, 0.6); }

.task-card-step-name,
.task-card-log-text {
  font-size: 12px;
  line-height: 1.6;
  color: #57534e;
}

.task-card-step-status,
.task-card-log-time {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  color: #a8a29e;
}

.task-card-error {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 240, 240, 0.8);
  font-size: 12px;
  line-height: 1.6;
  color: #57534e;
}

.task-log {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 240px;
}

.task-log-time {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  color: #a8a29e;
  min-width: 54px;
}

.task-log-text {
  font-size: 12px;
  line-height: 1.6;
  color: #57534e;
}

.error-retry-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 10px;
  max-width: 520px;
}
.error-retry-message {
  font-size: 13px;
  line-height: 1.55;
  color: #7f1d1d;
}
.error-retry-btn {
  align-self: flex-start;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: #dc2626;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}
.error-retry-btn:hover:not(:disabled) {
  background: #b91c1c;
}
.error-retry-btn:disabled {
  background: #d1d5db;
  cursor: not-allowed;
}

.ai-rich-message {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.ai-rich-message.collapsed {
  max-width: 100%;
}

.ai-rich-summary {
  font-size: 13px;
  line-height: 1.7;
  color: #57534e;
}

.ai-rich-toggle {
  align-self: flex-start;
  padding: 0;
  border: none;
  background: transparent;
  color: rgb(var(--arcoblue-6));
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

/* AI loading 动画 */
.pending-loading-card :deep(.chat-loading) {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 180px;
  padding: 2px 0;
  color: #57534e;
}

.pending-loading-card :deep(.chat-loading-orb) {
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  border-radius: 999px;
  background: linear-gradient(135deg, rgb(var(--arcoblue-5)), rgb(var(--arcoblue-3)));
  box-shadow: 0 0 0 0 rgba(var(--arcoblue-5), 0.35);
  animation: loading-pulse 1.5s ease-out infinite;
}

.pending-loading-card :deep(.chat-loading-copy) {
  display: inline-flex;
  flex-direction: column;
  gap: 6px;
  min-width: 148px;
}

.pending-loading-card :deep(.chat-loading-text) {
  font-size: 13px;
  line-height: 1.2;
  color: #57534e;
}

.pending-loading-card :deep(.chat-loading-detail) {
  font-size: 11px;
  line-height: 1.2;
  color: #a8a29e;
}

.pending-loading-card :deep(.chat-loading-bar) {
  position: relative;
  width: 100%;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(var(--arcoblue-3), 0.14);
}

.pending-loading-card :deep(.chat-loading-bar-inner) {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    rgba(var(--arcoblue-4), 0.08) 0%,
    rgba(var(--arcoblue-5), 0.9) 45%,
    rgba(var(--arcoblue-4), 0.08) 100%
  );
  transform: translateX(-100%);
  animation: loading-scan 1.25s ease-in-out infinite;
}

@keyframes loading-pulse {
  0% {
    transform: scale(0.92);
    box-shadow: 0 0 0 0 rgba(var(--arcoblue-5), 0.34);
    opacity: 0.9;
  }
  60% {
    transform: scale(1);
    box-shadow: 0 0 0 9px rgba(var(--arcoblue-5), 0);
    opacity: 1;
  }
  100% {
    transform: scale(0.92);
    box-shadow: 0 0 0 0 rgba(var(--arcoblue-5), 0);
    opacity: 0.9;
  }
}

@keyframes loading-scan {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

.pending-loading-wrap {
  margin-top: 4px;
}

.pending-loading-card {
  display: inline-flex;
  min-width: 190px;
  max-width: 280px;
  padding: 4px 2px;
  background: transparent;
  border: 0;
  box-shadow: none;
}

/* ── 任务队列 ── */
.task-queue {
  margin-bottom: 8px;
  border: 1px solid rgba(0,0,0,0.06);
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
}

.queue-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: #f9fafb;
  border-bottom: 1px solid #f0f0f0;
  font-size: 12px;
  font-weight: 600;
  color: #a8a29e;
}

.queue-header-icon {
  font-size: 13px;
  color: rgb(var(--arcoblue-6));
}

.queue-badge {
  margin-left: auto;
  background: rgb(var(--arcoblue-6));
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 99px;
  min-width: 18px;
  text-align: center;
}

.queue-list {
  display: flex;
  flex-direction: column;
}

.queue-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  font-size: 12px;
  border-bottom: 1px solid #f5f5f5;
}
.queue-item:last-child { border-bottom: none; }

.queue-item-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.queue-item-dot.active  {
  background: rgb(var(--arcoblue-6));
  animation: queue-pulse 1.2s ease-in-out infinite;
}
.queue-item-dot.waiting { background: #d1d5db; }

@keyframes queue-pulse {
  0%, 100% { opacity: 1;    transform: scale(1); }
  50%       { opacity: 0.4; transform: scale(0.75); }
}

.queue-item-type {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(68,64,60,0.06);
  color: #a8a29e;
}
.queue-item.agent .queue-item-type {
  background: rgb(var(--arcoblue-1));
  color: rgb(var(--arcoblue-6));
}

.queue-item-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #44403c;
}

.queue-item-status {
  flex-shrink: 0;
  font-size: 11px;
  color: #9ca3af;
}
.queue-item:first-child .queue-item-status {
  color: rgb(var(--arcoblue-6));
  font-weight: 500;
}

/* 队列动画 */
.queue-slide-enter-active, .queue-slide-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}
.queue-slide-enter-from, .queue-slide-leave-to {
  opacity: 0;
  max-height: 0;
}
.queue-slide-enter-to, .queue-slide-leave-from {
  opacity: 1;
  max-height: 300px;
}

/* ── 输入区 ── */
.chat-input-area {
  flex-shrink: 0;
  width: 100%;
  max-width: 900px;
  padding: 8px 20px 24px;
}

.input-card-outer {
  position: relative;
}

.quick-reply-bar {
  margin-bottom: 12px;
  padding: 12px 14px;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.05);
}

.quick-reply-label {
  font-size: 11px;
  font-weight: 700;
  color: #a8a29e;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.quick-reply-question {
  margin-top: 8px;
  font-size: 14px;
  line-height: 1.6;
  color: #292524;
}

.quick-reply-helper {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: #78716c;
}

.quick-reply-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.quick-reply-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 14px;
  background: #fff;
  color: #44403c;
  text-align: left;
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}

.quick-reply-item:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: rgba(var(--arcoblue-6), 0.35);
  background: rgba(var(--arcoblue-1), 0.68);
}

.quick-reply-item-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1917;
}

.quick-reply-item-desc {
  font-size: 12px;
  line-height: 1.5;
  color: #78716c;
}

.quick-reply-item:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.input-card {
  position: relative;
  border: 1.5px solid #e4e6ea;
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 1px 8px rgba(0,0,0,0.05);
  display: flex;
  flex-direction: column;
  transition: border-color 0.18s, box-shadow 0.18s;
  overflow: hidden;
  /* 防止 Arco 子组件渗色 */
  isolation: isolate;
}

.input-card.focused {
  border-color: #c8d4e8;
  box-shadow: 0 2px 12px rgba(0,0,0,0.06), 0 0 0 3px rgba(var(--arcoblue-6), 0.08);
}

.chat-image-input {
  display: none;
}

.pending-image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  padding: 12px 12px 0;
}

/* ── 空间文档引用 ── */
.pending-ws-refs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px 0;
}

.pending-ws-ref-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px 4px 10px;
  background: #f5f5f4;
  border: 1px solid #e4e6ea;
  border-radius: 20px;
  max-width: 200px;
}

.ws-ref-chip-icon {
  font-size: 13px;
  color: #78716c;
  flex-shrink: 0;
}

.ws-ref-chip-name {
  font-size: 12px;
  color: #44403c;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.ws-ref-chip-remove {
  background: none;
  border: none;
  cursor: pointer;
  color: #a8a29e;
  font-size: 14px;
  line-height: 1;
  padding: 0 0 0 2px;
  flex-shrink: 0;
}
.ws-ref-chip-remove:hover { color: #44403c; }

/* @ 内联菜单 */
.at-mention-dropdown {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 12px;
  right: 12px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  overflow: hidden;
  z-index: 100;
  max-height: 220px;
  overflow-y: auto;
}

.at-mention-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.12s;
}
.at-mention-item:hover,
.at-mention-item.active {
  background: #f5f5f4;
}

.at-mention-icon {
  font-size: 14px;
  color: #a8a29e;
  flex-shrink: 0;
}

.at-mention-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.at-mention-name {
  font-size: 13px;
  color: #1c1917;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.at-mention-folder {
  font-size: 11px;
  color: #a8a29e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 工具栏空间引用按钮 */
.ws-picker-wrap {
  position: relative;
}

.ws-picker-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  background: rgb(var(--arcoblue-6));
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  border-radius: 8px;
  padding: 1px 4px;
  min-width: 16px;
  text-align: center;
  line-height: 1.4;
  pointer-events: none;
}

.attach-btn.active {
  color: rgb(var(--arcoblue-6));
}

/* 空间文档 picker 下拉 */
.ws-picker-dropdown {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  width: 280px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.14);
  overflow: hidden;
  z-index: 200;
}

.ws-picker-head {
  padding: 10px 12px 6px;
  border-bottom: 1px solid #f3f4f6;
}

.ws-picker-search {
  width: 100%;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 13px;
  outline: none;
  color: #1c1917;
}
.ws-picker-search:focus { border-color: rgb(var(--arcoblue-6)); }

.ws-picker-hint {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: #a8a29e;
}

.ws-picker-list {
  max-height: 240px;
  overflow-y: auto;
  padding: 4px 0;
}

.ws-picker-empty {
  padding: 12px;
  font-size: 13px;
  color: #a8a29e;
  text-align: center;
}

.ws-picker-folder-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 4px;
  font-size: 11px;
  font-weight: 600;
  color: #78716c;
  letter-spacing: 0.02em;
  background: #fafaf9;
  border-top: 1px solid #f3f4f6;
}
.ws-picker-folder-header:first-child { border-top: none; }

.ws-picker-folder-icon {
  font-size: 12px;
  color: #a8a29e;
  flex-shrink: 0;
}

.ws-picker-item--indented {
  padding-left: 24px;
}

.ws-picker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.12s;
}
.ws-picker-item:hover { background: #f5f5f4; }
.ws-picker-item.selected { background: rgba(var(--arcoblue-6), 0.06); }

.ws-picker-icon {
  font-size: 14px;
  color: #a8a29e;
  flex-shrink: 0;
}
.ws-picker-item.selected .ws-picker-icon { color: rgb(var(--arcoblue-6)); }

.ws-picker-name {
  font-size: 13px;
  color: #1c1917;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-picker-check {
  font-size: 13px;
  color: rgb(var(--arcoblue-6));
  font-weight: 700;
  flex-shrink: 0;
}
/* ── end 空间文档引用 ── */

/* ── 工具直达模式（"+"按钮） ────────────────────────────────── */
.tool-picker-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.tool-picker-btn {
  margin-right: 0; /* 覆盖 .attach-btn 的 auto margin，交给后续的 attachment 按钮处理 */
}

.tool-picker-btn.active {
  background: #1c1917;
  color: #fff;
}

.tool-picker-dropdown {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  width: 240px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.14);
  overflow: hidden;
  z-index: 200;
}

.tool-picker-head {
  padding: 10px 12px 6px;
  font-size: 11px;
  font-weight: 600;
  color: #78716c;
  letter-spacing: 0.02em;
  border-bottom: 1px solid #f3f4f6;
}

.tool-picker-list {
  padding: 4px 0;
}

.tool-picker-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  cursor: pointer;
  transition: background 0.12s;
}
.tool-picker-item:hover { background: #f5f5f4; }
.tool-picker-item.selected { background: rgba(var(--arcoblue-6), 0.06); }

.tool-picker-icon {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: #eef2ff;
  color: #1c1917;
  font-size: 14px;
  flex-shrink: 0;
}
.tool-picker-item.selected .tool-picker-icon {
  background: rgb(var(--arcoblue-6));
  color: #fff;
}

.tool-picker-meta {
  flex: 1;
  min-width: 0;
}

.tool-picker-label {
  font-size: 13px;
  color: #1c1917;
  font-weight: 500;
  line-height: 1.2;
}

.tool-picker-hint {
  font-size: 11px;
  color: #a8a29e;
  margin-top: 2px;
}

.tool-picker-check {
  font-size: 13px;
  color: rgb(var(--arcoblue-6));
  font-weight: 700;
}

/* Pill 挂在输入框上方 */
.tool-mode-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 10px 12px 0;
  padding: 4px 6px 4px 10px;
  border-radius: 999px;
  background: #1c1917;
  color: #fff;
  font-size: 12px;
  width: fit-content;
}

.tool-mode-pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  flex-shrink: 0;
}

.tool-mode-pill-label {
  font-weight: 600;
}

.tool-mode-pill-hint {
  color: #d6d3d1;
}

.tool-mode-pill-remove {
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: rgba(255,255,255,0.12);
  color: #fff;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  margin-left: 2px;
  padding: 0;
  transition: background 0.18s ease, transform 0.15s ease;
}
.tool-mode-pill-remove:active { transform: scale(0.92); }
.tool-mode-pill-remove:hover { background: rgba(255,255,255,0.24); }
/* ── end 工具直达 ── */

.pending-doc-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px 0;
}

.pending-doc-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #e0e7ff;
  border-radius: 10px;
  background: #f0f4ff;
}

.pending-doc-icon {
  font-size: 18px;
  color: #4f46e5;
  flex-shrink: 0;
}

.pending-doc-meta {
  min-width: 0;
  flex: 1;
}

.pending-doc-name {
  font-size: 12px;
  font-weight: 600;
  color: #1e1b4b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pending-doc-size {
  margin-top: 2px;
  font-size: 11px;
  color: #6366f1;
}

.pending-image-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border: 1px solid rgba(0,0,0,0.06);
  border-radius: 14px;
  background: #faf9f7;
}

.pending-image-thumb {
  width: 54px;
  height: 54px;
  object-fit: cover;
  border-radius: 10px;
  flex-shrink: 0;
}

.pending-image-meta {
  min-width: 0;
  flex: 1;
}

.pending-image-name {
  font-size: 12px;
  font-weight: 600;
  color: #1c1917;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pending-image-size {
  margin-top: 3px;
  font-size: 11px;
  color: #57534e;
}

.pending-image-remove {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 50%;
  background: #e2e8f0;
  color: #57534e;
  cursor: pointer;
  flex-shrink: 0;
}

:deep(.chat-textarea),
:deep(.chat-textarea .arco-textarea-wrapper),
:deep(.chat-textarea .arco-textarea-wrapper:hover),
:deep(.chat-textarea .arco-textarea-wrapper.arco-textarea-focus) {
  background: #fff !important;
  border: none !important;
  box-shadow: none !important;
  border-radius: 0 !important;
  padding: 0 !important;
}

:deep(.chat-textarea textarea) {
  background: #fff !important;
  border: none !important;
  box-shadow: none !important;
  resize: none;
  padding: 14px 16px 6px;
  font-size: 14px;
  line-height: 1.7;
  color: #1c1917;
}

:deep(.chat-textarea textarea::placeholder) {
  color: #c2c7d0;
}

:deep(.chat-textarea textarea:focus) {
  border: none !important;
  box-shadow: none !important;
  outline: none;
}

/* 工具栏 */
.input-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 6px 10px 10px;
}

.attach-btn {
  margin-right: auto;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: rgba(15, 23, 42, 0.04);
  color: #57534e;
  font-size: 15px;
  cursor: pointer;
  transition: background 0.22s ease, color 0.22s ease,
              transform 0.18s cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 0.22s ease;
}

.attach-btn:hover:not(:disabled) {
  background: #eef2ff;
  color: rgb(var(--arcoblue-6));
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08);
}

.attach-btn:active:not(:disabled) {
  transform: translateY(0) scale(0.96);
  box-shadow: none;
}

.attach-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* 发送按钮 */
.send-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: rgba(15, 23, 42, 0.05);
  color: #a8a29e;
  font-size: 15px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: default;
  flex-shrink: 0;
  transition: background 0.22s ease, color 0.22s ease,
              transform 0.18s cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 0.22s ease;
}

.send-btn--active {
  background: #1c1917;
  color: #fff;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.18);
}

.send-btn--active:hover {
  background: #0f172a;
  transform: translateY(-1px) scale(1.04);
  box-shadow: 0 6px 14px rgba(15, 23, 42, 0.22);
}

.send-btn--active:active {
  transform: translateY(0) scale(0.95);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.18);
}

.stop-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: #fee2e2;
  color: #dc2626;
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  box-shadow: 0 2px 6px rgba(220, 38, 38, 0.18);
  transition: background 0.2s ease, transform 0.18s cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 0.22s ease;
}

.stop-btn:hover {
  background: #fecaca;
  transform: translateY(-1px) scale(1.04);
  box-shadow: 0 6px 14px rgba(220, 38, 38, 0.24);
}

.stop-btn:active {
  transform: translateY(0) scale(0.95);
  box-shadow: 0 1px 3px rgba(220, 38, 38, 0.2);
}

/* ── 右侧工作区 ── */
.ws-workspace {
  width: var(--preview-width);
  min-width: 480px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: #f5f6fa;
}

/* ── 单一产出物面板 ── */
.artifact-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: #fff;
}

.artifact-pane--ppt {
  background: #f5f6fa;
}

.artifact-pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 22px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.06);
  flex-shrink: 0;
  background: linear-gradient(180deg, #ffffff 0%, #fbfbfd 100%);
}

.artifact-pane-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.artifact-pane-icon-wrap {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  background: rgba(59, 130, 246, 0.10);
  color: #2563eb;
  transition: background 0.25s ease, transform 0.25s ease;
}

.artifact-pane-icon {
  font-size: 17px;
  color: inherit;
}

.artifact-pane-title-stack {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.artifact-pane-kicker {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #94A3B8;
  line-height: 1;
}

.artifact-pane-title {
  font-size: 14px;
  font-weight: 600;
  color: #1E293B;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artifact-pane-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.pane-action-btn {
  padding: 6px 14px;
  border: 1px solid rgba(15, 23, 42, 0.10);
  border-radius: 8px;
  background: #fff;
  font-size: 12px;
  font-weight: 500;
  color: #475569;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  transition: border-color 0.2s ease, color 0.2s ease,
              background 0.2s ease, box-shadow 0.22s ease,
              transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}
.pane-action-btn:hover {
  border-color: rgba(var(--arcoblue-6), 0.45);
  color: rgb(var(--arcoblue-6));
  background: rgba(var(--arcoblue-6), 0.04);
  box-shadow: 0 4px 10px rgba(15, 23, 42, 0.06);
  transform: translateY(-1px);
}
.pane-action-btn:active {
  transform: translateY(0) scale(0.97);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.artifact-pane-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.pane-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pane-label {
  font-size: 11px;
  font-weight: 600;
  color: #94A3B8;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.concept-pane-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.concept-streaming {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: #6366f1;
  text-transform: none;
  font-weight: 500;
}

.concept-streaming-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #6366f1;
  animation: concept-pulse 1.2s ease-in-out infinite;
}

@keyframes concept-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.1); }
}

.concept-skeleton {
  gap: 14px;
}

.concept-skeleton-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.concept-skeleton-bar {
  height: 10px;
  border-radius: 6px;
  background: linear-gradient(90deg, #eef0f3 0%, #f6f7f9 50%, #eef0f3 100%);
  background-size: 200% 100%;
  animation: concept-shimmer 1.4s linear infinite;
}

.concept-skeleton-bar--label {
  width: 35%;
  height: 8px;
}

.concept-skeleton-bar--short {
  width: 60%;
}

@keyframes concept-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.pane-text {
  font-size: 14px;
  color: #44403c;
  line-height: 1.7;
}

.pane-plan-title {
  font-size: 18px;
  font-weight: 700;
  color: #1E293B;
  margin-bottom: 4px;
}

.pane-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pane-chip {
  padding: 3px 10px;
  background: #EFF6FF;
  color: rgb(var(--arcoblue-6));
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.pane-list {
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pane-list li {
  font-size: 13px;
  color: #57534e;
  line-height: 1.6;
}

.pane-numbered-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid #F1F5F9;
  font-size: 13px;
  color: #44403c;
  line-height: 1.5;
}

.pane-num {
  font-size: 12px;
  font-weight: 700;
  color: rgb(var(--arcoblue-6));
  min-width: 18px;
  padding-top: 1px;
}

.pane-structure-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #F1F5F9;
}

.pane-structure-num {
  font-size: 14px;
  font-weight: 800;
  color: rgb(var(--arcoblue-6));
  opacity: 0.6;
  min-width: 28px;
}

.pane-structure-title {
  font-size: 13px;
  font-weight: 600;
  color: #1E293B;
  margin-bottom: 3px;
}

.pane-structure-points {
  font-size: 12px;
  color: #94A3B8;
}

.pane-score {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  padding: 16px;
  background: #FEF2F2;
  border-radius: 10px;
}
.pane-score--pass {
  background: #F0FDF4;
}

.pane-score-round {
  width: 100%;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #94A3B8;
  margin-bottom: 4px;
}

.pane-score-num {
  font-size: 36px;
  font-weight: 900;
  color: #EF4444;
}
.pane-score--pass .pane-score-num {
  color: #22C55E;
}

.pane-score-label {
  font-size: 16px;
  color: #64748B;
}

.pane-score-status {
  font-size: 14px;
  font-weight: 600;
  color: #64748B;
  margin-left: 8px;
}

.pane-page-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid #F1F5F9;
}

.pane-page-num {
  font-size: 12px;
  font-weight: 700;
  color: rgb(var(--arcoblue-6));
  opacity: 0.6;
  min-width: 24px;
}

.pane-page-layout {
  font-size: 11px;
  color: #94A3B8;
  background: #F1F5F9;
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.pane-page-title {
  font-size: 13px;
  color: #44403c;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pane-json {
  font-size: 12px;
  color: #64748B;
  background: #F8FAFC;
  border-radius: 8px;
  padding: 12px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

/* Welcome */
.ws-welcome {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 32px;
  text-align: center;
  gap: 12px;
}

.welcome-icon  { font-size: 52px; color: rgb(var(--arcoblue-6)); }
.welcome-title { font-size: 22px; font-weight: 700; color: var(--color-text-1); }
.welcome-desc  { font-size: 14px; color: var(--color-text-3); max-width: 420px; line-height: 1.6; }

.example-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 16px;
  width: 100%;
  max-width: 440px;
}

.example-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 12px 16px;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.1s;
}
.example-card:hover {
  border-color: rgb(var(--arcoblue-6));
  box-shadow: 0 2px 10px rgba(var(--arcoblue-6), 0.12);
  transform: translateY(-1px);
}

.example-icon  { font-size: 20px; flex-shrink: 0; color: rgb(var(--arcoblue-6)); }
.example-text  { font-size: 13px; color: var(--color-text-1); }

/* Execution */
.ws-execution {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.exec-progress {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px 20px 14px;
  background: #fff;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.exec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.exec-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.exec-state-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgb(var(--arcoblue-6));
  box-shadow: 0 0 0 6px rgba(var(--arcoblue-6), 0.12);
  animation: queue-pulse 1.4s ease-in-out infinite;
  flex-shrink: 0;
}

.exec-state-dot.failed {
  background: rgb(var(--red-6));
  box-shadow: 0 0 0 6px rgba(var(--red-6), 0.12);
  animation: none;
}

.exec-title-copy {
  min-width: 0;
}

.exec-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text-1);
}

.exec-subtitle {
  margin-top: 3px;
  font-size: 12px;
  color: var(--color-text-3);
  line-height: 1.5;
}

.exec-pct {
  font-size: 14px;
  font-weight: 700;
  color: rgb(var(--arcoblue-6));
  min-width: 40px;
  text-align: right;
}

.exec-brief,
.exec-preview-card {
  margin: 14px 20px 0;
  padding: 16px;
  border-radius: 14px;
  background: #fff;
}

.exec-preview-card.preview-only {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.exec-error-card {
  margin: 14px 20px 0;
  padding: 16px;
  border-radius: 14px;
  background: #fff4f4;
  border: 1px solid rgba(var(--red-6), 0.18);
}

.exec-section-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-1);
}

.exec-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.exec-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 999px;
  background: #f7f8fa;
  color: #57534e;
  font-size: 12px;
}

.exec-chip b {
  color: #a8a29e;
  font-weight: 600;
}

.exec-error-stage {
  margin-top: 10px;
  font-size: 12px;
  font-weight: 700;
  color: rgb(var(--red-6));
}

.exec-error-message {
  margin-top: 6px;
  font-size: 13px;
  line-height: 1.7;
  color: #57534e;
}

.exec-error-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}

.exec-preview-stage {
  margin-top: 12px;
  padding: 14px;
  border-radius: 12px;
  background:
    linear-gradient(135deg, rgba(var(--arcoblue-6), 0.12), rgba(var(--arcoblue-3), 0.06)),
    #f7faff;
  border: 1px solid rgba(var(--arcoblue-6), 0.12);
}

.preview-stage-title {
  font-size: 14px;
  font-weight: 700;
  color: #1c1917;
}

.preview-stage-desc {
  margin-top: 6px;
  font-size: 12.5px;
  color: #57534e;
  line-height: 1.6;
}

.exec-preview-skeleton {
  margin-top: 14px;
}

.artifact-card {
  margin-top: 14px;
  padding: 14px;
  border-radius: 14px;
  background: #fbfcff;
  border: 1px solid #edf1f7;
}

.artifact-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 14px;
  font-weight: 700;
  color: #1c1917;
}

.artifact-score {
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(var(--orange-6), 0.1);
  color: rgb(var(--orange-6));
  font-size: 12px;
}

.artifact-score.pass {
  background: rgba(var(--green-6), 0.12);
  color: rgb(var(--green-6));
}

.artifact-paragraph {
  margin-top: 10px;
  font-size: 12.5px;
  line-height: 1.7;
  color: #57534e;
}

.artifact-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.artifact-chip {
  display: inline-flex;
  align-items: center;
  padding: 5px 10px;
  border-radius: 999px;
  background: #f2f3f5;
  color: #57534e;
  font-size: 12px;
}

.artifact-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}

.artifact-list-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #edf1f7;
}

.artifact-list-item b {
  font-size: 12px;
  color: #1c1917;
}

.artifact-list-item span {
  font-size: 12px;
  line-height: 1.6;
  color: #57534e;
}

.highlight-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 14px;
}

.highlight-card {
  padding: 14px;
  border-radius: 14px;
  background: #fff;
}

.highlight-index {
  font-size: 11px;
  font-weight: 800;
  color: rgb(var(--arcoblue-6));
}

.highlight-text {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.7;
  color: #57534e;
}

.artifact-timeline {
  margin-top: 14px;
}

.artifact-timeline-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.artifact-timeline-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #fff;
}

.artifact-timeline-type {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgb(var(--arcoblue-1));
  color: rgb(var(--arcoblue-6));
  font-size: 11px;
  font-weight: 700;
}

.artifact-timeline-text {
  font-size: 12px;
  line-height: 1.6;
  color: #57534e;
}

.strategy-preview {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 14px;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.strategy-preview--final {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px 20px;
  background: #f5f6fa;
}

.strategy-hero {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 14px;
  padding: 18px;
  border-radius: 18px;
  background:
    radial-gradient(circle at top left, rgba(var(--arcoblue-6), 0.12), transparent 44%),
    linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
  border: 1px solid rgba(var(--arcoblue-6), 0.12);
}

.strategy-hero-copy {
  flex: 1;
  min-width: 0;
}

.strategy-hero-eyebrow {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgb(var(--arcoblue-6));
}

.strategy-hero-title {
  margin-top: 10px;
  font-size: 24px;
  font-weight: 800;
  line-height: 1.2;
  color: #1c1917;
}

.strategy-hero-desc {
  margin-top: 10px;
  font-size: 13px;
  line-height: 1.75;
  color: #57534e;
  max-width: 680px;
}

.strategy-hero-meta {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  width: 220px;
  flex-shrink: 0;
}

.strategy-meta-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.78);
}

.strategy-meta-card span {
  font-size: 11px;
  font-weight: 700;
  color: #a8a29e;
}

.strategy-meta-card strong {
  font-size: 14px;
  line-height: 1.5;
  color: #1c1917;
}

.preview-block {
  padding: 14px;
  border-radius: 14px;
  background: rgba(251, 252, 255, 0.8);
}

.preview-block--plan {
  background: linear-gradient(180deg, #ffffff 0%, #fbfcff 100%);
}

.preview-block-title {
  font-size: 13px;
  font-weight: 700;
  color: #1c1917;
}

.research-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 12px;
}

.research-card {
  min-width: 0;
  padding: 12px;
  border-radius: 12px;
  background: #fff;
}

.research-card-title {
  font-size: 12px;
  font-weight: 700;
  color: #1c1917;
}

.research-card-summary {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: #57534e;
}

.research-card-points {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.research-card-points span {
  font-size: 11px;
  line-height: 1.6;
  color: #57534e;
}

.plan-outline {
  margin-top: 14px;
}

.plan-outline-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}

.plan-outline-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  border-radius: 12px;
  background: #fff;
}

.plan-outline-index {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: rgb(var(--arcoblue-1));
  color: rgb(var(--arcoblue-6));
  font-size: 12px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
}

.plan-outline-copy {
  min-width: 0;
}

.plan-outline-title {
  font-size: 13px;
  font-weight: 700;
  color: #1c1917;
}

.plan-outline-desc {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: #57534e;
}

.review-block {
  background: rgba(255, 250, 243, 0.6);
}

.section-live-block {
  background: linear-gradient(180deg, #f9fbff 0%, #ffffff 100%);
}

.section-live-badge {
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(var(--arcoblue-6), 0.1);
  color: rgb(var(--arcoblue-6));
  font-size: 11px;
  font-weight: 700;
}

.section-live-focus {
  margin-top: 14px;
  padding: 14px;
  border-radius: 14px;
  background: rgba(230, 238, 255, 0.5);
}

.section-live-eyebrow {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgb(var(--arcoblue-6));
}

.section-live-title {
  margin-top: 8px;
  font-size: 18px;
  font-weight: 800;
  color: #1c1917;
}

.section-live-points {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.section-live-points span {
  font-size: 12px;
  line-height: 1.7;
  color: #57534e;
}

.section-live-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
}

.section-live-item {
  padding: 12px;
  border-radius: 14px;
  background: #fff;
}

.section-live-item.active {
  background: rgba(230, 238, 255, 0.6);
}

.section-live-item.final {
  background: #fff;
}

.section-live-item-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.section-live-item-index {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: #f2f3f5;
  color: #57534e;
  font-size: 11px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
}

.section-live-item-title {
  font-size: 13px;
  font-weight: 700;
  color: #1c1917;
}

.section-live-item-desc {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.7;
  color: #57534e;
}

.preview-tabs-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: #fff;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.preview-tabs {
  display: inline-flex;
  gap: 6px;
  padding: 4px;
  border-radius: 12px;
  background: #f2f3f5;
}

.preview-tab {
  border: none;
  background: transparent;
  color: #57534e;
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}

.preview-tab.active {
  background: #fff;
  color: rgb(var(--arcoblue-6));
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}

.exec-log-card {
  margin: 0 20px 20px;
  padding: 16px;
  border-radius: 14px;
  background: #fff;
  border: 1px solid var(--color-border);
}

.exec-log-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  max-height: 240px;
  overflow-y: auto;
}

.exec-log-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #f7f8fa;
}

.exec-log-time {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  color: #a8a29e;
  min-width: 54px;
}

.exec-log-text {
  font-size: 12px;
  line-height: 1.6;
  color: #57534e;
}

.preview-skel,
.preview-card {
  position: relative;
  overflow: hidden;
  background: linear-gradient(90deg, #f2f3f5 0%, #f7f8fa 50%, #f2f3f5 100%);
  background-size: 200% 100%;
  animation: preview-shimmer 1.8s linear infinite;
}

.preview-skel--hero {
  height: 108px;
  border-radius: 14px;
}

.preview-skel--line {
  height: 12px;
  border-radius: 999px;
  margin-top: 12px;
}

.preview-skel--line.short {
  width: 52%;
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 14px;
}

.preview-card {
  height: 92px;
  border-radius: 12px;
}

.ppt-build-board {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ppt-build-hero {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 14px;
  padding: 18px;
  border-radius: 18px;
  background:
    radial-gradient(circle at top left, rgba(var(--arcoblue-6), 0.14), transparent 42%),
    linear-gradient(180deg, #ffffff 0%, #f6f9ff 100%);
  border: 1px solid rgba(var(--arcoblue-6), 0.12);
}

.ppt-build-hero-copy {
  flex: 1;
  min-width: 0;
}

.ppt-build-eyebrow,
.ppt-build-stage-kicker {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgb(var(--arcoblue-6));
}

.ppt-build-title {
  margin-top: 10px;
  font-size: 24px;
  font-weight: 800;
  line-height: 1.2;
  color: #1c1917;
}

.ppt-build-desc {
  margin-top: 10px;
  font-size: 13px;
  line-height: 1.7;
  color: #57534e;
  max-width: 640px;
}

.ppt-build-metrics {
  width: 196px;
  flex-shrink: 0;
  display: grid;
  gap: 10px;
}

.ppt-build-metric {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.84);
}

.ppt-build-metric span {
  font-size: 11px;
  font-weight: 700;
  color: #a8a29e;
}

.ppt-build-metric strong {
  font-size: 18px;
  line-height: 1.4;
  color: #1c1917;
}

.ppt-build-progress {
  padding: 14px 16px;
  border-radius: 16px;
  background: #fff;
  border: 1px solid #edf1f7;
}

.ppt-build-progress-track {
  height: 8px;
  border-radius: 999px;
  background: #edf1f7;
  overflow: hidden;
}

.ppt-build-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, rgb(var(--arcoblue-6)), rgb(var(--arcoblue-4)));
  transition: width 0.35s ease;
}

.ppt-build-progress-text {
  margin-top: 10px;
  font-size: 12.5px;
  color: #57534e;
}

.ppt-build-stage {
  padding: 16px;
  border-radius: 18px;
  background: linear-gradient(180deg, #f9fbff 0%, #ffffff 100%);
  border: 1px solid rgba(var(--arcoblue-6), 0.1);
}

.ppt-build-stage-title {
  margin-top: 8px;
  font-size: 20px;
  font-weight: 800;
  color: #1c1917;
}

.ppt-build-stage-meta {
  margin-top: 6px;
  font-size: 12px;
  color: rgb(var(--arcoblue-6));
  font-weight: 700;
}

.ppt-build-stage-shell {
  margin-top: 14px;
  padding: 18px;
  border-radius: 16px;
  background:
    linear-gradient(135deg, rgba(var(--arcoblue-6), 0.08), rgba(var(--arcoblue-3), 0.04)),
    #fff;
  border: 1px solid rgba(var(--arcoblue-6), 0.08);
}

.ppt-build-stage-bar,
.ppt-build-stage-line,
.ppt-build-card-line {
  border-radius: 999px;
  background: linear-gradient(90deg, #eef2ff 0%, #f8fbff 50%, #eef2ff 100%);
  background-size: 200% 100%;
  animation: preview-shimmer 1.8s linear infinite;
}

.ppt-build-stage-bar {
  width: 32%;
  height: 10px;
}

.ppt-build-stage-line {
  height: 12px;
  margin-top: 12px;
}

.ppt-build-stage-line.short,
.ppt-build-card-line.short {
  width: 58%;
}

.ppt-build-stage-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 16px;
}

.ppt-build-stage-grid span {
  display: block;
  height: 82px;
  border-radius: 14px;
  background: linear-gradient(180deg, #f5f7fb 0%, #ffffff 100%);
  border: 1px solid #edf1f7;
}

.ppt-build-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.ppt-build-card {
  padding: 14px;
  border-radius: 16px;
  background: #fff;
  border: 1px solid #edf1f7;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.ppt-build-card.active {
  border-color: rgba(var(--arcoblue-6), 0.24);
  box-shadow: 0 10px 24px rgba(59, 130, 246, 0.12);
  transform: translateY(-1px);
}

.ppt-build-card.built {
  background: linear-gradient(180deg, #f7fff9 0%, #ffffff 100%);
  border-color: rgba(var(--green-6), 0.16);
}

.ppt-build-card.pending {
  background: linear-gradient(180deg, #fbfcff 0%, #ffffff 100%);
}

.ppt-build-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.ppt-build-card-num {
  width: 28px;
  height: 28px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #f2f3f5;
  color: #57534e;
  font-size: 11px;
  font-weight: 800;
}

.ppt-build-card.active .ppt-build-card-num {
  background: rgba(var(--arcoblue-6), 0.12);
  color: rgb(var(--arcoblue-6));
}

.ppt-build-card.built .ppt-build-card-num {
  background: rgba(var(--green-6), 0.12);
  color: rgb(var(--green-6));
}

.ppt-build-card-status {
  font-size: 11px;
  font-weight: 700;
  color: #a8a29e;
}

.ppt-build-card-layout {
  margin-top: 12px;
  font-size: 11px;
  font-weight: 700;
  color: rgb(var(--arcoblue-6));
}

.ppt-build-card-title {
  margin-top: 6px;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.5;
  color: #1c1917;
  min-height: 40px;
}

.ppt-build-card-shell {
  margin-top: 14px;
}

.ppt-build-card-line {
  height: 10px;
  margin-top: 10px;
}

@keyframes preview-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.steps-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.step-card {
  background: #fff;
  border: 1.5px solid var(--color-border);
  border-radius: 12px;
  padding: 12px 16px;
  transition: border-color 0.2s, box-shadow 0.2s, opacity 0.2s;
}

.step-card.pending   { opacity: 0.5; }
.step-card.running   { border-color: rgb(var(--arcoblue-6)); box-shadow: 0 0 0 3px rgba(var(--arcoblue-6), 0.1); opacity: 1; }
.step-card.completed { border-left: 4px solid rgb(var(--green-6)); }
.step-card.failed    { border-left: 4px solid rgb(var(--red-6)); }

.step-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.step-icon  { font-size: 18px; flex-shrink: 0; color: rgb(var(--arcoblue-6)); }
.step-title { font-size: 14px; font-weight: 600; color: var(--color-text-1); flex: 1; }
.step-tag   { flex-shrink: 0; }

.step-detail {
  margin-top: 6px;
  margin-left: 28px;
  font-size: 12.5px;
  color: var(--color-text-3);
  line-height: 1.5;
}

.step-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  margin-left: 28px;
  font-size: 12px;
  color: var(--color-text-3);
}

.meta-pass {
  color: rgb(var(--green-6));
  font-weight: 600;
}

.meta-revise {
  color: rgb(var(--orange-6));
  font-weight: 600;
}

.step-subs { margin-top: 6px; margin-left: 28px; display: flex; flex-direction: column; gap: 4px; }
.sub-item  { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--color-text-3); }

.sub-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #d1d5db;
  flex-shrink: 0;
}

.sub-dot.done {
  background: rgb(var(--green-6));
}

/* Done */
.ws-done {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ws-document {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.build-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: #fff;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.build-summary-copy {
  min-width: 0;
}

.build-summary-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-1);
}

.build-summary-desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-text-3);
  line-height: 1.5;
}

.done-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 16px;
  background: #fff;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.done-label {
  margin-left: auto;
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--green-6));
}

@media (max-width: 1024px) {
  .chat-conversation-sidebar {
    width: 240px;
    min-width: 240px;
  }

  .chat-layout.preview-open .chat-panel {
    min-width: 320px;
  }

  .preview-grid {
    grid-template-columns: 1fr;
  }

  .research-grid {
    grid-template-columns: 1fr;
  }

  .highlight-grid {
    grid-template-columns: 1fr;
  }

  .strategy-hero {
    flex-direction: column;
  }

  .strategy-hero-meta {
    width: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ws-workspace {
    min-width: 360px;
  }
}

@media (max-width: 768px) {
  .chat-layout {
    flex-direction: column;
  }

  .chat-conversation-sidebar {
    display: none;
  }

  .chat-panel {
    width: 100%;
    min-width: 0;
    border-right: none;
  }

  .chat-input-area {
    padding: 14px;
  }

  .input-card {
    border-radius: 18px;
  }

  .space-select {
    width: 124px;
  }

  .panel-resizer,
  .ws-workspace {
    display: none;
  }
}

/* ── Brain Agent 新消息类型 ─────────────────────────── */

/* thinking 气泡 */
.thinking-bubble {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 0;
}

.thinking-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #d1d5db;
  animation: thinking-bounce 1.2s infinite ease-in-out;
}

.thinking-dot:nth-child(2) { animation-delay: 0.2s; }
.thinking-dot:nth-child(3) { animation-delay: 0.4s; }

.thinking-label {
  margin-left: 8px;
  font-size: 12px;
  color: var(--ink-2, #94a3b8);
}

@keyframes thinking-bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.5; }
  40% { transform: translateY(-6px); opacity: 1; }
}

/* tool-call 气泡 */
.tool-call-bubble {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: #f7f8fa;
  border-radius: 8px;
  border-left: 2px solid #e5e6eb;
  font-size: 13px;
  color: #57534e;
  max-width: 460px;
}

.tool-call-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.tool-call-icon {
  font-size: 15px;
  flex-shrink: 0;
}

.tool-call-display {
  flex: 1;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-call-progress {
  font-size: 12px;
  color: #a8a29e;
  flex-shrink: 0;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-call-result {
  width: 100%;
  border-top: 1px solid #e5e6eb;
  padding-top: 8px;
}

.tool-call-result-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  color: #1c1917;
}

.tool-call-toggle {
  border: none;
  background: transparent;
  color: rgb(var(--arcoblue-6));
  cursor: pointer;
  font-size: 12px;
  padding: 0;
  flex-shrink: 0;
}

.tool-call-result-details {
  margin: 8px 0 0;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid #e5e6eb;
  border-radius: 8px;
  color: #57534e;
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.process-summary-bubble {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 480px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 0;
}

.process-summary-head {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: #9ca3af;
  font-size: 13px;
  line-height: 1.5;
  transition: color 0.15s ease;
}

.process-summary-head:hover {
  color: #4b5563;
}

.process-summary-label {
  font-weight: 400;
}

.process-summary-chevron {
  display: inline-block;
  font-size: 14px;
  line-height: 1;
  transform: translateY(-1px);
  transition: transform 0.15s ease;
}

.process-summary-head.expanded .process-summary-chevron {
  transform: rotate(90deg);
}

.process-summary-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.process-summary-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid #eef0f3;
}

.process-summary-time {
  flex-shrink: 0;
  min-width: 54px;
  font-size: 11px;
  font-weight: 700;
  color: #a8a29e;
}

.process-summary-text {
  font-size: 12px;
  line-height: 1.6;
  color: #57534e;
}

/* clarification 气泡 */
.clarification-bubble {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px;
  background: #f2f7ff;
  border-radius: 10px;
  border: 1px solid #bedaff;
  max-width: 480px;
}

.clarification-question {
  font-size: 14px;
  color: #1c1917;
  line-height: 1.6;
}

.clarification-reply-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.clarification-input {
  flex: 1;
}

.clarification-answered {
  font-size: 12px;
  color: #a8a29e;
}

/* ── 独立产出物面板 ── */
.artifact-panel {
  border-bottom: 1px solid #f0f0f0;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  cursor: pointer;
  user-select: none;
  transition: background 0.2s;
}

.panel-header:hover {
  background: rgba(0, 0, 0, 0.02);
}

.panel-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-icon {
  font-size: 16px;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1917;
}

.panel-badge {
  font-size: 11px;
  color: #a8a29e;
  background: #f4f5f5;
  padding: 2px 8px;
  border-radius: 4px;
}

.panel-selected-badge {
  font-size: 10px;
  color: #fff;
  background: #165dff;
  padding: 2px 6px;
  border-radius: 4px;
}

.panel-toggle {
  font-size: 10px;
  color: #c9cdd4;
}

.panel-save-btn {
  font-size: 12px;
  color: #165dff;
  background: none;
  border: 1px solid #165dff;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.panel-save-btn:hover {
  background: #165dff;
  color: #fff;
}

.panel-body {
  padding: 0 16px 16px;
}

/* ── 搜索研究面板 ── */
.research-item {
  padding: 12px;
  background: #f7f8fa;
  border-radius: 8px;
  margin-bottom: 8px;
}

.research-item:last-child {
  margin-bottom: 0;
}

.research-item-title {
  font-size: 13px;
  font-weight: 600;
  color: #1c1917;
  margin-bottom: 6px;
}

.research-item-summary {
  font-size: 12px;
  color: #57534e;
  line-height: 1.5;
  margin-bottom: 8px;
}

.research-item-findings {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.finding-item {
  font-size: 12px;
  color: #57534e;
  padding-left: 12px;
  position: relative;
}

.finding-item::before {
  content: '•';
  position: absolute;
  left: 0;
  color: #165dff;
}

/* ── 方案草稿面板 ── */
.plan-draft-title {
  font-size: 15px;
  font-weight: 600;
  color: #1c1917;
  margin-bottom: 12px;
}

.plan-draft-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.highlight-section {
  background: #f7f8fa;
  border-radius: 8px;
  padding: 12px;
}

.highlight-title {
  font-size: 13px;
  font-weight: 600;
  color: #1c1917;
  margin-bottom: 8px;
}

.highlight-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  color: #57534e;
  margin-bottom: 6px;
}

.highlight-item:last-child {
  margin-bottom: 0;
}

.highlight-num {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  background: #165dff;
  color: #fff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
}

.plan-structure {
  background: #f7f8fa;
  border-radius: 8px;
  padding: 12px;
}

.structure-title {
  font-size: 13px;
  font-weight: 600;
  color: #1c1917;
  margin-bottom: 10px;
}

.structure-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 10px;
}

.structure-item:last-child {
  margin-bottom: 0;
}

.structure-num {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  background: #e8eefb;
  color: #165dff;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
}

.structure-info {
  flex: 1;
}

.structure-item-title {
  font-size: 13px;
  font-weight: 500;
  color: #1c1917;
  margin-bottom: 2px;
}

.structure-item-points {
  font-size: 12px;
  color: #a8a29e;
}

/* ── 章节内容面板 ── */
.section-item {
  padding: 10px 12px;
  background: #f7f8fa;
  border-radius: 8px;
  margin-bottom: 8px;
}

.section-item:last-child {
  margin-bottom: 0;
}

.section-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.section-item-num {
  font-size: 12px;
  font-weight: 600;
  color: #165dff;
}

.section-item-title {
  font-size: 13px;
  font-weight: 500;
  color: #1c1917;
}

.section-item-points {
  font-size: 12px;
  color: #a8a29e;
  padding-left: 30px;
}

/* ── PPT预览面板 ── */
.ppt-outline {
  background: #f7f8fa;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}

.ppt-outline-title {
  font-size: 13px;
  font-weight: 600;
  color: #1c1917;
  margin-bottom: 10px;
}

.ppt-page-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid #e8eefb;
}

.ppt-page-item:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.ppt-page-num {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  background: #e8eefb;
  color: #165dff;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
}

.ppt-page-layout {
  font-size: 11px;
  color: #a8a29e;
  background: #fff;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid #e8eefb;
}

.ppt-page-name {
  flex: 1;
  font-size: 12px;
  color: #1c1917;
}

.ppt-slides {
  margin-top: 12px;
}

/* ── 空状态 ── */
.workspace-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: #a8a29e;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-text {
  font-size: 14px;
  text-align: center;
}

/* ╔════════════════════════════════════════════════════════════════╗
   ║  CINEMA THEME OVERRIDES — 暗场胶片风                              ║
   ║  注入位置：scoped style 末尾                                       ║
   ║  原则：靠 cascade 后置压住前面所有亮色规则；不动原始 6200 行 CSS    ║
   ╚════════════════════════════════════════════════════════════════╝ */

/* ── 主布局壳 ───────────────────────────── */
.chat-layout { background: var(--bg-stage); color: var(--ink); }
.chat-panel,
.chat-content,
.chat-main { background: var(--bg-stage); color: var(--ink); }

/* 左侧历史对话栏 */
.chat-conversation-sidebar {
  background: var(--bg-stage-2);
  border-right: 1px solid var(--line);
  color: var(--ink);
}
.chat-history,
.chat-history-list { background: transparent; color: var(--ink); }
.chat-history h1, .chat-history h2, .chat-history h3,
.chat-conversation-sidebar h1, .chat-conversation-sidebar h2, .chat-conversation-sidebar h3 {
  color: var(--ink-strong);
  font-family: var(--font-serif);
  font-weight: 400;
  letter-spacing: -0.015em;
}
.conversation-pill,
.history-item,
.chat-history-item {
  background: transparent;
  color: var(--ink-2);
  border: 1px solid transparent;
  transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.conversation-pill:hover,
.history-item:hover,
.chat-history-item:hover {
  background: var(--bg-card-hover);
  color: var(--ink);
  border-color: var(--line);
}
.conversation-pill.active,
.history-item.active,
.chat-history-item.active {
  background: var(--bg-card-hover);
  color: var(--ink-strong);
  border-color: var(--line-strong);
}

/* ── 聊天区域内容 ───────────────────────── */
.chat-messages,
.chat-stream,
.message-list { background: transparent; color: var(--ink); }

/* 消息气泡 */
.bubble,
.bubble-wrap,
.message-bubble,
.ai-message-card,
.ai-rich-message {
  background: transparent;
  color: var(--ink);
}
.bubble.user,
.user-bubble,
.message-bubble.user {
  background: var(--bg-card);
  border: 1px solid var(--line);
  color: var(--ink-strong);
  border-radius: var(--radius-lg);
  padding: 6px 12px;
}
.ai-rich-summary,
.ai-message-card .summary {
  color: var(--ink-2);
}

/* 内联段落（v-html 注入的子元素需用 :deep() 穿透 scoped 边界） */
.bubble :deep(p),
.ai-message-card :deep(p),
.ai-rich-message :deep(p) { color: var(--ink-2); }
.bubble :deep(strong),
.ai-message-card :deep(strong) { color: var(--ink-strong); }
.ai-message-card :deep(li) { color: var(--ink-2); }
.ai-message-card :deep(li::marker) { color: var(--mute); }
.ai-message-card :deep(h1),
.ai-message-card :deep(h2),
.ai-message-card :deep(h3) { color: var(--ink-strong); }
.ai-message-card :deep(hr) { border-top-color: var(--line); }
.bubble :deep(code),
.ai-message-card :deep(code) {
  background: var(--bg-card);
  border: 1px solid var(--line);
  color: var(--accent);
  font-family: var(--font-mono);
  padding: 1px 6px;
  border-radius: 3px;
}
.ai-message-card :deep(pre) {
  background: var(--bg-card);
  border: 1px solid var(--line);
  color: var(--ink);
}

/* 表格（v-html 注入，必须用 :deep 穿透 scoped 边界，否则不命中） */
.ai-message-card :deep(.ai-table-wrap) {
  border: 1px solid var(--line) !important;
  background: var(--bg-card) !important;
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.ai-message-card :deep(table) {
  background: transparent !important;
  color: var(--ink-2) !important;
}
.ai-message-card :deep(th) {
  background: var(--bg-card-hover) !important;
  color: var(--ink-strong) !important;
  border-color: var(--line) !important;
  font-family: var(--font-mono);
  font-weight: 600;
  letter-spacing: 0.04em;
}
.ai-message-card :deep(td) {
  border-color: var(--line) !important;
  color: var(--ink-2) !important;
}
.ai-message-card :deep(table a),
.ai-message-card :deep(td a),
.ai-message-card :deep(th a) {
  color: var(--accent) !important;
}

/* ── 输入区 ────────────────────────────── */
.chat-input-area,
.chat-input-wrap,
.input-area {
  background: transparent;
  border-top: none;
}
.chat-textarea,
.input-textarea,
textarea.chat-textarea {
  background: var(--bg-input);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  font-family: var(--font-sans);
}
.chat-textarea::placeholder { color: var(--mute); }
.chat-textarea:focus { background: var(--bg-input-focus); border-color: var(--ink-3); outline: none; }

/* Input 内的图标按钮 — 无边框，纯 icon button */
.attach-btn,
.send-btn,
.input-action-btn,
.tool-picker-btn {
  background: transparent !important;
  color: var(--ink-3) !important;
  border: none !important;
  border-radius: var(--radius-sm);
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.attach-btn:hover,
.send-btn:hover,
.input-action-btn:hover,
.tool-picker-btn:hover {
  background: var(--bg-card-hover) !important;
  color: var(--ink) !important;
}
.send-btn { color: var(--accent-ink) !important; }
.send-btn:hover { color: var(--accent) !important; }

/* ── 思考过程 ───────────────────────────── */
.thinking-group,
.thinking-toggle,
.thinking-step {
  background: transparent;
  color: var(--ink-2);
}
.thinking-toggle { color: var(--ink-2); }
.thinking-toggle:hover { background: var(--bg-card-hover); color: var(--ink); }
.thinking-step {
  background: var(--bg-card);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  color: var(--ink-2);
}
.thinking-step-time {
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
}
.thinking-step-content { color: var(--ink-2); }
.thinking-icon { color: var(--ink-3); }

/* ── 工具调用 ───────────────────────────── */
.tool-calls-group { color: var(--ink); }
.tool-calls-toggle {
  background: transparent;
  color: var(--ink-2);
}
.tool-calls-toggle:hover { background: var(--bg-card-hover); color: var(--ink); }
.tool-calls-chevron { color: var(--mute); }

.previous-tool-calls { background: transparent; }
.tool-call-mini {
  background: var(--bg-card);
  border: 1px solid var(--line);
  color: var(--ink-2);
  font-family: var(--font-mono);
  font-size: 11.5px;
}
.tool-call-mini-icon { color: var(--ink-3); }
.tool-call-mini-text { color: var(--ink-2); }

.tool-call-card { background: transparent; }
.tool-call-card-icon {
  background: var(--bg-card);
  color: var(--ink-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}
.tool-call-card-title { color: var(--ink); font-family: var(--font-sans); font-weight: 500; }
.tool-call-card-progress { color: var(--mute); font-family: var(--font-mono); font-size: 11px; }
.tool-call-card-result {
  border-top: 1px solid var(--line);
  color: var(--ink-2);
}
.tool-call-card-result-summary { color: var(--ink-2); }

/* 图标语义色（暗场退饱和版） */
.tool-tone--blue   { background: rgba(168,197,214,0.10); color: #A8C5D6; border-color: rgba(168,197,214,0.18); }
.tool-tone--violet { background: rgba(196,189,222,0.10); color: #C4BDDE; border-color: rgba(196,189,222,0.18); }
.tool-tone--amber  { background: rgba(214,201,155,0.10); color: #D6C99B; border-color: rgba(214,201,155,0.18); }
.tool-tone--green  { background: var(--accent-soft);     color: var(--accent); border-color: var(--accent-line); }
.tool-tone--rose   { background: rgba(214,168,155,0.10); color: #D6A89B; border-color: rgba(214,168,155,0.18); }
.tool-tone--slate  { background: var(--bg-card);         color: var(--ink-2); border-color: var(--line); }

/* ── Brief Card ─────────────────────────── */
.brief-card {
  background: var(--bg-card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  color: var(--ink);
  position: relative;
}
/* 内部 sections 不要再加 bg/border（避免框中框） */
.brief-card-block,
.brief-card-block--inline {
  background: transparent !important;
  border: none !important;
  border-radius: 0 !important;
}
/* 用极轻的顶部分隔线代替整框 */
.brief-card .brief-card-block + .brief-card-block { border-top: 1px solid var(--line) !important; }
.brief-card-block--inline { border-top: none !important; padding-top: 4px !important; }

.brief-card-head { color: var(--ink-strong); }
.brief-card-brand,
.brief-card-kicker,
.brief-card-label,
.brief-card-label-inline {
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.brief-card-text,
.brief-card-text-inline {
  color: var(--ink) !important;
  font-size: 14.5px;
  line-height: 1.65;
}
.brief-card-chips { gap: 6px; }
.brief-card-chip {
  background: var(--bg-card-hover);
  border: 1px solid var(--line);
  color: var(--ink-2);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  border-radius: var(--radius-sm);
}
.brief-card-list { color: var(--ink-2); }
.brief-card-list li::marker { color: var(--mute); }

/* ── Challenge Card (Critic) ────────────── */
.challenge-card,
.challenge-card--clean {
  background: var(--bg-card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  color: var(--ink);
}
.challenge-card-head { color: var(--ink-strong); }
.challenge-card-kicker {
  color: var(--accent-ink);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.challenge-card-assessment { color: var(--ink-2); font-size: 14px; line-height: 1.7; }
.challenge-card-concern {
  background: rgba(255,255,255,0.02);
  border-top: 1px solid var(--line);
  border-left: none;
  color: var(--ink-2);
}
.challenge-card-concern--high   { box-shadow: inset 2px 0 0 0 #D6A89B; }
.challenge-card-concern--medium { box-shadow: inset 2px 0 0 0 #D6C99B; }
.challenge-card-concern--low    { box-shadow: inset 2px 0 0 0 var(--accent); }
.challenge-card-concern-head    { color: var(--ink); }
.challenge-card-concern-axis,
.challenge-card-concern-sev {
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.challenge-card-concern-issue       { color: var(--ink); }
.challenge-card-concern-why         { color: var(--ink-3); font-style: italic; }
.challenge-card-concern-resolution  { color: var(--ink-2); }
.challenge-card-concern-resolution-label {
  color: var(--accent-ink);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

/* ── Concept Card (策划方向) ────────────── */
.concept-card {
  background: var(--bg-card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  color: var(--ink);
}
.concept-card--degraded { opacity: 0.7; }
/* 内部 block 不要再加 bg/border（避免框中框） */
.concept-card-block,
.concept-card-block--inline {
  background: transparent !important;
  border: none !important;
  border-radius: 0 !important;
}
.concept-card .concept-card-block + .concept-card-block { border-top: 1px solid var(--line) !important; }
.concept-card-block--inline { border-top: none !important; }
.concept-card-head,
.concept-card-direction {
  color: var(--ink-strong);
  font-family: var(--font-serif);
  font-weight: 400;
  letter-spacing: -0.015em;
}
.concept-card-axis,
.concept-card-label,
.concept-card-label-inline {
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.concept-card-positioning,
.concept-card-framework,
.concept-card-shared,
.concept-card-rec-text { color: var(--ink-2); line-height: 1.7; }
.concept-card-rec-label,
.concept-card-recommendation {
  color: var(--accent-ink);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.concept-card-tab {
  background: transparent;
  border: 1px solid var(--line);
  color: var(--ink-2);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
}
.concept-card-tab--active {
  background: var(--bg-card-hover);
  border-color: var(--line-strong);
  color: var(--ink-strong);
}
.concept-card-cta { color: var(--ink); }
.concept-card-degraded-note { color: var(--mute); font-style: italic; }
.concept-card-footer { border-top: 1px solid var(--line); color: var(--ink-3); }

/* ── Clarification ──────────────────────── */
.clarification-card,
.clarification-bubble {
  background: var(--bg-card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  color: var(--ink);
}
.clarification-header { color: var(--ink-strong); font-family: var(--font-serif); }
.clarification-question { color: var(--ink); }
.clarification-copy { color: var(--ink-2); }
.clarification-icon { color: var(--accent); }
.clarification-input {
  background: var(--bg-input);
  border: 1px solid var(--line);
  color: var(--ink);
}
.clarification-input:focus { border-color: var(--ink-3); background: var(--bg-input-focus); outline: none; }
.clarification-answered {
  background: var(--accent-soft);
  border-color: var(--accent-line);
  color: var(--ink-2);
}

/* ── Artifact (检索/研究) ───────────────── */
/* 对话内嵌的小卡保留卡片样式，但右侧大面板（pane / panel）应该是面板，非卡片 */
.artifact-card,
.artifact-msg-card {
  background: var(--bg-card);
  border: 1px solid var(--line);
  color: var(--ink);
  border-radius: var(--radius);
}
/* 右侧整片研究面板：不要外框，直接铺在暗场画布上 */
.artifact-pane,
.artifact-panel {
  background: transparent !important;
  border: none !important;
  border-radius: 0 !important;
  color: var(--ink);
}
/* pane-header 的浅色 gradient 也得压住 */
.artifact-pane-header {
  background: transparent !important;
}
.artifact-msg-card--active {
  border-color: var(--line-strong);
  background: var(--bg-card-hover);
}
.artifact-msg-card-icon-wrap,
.artifact-pane-icon-wrap {
  background: var(--bg-card-hover);
  border: 1px solid var(--line);
  color: var(--ink-2);
  border-radius: var(--radius-sm);
}
.artifact-msg-card-kicker,
.artifact-pane-kicker {
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.artifact-msg-card-title,
.artifact-pane-title,
.artifact-title {
  color: var(--ink-strong);
  font-family: var(--font-serif);
  font-weight: 400;
  letter-spacing: -0.01em;
}
.artifact-msg-card-summary { color: var(--ink-2); }
.artifact-msg-card-chips,
.artifact-chip-row { gap: 6px; }
.artifact-msg-chip,
.artifact-chip {
  background: var(--bg-card-hover);
  border: 1px solid var(--line);
  color: var(--ink-2);
  font-family: var(--font-mono);
  font-size: 10.5px;
  border-radius: var(--radius-sm);
}
/* artifact-msg-card-copy 是正文容器，不是按钮 — 去掉边框 */
.artifact-msg-card-copy {
  background: transparent;
  border: none;
  color: var(--ink);
  padding: 0;
}
.artifact-msg-card-view-btn {
  color: var(--ink);
  background: transparent;
  border: 1px solid var(--line-strong);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  border-radius: var(--radius-sm);
}
.artifact-msg-card-view-btn:hover {
  background: var(--bg-card-hover);
  border-color: var(--ink-3);
}
.artifact-msg-card-footer { border-top: 1px solid var(--line); color: var(--ink-3); }
.artifact-paragraph { color: var(--ink-2); line-height: 1.7; }
.artifact-timeline { border-left: 1px solid var(--line); }
.artifact-timeline-item { color: var(--ink-2); }
.artifact-timeline-text { color: var(--ink); }
.artifact-timeline-type {
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.artifact-pane-actions { border-top: 1px solid var(--line); }
.artifact-pane-header { border-bottom: 1px solid var(--line); }
.artifact-pane-body { background: transparent; }
.artifact-score { color: var(--accent); font-family: var(--font-mono); }

/* Artifact modal 内部 */
.artifact-modal-content { color: var(--ink-2); }
.artifact-modal-label,
.artifact-modal-section {
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.artifact-modal-text { color: var(--ink-2); }
.artifact-modal-highlight { background: var(--accent-soft); color: var(--accent); padding: 0 4px; border-radius: 2px; }
.artifact-modal-chip,
.artifact-modal-page-item,
.artifact-modal-section-item {
  background: var(--bg-card);
  border: 1px solid var(--line);
  color: var(--ink-2);
  border-radius: var(--radius-sm);
}
.artifact-modal-json {
  background: var(--bg-stage-2);
  border: 1px solid var(--line);
  color: var(--ink-2);
  font-family: var(--font-mono);
}
.artifact-modal-score { color: var(--accent); font-family: var(--font-mono); }

/* ── Build summary（方案构建总结） ───────── */
.build-summary {
  background: var(--bg-card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  color: var(--ink);
}
.build-summary-title {
  color: var(--ink-strong);
  font-family: var(--font-serif);
  font-weight: 400;
  letter-spacing: -0.015em;
}
.build-summary-desc { color: var(--ink-2); }
.build-summary-copy {
  color: var(--ink);
  border: 1px solid var(--line-strong);
  background: transparent;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.build-summary-copy:hover { background: var(--bg-card-hover); border-color: var(--ink-3); }

/* ── @-mention dropdown ─────────────────── */
.at-mention-dropdown {
  background: var(--bg-elevated);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-rise);
  color: var(--ink);
  border-radius: var(--radius);
}
.at-mention-item { color: var(--ink-2); }
.at-mention-item:hover,
.at-mention-item.active { background: var(--bg-card-hover); color: var(--ink); }
.at-mention-icon { color: var(--ink-3); }
.at-mention-name { color: var(--ink); }
.at-mention-info { color: var(--mute); font-family: var(--font-mono); font-size: 10.5px; }
.at-mention-folder { color: var(--mute); font-size: 11px; }

/* ── Loading ────────────────────────────── */
.chat-loading,
.chat-loading-orb {
  color: var(--ink);
}
.chat-loading-text { color: var(--ink-2); }
.chat-loading-detail { color: var(--mute); font-family: var(--font-mono); font-size: 11px; }
.chat-loading-bar {
  background: var(--bg-card);
  border: 1px solid var(--line);
  overflow: hidden;
  border-radius: 999px;
}
.chat-loading-bar-inner {
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
}
.chat-loading-copy { color: var(--ink-2); }

/* ── Image cards ────────────────────────── */
.chat-image-card,
.chat-image-set-card {
  background: var(--bg-card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
}
.chat-image-name,
.chat-image-set-cap,
.chat-image-set-meta {
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
}
.chat-image-thumb { background: var(--bg-stage-2); }
.chat-image-grid,
.chat-image-set-grid { gap: 8px; }

/* Lightbox */
.chat-image-lightbox-modal { background: rgba(0,0,0,0.85); }
.chat-image-lightbox-stage { background: transparent; }
.chat-image-lightbox-title { color: var(--ink-strong); font-family: var(--font-serif); font-weight: 400; }
.chat-image-lightbox-actions { color: var(--ink); }
.chat-image-lightbox-btn {
  background: rgba(255,255,255,0.08);
  border: 1px solid var(--line-strong);
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.chat-image-lightbox-btn:hover { background: rgba(255,255,255,0.16); }

/* AI inline strip */
.ai-image-strip {
  background: var(--bg-card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}
.ai-image-strip-cta {
  color: var(--ink);
  border: 1px solid var(--line-strong);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.ai-image-strip-cta:hover { background: var(--bg-card-hover); border-color: var(--ink-3); }
.ai-inline-image { border: 1px solid var(--line); border-radius: var(--radius-sm); }

/* Rich toggles */
.ai-rich-toggle {
  color: var(--ink-2);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
}
.ai-rich-toggle:hover { color: var(--ink); }

/* ── Empty / placeholder ─────────────────── */
.empty-state { color: var(--mute); }
.empty-icon { color: var(--ink-3); opacity: 0.4; }
.empty-text { color: var(--mute); font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.04em; }

/* ── 通用文字色补偿（兜底） ───────────────── */
.chat-layout h1, .chat-layout h2, .chat-layout h3, .chat-layout h4, .chat-layout h5 { color: var(--ink-strong); }
.chat-layout a { color: var(--accent); }
.chat-layout a:hover { color: var(--ink-strong); }
.chat-layout hr { border-color: var(--line); }

/* ── Sidebar rail toggle / Panel resizer ─── */
.conversation-sidebar-rail-toggle,
.panel-resizer-toggle {
  background: var(--bg-stage-2);
  border: 1px solid var(--line);
  color: var(--ink-2);
  border-radius: var(--radius-sm);
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
}
.conversation-sidebar-rail-toggle:hover,
.panel-resizer-toggle:hover {
  background: var(--bg-card-hover);
  color: var(--ink);
  border-color: var(--ink-3);
}
.panel-resizer { background: transparent; }
.panel-resizer:hover { background: var(--accent-soft); }

/* ── Input card / textarea (Arco wrapped) ─ */
.input-card,
.input-card-outer {
  background: var(--bg-stage-2) !important;
  border: 1px solid var(--line) !important;
  border-radius: var(--radius-lg);
  color: var(--ink);
}
.input-card-outer { background: transparent !important; border: none !important; }
/* 用 :deep() 穿透 scoped 边界，覆盖前面 8578-8607 的 #fff 规则 */
:deep(.chat-textarea),
:deep(.chat-textarea .arco-textarea-wrapper),
:deep(.chat-textarea .arco-textarea-wrapper:hover),
:deep(.chat-textarea .arco-textarea-wrapper.arco-textarea-focus) {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}
:deep(.chat-textarea textarea) {
  background: transparent !important;
  color: var(--ink) !important;
  border: none !important;
  box-shadow: none !important;
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.7;
}
:deep(.chat-textarea textarea::placeholder) {
  color: var(--mute) !important;
}
:deep(.chat-textarea textarea:focus) {
  border: none !important;
  box-shadow: none !important;
  outline: none;
}

/* ── Inline image fallback ────────────────── */
.ai-inline-image {
  background: var(--bg-stage-2) !important;
  border: 1px solid var(--line);
}

/* ── Workspace embedded preview (.ws-*) ──── */
.ws-workspace,
.ws-empty,
.ws-pane,
.ws-content {
  background: var(--bg-stage) !important;
  color: var(--ink);
}
.ws-workspace * { color: inherit; }

/* ── Note detail (xiaohongshu 笔记预览) ───── */
.note-detail-list,
.note-detail-pane { background: transparent; }
.note-detail-item,
.note-detail-card {
  background: var(--bg-card) !important;
  border: 1px solid var(--line) !important;
  color: var(--ink);
  border-radius: var(--radius);
  transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease);
}
.note-detail-item:hover,
.note-detail-card:hover {
  background: var(--bg-card-hover) !important;
  border-color: var(--line-strong) !important;
}
.note-detail-head { color: var(--ink-strong); font-family: var(--font-serif); font-weight: 400; letter-spacing: -0.015em; }
.note-detail-title { color: var(--ink-strong); font-family: var(--font-serif); font-weight: 400; }
.note-detail-meta,
.note-detail-source,
.note-detail-time {
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
}
.note-detail-text,
.note-detail-content { color: var(--ink-2); line-height: 1.7; }
.note-detail-badge {
  background: var(--danger-soft);
  color: var(--danger);
  border: 1px solid rgba(214,168,155,0.2);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  border-radius: var(--radius-sm);
  padding: 2px 8px;
}
.note-detail-tag {
  background: var(--bg-card-hover);
  color: var(--ink-2);
  border: 1px solid var(--line);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  border-radius: var(--radius-sm);
}
.note-detail-tags { gap: 4px; }
.note-detail-image,
.note-detail-thumb { background: var(--bg-stage-2); border: 1px solid var(--line); border-radius: var(--radius-sm); }
.note-detail-empty { color: var(--mute); font-style: italic; font-family: var(--font-mono); font-size: 11px; }

/* ── Research pane (右侧搜索结果列表) ──── */
.research-pane,
.research-pane-list { background: transparent; color: var(--ink); }
.research-pane-head { color: var(--ink-strong); border-bottom: 1px solid var(--line); padding-bottom: 14px; margin-bottom: 14px; }
.research-pane-query {
  color: var(--ink-strong);
  font-family: var(--font-serif);
  font-weight: 400;
  letter-spacing: -0.015em;
  font-size: 17px;
  line-height: 1.4;
}
.research-pane-meta {
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  margin-top: 6px;
}
.research-pane-item {
  background: var(--bg-card);
  border: 1px solid var(--line);
  color: var(--ink);
  border-radius: var(--radius);
  transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease), transform var(--dur) var(--ease);
}
.research-pane-item:hover {
  background: var(--bg-card-hover);
  border-color: var(--line-strong);
  transform: translateY(-1px);
}
.research-pane-item-head { color: var(--ink-strong); }
.research-pane-index {
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
}
.research-pane-title {
  color: var(--ink-strong);
  font-family: var(--font-serif);
  font-weight: 400;
  letter-spacing: -0.01em;
}
.research-pane-snippet { color: var(--ink-2); line-height: 1.65; }
.research-pane-source,
.research-pane-domain {
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

/* ── Step / Plan / PPT outline ─────────── */
.step-card {
  background: var(--bg-card);
  border: 1px solid var(--line);
  color: var(--ink);
  border-radius: var(--radius);
}
.step-card.active,
.step-card.current {
  background: var(--bg-card-hover);
  border-color: var(--line-strong);
}
.section-live-item {
  background: var(--bg-card);
  border: 1px solid var(--line);
  color: var(--ink);
}
.section-live-item.final {
  background: var(--accent-soft);
  border-color: var(--accent-line);
}
.plan-structure,
.ppt-outline {
  background: var(--bg-card);
  border: 1px solid var(--line);
  color: var(--ink);
  border-radius: var(--radius);
}
.highlight-section {
  background: var(--accent-soft);
  border: 1px solid var(--accent-line);
  color: var(--ink);
  border-radius: var(--radius);
}

/* ── Tabs (preview / concept-detail) ───── */
.preview-tab,
.concept-detail-tab {
  background: transparent;
  border: 1px solid var(--line);
  color: var(--ink-2);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
}
.preview-tab.active,
.concept-detail-tab--active,
.concept-card-tab--active {
  background: var(--bg-card-hover);
  border-color: var(--line-strong);
  color: var(--ink-strong);
}

/* ── Picker items (workspace / tool dropdowns) ── */
.ws-picker-item,
.tool-picker-item {
  background: transparent;
  color: var(--ink-2);
  border-bottom: 1px solid var(--line);
}
.ws-picker-item:hover,
.tool-picker-item:hover {
  background: var(--bg-card-hover);
  color: var(--ink);
}

/* ── Stop button ─────────────────────────── */
.stop-btn {
  background: transparent;
  color: var(--ink-2);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
}
.stop-btn:hover {
  background: var(--danger-soft);
  border-color: var(--danger);
  color: var(--danger);
}

/* ── Conversation sidebar 文字（修对比度） ── */
.conversation-sidebar-head { color: var(--ink); }
.conversation-sidebar-body-title,
.conversation-sidebar-section-title {
  color: var(--mute) !important;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.conversation-sidebar-copy { color: var(--ink); }
.conversation-pill-title { color: var(--ink) !important; font-weight: 400; }
.conversation-pill-meta,
.conversation-pill-time {
  color: var(--mute) !important;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
}
.conversation-pill.active .conversation-pill-title { color: var(--ink-strong) !important; }
.conversation-pill-actions { color: var(--mute); }
.conversation-pill-actions:hover { color: var(--ink); }

/* ── Pane action buttons（artifact / preview 工具栏） ── */
.pane-action-btn,
.preview-action-btn {
  background: transparent !important;
  color: var(--ink-2) !important;
  border: 1px solid var(--line-strong) !important;
  border-radius: var(--radius-sm) !important;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
}
.pane-action-btn:hover,
.preview-action-btn:hover {
  background: var(--bg-card-hover) !important;
  color: var(--ink) !important;
  border-color: var(--ink-3) !important;
}

/* ── 全局兜底：sidebar 内任何 #1c1917/#0f0f0e 暗色文字反转为暖白 ── */
.chat-conversation-sidebar :where(span, div, button) {
  /* 不强制 — 仅在已知 class 上压色 */
}
.conversation-sidebar-search input {
  background: var(--bg-input);
  color: var(--ink);
  border: 1px solid var(--line);
}
.conversation-sidebar-search input::placeholder { color: var(--mute); }

/* ── Artifact pane variants ──────────────── */
.artifact-pane--ppt {
  background: var(--bg-card);
  border: 1px solid var(--line);
  color: var(--ink);
}

/* ── 兜底 sweep：把所有残留 white 容器统一拉暗 ─── */
.chat-layout :where(
  .conversation-pill.active,
  .conversation-sidebar-rail-toggle:hover
) {
  background: var(--bg-card-hover) !important;
  color: var(--ink-strong) !important;
  border-color: var(--line-strong) !important;
}
</style>

<style>
/* Arco Modal 会 teleport 到 body，scoped :deep() 无法命中，因此单独用全局块覆盖 */
.concept-detail-modal .arco-modal {
  border-radius: var(--radius-lg);
  background: var(--bg-elevated) !important;
  border: 1px solid var(--line);
  box-shadow:
    0 32px 80px -24px rgba(0,0,0,0.7),
    0 0 0 1px rgba(255,255,255,0.04);
}
.concept-detail-modal .arco-modal-body {
  padding: 24px 36px 32px;
  color: var(--ink-2);
}
.concept-detail-modal .arco-modal-header {
  padding: 28px 36px 18px;
  height: auto;
  min-height: 64px;
  align-items: flex-start;
  border-bottom: none;
  background: transparent !important;
}
.concept-detail-modal .arco-modal-title {
  display: block;
  width: 100%;
  text-align: left;
  white-space: normal;
  overflow: visible;
  text-overflow: clip;
  line-height: 1.3;
  font-family: var(--font-serif);
  font-weight: 400;
  font-size: 22px;
  letter-spacing: -0.02em;
  color: var(--ink-strong) !important;
}
.concept-detail-modal .arco-modal-close-btn {
  color: var(--mute);
  transition: color var(--dur) var(--ease);
}
.concept-detail-modal .arco-modal-close-btn:hover {
  color: var(--ink);
}

/* ── 统一 AI 侧对话卡片宽度 ─────────────────
   原各类卡片用 85% / 92% / 700~850px 混搭，开预览后 .chat-history
   解除 900px 限制，宽度差异更明显。这里对齐到同一上限。 */
.bubble-wrap.ai > .bubble,
.bubble-wrap.ai > .tool-call-card,
.bubble-wrap.ai > .clarification-card,
.bubble-wrap.ai > .brief-card,
.bubble-wrap.ai > .concept-card,
.bubble-wrap.ai > .challenge-card,
.bubble-wrap.ai > .artifact-msg-card,
.bubble-wrap.ai > .error-retry-card,
.bubble-wrap.ai > .process-summary-bubble {
  width: 100%;
  max-width: 760px;
}

/* ╔════════════════════════════════════════════╗
   ║  CINEMA bulk overrides — task / conversation / preview / page
   ║  原 scoped CSS 写死了 #1c1917 / #44403c / #57534e / #a8a29e
   ║  这里按语义梯度统一映射到 cinema tokens
   ╚════════════════════════════════════════════╝ */

/* ── 主标题级 → ink-strong ── */
.task-summary-title,
.task-hud-title,
.task-card-title,
.task-card-section-title,
.task-card-focus-text,
.conversation-list-empty-title,
.quick-reply-question,
.quick-reply-item-title,
.ws-picker-name,
.tool-picker-label,
.pending-image-name,
.preview-stage-title,
.strategy-hero-title,
.preview-block-title,
.research-card-title,
.research-item-title,
.plan-outline-title,
.plan-draft-title,
.section-live-title,
.section-live-item-title,
.section-item-title,
.ppt-build-title,
.ppt-build-stage-title,
.ppt-build-card-title,
.ppt-outline-title,
.ppt-page-name,
.tool-call-result-summary,
.panel-title,
.highlight-title,
.structure-title,
.structure-item-title,
.artifact-list-item {
  color: var(--ink-strong) !important;
}

/* ── 次级文字 → ink-2 ── */
.queue-item-text,
.quick-reply-item,
.ws-ref-chip-name,
.pane-text,
.pane-numbered-item,
.pane-page-title,
.tool-call-bubble,
.tool-call-result-details,
.process-summary-text,
.research-item-summary,
.research-card-summary,
.research-card-points,
.plan-outline-desc,
.section-live-points,
.section-live-item-desc,
.strategy-hero-desc,
.preview-stage-desc,
.highlight-text,
.highlight-item,
.finding-item,
.exec-error-message,
.exec-log-text,
.ppt-build-desc,
.ppt-build-progress-text,
.task-card-error,
.task-card-log-text,
.task-log-text,
.task-summary-subtitle,
.task-card-subtitle,
.task-hud-subtitle,
.artifact-modal-list,
.page-num,
.page-title {
  color: var(--ink-2) !important;
}

/* ── 辅助文字 / chip / meta → mute ── */
.tool-call-card-toggle,
.tool-call-card-details,
.tool-call-progress,
.section-points,
.conversation-create-btn,
.conversation-sidebar-space-label,
.conversation-group-title,
.conversation-list-empty-desc,
.task-hud-chip,
.task-hud-log-text,
.task-hud-log-time,
.task-card-chip,
.task-card-meta,
.task-card-focus-label,
.task-card-focus-status,
.task-card-log-time,
.task-log-time,
.queue-header,
.queue-item-type,
.quick-reply-label,
.quick-reply-helper,
.quick-reply-item-desc,
.ws-ref-chip-icon,
.ws-ref-chip-remove,
.ws-picker-hint,
.ws-picker-empty,
.ws-picker-icon,
.ws-picker-folder-icon,
.ws-picker-folder-header,
.tool-picker-head,
.tool-picker-hint,
.tool-picker-icon,
.pending-image-size,
.pending-image-remove,
.pane-list,
.exec-chip,
.exec-log-time,
.strategy-meta-card,
.ppt-build-metric,
.ppt-build-card-num,
.ppt-build-card-status,
.ppt-page-layout,
.process-summary-time,
.panel-badge,
.structure-item-points,
.section-item-points,
.workspace-empty,
.section-num {
  color: var(--mute) !important;
}

/* ── 数字标号 / 信息色 → accent-ink ── */
.page-layout,
.panel-save-btn,
.structure-num,
.section-item-num,
.ppt-page-num,
.score-num {
  color: var(--accent-ink) !important;
}

/* ── arco 输入子元素 ── */
:deep(.arco-input),
:deep(.arco-select-view-value) {
  color: var(--ink) !important;
}

/* ── Concept trio 分组 label：保留语义但调成 cinema 强调色 ── */
.concept-card-trio-cell--up .concept-card-trio-label,
.concept-card-trio-cell--down .concept-card-trio-label,
.concept-detail-trio-cell--up .concept-detail-trio-label,
.concept-detail-trio-cell--down .concept-detail-trio-label {
  color: var(--accent) !important;
}

/* ── lightbox primary 按钮 ── */
.chat-image-lightbox-btn.primary {
  background: var(--ink) !important;
  color: var(--bg-stage) !important;
  border-color: var(--ink) !important;
}
.generated-image-actions { color: var(--ink) !important; }

/* ── tool tone 系列：去掉浅色背景，改成 cinema 暗调 ── */
.tool-tone--blue   { background: var(--info-soft) !important;     color: var(--info) !important; }
.tool-tone--green  { background: var(--accent-soft) !important;   color: var(--accent) !important; }
.tool-tone--slate  { background: var(--bg-card) !important;       color: var(--ink-2) !important; }

/* ── chat-history h 标签兜底 ── */
.chat-history h1, .chat-history h2, .chat-history h3 {
  color: var(--ink-strong) !important;
}

/* ── Quick-reply (ask_user suggestion) ─────────────
   原 scoped 写死了 #fff / rgba(255,255,255,0.92) 浅色底，
   暗场下需要把容器和每个 option 卡片改成 cinema 卡面色。 */
.quick-reply-bar {
  background: var(--bg-card) !important;
  border: 1px solid var(--line) !important;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.04),
    0 12px 28px -18px rgba(0,0,0,0.55) !important;
}
.quick-reply-item {
  background: var(--bg-card) !important;
  border: 1px solid var(--line) !important;
  color: var(--ink-2) !important;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease), transform var(--dur) var(--ease);
}
.quick-reply-item:hover:not(:disabled) {
  background: var(--bg-card-hover) !important;
  border-color: var(--line-strong) !important;
}

/* ── 输入区附件 chip / 卡片（pending refs / docs / images）───
   原 scoped 用 #f5f5f4 / #f0f4ff / #faf9f7 / #e4e6ea 浅底浅边，
   在暗场会变成亮色岛。统一翻成 cinema 卡面 + 暗边。 */
.pending-ws-ref-chip {
  background: var(--bg-card) !important;
  border: 1px solid var(--line) !important;
}
.pending-doc-chip {
  background: var(--info-soft) !important;
  border: 1px solid var(--info-line, var(--line)) !important;
}
.pending-doc-icon { color: var(--info) !important; }
.pending-doc-name { color: var(--ink) !important; }
.pending-doc-size { color: var(--info) !important; }
.pending-image-card {
  background: var(--bg-card) !important;
  border: 1px solid var(--line) !important;
}

/* ── Workspace picker 二级头（文件夹分组标题）────── */
.ws-picker-folder-header {
  background: var(--bg-card-hover) !important;
  border-top: 1px solid var(--line) !important;
}

/* ── 图片集合卡片：caption / 占位图底色 ─────────── */
.chat-image-set-cap {
  background: var(--bg-card) !important;
  color: var(--mute) !important;
}
.chat-image-set-card img {
  background: var(--bg-stage-2) !important;
}

/* ── 右侧面板生成图卡（artifact image）────────── */
.generated-image-card {
  background: var(--bg-card) !important;
  border: 1px solid var(--line) !important;
}

/* ── 对话卡片：cinema verdict-风渐变 + 顶部细线 ─────
   参考 demo 03 的 .d3-verdict / cinema.css 的 .cn-verdict。
   只对"判定/产出物"类卡片注入精致渐变，tool-call 等流式过程保留扁平。 */
.bubble-wrap.ai > .brief-card,
.bubble-wrap.ai > .challenge-card,
.bubble-wrap.ai > .concept-card,
.bubble-wrap.ai > .artifact-msg-card,
.bubble-wrap.ai > .clarification-card {
  position: relative;
  background:
    linear-gradient(180deg,
      rgba(255,255,255,0.045) 0%,
      rgba(255,255,255,0.012) 55%,
      rgba(255,255,255,0.005) 100%
    );
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.04),
    0 12px 28px -18px rgba(0,0,0,0.55);
  overflow: hidden;
  transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.bubble-wrap.ai > .brief-card::before,
.bubble-wrap.ai > .challenge-card::before,
.bubble-wrap.ai > .concept-card::before,
.bubble-wrap.ai > .artifact-msg-card::before,
.bubble-wrap.ai > .clarification-card::before {
  content: '';
  position: absolute;
  top: 0; left: 24px; right: 24px; height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255,255,255,0.22) 35%,
    rgba(255,255,255,0.22) 65%,
    transparent 100%
  );
  pointer-events: none;
}

/* 偏"积极/创意"语义：暖绿色调渐变（accent 调） */
.bubble-wrap.ai > .challenge-card--clean,
.bubble-wrap.ai > .concept-card {
  background:
    linear-gradient(180deg,
      var(--accent-soft) 0%,
      rgba(200,220,197,0.025) 50%,
      transparent 100%
    );
}
.bubble-wrap.ai > .challenge-card--clean::before,
.bubble-wrap.ai > .concept-card::before {
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--accent-line) 35%,
    var(--accent-line) 65%,
    transparent 100%
  );
}

/* hover：轻微提亮边线，整体浮起 1px */
.bubble-wrap.ai > .brief-card:hover,
.bubble-wrap.ai > .challenge-card:hover,
.bubble-wrap.ai > .concept-card:hover,
.bubble-wrap.ai > .artifact-msg-card:hover,
.bubble-wrap.ai > .clarification-card:hover {
  border-color: var(--line-strong);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.06),
    0 16px 36px -20px rgba(0,0,0,0.65);
}

/* artifact-msg-card 选中：用 accent 渐变压住默认渐变，保留高亮语义 */
.bubble-wrap.ai > .artifact-msg-card--active {
  background:
    linear-gradient(180deg,
      var(--accent-soft) 0%,
      rgba(200,220,197,0.04) 60%,
      transparent 100%
    );
  border-color: var(--accent-line);
}
.bubble-wrap.ai > .artifact-msg-card--active::before {
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--accent-line) 35%,
    var(--accent-line) 65%,
    transparent 100%
  );
}

/* ╔════════════════════════════════════════════╗
   ║  CINEMA child-element overrides
   ║  父级 class 已覆盖，但写死的 li/strong/th/span 子选择器
   ║  specificity 更高，需要显式压住
   ╚════════════════════════════════════════════╝ */

/* AI markdown 卡片：h3 / strong / th 子元素 */
.ai-message-card :deep(h3),
.ai-message-card :deep(strong) {
  color: var(--ink-strong) !important;
}
.ai-message-card :deep(th) {
  color: var(--ink) !important;
  background: var(--bg-card-hover) !important;
}

/* Brief Card 假设列表 — 用户反馈红框区域 */
.brief-card-list,
.brief-card-list li {
  color: var(--ink-2) !important;
}
.brief-card-list li::marker { color: var(--mute) !important; }

/* Concept Card / Concept Detail 列表项 */
.concept-card-angles li,
.concept-card-framework li,
.concept-detail-angles li,
.concept-detail-framework li {
  color: var(--ink-2) !important;
}
.concept-card-angles li::marker,
.concept-card-framework li::marker,
.concept-detail-angles li::marker,
.concept-detail-framework li::marker {
  color: var(--mute) !important;
}

/* Challenge Card 风险点解决方案 */
.challenge-card-concern-resolution span:last-child {
  color: var(--ink-2) !important;
}

/* 各种侧栏 / 卡片 list / meta 子元素 */
.pane-list li,
.artifact-list-item span,
.research-card-points span,
.section-live-points span {
  color: var(--ink-2) !important;
}
.strategy-meta-card span,
.ppt-build-metric span {
  color: var(--mute) !important;
}
.strategy-meta-card strong,
.ppt-build-metric strong {
  color: var(--ink-strong) !important;
}

/* finding 列表前缀符号 */
.finding-item::before {
  color: var(--accent-ink) !important;
}

/* 图片操作链接 */
.generated-image-actions a {
  color: var(--ink) !important;
}

/* 对话搜索框 arco input deep */
:deep(.conversation-search .arco-input) {
  color: var(--ink) !important;
}
:deep(.conversation-search .arco-input::placeholder) {
  color: var(--mute) !important;
}
:deep(.conversation-search .arco-input-prefix) {
  color: var(--mute) !important;
}

/* ── Tool picker dropdown 容器（+ 按钮弹层） ───── */
.tool-picker-dropdown {
  background: var(--bg-elevated) !important;
  border: 1px solid var(--line) !important;
  box-shadow: var(--shadow-rise) !important;
  border-radius: var(--radius) !important;
}
.tool-picker-head {
  border-bottom: 1px solid var(--line) !important;
}
.tool-picker-item.selected {
  background: var(--bg-card-hover) !important;
}
.tool-picker-icon {
  background: var(--bg-card-hover) !important;
  color: var(--ink-2) !important;
}
.tool-picker-item.selected .tool-picker-icon {
  background: var(--ink-strong) !important;
  color: var(--bg-stage) !important;
}
.tool-picker-check {
  color: var(--ink-strong) !important;
}

/* ── Tool mode pill（已选工具浮条） ──────────── */
.tool-mode-pill {
  background: var(--ink) !important;
  color: var(--bg-stage) !important;
}
.tool-mode-pill-dot {
  background: var(--accent) !important;
}
.tool-mode-pill-hint {
  color: rgba(15, 15, 14, 0.6) !important;
}

/* ── Workspace picker 容器（@ 引用弹层，对称问题） ─ */
.ws-picker-dropdown,
.ws-picker {
  background: var(--bg-elevated) !important;
  border: 1px solid var(--line) !important;
  box-shadow: var(--shadow-rise) !important;
  border-radius: var(--radius) !important;
}

/* ╔════════════════════════════════════════════╗
   ║  CINEMA — Concept card / Concept detail
   ║  原 CSS 整片白底亮色岛，需要全量翻暗
   ╚════════════════════════════════════════════╝ */

/* === Concept Card（聊天内嵌） === */
.concept-card {
  background: var(--bg-card) !important;
  border: 1px solid var(--line) !important;
  border-radius: var(--radius) !important;
}
.concept-card:hover {
  border-color: var(--line-strong) !important;
  box-shadow: var(--shadow-rise) !important;
}
.concept-card--degraded {
  background: var(--bg-card) !important;
  border-color: rgba(214,168,155,0.25) !important;
}

.concept-card-version {
  color: var(--mute) !important;
  font-family: var(--font-mono);
}
.concept-card-axis {
  color: var(--ink) !important;
  font-family: var(--font-serif);
  font-weight: 400;
  letter-spacing: -0.01em;
}
.concept-card-shared {
  color: var(--mute) !important;
}

.concept-card-tabs {
  background: var(--bg-card-hover) !important;
  border-color: var(--line) !important;
}
.concept-card-tab {
  color: var(--ink-3) !important;
  background: transparent !important;
}
.concept-card-tab:hover {
  color: var(--ink) !important;
}
.concept-card-tab--active {
  background: var(--bg-card-hover) !important;
  color: var(--ink-strong) !important;
  box-shadow: 0 0 0 1px var(--line-strong) !important;
}

.concept-card-theme {
  color: var(--ink-strong) !important;
  font-family: var(--font-serif);
  font-weight: 400;
  letter-spacing: -0.02em;
}
.concept-card-positioning {
  color: var(--ink-2) !important;
}
.concept-card-label,
.concept-card-label-inline {
  color: var(--mute) !important;
  font-family: var(--font-mono);
}
.concept-card-text,
.concept-card-text-inline {
  color: var(--ink-2) !important;
}

.concept-card-framework li,
.concept-card-angles li {
  color: var(--ink-2) !important;
}
.concept-card-framework li::marker {
  color: var(--ink-2) !important;
}
.concept-card-angles li::marker {
  color: var(--mute) !important;
}

.concept-card-trio {
  border-top: 1px solid var(--line) !important;
  border-bottom: 1px solid var(--line) !important;
}
.concept-card-trio-cell + .concept-card-trio-cell {
  border-left: 1px solid var(--line) !important;
}
.concept-card-trio-cell--up   .concept-card-trio-label { color: var(--accent) !important; }
.concept-card-trio-cell--risk .concept-card-trio-label { color: var(--danger) !important; }
.concept-card-trio-cell--fit  .concept-card-trio-label { color: var(--ink-2) !important; }
.concept-card-trio-text {
  color: var(--ink-2) !important;
}

.concept-card-recommendation {
  background: var(--accent-soft) !important;
  border-left-color: var(--accent) !important;
}
.concept-card-rec-label {
  color: var(--accent-ink) !important;
  font-family: var(--font-mono);
}
.concept-card-rec-text {
  color: var(--ink-2) !important;
}

.concept-card-footer {
  border-top: 1px solid var(--line) !important;
}
.concept-card-cta {
  color: var(--mute) !important;
}
.concept-card-cta:hover,
.concept-card .concept-card-direction:hover ~ .concept-card-footer .concept-card-cta {
  color: var(--accent) !important;
}

.concept-card-degraded-note {
  background: var(--danger-soft) !important;
  color: var(--danger) !important;
  border-left-color: var(--danger) !important;
}

.concept-streaming { color: var(--accent-ink) !important; }
.concept-streaming-dot { background: var(--accent) !important; }

/* === Concept Detail Modal === */
.concept-detail-version {
  color: var(--mute) !important;
  font-family: var(--font-mono);
}
.concept-detail-theme {
  color: var(--ink-strong) !important;
  font-family: var(--font-serif);
  font-weight: 400;
  letter-spacing: -0.025em;
}
.concept-detail-axis {
  color: var(--ink-2) !important;
}

.concept-detail-body {
  scrollbar-color: var(--line) transparent !important;
}
.concept-detail-body::-webkit-scrollbar-thumb {
  background: var(--line) !important;
}

.concept-detail-label {
  color: var(--mute) !important;
  font-family: var(--font-mono);
}
.concept-detail-text {
  color: var(--ink-2) !important;
}
.concept-detail-text--muted {
  color: var(--ink-3) !important;
}

.concept-detail-framework li,
.concept-detail-angles li {
  color: var(--ink-2) !important;
}
.concept-detail-framework li::marker {
  color: var(--ink-2) !important;
}
.concept-detail-angles li::marker {
  color: var(--mute) !important;
}

.concept-detail-degraded {
  background: var(--danger-soft) !important;
  color: var(--danger) !important;
  border-left-color: var(--danger) !important;
}

.concept-detail-tabs {
  background: var(--bg-card-hover) !important;
  border-color: var(--line) !important;
}
.concept-detail-tab {
  background: transparent !important;
  color: var(--ink-3) !important;
}
.concept-detail-tab:hover {
  color: var(--ink) !important;
}
.concept-detail-tab--active {
  background: var(--bg-card-hover) !important;
  color: var(--ink-strong) !important;
  box-shadow: 0 0 0 1px var(--line-strong) !important;
}

.concept-detail-trio {
  border-top: 1px solid var(--line) !important;
  border-bottom: 1px solid var(--line) !important;
}
.concept-detail-trio-cell + .concept-detail-trio-cell {
  border-left: 1px solid var(--line) !important;
}
.concept-detail-trio-cell--up   .concept-detail-trio-label { color: var(--accent) !important; }
.concept-detail-trio-cell--risk .concept-detail-trio-label { color: var(--danger) !important; }
.concept-detail-trio-cell--fit  .concept-detail-trio-label { color: var(--ink-2) !important; }
.concept-detail-trio-text {
  color: var(--ink-2) !important;
}

.concept-detail-recommendation {
  background: var(--accent-soft) !important;
  border-left-color: var(--accent) !important;
}
.concept-detail-recommendation-label {
  color: var(--accent-ink) !important;
}
</style>
