<template>
  <div
    ref="layoutRef"
    class="chat-layout"
    :class="{ 'preview-open': previewVisible, resizing: isResizing }"
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
            <div class="bubble user">{{ msg.text }}</div>
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
                <div class="clarification-question">{{ msg.question }}</div>
              </div>
            </template>

            <!-- 产出物卡片 -->
            <template v-else-if="msg.kind === 'artifact-card'">
              <div class="artifact-msg-card" :class="`artifact-msg-card--${msg.artifactType}`" @click="openArtifactModal(msg)">
                <div class="artifact-msg-card-head">
                  <span class="artifact-msg-card-icon">{{ artifactMsgIcon(msg.artifactType) }}</span>
                  <span class="artifact-msg-card-title">{{ msg.title }}</span>
                  <span class="artifact-msg-card-arrow">›</span>
                </div>
                <div v-if="msg.summary" class="artifact-msg-card-summary">{{ msg.summary }}</div>
                <div v-if="msg.chips?.length" class="artifact-msg-card-chips">
                  <span v-for="chip in msg.chips" :key="chip" class="artifact-msg-chip">{{ chip }}</span>
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

        <div class="input-card" :class="{ focused: inputFocused }">
          <!-- 文本输入 -->
          <a-textarea
            v-model="inputText"
            class="chat-textarea"
            :auto-size="{ minRows: 2, maxRows: 6 }"
            :placeholder="waitingForClarification ? '请回答上述问题...' : '描述活动需求，如：帮我为小米做一个大型新品发布会...'"
            @focus="inputFocused = true"
            @blur="inputFocused = false"
            @compositionstart="isComposing = true"
            @compositionend="isComposing = false"
            @keydown.enter.exact="handleEnter"
          />

          <!-- 工具栏 -->
          <div class="input-toolbar">
            <!-- 终止按钮（任务运行中显示） -->
            <button
              v-if="isRunning || wsState === 'execution'"
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
              :class="{ 'send-btn--active': inputText.trim() }"
              :disabled="!inputText.trim()"
              @click="send"
            >
              <icon-arrow-up />
            </button>
          </div>
        </div>
      </div>
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

    <!-- ── 右侧：任务工作区 / 结果预览区 ── -->
    <div v-if="previewVisible && !previewCollapsed" class="ws-workspace">
      <div v-if="wsState === 'execution' || wsState === 'failed'" class="ws-execution">
        <div class="exec-preview-card preview-only">
          <div class="exec-preview-head">
            <div>
              <div class="exec-section-title">实时产出预览</div>
              <div class="preview-stage-desc">{{ currentPreviewHint }}</div>
            </div>
            <div v-if="wsState === 'failed'" class="exec-preview-actions">
              <a-button type="primary" size="small" @click="retryCurrentTask">重试</a-button>
              <a-button size="small" @click="restoreTaskToInput">回填输入</a-button>
            </div>
          </div>

          <div v-if="hasStrategyPreview" class="strategy-preview">
            <div class="strategy-hero">
              <div class="strategy-hero-copy">
                <div class="strategy-hero-eyebrow">方案实时预览</div>
                <div class="strategy-hero-title">
                  {{ latestPlanDraft?.payload.planTitle || currentTask?.topic || '活动策划方案' }}
                </div>
                <div class="strategy-hero-desc">
                  {{ latestPlanDraft?.payload.coreStrategy || latestTaskBrief?.payload.parsedGoal || '系统正在基于任务简报、搜索摘要和评审反馈形成策划方案。' }}
                </div>
              </div>
              <div class="strategy-hero-meta">
                <div class="strategy-meta-card">
                  <span>当前阶段</span>
                  <strong>{{ currentStageTitle }}</strong>
                </div>
                <div class="strategy-meta-card">
                  <span>当前产出</span>
                  <strong>{{ strategySnapshotLabel }}</strong>
                </div>
              </div>
            </div>

            <div v-if="latestTaskBrief" class="preview-block">
              <div class="preview-block-title">任务理解</div>
              <div class="artifact-paragraph">{{ latestTaskBrief.payload.parsedGoal }}</div>
              <div v-if="latestTaskBrief.payload.keyThemes?.length" class="artifact-chip-row">
                <span v-for="item in latestTaskBrief.payload.keyThemes" :key="item" class="artifact-chip">{{ item }}</span>
              </div>
            </div>

            <div v-if="researchPreviewItems.length" class="preview-block">
              <div class="preview-block-title">搜索摘要</div>
              <div class="research-grid">
                <div v-for="item in researchPreviewItems" :key="item.id" class="research-card">
                  <div class="research-card-title">{{ item.payload.focus }}</div>
                  <div class="research-card-summary">{{ item.payload.summary || '正在整理搜索发现...' }}</div>
                  <div v-if="item.payload.keyFindings?.length" class="research-card-points">
                    <span v-for="(finding, idx) in item.payload.keyFindings.slice(0, 2)" :key="idx">{{ finding }}</span>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="latestPlanDraft" class="preview-block preview-block--plan">
              <div class="artifact-title">{{ latestPlanDraft.payload.planTitle || '策划方案草稿' }}</div>
              <div class="artifact-paragraph">{{ latestPlanDraft.payload.coreStrategy }}</div>
              <div v-if="latestPlanDraft.payload.highlights?.length" class="artifact-chip-row">
                <span v-for="item in latestPlanDraft.payload.highlights.slice(0, 4)" :key="item" class="artifact-chip">{{ item }}</span>
              </div>
              <div v-if="latestPlanDraft.payload.highlights?.length" class="highlight-grid">
                <div
                  v-for="(item, idx) in latestPlanDraft.payload.highlights.slice(0, 3)"
                  :key="item"
                  class="highlight-card"
                >
                  <div class="highlight-index">亮点 {{ idx + 1 }}</div>
                  <div class="highlight-text">{{ item }}</div>
                </div>
              </div>
              <div v-if="latestPlanDraft.payload.sections?.length" class="plan-outline">
                <div class="preview-block-title">方案结构</div>
                <div class="plan-outline-list">
                  <div
                    v-for="(section, idx) in latestPlanDraft.payload.sections.slice(0, 6)"
                    :key="idx"
                    class="plan-outline-item"
                  >
                    <div class="plan-outline-index">{{ String(idx + 1).padStart(2, '0') }}</div>
                    <div class="plan-outline-copy">
                      <div class="plan-outline-title">{{ section.title }}</div>
                      <div class="plan-outline-desc">{{ (section.keyPoints || []).slice(0, 2).join(' / ') }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="planSectionArtifacts.length" class="preview-block section-live-block">
              <div class="artifact-title">
                章节展开中
                <span class="section-live-badge">实时更新</span>
              </div>
              <div v-if="latestPlanSection" class="section-live-focus">
                <div class="section-live-eyebrow">当前展开章节</div>
                <div class="section-live-title">{{ latestPlanSection.payload.title }}</div>
                <div class="section-live-points">
                  <span v-for="(point, idx) in latestPlanSection.payload.keyPoints.slice(0, 3)" :key="idx">{{ point }}</span>
                </div>
              </div>
              <div class="section-live-list">
                <div
                  v-for="section in planSectionArtifacts"
                  :key="section.payload.title"
                  class="section-live-item"
                  :class="{ active: latestPlanSection?.payload.title === section.payload.title }"
                >
                  <div class="section-live-item-head">
                    <span class="section-live-item-index">{{ String((section.payload.index || 0) + 1).padStart(2, '0') }}</span>
                    <span class="section-live-item-title">{{ section.payload.title }}</span>
                  </div>
                  <div class="section-live-item-desc">{{ (section.payload.keyPoints || []).slice(0, 3).join(' / ') }}</div>
                </div>
              </div>
            </div>

            <div v-if="latestReviewFeedback" class="preview-block review-block">
              <div class="artifact-title">
                第 {{ latestReviewFeedback.payload.round }} 轮评审
                <span class="artifact-score" :class="{ pass: latestReviewFeedback.payload.passed }">
                  {{ latestReviewFeedback.payload.score }} 分
                </span>
              </div>
              <div class="artifact-paragraph">{{ latestReviewFeedback.payload.specificFeedback }}</div>
              <div v-if="latestReviewFeedback.payload.weaknesses?.length" class="artifact-list">
                <div v-for="(item, idx) in latestReviewFeedback.payload.weaknesses.slice(0, 4)" :key="idx" class="artifact-list-item">
                  <b>待优化</b>
                  <span>{{ item }}</span>
                </div>
              </div>
            </div>

            <div v-if="latestPptOutline" class="preview-block">
              <div class="preview-block-title">PPT 结构映射</div>
              <div class="artifact-paragraph">已将方案映射为 {{ latestPptOutline.payload.total || 0 }} 页 PPT 结构，下一步会逐页生成可视内容。</div>
            </div>
          </div>

          <div v-else class="exec-preview-skeleton">
            <div class="preview-skel preview-skel--hero" />
            <div class="preview-skel preview-skel--line" />
            <div class="preview-skel preview-skel--line short" />
            <div class="preview-grid">
              <div class="preview-card" />
              <div class="preview-card" />
              <div class="preview-card" />
            </div>
          </div>

          <div v-if="artifactTimeline.length" class="artifact-timeline">
            <div class="exec-section-title">最近产出</div>
            <div class="artifact-timeline-list">
              <div v-for="item in artifactTimeline" :key="item.id" class="artifact-timeline-item">
                <span class="artifact-timeline-type">{{ artifactTypeLabel(item.artifactType) }}</span>
                <span class="artifact-timeline-text">{{ artifactTimelineText(item) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="wsState === 'document'" class="ws-document">
        <PlanDocumentPanel
          :content="docContent"
          :title="docTitle"
          :spaces="spaces"
          :loading="isRunning"
          @generate-ppt="triggerPptBuild"
          @saved="loadSpaces"
        />
      </div>

      <div v-else class="ws-done">
        <div class="preview-tabs-head">
          <div class="preview-tabs">
            <button
              type="button"
              class="preview-tab"
              :class="{ active: activePreviewTab === 'strategy' }"
              @click="activePreviewTab = 'strategy'"
            >
              方案预览
            </button>
            <button
              type="button"
              class="preview-tab"
              :class="{ active: activePreviewTab === 'ppt' }"
              @click="activePreviewTab = 'ppt'"
            >
              PPT 预览
            </button>
          </div>
          <div v-if="wsState === 'done'" class="done-summary">
          <a-tag v-for="s in summarySteps" :key="s.key" color="green" size="small">
            <template #icon><icon-check /></template>
            {{ s.title }}
          </a-tag>
          <span class="done-label">全部完成</span>
        </div>
        </div>

        <div v-if="activePreviewTab === 'strategy'" class="strategy-preview strategy-preview--final">
          <div class="strategy-hero">
            <div class="strategy-hero-copy">
              <div class="strategy-hero-eyebrow">方案总览</div>
              <div class="strategy-hero-title">
                {{ latestPlanDraft?.payload.planTitle || resultData?.previewData?.title || currentTask?.topic || '活动策划方案' }}
              </div>
              <div class="strategy-hero-desc">
                {{ latestPlanDraft?.payload.coreStrategy || '方案已成型，可继续切换到 PPT 预览查看视觉页面。' }}
              </div>
            </div>
            <div class="strategy-hero-meta">
              <div class="strategy-meta-card">
                <span>任务状态</span>
                <strong>{{ wsState === 'done' ? '已完成' : currentStageTitle }}</strong>
              </div>
              <div class="strategy-meta-card">
                <span>方案亮点</span>
                <strong>{{ latestPlanDraft?.payload.highlights?.length || 0 }} 项</strong>
              </div>
            </div>
          </div>

          <div v-if="latestPlanDraft" class="preview-block preview-block--plan">
            <div class="artifact-title">{{ latestPlanDraft.payload.planTitle || resultData?.previewData?.title || '策划方案' }}</div>
            <div class="artifact-paragraph">{{ latestPlanDraft.payload.coreStrategy }}</div>
            <div v-if="latestPlanDraft.payload.highlights?.length" class="artifact-chip-row">
              <span v-for="item in latestPlanDraft.payload.highlights.slice(0, 4)" :key="item" class="artifact-chip">{{ item }}</span>
            </div>
            <div v-if="latestPlanDraft.payload.highlights?.length" class="highlight-grid">
              <div
                v-for="(item, idx) in latestPlanDraft.payload.highlights.slice(0, 3)"
                :key="item"
                class="highlight-card"
              >
                <div class="highlight-index">亮点 {{ idx + 1 }}</div>
                <div class="highlight-text">{{ item }}</div>
              </div>
            </div>
            <div v-if="latestPlanDraft.payload.sections?.length" class="plan-outline">
              <div class="preview-block-title">方案结构</div>
              <div class="plan-outline-list">
                <div
                  v-for="(section, idx) in latestPlanDraft.payload.sections"
                  :key="idx"
                  class="plan-outline-item"
                >
                  <div class="plan-outline-index">{{ String(idx + 1).padStart(2, '0') }}</div>
                  <div class="plan-outline-copy">
                    <div class="plan-outline-title">{{ section.title }}</div>
                    <div class="plan-outline-desc">{{ (section.keyPoints || []).slice(0, 3).join(' / ') }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="planSectionArtifacts.length" class="preview-block section-live-block">
            <div class="artifact-title">章节内容总览</div>
            <div class="section-live-list">
              <div
                v-for="section in planSectionArtifacts"
                :key="section.payload.title"
                class="section-live-item final"
              >
                <div class="section-live-item-head">
                  <span class="section-live-item-index">{{ String((section.payload.index || 0) + 1).padStart(2, '0') }}</span>
                  <span class="section-live-item-title">{{ section.payload.title }}</span>
                </div>
                <div class="section-live-item-desc">{{ (section.payload.keyPoints || []).slice(0, 4).join(' / ') }}</div>
              </div>
            </div>
          </div>

          <div v-if="latestReviewFeedback" class="preview-block review-block">
            <div class="artifact-title">
              最新评审结论
              <span class="artifact-score" :class="{ pass: latestReviewFeedback.payload.passed }">
                {{ latestReviewFeedback.payload.score }} 分
              </span>
            </div>
            <div class="artifact-paragraph">{{ latestReviewFeedback.payload.specificFeedback }}</div>
          </div>
        </div>

        <SlideViewer
          v-else
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
      title="保存到文档空间"
      @ok="doSave"
      @cancel="showSaveModal = false"
    >
      <a-form layout="vertical">
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

    <!-- 产出物详情弹窗 -->
    <a-modal
      v-model:visible="showArtifactModal"
      :title="selectedArtifact?.title || '产出物详情'"
      width="680px"
      :footer="null"
      @cancel="showArtifactModal = false"
    >
      <div v-if="selectedArtifact" class="artifact-modal-content">
        <!-- plan_draft -->
        <template v-if="selectedArtifact.artifactType === 'plan_draft'">
          <div class="artifact-modal-section">
            <div class="artifact-modal-label">核心策略</div>
            <div class="artifact-modal-text">{{ selectedArtifact.payload?.coreStrategy || '—' }}</div>
          </div>
          <div v-if="selectedArtifact.payload?.highlights?.length" class="artifact-modal-section">
            <div class="artifact-modal-label">活动亮点</div>
            <div class="artifact-modal-highlights">
              <div v-for="(h, i) in selectedArtifact.payload.highlights" :key="i" class="artifact-modal-highlight">
                <span class="highlight-num">{{ i + 1 }}</span>
                <span>{{ h }}</span>
              </div>
            </div>
          </div>
          <div v-if="selectedArtifact.payload?.sections?.length" class="artifact-modal-section">
            <div class="artifact-modal-label">方案结构</div>
            <div class="artifact-modal-sections">
              <div v-for="(s, i) in selectedArtifact.payload.sections" :key="i" class="artifact-modal-section-item">
                <span class="section-num">{{ String(i + 1).padStart(2, '0') }}</span>
                <div class="section-info">
                  <div class="section-title">{{ s.title }}</div>
                  <div class="section-points">{{ (s.keyPoints || []).slice(0, 3).join(' / ') }}</div>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- task_brief -->
        <template v-else-if="selectedArtifact.artifactType === 'task_brief'">
          <div class="artifact-modal-section">
            <div class="artifact-modal-label">任务目标</div>
            <div class="artifact-modal-text">{{ selectedArtifact.payload?.parsedGoal || selectedArtifact.payload?.goal || '—' }}</div>
          </div>
          <div v-if="selectedArtifact.payload?.keyThemes?.length" class="artifact-modal-section">
            <div class="artifact-modal-label">关键主题</div>
            <div class="artifact-modal-chips">
              <span v-for="t in selectedArtifact.payload.keyThemes" :key="t" class="artifact-modal-chip">{{ t }}</span>
            </div>
          </div>
        </template>

        <!-- research_result -->
        <template v-else-if="selectedArtifact.artifactType === 'research_result'">
          <div class="artifact-modal-section">
            <div class="artifact-modal-label">研究主题</div>
            <div class="artifact-modal-text">{{ selectedArtifact.payload?.focus || '—' }}</div>
          </div>
          <div class="artifact-modal-section">
            <div class="artifact-modal-label">摘要</div>
            <div class="artifact-modal-text">{{ selectedArtifact.payload?.summary || '—' }}</div>
          </div>
          <div v-if="selectedArtifact.payload?.keyFindings?.length" class="artifact-modal-section">
            <div class="artifact-modal-label">关键发现</div>
            <ul class="artifact-modal-list">
              <li v-for="(f, i) in selectedArtifact.payload.keyFindings" :key="i">{{ f }}</li>
            </ul>
          </div>
        </template>

        <!-- review_feedback -->
        <template v-else-if="selectedArtifact.artifactType === 'review_feedback'">
          <div class="artifact-modal-section">
            <div class="artifact-modal-score" :class="{ pass: selectedArtifact.payload?.passed }">
              <span class="score-num">{{ selectedArtifact.payload?.score || 0 }}</span>
              <span class="score-label">分</span>
              <span class="score-status">{{ selectedArtifact.payload?.passed ? '通过' : '待优化' }}</span>
            </div>
          </div>
          <div class="artifact-modal-section">
            <div class="artifact-modal-label">评审反馈</div>
            <div class="artifact-modal-text">{{ selectedArtifact.payload?.specificFeedback || '—' }}</div>
          </div>
          <div v-if="selectedArtifact.payload?.weaknesses?.length" class="artifact-modal-section">
            <div class="artifact-modal-label">待优化项</div>
            <ul class="artifact-modal-list">
              <li v-for="(w, i) in selectedArtifact.payload.weaknesses" :key="i">{{ w }}</li>
            </ul>
          </div>
          <div v-if="selectedArtifact.payload?.suggestions?.length" class="artifact-modal-section">
            <div class="artifact-modal-label">修改建议</div>
            <ul class="artifact-modal-list">
              <li v-for="(s, i) in selectedArtifact.payload.suggestions" :key="i">{{ s }}</li>
            </ul>
          </div>
        </template>

        <!-- ppt_outline -->
        <template v-else-if="selectedArtifact.artifactType === 'ppt_outline'">
          <div class="artifact-modal-section">
            <div class="artifact-modal-label">PPT 主题</div>
            <div class="artifact-modal-text">{{ selectedArtifact.payload?.title || '—' }}</div>
          </div>
          <div class="artifact-modal-section">
            <div class="artifact-modal-label">总页数</div>
            <div class="artifact-modal-text">{{ selectedArtifact.payload?.total || 0 }} 页</div>
          </div>
          <div v-if="selectedArtifact.payload?.pages?.length" class="artifact-modal-section">
            <div class="artifact-modal-label">页面结构</div>
            <div class="artifact-modal-pages">
              <div v-for="(p, i) in selectedArtifact.payload.pages" :key="i" class="artifact-modal-page-item">
                <span class="page-num">{{ i + 1 }}</span>
                <span class="page-layout">{{ p.layout || p.type }}</span>
                <span class="page-title">{{ p.content?.title || p.content?.name || '' }}</span>
              </div>
            </div>
          </div>
        </template>

        <!-- fallback -->
        <template v-else>
          <pre class="artifact-modal-json">{{ JSON.stringify(selectedArtifact.payload, null, 2) }}</pre>
        </template>
      </div>
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
  IconMobile, IconCompass, IconCamera, IconRecordStop
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
  if (!reply) return
  clarificationReplyText.value = ''
  msg.answered = true

  pushMsg('user', reply)
  waitingForClarification.value = false
  isRunning.value = true

  return new Promise(resolve => {
    const done = () => { resolveCurrent = null; resolve() }
    resolveCurrent = done

    fetch(`/api/agent/${currentSessionId.value}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply, apiKeys: settings.apiKeys })
    }).then(r => r.json()).then(res => {
      if (!res.success) throw new Error(res.message)
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
const historyRef = ref(null)
const isRunning  = ref(false)
const conversations = ref([])
const activeConversationId = ref('')
const conversationSearch = ref('')
const conversationSidebarCollapsed = ref(loadConversationSidebarCollapsed())
const restoringConversation = ref(false)
let persistConversationTimer = null

function createMessageId(prefix = 'msg') {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
}

function stripHtmlText(value = '') {
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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
  const nextMessage = {
    id: createMessageId(role),
    role,
    text: text || '',
    html: html || text || '',
    createdAt: new Date().toISOString(),
    ...extra
  }
  if (role === 'ai') Object.assign(nextMessage, buildAiMessageMeta(text, html))
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
const hasMatureStrategyPreview = computed(() =>
  !!latestPlanDraft.value ||
  planSectionArtifacts.value.length > 0 ||
  !!latestReviewFeedback.value ||
  !!latestPptOutline.value
)
const hasStrategyPreview = computed(() =>
  !!latestTaskBrief.value ||
  researchPreviewItems.value.length > 0 ||
  !!latestPlanDraft.value ||
  planSectionArtifacts.value.length > 0 ||
  !!latestReviewFeedback.value ||
  !!latestPptOutline.value
)
const previewVisible = computed(() => {
  if (docContent.value || resultSlides.value.length > 0) return true
  return hasStrategyPreview.value
})
const strategySnapshotLabel = computed(() => {
  if (latestPptOutline.value) return '已进入 PPT 结构映射'
  if (latestReviewFeedback.value) return '已形成评审结论'
  if (latestPlanSection.value) return `已展开 ${latestPlanSection.value.payload.title}`
  if (latestPlanDraft.value) return '已形成方案草稿'
  if (researchPreviewItems.value.length) return '已形成研究摘要'
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
  if (taskMode.value === 'brain') {
    if (waitingForClarification.value) return '正在等待你补充一个关键信息，收到后会继续推进。'
    if (isBuilding.value) return '正在把方案转换成 PPT 页面，新的页面会在这里逐张出现。'
    if (brainPlanItems.value.some(item => item.status === 'in_progress')) {
      return '系统正在按计划推进任务，会把结构化 brief、搜索结果和方案草稿同步展示在这里。'
    }
  }
  return '系统正在准备可预览的中间产出。'
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
  resultSlides.value      = []
  resultDownloadUrl.value = ''
  resultData.value        = null
  docContent.value = ''
  docTitle.value = ''
  failedReason.value = ''
  failedStage.value = ''
  artifacts.value = []
  executionLogs.value = []
  taskMode.value = 'idle'
  brainPlanItems.value = []
}

function statusLabel(s) {
  return { pending: '等待中', running: '进行中', completed: '完成', failed: '失败' }[s] || s
}

function artifactTypeLabel(type) {
  return {
    task_brief: '任务理解',
    research_result: '搜索发现',
    plan_draft: '方案草稿',
    review_feedback: '评审结果',
    ppt_outline: 'PPT 大纲',
    ppt_page: '页面完成'
  }[type] || '中间产物'
}

function artifactMsgIcon(type) {
  return {
    task_brief: '📋',
    research_result: '🔍',
    plan_draft: '📝',
    review_feedback: '✅',
    ppt_outline: '📐'
  }[type] || '📄'
}

function artifactTimelineText(item) {
  const payload = item.payload || {}
  if (item.artifactType === 'task_brief') return payload.parsedGoal || '已完成任务拆解'
  if (item.artifactType === 'research_result') return payload.focus || payload.summary || '已完成一条搜索结果'
  if (item.artifactType === 'plan_draft') return payload.planTitle || payload.coreStrategy || '已生成方案草稿'
  if (item.artifactType === 'review_feedback') return `第 ${payload.round} 轮评分 ${payload.score}${payload.passed ? '，通过' : '，待优化'}`
  if (item.artifactType === 'ppt_outline') return `已生成 ${payload.total || 0} 页 PPT 大纲`
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
  const prev = executionLogs.value[0]
  if (prev?.text === text) return
  const log = {
    id: `${ts}_${Math.random().toString(16).slice(2, 8)}`,
    time: formatLogTime(ts),
    text
  }
  executionLogs.value.unshift(log)
  executionLogs.value = executionLogs.value.slice(0, 24)
  scheduleConversationPersist()
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
  if (isComposing.value) return   // IME 确认词组阶段，不拦截
  e.preventDefault()
  send()
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

function restoreFromConversation(detail) {
  const state = detail?.state || {}
  restoringConversation.value = true
  messages.value = Array.isArray(detail?.messages)
    ? detail.messages.map(msg => ({
        ...msg,
        id: msg.id || createMessageId('msg'),
        createdAt: msg.createdAt || new Date().toISOString()
      }))
    : []

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
  failedReason.value = state.failedReason || ''
  failedStage.value = state.failedStage || ''
  artifacts.value = Array.isArray(state.artifacts) ? state.artifacts : []
  executionLogs.value = Array.isArray(state.executionLogs) ? state.executionLogs : []

  const savedWsState = state.wsState || 'welcome'
  wsState.value = ['execution', 'streaming', 'document'].includes(savedWsState)
    ? (resultSlides.value.length ? 'done' : 'failed')
    : savedWsState
  if (['execution', 'streaming'].includes(savedWsState) && !failedReason.value) {
    failedReason.value = '这是一次已恢复的历史会话，原任务执行过程不会自动继续。'
  }

  isRunning.value = false

  nextTick(() => {
    restoringConversation.value = false
    if (historyRef.value) historyRef.value.scrollTop = historyRef.value.scrollHeight
  })
}

function clearConversationView() {
  restoringConversation.value = true
  messages.value = []
  currentTask.value = null
  taskMode.value = 'idle'
  brainPlanItems.value = []
  resetSteps()
  wsState.value = 'welcome'
  currentSlideIndex.value = 0
  failedReason.value = ''
  failedStage.value = ''
  nextTick(() => {
    restoringConversation.value = false
  })
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

// 发送：直接走 Brain Agent，不再做前置意图解析
async function send() {
  const text = inputText.value.trim()
  if (!text || isRunning.value) return
  inputText.value = ''

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
  if (pptDone || wsState.value === 'failed') {
    activeConversationId.value = ''
    currentSessionId.value = ''
  }

  const conversationId = await ensureActiveConversation(text.slice(0, 24))
  if (!conversationId) {
    inputText.value = text
    return
  }

  pushMsg('user', text)
  await nextTick()
  if (historyRef.value) historyRef.value.scrollTop = historyRef.value.scrollHeight

  await runBrainTask(text)
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
  if (sse) { sse.close(); sse = null }
  isRunning.value  = false
  isBuilding.value = false
  // resolve 挂起的 Promise，让队列处理器正常退出
  if (resolveCurrent) { resolveCurrent(); resolveCurrent = null }
  pushMsg('ai', '', '已终止当前任务。')
}

// ── Brain Agent 任务 ──────────────────────────────────────────────
async function runBrainTask(text) {
  const isContinuing = !!currentSessionId.value  // 是否复用现有 session
  isRunning.value = true
  waitingForClarification.value = false
  resetProcessedStreamEvents()
  if (!isContinuing) {
    resetSteps()
    brainPlanItems.value = defaultBrainPlan()
    currentTask.value = { topic: text.slice(0, 32), requirements: text }
  }
  taskMode.value = 'brain'
  progress.value = isContinuing ? Math.max(progress.value, 8) : 8
  progressLabel.value = isContinuing ? '继续推进...' : '正在理解需求...'
  wsState.value = 'execution'
  addExecutionLog(isContinuing ? `继续任务：${text.slice(0, 48)}` : `收到新任务：${text.slice(0, 48)}`)

  return new Promise(resolve => {
    const timeoutId = setTimeout(() => {
      if (sse) { sse.close(); sse = null }
      isRunning.value = false
      wsState.value = wsState.value !== 'done' ? 'failed' : wsState.value
      pushMsg('ai', '', '任务执行超时，已自动终止。')
      resolve()
    }, 30 * 60 * 1000)

    const done = () => { clearTimeout(timeoutId); resolveCurrent = null; resolve() }
    resolveCurrent = done

    fetch('/api/agent/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        spaceId: selectedSpaceId.value,
        apiKeys: settings.apiKeys,
        sessionId: currentSessionId.value || undefined  // 复用已有 session（如有）
      })
    }).then(r => r.json()).then(res => {
      if (!res.success) throw new Error(res.message || '启动失败')
      currentSessionId.value = res.sessionId
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
  if (sse) sse.close()
  sse = new EventSource(url)

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
      addExecutionLog(`开始${d.display || d.tool}`)
    }
  })

  sse.addEventListener('tool_progress', e => {
    const d = JSON.parse(e.data)
    // 更新最后一个 tool-call 气泡的 progress 字段
    const lastToolCall = [...messages.value].reverse().find(m => m.kind === 'tool-call')
    if (lastToolCall) lastToolCall.progress = d.message
    if (d.message) {
      progressLabel.value = d.message
    }
  })

  sse.addEventListener('text', e => {
    const d = JSON.parse(e.data)
    popThinking()
    if (d.text) pushMsg('ai', '', d.text, { kind: 'narration' })
  })

  sse.addEventListener('clarification', e => {
    const d = JSON.parse(e.data)
    if (shouldSkipStreamEvent('clarification', d)) return
    popThinking()
    waitingForClarification.value = true
    isRunning.value = false
    pushAiMessage({ kind: 'clarification', question: d.question, questionType: d.type, answered: false })
    scheduleConversationPersist()
  })

  sse.addEventListener('plan_update', e => {
    const d = JSON.parse(e.data)
    brainPlanItems.value = Array.isArray(d.items) ? d.items : []
    progress.value = Math.max(progress.value, 15)
    progressLabel.value = '正在执行计划'
    if (brainPlanItems.value.length) {
      addExecutionLog(`计划已更新，当前共 ${brainPlanItems.value.length} 步。`, d.timestamp || Date.now())
    }
  })

  sse.addEventListener('brief_update', e => {
    const d = JSON.parse(e.data)
    currentTask.value = {
      ...(currentTask.value || {}),
      ...(d.brief || {})
    }
    if (currentTask.value?.topic || currentTask.value?.brand) {
      addExecutionLog(`已整理任务简报：${currentTask.value.topic || currentTask.value.brand}`, d.timestamp || Date.now())
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
      addExecutionLog(d.summary || `${d.tool} 已完成`, d.timestamp || Date.now())
    }
    scheduleConversationPersist()
  })

  // 复用现有事件处理
  sse.addEventListener('artifact', e => handleArtifact(JSON.parse(e.data)))
  sse.addEventListener('doc_ready', e => handleDocReady(JSON.parse(e.data)))
  sse.addEventListener('slide_added', e => handleSlideAdded(JSON.parse(e.data)))
  sse.addEventListener('done', e => {
    popThinking()
    handleDone(JSON.parse(e.data))
    sse.close(); sse = null
    isRunning.value = false
    resolve()
  })

  sse.addEventListener('error', e => {
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
    if (sse) { sse.close(); sse = null }
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

  // 在对话流中插入产出物卡片
  const cardTypes = ['task_brief', 'research_result', 'plan_draft', 'review_feedback', 'ppt_outline']
  if (cardTypes.includes(d.artifactType)) {
    pushAiMessage({
      kind: 'artifact-card',
      artifactType: d.artifactType,
      artifactId: artifact.id,
      title: artifactCardTitle(d.artifactType, d.payload || {}),
      summary: artifactCardSummary(d.artifactType, d.payload || {}),
      chips: artifactCardChips(d.artifactType, d.payload || {}),
      payload: d.payload || {}
    })
  }
  if (['plan_draft', 'review_feedback', 'ppt_outline'].includes(d.artifactType)) {
    addExecutionLog(`${artifactTypeLabel(d.artifactType)}已更新：${artifactTimelineText({ artifactType: d.artifactType, payload: d.payload || {} })}`, d.timestamp || Date.now())
  }
}

function artifactCardTitle(type, payload) {
  if (type === 'task_brief') return `任务理解：${payload.brand || payload.topic || '已整理'}`
  if (type === 'research_result') return `搜索发现：${payload.focus || '行业资讯'}`
  if (type === 'plan_draft') return `方案草稿：${payload.planTitle || '已生成'}`
  if (type === 'review_feedback') return `评审结果：第 ${payload.round || 1} 轮，评分 ${payload.score || 0}`
  if (type === 'ppt_outline') return `PPT 大纲：共 ${payload.total || 0} 页`
  return artifactTypeLabel(type)
}

function artifactCardSummary(type, payload) {
  if (type === 'task_brief') return payload.parsedGoal || payload.goal || ''
  if (type === 'research_result') return payload.summary || ''
  if (type === 'plan_draft') return payload.coreStrategy || ''
  if (type === 'review_feedback') return payload.passed ? '方案通过评审，进入下一步' : (payload.suggestions?.[0] || '方案待优化')
  if (type === 'ppt_outline') return `${payload.title || ''}`
  return ''
}

function artifactCardChips(type, payload) {
  if (type === 'task_brief') return (payload.keyThemes || []).slice(0, 3)
  if (type === 'plan_draft') return (payload.highlights || []).slice(0, 3)
  return []
}

function handleDocReady(d) {
  docContent.value = d.docHtml || ''
  docTitle.value = d.title || currentTask.value?.topic || '策划方案'
  progress.value = Math.max(progress.value, 88)
  progressLabel.value = '策划文档已生成，等待确认'
  wsState.value = 'document'
  isRunning.value = false
  addExecutionLog('策划文档已生成，请先确认文档内容，再生成 PPT。', d.timestamp || Date.now())
  pushMsg('ai', '', `策划文档已生成。请先在右侧确认「${docTitle.value}」，确认后再生成 PPT。`)
}

function handleSlideAdded(d) {
  // 第一张页到来时切换到 streaming 状态，展开右侧面板
  if (wsState.value !== 'streaming' && wsState.value !== 'done') {
    wsState.value = 'streaming'
    isBuilding.value = true
  }
  buildTotal.value = d.total || 0
  const current = d.index + 1
  const total = d.total || 0
  const shouldLogPage = total > 0
    ? (total <= 8 || current === 1 || current === total || current % 3 === 0)
    : true
  if (shouldLogPage) {
    addExecutionLog(
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
  progress.value = 100
  progressLabel.value = isBrainOnly ? '本轮任务已完成' : '策划方案生成完成！'
  brainPlanItems.value = (brainPlanItems.value.length ? brainPlanItems.value : defaultBrainPlan()).map((item) => ({
    ...item,
    status: 'completed'
  }))

  isBuilding.value = false
  resultSlides.value       = d.previewSlides || []
  resultDownloadUrl.value  = d.downloadUrl   || ''
  resultData.value         = d
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
      ? '方案方向已经整理完了，我会带着这版判断继续配合你细化，确认后也可以直接生成 PPT。'
      : '这一轮信息我已经整理完了，你可以继续补充方向，我再往下推进。')
    wsState.value = docContent.value
      ? 'document'
      : (hasStrategyPreview.value ? 'done' : 'welcome')
  } else {
    pushMsg('ai', '', '策划方案已生成完成！可在右侧预览，或点击"进入编辑器"精修。')
    wsState.value = 'done'
  }
  addExecutionLog(isBrainOnly ? '本轮任务已完成，可继续补充要求或进入 PPT 生成。' : '任务已完成，支持预览、编辑和保存。')
  isRunning.value = false
  waitingForClarification.value = false
  failedReason.value = ''
  failedStage.value = ''
  // resolve 由 connectSSE 的 done 监听器调用
}

async function triggerPptBuild({ content: editedHtml } = {}) {
  if (!currentSessionId.value) {
    Message.error('当前会话不存在，请重新开始')
    return
  }

  isRunning.value = true
  isBuilding.value = false
  wsState.value = 'execution'
  progress.value = Math.max(progress.value, 90)
  progressLabel.value = '正在基于文档生成 PPT...'
  if (editedHtml) {
    docContent.value = editedHtml
  }

  try {
    const res = await fetch(`/api/agent/${currentSessionId.value}/build-ppt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        docContent: docContent.value,
        apiKeys: settings.apiKeys
      })
    }).then(r => r.json())

    if (!res.success) throw new Error(res.message || '启动失败')
    if (!sse || sse.readyState === EventSource.CLOSED) {
      connectBrainSSE(res.streamUrl, () => {})
    }
  } catch (err) {
    Message.error('生成 PPT 失败：' + err.message)
    isRunning.value = false
    wsState.value = 'document'
  }
}

// ── 保存 PPT ─────────────────────────────────────────────────────
const showSaveModal = ref(false)
const saveSpaceId   = ref('')
const saveName      = ref('')

// ── 产出物卡片详情 ─────────────────────────────────────────────────
const showArtifactModal = ref(false)
const selectedArtifact = ref(null)

function openArtifactModal(msg) {
  selectedArtifact.value = msg
  showArtifactModal.value = true
}

function showSaveDialog() {
  if (!spaces.value.length) {
    Message.warning('请先在文档空间创建工作空间')
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
      Message.success('已保存到文档空间')
      pushMsg('ai', '', '策划方案已保存到文档空间。')
    } else {
      Message.error(res.message || '保存失败')
    }
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

onMounted(() => {
  window.addEventListener('resize', syncPreviewWidth)
})

onUnmounted(() => {
  if (sse) sse.close()
  stopResize()
  clearTimeout(persistConversationTimer)
  clearPendingLoadingTicker()
  window.removeEventListener('resize', syncPreviewWidth)
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
  color: #475569;
  transition: background 0.2s;
}

.thinking-toggle:hover {
  background: rgba(59, 130, 246, 0.05);
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
  color: #94a3b8;
  margin-bottom: 4px;
}

.thinking-step-content {
  color: #475569;
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
  color: #64748b;
  transition: background 0.2s;
}

.tool-calls-toggle:hover {
  background: rgba(148, 163, 184, 0.1);
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
  color: #475569;
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
  color: #4b5563;
}

.tool-call-card-progress {
  font-size: 12px;
  color: #6b7280;
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
  color: #374151;
  line-height: 1.5;
}

.tool-call-card-toggle {
  margin-top: 8px;
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.04);
  color: #6b7280;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.tool-call-card-toggle:hover {
  background: rgba(0, 0, 0, 0.08);
  color: #374151;
}

.tool-call-card-details {
  margin-top: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 8px;
  font-size: 12px;
  color: #6b7280;
  overflow-x: auto;
  max-height: 280px;
  line-height: 1.6;
}

/* ── AI 消息 ── */
.ai-message-card {
  font-size: 14px;
  line-height: 1.7;
  color: #374151;
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

.ai-message-card :deep(ul) {
  margin-bottom: 8px;
  padding-left: 20px;
}

.ai-message-card :deep(li) {
  margin-bottom: 4px;
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

.clarification-question {
  font-size: 14px;
  color: #374151;
  line-height: 1.7;
  white-space: pre-wrap;
  flex: 1;
}

/* ── 产出物消息卡片 ── */
.artifact-msg-card {
  max-width: 88%;
  border: none;
  padding: 4px 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  cursor: pointer;
  transition: all 0.15s;
}

.artifact-msg-card:hover .artifact-msg-card-arrow {
  color: #3b82f6;
}

.artifact-msg-card--plan_draft,
.artifact-msg-card--review_feedback {
  background: transparent;
  border-color: transparent;
}

.artifact-msg-card-head {
  display: flex;
  align-items: center;
  gap: 7px;
}

.artifact-msg-card-icon {
  font-size: 15px;
  flex-shrink: 0;
}

.artifact-msg-card-title {
  font-size: 13px;
  font-weight: 600;
  color: #1f2937;
  flex: 1;
}

.artifact-msg-card-arrow {
  font-size: 18px;
  color: #9ca3af;
  font-weight: 300;
  margin-left: auto;
}

.artifact-msg-card:hover .artifact-msg-card-arrow {
  color: #3b82f6;
}

.artifact-msg-card-summary {
  font-size: 12.5px;
  color: #6b7280;
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
  margin-top: 2px;
}

.artifact-msg-chip {
  font-size: 11px;
  padding: 2px 8px;
  background: rgba(59, 130, 246, 0.08);
  color: rgb(var(--arcoblue-6));
  border-radius: 20px;
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
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.artifact-modal-text {
  font-size: 14px;
  color: #1f2937;
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
  background: #f8faff;
  border-radius: 8px;
  font-size: 13px;
  color: #374151;
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
  background: #f8faff;
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
  color: #1f2937;
  margin-bottom: 2px;
}

.section-points {
  font-size: 12px;
  color: #6b7280;
}

.artifact-modal-list {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  color: #374151;
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
  background: #f8faff;
  border-radius: 6px;
  font-size: 12px;
}

.page-num {
  width: 22px;
  height: 22px;
  background: #e5e7eb;
  color: #374151;
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
  color: #374151;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artifact-modal-json {
  background: #f3f4f6;
  padding: 12px;
  border-radius: 8px;
  font-size: 12px;
  color: #374151;
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
  color: #1e293b;
  margin-bottom: 4px;
}

.task-summary-subtitle {
  font-size: 13px;
  color: #64748b;
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
  background: #f8fafc;
  border-right: 1px solid rgba(15, 23, 42, 0.06);
  transition: width 0.22s ease, min-width 0.22s ease;
  overflow: hidden;
}

.chat-conversation-sidebar.collapsed {
  border-right-color: transparent;
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
  color: #86909c;
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
  color: #94a3b8;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08), inset 0 0 0 1px rgba(15, 23, 42, 0.06);
  cursor: pointer;
  transition: left 0.22s ease, background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
}

.conversation-sidebar-rail-toggle:hover {
  background: #f8fafc;
  color: #4e5969;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.1), inset 0 0 0 1px rgba(15, 23, 42, 0.08);
}

.conversation-sidebar-rail-toggle.collapsed {
  left: 8px;
}

.conversation-create-btn:hover {
  background: rgba(15, 23, 42, 0.04);
  color: #4e5969;
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
  color: #94a3b8;
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
  color: #1d2129;
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
  color: #4e5969;
}

:deep(.conversation-sidebar-head-select .arco-select-view-icon) {
  color: #b6c0cd;
}

:deep(.conversation-search .arco-input-wrapper) {
  border: none;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.78);
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.12);
  transition: background 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}

:deep(.conversation-search .arco-input-wrapper:hover),
:deep(.conversation-search .arco-input-wrapper.arco-input-focus) {
  background: rgba(255, 255, 255, 0.96);
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.22);
}

:deep(.conversation-search .arco-input) {
  font-size: 12px;
  color: #334155;
}

:deep(.conversation-search .arco-input::placeholder) {
  color: #94a3b8;
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
  color: #86909c;
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
  color: #1d2129;
}

.conversation-list-empty-desc {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: #86909c;
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
  color: #1d2129;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.conversation-pill-meta {
  font-size: 11px;
  color: #94a3b8;
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
  color: #4e5969;
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
  border: 1px solid #e5e7eb;
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
  color: #1d2129;
}

.task-hud-subtitle {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: #4e5969;
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
  color: #4e5969;
  font-size: 12px;
}

.task-hud-chip b {
  color: #86909c;
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
  color: #86909c;
}

.task-hud-log-text {
  font-size: 12px;
  line-height: 1.6;
  color: #4e5969;
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
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 20px;
  height: 36px;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #94a3b8;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  z-index: 10;
  padding: 0;
}

.panel-resizer:hover .panel-resizer-toggle,
.panel-resizer--collapsed .panel-resizer-toggle {
  opacity: 1;
}

.panel-resizer-toggle:hover {
  color: rgb(var(--arcoblue-6));
  border-color: rgba(var(--arcoblue-6), 0.4);
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
  color: #1e293b;
  font-weight: 500;
}

.bubble.ai {
  color: #374151;
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
  color: #1d2129;
}

.task-card-subtitle {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: #4e5969;
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
  border: 1px solid #e5e7eb;
  font-size: 12px;
  color: #4e5969;
}

.task-card-chip b {
  color: #86909c;
  font-weight: 700;
}

.task-card-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
  font-size: 11px;
  color: #86909c;
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
  color: #86909c;
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
  color: #1d2129;
  font-weight: 600;
}

.task-card-focus-status {
  flex-shrink: 0;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  background: #fff;
  color: #86909c;
  border: 1px solid #e5e7eb;
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
  color: #1d2129;
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
  color: #4e5969;
}

.task-card-step-status,
.task-card-log-time {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  color: #86909c;
}

.task-card-error {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 240, 240, 0.8);
  font-size: 12px;
  line-height: 1.6;
  color: #4e5969;
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
  color: #86909c;
  min-width: 54px;
}

