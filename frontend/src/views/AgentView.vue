<template>
  <div
    ref="layoutRef"
    class="chat-layout"
    :class="{ 'preview-open': previewVisible, resizing: isResizing }"
    :style="{ '--preview-width': `${previewWidth}px`, '--conversation-width': `${conversationSidebarCollapsed ? 56 : 280}px` }"
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
            +
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
                <icon-search />
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

        <template v-else>
          <button
            v-for="item in conversations.slice(0, 8)"
            :key="item.id"
            type="button"
            class="conversation-mini"
            :class="{ active: item.id === activeConversationId }"
            :title="item.title"
            @click="onConversationChange(item.id)"
          >
            {{ item.title.slice(0, 1) || '对' }}
          </button>
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
      <div class="chat-history" ref="historyRef">
        <!-- 按时间顺序渲染所有消息 -->
        <div v-for="msg in messages" :key="msg.id" class="bubble-wrap" :class="msg.role">
          
          <!-- 用户消息 -->
          <template v-if="msg.role === 'user'">
            <div class="bubble user">
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
              </div>
            </template>
            
            <!-- 工具调用 -->
            <template v-else-if="msg.kind === 'tool-call'">
              <div class="tool-call-card" :class="{ active: msg.progress }">
                <div class="tool-call-card-head">
                  <span class="tool-call-card-icon">{{ toolIcon(msg.tool) }}</span>
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
              <icon-file-pdf v-if="doc.docType === 'ppt'" class="at-mention-icon" />
              <icon-file v-else class="at-mention-icon" />
              <span class="at-mention-name">{{ doc.name }}</span>
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
              <div v-if="!workspacePickerResults.length" class="ws-picker-empty">无匹配文档</div>
              <div
                v-for="doc in workspacePickerResults"
                :key="doc.id"
                class="ws-picker-item"
                :class="{ selected: pendingWorkspaceRefs.some(r => r.id === doc.id) }"
                @click="pendingWorkspaceRefs.some(r => r.id === doc.id) ? removeWorkspaceRef(doc.id) : addWorkspaceRef(doc)"
              >
                <icon-file-pdf v-if="doc.docType === 'ppt'" class="ws-picker-icon" />
                <icon-file v-else class="ws-picker-icon" />
                <span class="ws-picker-name">{{ doc.name }}</span>
                <span v-if="pendingWorkspaceRefs.some(r => r.id === doc.id)" class="ws-picker-check">✓</span>
              </div>
            </div>
          </div>

          <div class="input-card" :class="{ focused: inputFocused }">
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
              <icon-file-pdf v-if="item.mimeType === 'application/pdf'" class="pending-doc-icon" />
              <icon-file v-else class="pending-doc-icon" />
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
              <icon-file-pdf v-if="ref.docType === 'ppt'" class="ws-ref-chip-icon" />
              <icon-file v-else class="ws-ref-chip-icon" />
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
                <icon-layers />
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
              <icon-attachment />
            </button>

            <!-- 终止按钮（任务运行中显示） -->
            <button
              v-if="showStopButton"
              type="button"
              class="stop-btn"
              @click="stopTask"
            >
              <icon-record-stop />
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
              <icon-arrow-up />
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
          />
        </div>
      </template>

      <!-- 具体产出物 -->
      <template v-else-if="displayedArtifact">
        <div class="artifact-pane">
          <!-- 面板头 -->
          <div class="artifact-pane-header">
            <div class="artifact-pane-title-row">
              <component :is="artifactMsgIcon(displayedArtifact.artifactType)" class="artifact-pane-icon" />
              <span class="artifact-pane-title">{{ displayedArtifact.title || artifactTypeLabel(displayedArtifact.artifactType) }}</span>
            </div>
            <div class="artifact-pane-actions">
              <button v-if="displayedArtifact.artifactType === 'research_result'" type="button" class="pane-action-btn" @click="openSaveResearch">保存</button>
              <button v-if="displayedArtifact.artifactType === 'plan_draft'" type="button" class="pane-action-btn" @click="openSavePlanDraft">保存</button>
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
              <div class="pane-section">
                <div class="pane-label">研究主题</div>
                <div class="pane-text">{{ displayedArtifact.payload?.focus || '—' }}</div>
              </div>
              <div class="pane-section">
                <div class="pane-label">摘要</div>
                <div class="pane-text">{{ displayedArtifact.payload?.summary || '—' }}</div>
              </div>
              <div v-if="displayedArtifact.payload?.keyFindings?.length" class="pane-section">
                <div class="pane-label">关键发现</div>
                <ul class="pane-list">
                  <li v-for="(f, i) in displayedArtifact.payload.keyFindings" :key="i">{{ f }}</li>
                </ul>
              </div>
            </template>

            <!-- plan_draft -->
            <template v-else-if="displayedArtifact.artifactType === 'plan_draft'">
              <div class="pane-section">
                <div class="pane-plan-title">{{ displayedArtifact.payload?.planTitle || '策划方案草稿' }}</div>
                <div class="pane-text">{{ displayedArtifact.payload?.coreStrategy }}</div>
              </div>
              <div v-if="displayedArtifact.payload?.highlights?.length" class="pane-section">
                <div class="pane-label">活动亮点</div>
                <div v-for="(h, i) in displayedArtifact.payload.highlights" :key="i" class="pane-numbered-item">
                  <span class="pane-num">{{ i + 1 }}</span>
                  <span>{{ h }}</span>
                </div>
              </div>
              <div v-if="displayedArtifact.payload?.sections?.length" class="pane-section">
                <div class="pane-label">方案结构</div>
                <div v-for="(s, i) in displayedArtifact.payload.sections" :key="i" class="pane-structure-item">
                  <span class="pane-structure-num">{{ String(i + 1).padStart(2, '0') }}</span>
                  <div>
                    <div class="pane-structure-title">{{ s.title }}</div>
                    <div class="pane-structure-points">{{ (s.keyPoints || []).slice(0, 3).join(' · ') }}</div>
                  </div>
                </div>
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

  </div>