.task-log-text {
  font-size: 12px;
  line-height: 1.6;
  color: #4e5969;
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
  color: #4e5969;
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
  color: #4e5969;
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
  color: #4e5969;
}

.pending-loading-card :deep(.chat-loading-detail) {
  font-size: 11px;
  line-height: 1.2;
  color: #86909c;
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
  border: 1px solid #e5e7eb;
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
  color: #6b7280;
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
  background: #f3f4f6;
  color: #6b7280;
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
  color: #374151;
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

.input-card {
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
  color: #1f2937;
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
  padding: 6px 10px 10px;
}

/* 发送按钮 */
.send-btn {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: #e5e7eb;
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
  background: #111827;
  color: #fff;
  cursor: pointer;
}

.send-btn--active:hover {
  background: #374151;
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
  color: #4e5969;
  font-size: 12px;
}

.exec-chip b {
  color: #86909c;
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
  color: #4e5969;
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
  color: #1d2129;
}

.preview-stage-desc {
  margin-top: 6px;
  font-size: 12.5px;
  color: #4e5969;
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
  color: #1d2129;
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
  color: #4e5969;
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
  color: #4e5969;
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
  color: #1d2129;
}

.artifact-list-item span {
  font-size: 12px;
  line-height: 1.6;
  color: #4e5969;
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
  color: #4e5969;
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
  color: #4e5969;
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
  color: #1d2129;
}

.strategy-hero-desc {
  margin-top: 10px;
  font-size: 13px;
  line-height: 1.75;
  color: #4e5969;
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
  color: #86909c;
}

.strategy-meta-card strong {
  font-size: 14px;
  line-height: 1.5;
  color: #1d2129;
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
  color: #1d2129;
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
  color: #1d2129;
}

.research-card-summary {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: #4e5969;
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
  color: #4e5969;
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
  color: #1d2129;
}

.plan-outline-desc {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: #4e5969;
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
  color: #1d2129;
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
  color: #4e5969;
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
  color: #4e5969;
  font-size: 11px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
}

.section-live-item-title {
  font-size: 13px;
  font-weight: 700;
  color: #1d2129;
}

.section-live-item-desc {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.7;
  color: #4e5969;
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
  color: #4e5969;
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
  color: #86909c;
  min-width: 54px;
}

.exec-log-text {
  font-size: 12px;
  line-height: 1.6;
  color: #4e5969;
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
  color: #4e5969;
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
  color: #86909c;
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
  color: #1d2129;
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
  color: #4e5969;
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
  color: #4e5969;
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
  color: #86909c;
}

.process-summary-text {
  font-size: 12px;
  line-height: 1.6;
  color: #4e5969;
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
  color: #1d2129;
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
  color: #86909c;
}
</style>