</template>

<script setup>
import { ref, reactive, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { Message } from '@arco-design/web-vue'
import { useRouter } from 'vue-router'
import { useSettingsStore } from '../stores/settings'
import { workspaceApi } from '../api/workspace'
import SlideViewer from '../components/SlideViewer.vue'
import PlanDocumentPanel from '../components/PlanDocumentPanel.vue'
import PptEditor from '../components/PptEditor.vue'
import {
  IconMobile, IconCompass, IconCamera, IconRecordStop,
  IconBulb, IconSearch, IconEdit, IconCheckCircle, IconLayout, IconAttachment,
  IconLayers, IconFile, IconFilePdf
} from '@arco-design/web-vue/es/icon'

const router   = useRouter()
const settings = useSettingsStore()
const layoutRef = ref(null)
const CONVERSATION_SIDEBAR_COLLAPSED_KEY = 'oc_conversation_sidebar_collapsed'

function loadConversationSidebarCollapsed() {
  try {
    return localStorage.getItem(CONVERSATION_SIDEBAR_COLLAPSED_KEY) === '1'
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

// 工具图标映射
function toolIcon(tool) {
  return { web_search: '🔍', web_fetch: '🌐', run_strategy: '📋', build_ppt: '🎨' }[tool] || '🔧'
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
    attachments: buildMessageAttachments(images),
    documents: docs.map(d => ({ id: d.id, name: d.name, size: d.size, mimeType: d.mimeType }))
  })
  clearPendingImages()
  waitingForClarification.value = false
  isRunning.value = true

  return new Promise(resolve => {
    const done = () => { resolveCurrent = null; resolve() }
    resolveCurrent = done

    fetch(`/api/agent/${currentSessionId.value}/reply`, {
      method: 'POST',
      body: buildAgentFormData({ reply, apiKeys: settings.apiKeys, images, docs })
    }).then(r => r.json()).then(res => {
      if (!res.success) throw new Error(res.message)
      replaceLatestUserAttachments(res.attachments || [])
      connectBrainSSE(res.streamUrl, done)
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
const activeConversationId = ref('')
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

  const lines = source.split('\n')
  const blocks = []
  let listItems = []
  let paragraph = []
  let codeFence = null
  let codeLines = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push(`<p>${parseInlineRichText(paragraph.join('<br />'))}</p>`)
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
  return blocks.join('')
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
    ...extra
  }
  if (role === 'ai') Object.assign(nextMessage, buildAiMessageMeta(text, resolvedHtml))
  messages.value.push(nextMessage)
  scheduleConversationPersist()
  nextTick(() => {
    if (historyRef.value) historyRef.value.scrollTop = historyRef.value.scrollHeight
  })
}

function pushAiMessage(message) {
  messages.value.push({
    id: createMessageId('ai'),
    role: 'ai',
    createdAt: new Date().toISOString(),
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
  if (payload.restoreSession !== undefined) form.append('restoreSession', JSON.stringify(payload.restoreSession))
  form.append('apiKeys', JSON.stringify(payload.apiKeys || {}))
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
const previewCollapsed = ref(false)
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
const failedReason = ref('')
const failedStage = ref('')
const artifacts = ref([])
const executionLogs = ref([])
const PROCESS_MESSAGE_KINDS = new Set(['thinking', 'tool-call', 'task-log', 'narration'])
const PROCESS_STREAM_VISIBLE_COUNT = 3

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
  if (activeArtifact.value?.artifactType === 'ppt_slides') return activeArtifact.value
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
  return ['plan_draft', 'plan_document'].includes(displayedArtifact.value.artifactType)
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
  !!latestPptOutline.value
)
const previewVisible = computed(() => {
  if (docContent.value || resultSlides.value.length > 0) return true
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
    plan_draft: '方案草稿',
    plan_document: '策划文档',
    review_feedback: '评审意见',
    ppt_outline: 'PPT大纲',
    ppt_slides: 'PPT成稿',
    ppt_page: 'PPT页面'
  }[type] || '中间产物'
}

function artifactMsgIcon(type) {
  return {
    task_brief: IconBulb,
    research_result: IconSearch,
    plan_draft: IconEdit,
    plan_document: IconEdit,
    review_feedback: IconCheckCircle,
    ppt_outline: IconLayout,
    ppt_slides: IconFile,
  }[type] || IconEdit
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
  if (item.artifactType === 'plan_draft') return payload.planTitle || payload.coreStrategy || '已生成方案草稿'
  if (item.artifactType === 'plan_document') return payload.title || '策划文档已生成'
  if (item.artifactType === 'review_feedback') return `第 ${payload.round} 轮评分 ${payload.score}${payload.passed ? '，通过' : '，待优化'}`
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

function humanizeActivityText(text) {
  if (!text) return ''
  const normalized = String(text).trim()
  if (!normalized) return ''

  let match = normalized.match(/^第\s*(\d+)\s*轮：制定策划方案/)
  if (match) return `正在打磨第 ${match[1]} 轮策划方向，收拢核心创意和执行结构`

  match = normalized.match(/^第\s*(\d+)\s*轮：专家评审中/)
  if (match) return `正在做第 ${match[1]} 轮专家评审，检查亮点、风险和可落地性`

  match = normalized.match(/^第\s*(\d+)\s*轮评审完成，得分\s*([0-9.]+)(.*)$/)
  if (match) {
    const suffix = match[3]?.includes('继续优化') ? '，还会继续往上收紧' : '，这一轮已经过线'
    return `第 ${match[1]} 轮评审完成，当前得分 ${match[2]} 分${suffix}`
  }

  match = normalized.match(/^正在重新查看\s*(\d+)\s*张图片/)
  if (match) return `正在重新整理 ${match[1]} 张参考图片，补充更贴近方向的视觉线索`

  match = normalized.match(/^找到\s*(\d+)\s*条结果（(.+?)）/)
  if (match) return `已补充 ${match[1]} 条参考资料，来源：${match[2]}`

  match = normalized.match(/^已读取文档：(.+)$/)
  if (match) return `已载入空间文档：${match[1]}`

  match = normalized.match(/^已更新文档：(.+)$/)
  if (match) return `已同步文档更新：${match[1]}`

  match = normalized.match(/^已保存到工作空间：(.+)$/)
  if (match) return `已保存到策划空间：${match[1]}`

  if (normalized === '正在整理策划文档...') return '正在把方案整理成可编辑文档'
  if (normalized === '正在生成 PPT 大纲...') return '正在把方案压缩成 PPT 页面结构'
  if (normalized === '正在结合策划内容与页面结构匹配背景图...') return '正在给每一页匹配更合适的背景图和视觉氛围'
  if (normalized === '页面内容已读取') return '参考页面已经读完，正在提炼可用信息'

  if (normalized.startsWith('开始生成 PPT')) return '开始生成 PPT 成稿，页面会逐张出现'
  if (normalized.startsWith('开始制定策划方案')) return '开始制定策划方案，先收拢方向再写正文'

  return normalized.replace(/\.\.\.$/, '')
}

function shouldSurfaceProgressMessage(text) {
  if (!text) return false
  return [
    /制定策划方案/,
    /专家评审中/,
    /评审完成/,
    /正在整理策划文档/,
    /正在生成 PPT 大纲/,
    /正在结合策划内容与页面结构匹配背景图/,
    /正在重新查看\s*\d+\s*张图片/,
    /找到\s*\d+\s*条结果/,
    /^页面内容已读取$/,
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
const spaces = ref([])
const selectedSpaceId = ref('')

// ── 工作空间文档引用 ─────────────────────────────────────────────
const pendingWorkspaceRefs = ref([])       // [{id, name, docType}]
const workspacePickerVisible = ref(false)  // 按钮选择器
const workspacePickerQuery = ref('')       // 选择器搜索词
const atMentionVisible = ref(false)        // @ 内联菜单
const atMentionQuery = ref('')             // @ 后的匹配词
const atMentionIndex = ref(0)              // 键盘高亮项
const textareaRef = ref(null)              // a-textarea 组件 ref

function flattenDocs(nodes, result = []) {
  for (const node of nodes || []) {
    if (node.type === 'document') result.push(node)
    if (node.children?.length) flattenDocs(node.children, result)
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
const groupedConversations = computed(() => {
  const now = Date.now()
  const groups = [
    { key: 'today', title: '今天', items: [] },
    { key: 'week', title: '近 7 天', items: [] },
    { key: 'earlier', title: '更早', items: [] }
  ]
  filteredConversations.value.forEach((item) => {
    const ts = new Date(item.updatedAt || item.lastMessageAt || item.createdAt || 0).getTime()
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
    if (spaces.value.length && !selectedSpaceId.value) {
      selectedSpaceId.value = spaces.value[0].id
    }
  } catch {}
}
loadSpaces()

function serializeState() {
  return {
    currentSessionId: currentSessionId.value,
    wasManuallyStopped: wasManuallyStopped.value,
    taskMode: taskMode.value,
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
      return content ? [{ role: 'assistant', content }] : []
    }

    return []
  }).slice(-24)
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
    planItems: Array.isArray(brainPlanItems.value)
      ? brainPlanItems.value.map(item => ({ ...item }))
      : [],
    attachments: uniqueAttachments
  }
}

function restoreFromConversation(detail) {
  const state = detail?.state || {}
  restoringConversation.value = true
  messages.value = Array.isArray(detail?.messages)
    ? detail.messages.map(msg => ({
        ...msg,
        attachments: Array.isArray(msg.attachments) ? msg.attachments : [],
        id: msg.id || createMessageId('msg'),
        createdAt: msg.createdAt || new Date().toISOString()
      }))
    : []

  currentSessionId.value = state.currentSessionId || ''
  wasManuallyStopped.value = !!state.wasManuallyStopped
  currentTask.value = state.currentTask || null
  taskMode.value = state.taskMode || 'idle'
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

  isRunning.value = false
  waitingForClarification.value = messages.value.some(msg => msg.role === 'ai' && msg.kind === 'clarification' && !msg.answered)
  syncQuickRepliesFromMessages()

  nextTick(() => {
    restoringConversation.value = false
    if (historyRef.value) historyRef.value.scrollTop = historyRef.value.scrollHeight
  })
}

function clearConversationView() {
  restoringConversation.value = true
  messages.value = []
  clearPendingImages()
  clearQuickReplies()
  currentSessionId.value = ''
  wasManuallyStopped.value = false
  currentTask.value = null
  taskMode.value = 'idle'
  brainPlanItems.value = []
  resetSteps()
  wsState.value = 'welcome'
  currentSlideIndex.value = 0
  failedReason.value = ''
  failedStage.value = ''
  activeArtifact.value = null
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

async function loadConversationsForSpace(spaceId) {
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
      const nextId = conversations.value.find(item => item.id === activeConversationId.value)?.id || conversations.value[0].id
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
  lastBoundConversationId.value = activeConversationId.value
  const payload = {
    title: deriveConversationTitle(),
    status: wsState.value === 'failed' ? 'failed' : wsState.value === 'done' ? 'completed' : 'active',
    state: serializeState(),
    messages: serializeMessages(),
    lastMessageAt: messages.value.at(-1)?.createdAt || new Date().toISOString()
  }
  await workspaceApi.saveConversation(activeConversationId.value, payload)
  conversations.value = conversations.value.map(item =>
    item.id === activeConversationId.value
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
}

watch(selectedSpaceId, async (spaceId, prevId) => {
  if (spaceId === prevId) return
  await loadConversationsForSpace(spaceId)
})

watch(conversationSidebarCollapsed, (value) => {
  try {
    localStorage.setItem(CONVERSATION_SIDEBAR_COLLAPSED_KEY, value ? '1' : '0')
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

function closeSseConnection() {
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

  // 如果 PPT 已生成完成，开新对话；否则在同一对话内继续
  const pptDone = wsState.value === 'done' && (resultDownloadUrl.value || resultSlides.value.length > 0)
  if (pptDone || (wsState.value === 'failed' && !wasManuallyStopped.value)) {
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
  pushMsg('user', displayText, '', {
    attachments: buildMessageAttachments(images),
    documents: docs.map(d => ({ id: d.id, name: d.name, size: d.size, mimeType: d.mimeType })),
    workspaceRefs: wsRefs
  })
  clearPendingImages()
  pendingWorkspaceRefs.value = []
  workspacePickerVisible.value = false
  await nextTick()
  if (historyRef.value) historyRef.value.scrollTop = historyRef.value.scrollHeight

  await runBrainTask(text, images, docs, wsRefs)
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
  const sessionId = currentSessionId.value
  if (sessionId) {
    fetch(`/api/agent/${sessionId}/stop`, { method: 'POST' }).catch(() => {})
  }
  closeSseConnection()
  isRunning.value  = false
  isBuilding.value = false
  waitingForClarification.value = false
  wasManuallyStopped.value = true
  failedReason.value = '用户已停止任务'
  if (wsState.value === 'execution' || wsState.value === 'streaming') {
    wsState.value = 'interrupted'
  }
  // resolve 挂起的 Promise，让队列处理器正常退出
  if (resolveCurrent) { resolveCurrent(); resolveCurrent = null }
  pushMsg('ai', '', '已终止当前任务。')
}

// ── Brain Agent 任务 ──────────────────────────────────────────────
async function runBrainTask(text, images = [], docs = [], workspaceRefs = []) {
  const isContinuing = !!currentSessionId.value  // 是否复用现有 session
  const taskSeed = text || docs[0]?.name || images[0]?.name || '文件需求'
  isRunning.value = true
  waitingForClarification.value = false
  wasManuallyStopped.value = false
  resetProcessedStreamEvents()
  if (!isContinuing) {
    resetSteps()
    brainPlanItems.value = defaultBrainPlan()
    currentTask.value = {
      topic: taskSeed.slice(0, 32),
      requirements: text || (docs.length ? `用户上传了文档：${docs.map(d => d.name).join('、')}` : '用户上传了图片，希望结合视觉内容继续分析')
    }
  }
  taskMode.value = 'brain'
  progress.value = isContinuing ? Math.max(progress.value, 8) : 8
  progressLabel.value = isContinuing ? '继续推进...' : '正在理解需求...'
  wsState.value = 'execution'
  publishActivity(isContinuing ? `继续任务：${taskSeed.slice(0, 48)}` : `收到新任务：${taskSeed.slice(0, 48)}`)

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

    fetch('/api/agent/start', {
      method: 'POST',
      body: buildAgentFormData({
        message: text,
        spaceId: selectedSpaceId.value,
        apiKeys: settings.apiKeys,
        sessionId: currentSessionId.value || undefined,
        restoreSession: currentSessionId.value ? buildRestoreSessionPayload() : undefined,
        images,
        docs,
        workspaceRefs
      })
    }).then(r => r.json()).then(res => {
      if (!res.success) throw new Error(res.message || '启动失败')
      currentSessionId.value = res.sessionId
      replaceLatestUserAttachments(res.attachments || [])
      connectBrainSSE(res.streamUrl, done)
    }).catch(err => {
      pushMsg('ai', '', `启动失败：${err.message}`)
      isRunning.value = false
      wsState.value = 'welcome'
      done()
    })
  })
}

function connectBrainSSE(url, resolve = () => {}) {
  closeSseConnection()
  sse = new EventSource(url)
  hasActiveStream.value = true

  // 移除上一条 thinking 气泡的辅助函数
  function popThinking() {
    const last = messages.value[messages.value.length - 1]
    if (last?.kind === 'thinking') messages.value.pop()
  }

  sse.addEventListener('thinking', () => {
    popThinking()
    pushAiMessage({ kind: 'thinking' })
  })

  sse.addEventListener('tool_call', e => {
    const d = JSON.parse(e.data)
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
    if (['run_strategy', 'build_ppt'].includes(d.tool)) {
      publishActivity(`开始${d.display || d.tool}`)
    }
  })

  sse.addEventListener('tool_progress', e => {
    const d = JSON.parse(e.data)
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

  sse.addEventListener('text', e => {
    const d = JSON.parse(e.data)
    popThinking()
    if (d.text) {
      pushMsg('ai', '', d.text, { kind: 'narration' })
      maybeSetQuickRepliesFromAiText(d.text)
    }
  })

  // 流式文字：逐 token 追加到同一条消息
  let streamingMsgId = null

  sse.addEventListener('text_delta', e => {
    const { delta } = JSON.parse(e.data)
    if (!delta) return

    if (!streamingMsgId) {
      popThinking()
      const msgId = createMessageId('ai')
      messages.value.push({
        id: msgId,
        role: 'ai',
        text: '',
        html: '',
        kind: 'narration',
        createdAt: new Date().toISOString()
      })
      streamingMsgId = msgId
    }

    const msg = messages.value.find(m => m.id === streamingMsgId)
    if (msg) {
      msg.text += delta
      msg.html = resolveAiHtml(msg.text)
      // 仅在用户未向上滚动时才自动滚底
      const el = historyRef.value
      if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
        el.scrollTop = el.scrollHeight
      }
    }
  })

  sse.addEventListener('text_end', () => {
    if (streamingMsgId) {
      const msg = messages.value.find(m => m.id === streamingMsgId)
      if (msg) {
        msg.html = resolveAiHtml(msg.text)
        Object.assign(msg, buildAiMessageMeta(msg.text, msg.html))
        maybeSetQuickRepliesFromAiText(msg.text)
      }
      scheduleConversationPersist()
      streamingMsgId = null
    }
  })

  sse.addEventListener('clarification', e => {
    const d = JSON.parse(e.data)
    if (shouldSkipStreamEvent('clarification', d)) return
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
    brainPlanItems.value = Array.isArray(d.items) ? d.items : []
    progress.value = Math.max(progress.value, 15)
    progressLabel.value = '正在执行计划'
    if (brainPlanItems.value.length) {
      publishActivity(`计划已更新，当前共 ${brainPlanItems.value.length} 步。`, d.timestamp || Date.now())
    }
  })

  sse.addEventListener('brief_update', e => {
    const d = JSON.parse(e.data)
    currentTask.value = {
      ...(currentTask.value || {}),
      ...(d.brief || {})
    }
    if (currentTask.value?.topic || currentTask.value?.brand) {
      publishActivity(`已整理任务简报：${currentTask.value.topic || currentTask.value.brand}`, d.timestamp || Date.now())
    }
  })

  sse.addEventListener('tool_result', e => {
    const d = JSON.parse(e.data)
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

  // 空间文档更新（auto-save / save_to_workspace）
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

  // 复用现有事件处理
  sse.addEventListener('artifact', e => handleArtifact(JSON.parse(e.data)))
  sse.addEventListener('doc_section_added', e => handleDocSectionAdded(JSON.parse(e.data)))
  sse.addEventListener('doc_ready', e => handleDocReady(JSON.parse(e.data)))
  sse.addEventListener('slide_added', e => handleSlideAdded(JSON.parse(e.data)))
  sse.addEventListener('done', e => {
    streamingMsgId = null
    popThinking()
    handleDone(JSON.parse(e.data))
    closeSseConnection()
    isRunning.value = false
    resolve()
  })

  sse.addEventListener('error', e => {
    streamingMsgId = null
    popThinking()
    if (e.data) {
      try {
        const d = JSON.parse(e.data)
        if (d.message) pushMsg('ai', '', d.message)
        failedReason.value = d.message || '任务执行出错'
      } catch {}
    } else if (!failedReason.value) {
      failedReason.value = '任务连接中断，请重试。'
    }
    closeSseConnection()
    isRunning.value = false
    if (wsState.value !== 'done') wsState.value = 'failed'
    resolve()
  })
}

function handleArtifact(d) {
  const artifact = {
    id: `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    artifactType: d.artifactType,
    payload: d.payload || {}
  }
  artifacts.value.unshift(artifact)
  if (d.artifactType === 'ppt_page') return

  // 在对话流中插入产出物卡片，并自动切换右侧面板
  const cardTypes = ['task_brief', 'research_result', 'plan_draft', 'review_feedback', 'ppt_outline']
  if (cardTypes.includes(d.artifactType)) {
    const cardMsg = {
      kind: 'artifact-card',
      artifactType: d.artifactType,
      artifactId: artifact.id,
      title: artifactCardTitle(d.artifactType, d.payload || {}),
      summary: artifactCardSummary(d.artifactType, d.payload || {}),
      chips: artifactCardChips(d.artifactType, d.payload || {}),
      payload: d.payload || {}
    }
    pushAiMessage(cardMsg)
    // 自动切换右侧面板到最新产出物
    activeArtifact.value = cardMsg
  }
  if (d.artifactType === 'ppt_outline') {
    isBuilding.value = true
    buildTotal.value = Number(d.payload?.total || (Array.isArray(d.payload?.pages) ? d.payload.pages.length : 0) || 0)
    progressLabel.value = buildTotal.value
      ? `PPT 结构已确认，开始生成 ${buildTotal.value} 页内容...`
      : 'PPT 结构已确认，开始生成页面...'
    if (wsState.value !== 'done') wsState.value = 'execution'
  }
  if (['plan_draft', 'review_feedback', 'ppt_outline'].includes(d.artifactType)) {
    publishActivity(`${artifactTypeLabel(d.artifactType)}已更新：${artifactTimelineText({ artifactType: d.artifactType, payload: d.payload || {} })}`, d.timestamp || Date.now())
  }

}

function artifactCardTitle(type, payload) {
  if (type === 'task_brief') return `任务理解：${payload.brand || payload.topic || '已整理'}`
  if (type === 'research_result') return `搜索研究：${payload.focus || '行业资讯'}`
  if (type === 'plan_draft') return `方案草稿：${payload.planTitle || '已生成'}`
  if (type === 'plan_document') return `策划文档：${payload.title || '已生成'}`
  if (type === 'review_feedback') return `评审意见：第 ${payload.round || 1} 轮，评分 ${payload.score || 0}`
  if (type === 'ppt_outline') return `PPT大纲：共 ${payload.total || 0} 页`
  if (type === 'ppt_slides') return `PPT成稿：共 ${payload.pageCount || 0} 页`
  return artifactTypeLabel(type)
}

function artifactCardSummary(type, payload) {
  if (type === 'task_brief') return payload.parsedGoal || payload.goal || ''
  if (type === 'research_result') return payload.summary || ''
  if (type === 'plan_draft') return payload.coreStrategy || ''
  if (type === 'plan_document') return payload.summary || '完整策划方案文档已生成，可在右侧继续编辑和确认。'
  if (type === 'review_feedback') {
    if (payload.passed) return payload.specificFeedback || '方案通过评审，当前可以进入下一步。'
    return payload.weaknesses?.[0] || payload.suggestions?.[0] || '方案待优化'
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
  if (type === 'plan_draft') return (payload.highlights || []).slice(0, 3)
  if (type === 'plan_document') return (payload.highlights || []).slice(0, 3)
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
  publishActivity('策划文档已生成。若还不满意，可继续指出要优化的方向，再决定是否生成 PPT。', d.timestamp || Date.now())
  pushMsg('ai', '', '策划文档我已经整理好了。你先看方案本身是否满意；如果方向对了，直接在对话里回复“可以开始生成 PPT”，我会按这版继续往下做。如果还想调整，也直接告诉我改哪里。')
  setQuickReplies('下一步', [
    {
      label: '可以开始生成 PPT',
      value: '可以开始生成 PPT',
      description: '按当前这版方案直接进入 PPT 生成。'
    },
    {
      label: '继续优化方案',
      value: '先别生成 PPT，继续优化方案',
      description: '当前方向保留，但继续收紧主题、结构或执行细节。'
    },
    {
      label: '先补充新要求',
      value: '我先补充一些新的要求，再继续往下推',
      description: '先补限制条件或偏好，再决定是否出 PPT。'
    }
  ], '策划文档已经整理好了，这一版你想怎么继续？')
}

function handleDocSectionAdded(d) {
  docContent.value = d.docContent || docContent.value
  docTitle.value = d.title || docTitle.value || currentTask.value?.topic || '策划方案'
  docStreamProgress.value = Number(d.progress || 0)
  isDocStreaming.value = docStreamProgress.value < 100
  docStreamPhase.value = d.provisional ? 'draft' : 'final'
  progress.value = Math.max(progress.value, 72)
  progressLabel.value = d.sectionTitle
    ? `${d.provisional ? '正在起草' : '正在润色'}文档章节：${d.sectionTitle}`
    : (d.provisional ? '正在搭建策划文档初稿...' : '正在润色策划文档...')
  wsState.value = 'document'
  activeArtifact.value = {
    artifactType: 'plan_document',
    artifactId: createMessageId('artifact'),
    title: docTitle.value,
    payload: {
      title: docTitle.value,
      summary: latestPlanDraft.value?.payload?.coreStrategy || ''
    }
  }
  if (d.sectionTitle) {
    publishActivity(`文档已写入章节：${d.provisional ? '起草' : '润色'} ${d.sectionTitle}`, d.timestamp || Date.now())
  }
}

function handleSlideAdded(d) {
  // 第一张页到来时切换到 streaming 状态，右侧切换到 PPT 视图
  if (wsState.value !== 'streaming' && wsState.value !== 'done') {
    wsState.value = 'streaming'
    isBuilding.value = true
    activeArtifact.value = { artifactType: 'ppt_slides' }
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
    pushMsg('ai', '', d.hasPlan
      ? '方案方向已经整理完了。是否进入 PPT，我会在对话里和你确认；如果这版还不够满意，也可以继续让我改。'
      : '这一轮信息我已经整理完了，你可以继续补充方向，我再往下推进。')
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
  publishActivity(
    isBrainOnly
      ? '本轮任务已完成，可继续补充要求、优化方案，确认后再进入 PPT 生成。'
      : (isPptDone ? 'PPT 已生成完成，支持右侧预览和下载。' : '任务已完成，支持预览、编辑和保存。')
  )
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
  font-size: 16px;
  flex-shrink: 0;
}

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

/* ── 产出物消息卡片 ── */
.artifact-msg-card {
  width: min(85%, 560px);
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
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #F8FAFC;
  border: 1px solid rgba(0,0,0,0.06);
}

.artifact-msg-card-icon {
  font-size: 14px;
  color: #64748B;
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
  background: rgba(var(--arcoblue-6), 0.08);
  border-color: rgba(var(--arcoblue-6), 0.24);
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
  border-right-color: transparent;
}

.chat-conversation-sidebar.collapsed .conversation-sidebar-head {
  padding: 12px 6px 6px;
  min-height: 44px;
  border-bottom-color: transparent;
}

.chat-conversation-sidebar.collapsed .conversation-sidebar-body {
  padding: 8px 6px 14px;
  align-items: center;
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
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #a8a29e;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.18s ease, color 0.18s ease;
}

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
  gap: 2px;
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
  padding: 9px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
  transition: background 0.18s ease, box-shadow 0.18s ease, color 0.18s ease;
  text-align: left;
}

.conversation-pill:hover {
  background: rgba(255, 255, 255, 0.55);
}

.conversation-pill.active {
  background: rgba(255, 255, 255, 0.92);
  box-shadow: none;
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

.conversation-mini {
  width: 32px;
  height: 32px;
  margin: 0 auto 8px;
  border: none;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.75);
  color: #57534e;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}

.conversation-mini:hover {
  background: rgba(var(--arcoblue-6), 0.08);
  color: rgb(var(--arcoblue-6));
}

.conversation-mini.active {
  color: rgb(var(--arcoblue-6));
  background: rgb(var(--arcoblue-1));
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
  max-width: 720px;
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
}
.bubble-wrap.user { justify-content: flex-end; }
.bubble-wrap.ai   { justify-content: flex-start; }

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
  max-width: 720px;
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
  align-items: center;
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

.at-mention-name {
  font-size: 13px;
  color: #1c1917;
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
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: #eef2ff;
  color: #44403c;
  font-size: 15px;
  cursor: pointer;
  transition: background 0.18s, color 0.18s;
}

.attach-btn:hover:not(:disabled) {
  background: #dbeafe;
  color: #0f172a;
}

.attach-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* 发送按钮 */
.send-btn {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: rgba(0,0,0,0.06);
  color: #9ca3af;
  font-size: 15px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: default;
  flex-shrink: 0;
  transition: background 0.18s, color 0.18s, transform 0.12s;
}

.send-btn--active {
  background: #1c1917;
  color: #fff;
  cursor: pointer;
}

.send-btn--active:hover {
  background: #44403c;
  transform: scale(1.06);
}

.stop-btn {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: #fee2e2;
  color: #dc2626;
  font-size: 15px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.18s, transform 0.12s;
}

.stop-btn:hover {
  background: #fca5a5;
  transform: scale(1.06);
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
  padding: 14px 20px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
  flex-shrink: 0;
  background: #fff;
}

.artifact-pane-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.artifact-pane-icon {
  font-size: 16px;
}

.artifact-pane-title {
  font-size: 14px;
  font-weight: 600;
  color: #1E293B;
}

.artifact-pane-actions {
  display: flex;
  gap: 8px;
}

.pane-action-btn {
  padding: 4px 12px;
  border: 1px solid #CBD5E1;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  color: #57534e;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.pane-action-btn:hover {
  border-color: rgb(var(--arcoblue-6));
  color: rgb(var(--arcoblue-6));
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
  padding: 10px 12px;
  background: rgba(247, 248, 250, 0.95);
  border: 1px dashed #d9dde4;
  border-radius: 12px;
}

.process-summary-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.process-summary-title {
  font-size: 12px;
  font-weight: 700;
  color: #57534e;
}

.process-summary-toggle {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--arcoblue-6));
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
</style>
