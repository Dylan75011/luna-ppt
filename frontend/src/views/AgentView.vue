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
        <div
          v-for="(msg, i) in messages"
          :key="i"
          class="bubble-wrap"
          :class="msg.role"
        >
          <div class="bubble" :class="msg.role">
            <template v-if="msg.role === 'ai'">
              <template v-if="msg.kind === 'task-card'">
                <div class="task-card">
                  <div class="task-card-head">
                    <div class="task-card-title-row">
                      <span class="task-card-dot" :class="msg.taskState.status" />
                      <div class="task-card-copy">
                        <div class="task-card-title">{{ msg.taskState.title }}</div>
                        <div class="task-card-subtitle">{{ msg.taskState.subtitle }}</div>
                      </div>
                    </div>
                    <a-tag size="small" :color="msg.taskState.tagColor">{{ msg.taskState.tagText }}</a-tag>
                  </div>

                  <a-progress
                    class="task-card-progress"
                    :percent="msg.taskState.progress"
                    :show-text="false"
                    :stroke-width="6"
                  />

                  <div v-if="msg.taskState.summary?.length" class="task-card-chip-row">
                    <span v-for="item in msg.taskState.summary" :key="item.label" class="task-card-chip">
                      <b>{{ item.label }}</b>{{ item.value }}
                    </span>
                  </div>

                  <div class="task-card-meta">
                    <span>{{ msg.taskState.stageLabel }}</span>
                    <span v-if="msg.taskState.lastUpdate">{{ msg.taskState.lastUpdate }}</span>
                  </div>

                  <button class="task-card-toggle" @click="msg.taskState.expanded = !msg.taskState.expanded">
                    {{ msg.taskState.expanded ? '收起详情' : '展开详情' }}
                  </button>

                  <div v-if="msg.taskState.expanded" class="task-card-detail">
                    <div class="task-card-section">
                      <div class="task-card-section-title">执行阶段</div>
                      <div class="task-card-steps">
                        <div
                          v-for="step in msg.taskState.steps"
                          :key="step.key"
                          class="task-card-step"
                          :class="step.status"
                        >
                          <span class="task-card-step-name">{{ step.title }}</span>
                          <span class="task-card-step-status">{{ statusLabel(step.status) }}</span>
                        </div>
                      </div>
                    </div>

                    <div v-if="msg.taskState.error" class="task-card-section">
                      <div class="task-card-section-title">异常信息</div>
                      <div class="task-card-error">{{ msg.taskState.error }}</div>
                    </div>
                  </div>
                </div>
              </template>
              <template v-else-if="msg.kind === 'task-log'">
                <div class="task-log">
                  <span class="task-log-time">{{ msg.time }}</span>
                  <span class="task-log-text">{{ msg.text }}</span>
                </div>
              </template>
              <template v-else-if="msg.kind === 'task-log-group'">
                <div class="task-log-group">
                  <div class="task-log-group-head">
                    <div class="task-log-group-title">执行过程</div>
                    <button
                      v-if="msg.group.logs.length > msg.group.previewCount"
                      class="task-log-group-toggle"
                      @click="msg.group.expanded = !msg.group.expanded"
                    >
                      {{ msg.group.expanded ? '收起' : `查看全部 ${msg.group.logs.length} 条` }}
                    </button>
                  </div>
                  <div class="task-log-group-list">
                    <div
                      v-for="log in (msg.group.expanded ? msg.group.logs : msg.group.logs.slice(0, msg.group.previewCount))"
                      :key="log.id"
                      class="task-log-group-item"
                    >
                      <span class="task-log-time">{{ log.time }}</span>
                      <span class="task-log-text">{{ log.text }}</span>
                    </div>
                  </div>
                  <div
                    v-if="!msg.group.expanded && msg.group.logs.length > msg.group.previewCount"
                    class="task-log-group-foot"
                  >
                    已折叠 {{ msg.group.logs.length - msg.group.previewCount }} 条较早过程
                  </div>
                </div>
              </template>
              <template v-else>
                <span v-html="msg.html" />
              </template>
            </template>
            <template v-else>{{ msg.text }}</template>
          </div>
        </div>

        <div v-if="pendingLoading" class="bubble-wrap ai pending-loading-wrap">
          <div class="pending-loading-card" v-html="loadingMarkup(pendingLoading.label)" />
        </div>
      </div>

      <!-- 输入区 -->
      <div class="chat-input-area">

        <!-- 任务队列（仅显示等待中的，跳过正在处理的第一条） -->
        <transition name="queue-slide">
          <div v-if="taskQueue.length > 1" class="task-queue">
            <div class="queue-header">
              <icon-clock-circle class="queue-header-icon" />
              <span>待处理</span>
              <span class="queue-badge">{{ taskQueue.length - 1 }}</span>
            </div>
            <div class="queue-list">
              <div
                v-for="task in taskQueue.slice(1)"
                :key="task.id"
                class="queue-item"
                :class="task.type"
              >
                <span class="queue-item-dot waiting" />
                <span class="queue-item-type">{{ task.type === 'agent' ? '策划任务' : '对话' }}</span>
                <span class="queue-item-text">{{ task.text }}</span>
                <span class="queue-item-status">等待中</span>
              </div>
            </div>
          </div>
        </transition>

        <div class="input-card" :class="{ focused: inputFocused }">
          <!-- 文本输入 -->
          <a-textarea
            v-model="inputText"
            class="chat-textarea"
            :auto-size="{ minRows: 2, maxRows: 6 }"
            placeholder="描述活动需求，如：帮我为小米做一个大型新品发布会..."
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
              v-if="isRunning"
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
      @mousedown.prevent="startResize"
    >
      <div class="panel-resizer-line" />
    </div>

    <!-- ── 右侧：任务工作区 / 结果预览区 ── -->
    <div v-if="previewVisible" class="ws-workspace">
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
  IconUnorderedList, IconSearch, IconBulb, IconStar, IconLayers,
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

function pushMsg(role, text, html) {
  messages.value.push({
    id: createMessageId(role),
    role,
    text: text || '',
    html: html || text || '',
    createdAt: new Date().toISOString()
  })
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

function createTaskCard(task) {
  const taskCard = reactive({
    title: task.topic || '策划任务',
    subtitle: '正在启动任务...',
    status: 'running',
    progress: 0,
    tagText: '执行中',
    tagColor: 'arcoblue',
    summary: currentTaskSummary.value,
    stageLabel: '准备开始',
    lastUpdate: formatLogTime(),
    expanded: false,
    logs: [],
    steps: stepList.map(step => ({
      key: step.key,
      title: step.title,
      status: step.status
    })),
    error: ''
  })
  currentTaskCard.value = taskCard
  pushAiMessage({ kind: 'task-card', taskState: taskCard })
}

function createTaskLogGroup() {
  const logGroup = reactive({
    expanded: false,
    previewCount: 5,
    logs: []
  })
  currentTaskLogGroup.value = logGroup
  pushAiMessage({ kind: 'task-log-group', group: logGroup })
}

function syncTaskCard() {
  if (!currentTaskCard.value) return
  currentTaskCard.value.title = currentTask.value?.topic || '策划任务'
  currentTaskCard.value.subtitle = wsState.value === 'failed'
    ? (failedReason.value || '任务执行中断')
    : wsState.value === 'done'
      ? '结果已生成，可在右侧实时预览'
      : progressLabel.value
  currentTaskCard.value.status = wsState.value === 'failed'
    ? 'failed'
    : wsState.value === 'done'
      ? 'completed'
      : wsState.value === 'streaming'
        ? 'streaming'
        : 'running'
  currentTaskCard.value.progress = progress.value
  currentTaskCard.value.tagText = wsState.value === 'failed'
    ? '失败'
    : wsState.value === 'done'
      ? '已完成'
      : wsState.value === 'streaming'
        ? '生成中'
        : wsState.value === 'document'
          ? '待确认'
          : '执行中'
  currentTaskCard.value.tagColor = wsState.value === 'failed'
    ? 'red'
    : wsState.value === 'done'
      ? 'green'
      : wsState.value === 'document'
        ? 'orange'
        : 'arcoblue'
  currentTaskCard.value.summary = currentTaskSummary.value
  currentTaskCard.value.stageLabel = wsState.value === 'failed'
    ? `中断于 ${failedStageLabel.value}`
    : currentStageTitle.value
  currentTaskCard.value.lastUpdate = formatLogTime()
  currentTaskCard.value.error = failedReason.value
  currentTaskCard.value.steps = stepList.map(step => ({
    key: step.key,
    title: step.title,
    status: step.status
  }))
  scheduleConversationPersist()
}

// ── 工作区状态 ──────────────────────────────────────────────────
const wsState = ref('welcome') // 'welcome' | 'execution' | 'streaming' | 'done'
const progress = ref(0)
const progressLabel = ref('正在启动...')
const resultSlides  = ref([])
const resultDownloadUrl = ref('')
const resultData    = ref(null)
const previewWidth  = ref(760)
const isResizing    = ref(false)
const activePreviewTab = ref('strategy')
const currentSlideIndex = ref(0)
// 流式生成状态
const isBuilding    = ref(false)
const buildTotal    = ref(0)
// 文档确认状态
const docContent    = ref('')   // 文档 HTML 内容
const docTitle      = ref('')   // 文档标题
const currentTaskId = ref('')   // 当前任务 ID（用于 build-ppt 接口）
// SlideViewer 引用（用于调用 appendSlide）
const slideViewerRef = ref(null)
// 编辑器模式
const editorVisible = ref(false)
const currentTask = ref(null)
const currentTaskCard = ref(null)
const currentTaskLogGroup = ref(null)
const pendingIntake = ref(null)
const failedReason = ref('')
const failedStage = ref('')
const artifacts = ref([])
const executionLogs = ref([])

const previewVisible = computed(() => wsState.value !== 'welcome')

// ── Steps ────────────────────────────────────────────────────────
const stepList = reactive([
  { key: 'orchestrator', icon: IconUnorderedList, title: '需求解析',  status: 'pending', message: '', subs: [] },
  { key: 'research',     icon: IconSearch,        title: '素材搜索',  status: 'pending', message: '', subs: [] },
  { key: 'strategy',     icon: IconBulb,          title: '方案策划',  status: 'pending', message: '', subs: [] },
  { key: 'critic',       icon: IconStar,          title: '专家评审',  status: 'pending', message: '', subs: [], score: null, passed: false },
  { key: 'building',     icon: IconLayers,        title: '生成 PPT', status: 'pending', message: '', subs: [] }
])

const summarySteps = computed(() => stepList.filter(s => s.status === 'completed'))
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
const currentStage = computed(() => stepList.find(step => step.status === 'running') || null)
const currentStageTitle = computed(() => currentStage.value?.title || '准备开始任务')
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
const hasStrategyPreview = computed(() =>
  !!latestTaskBrief.value ||
  researchPreviewItems.value.length > 0 ||
  !!latestPlanDraft.value ||
  planSectionArtifacts.value.length > 0 ||
  !!latestReviewFeedback.value ||
  !!latestPptOutline.value
)
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
  return stepList.find(step => step.key === failedStage.value)?.title || failedStage.value
})
const currentPreviewHint = computed(() => {
  if (wsState.value === 'failed') {
    return '任务已中断，右侧保留当前阶段与最近产出，方便判断是配置问题还是方案质量问题。'
  }
  const stageKey = currentStage.value?.key
  const stageHints = {
    orchestrator: '正在拆解需求和搜索方向，稍后会形成任务理解与主题重点。',
    research: '正在并行收集行业趋势、竞品案例与创意素材，预览区会先展示可用方向。',
    strategy: '正在组织策划方案结构，接下来会进入方案草稿与目录生成。',
    critic: '正在评审当前方案质量，系统会根据反馈自动决定是否继续优化。',
    building: '正在把方案转换成 PPT 页面，新的页面会在这里逐张出现。'
  }
  return stageHints[stageKey] || '系统正在准备可预览的中间产出。'
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

const STAGE_PROGRESS = { orchestrator: 15, research: 40, strategy: 65, critic: 80, building: 95 }
const researchSummaryLogged = ref(false)

function resetSteps() {
  stepList.forEach(s => {
    s.status = 'pending'; s.message = ''; s.subs = []
    if ('score' in s) { s.score = null; s.passed = false }
  })
  progress.value = 0
  progressLabel.value = '正在启动...'
  // 重置流式状态，避免第二次任务时显示上一次残留
  isBuilding.value = false
  buildTotal.value  = 0
  resultSlides.value      = []
  resultDownloadUrl.value = ''
  resultData.value        = null
  failedReason.value = ''
  failedStage.value = ''
  artifacts.value = []
  executionLogs.value = []
  currentTaskLogGroup.value = null
  researchSummaryLogged.value = false
  docContent.value = ''
  docTitle.value   = ''
}

function defaultStepMessage(step) {
  const messages = {
    orchestrator: '系统会先判断需求重点，并拆成可执行的搜索与策划任务。',
    research: '多个搜索 Agent 会并行补齐趋势、案例和创意参考。',
    strategy: '系统会把素材整合成活动主线、目录和每页内容框架。',
    critic: '评审 Agent 会检查创意、完整度和落地性，必要时触发重写。',
    building: '通过评审后开始生成 PPT 页面，并在右侧实时展示。'
  }
  return messages[step.key] || '正在处理中...'
}

function statusLabel(s) {
  return { pending: '等待中', running: '进行中', completed: '完成', failed: '失败' }[s] || s
}

function statusColor(s) {
  return { pending: 'gray', running: 'blue', completed: 'green', failed: 'red' }[s] || 'gray'
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

function formatLogTime(ts = Date.now()) {
  const date = new Date(ts)
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function addExecutionLog(text, ts = Date.now()) {
  const log = {
    id: `${ts}_${Math.random().toString(16).slice(2, 8)}`,
    time: formatLogTime(ts),
    text
  }
  executionLogs.value.unshift(log)
  executionLogs.value = executionLogs.value.slice(0, 24)
  if (currentTaskCard.value) {
    currentTaskCard.value.logs.unshift(log)
    currentTaskCard.value.logs = currentTaskCard.value.logs.slice(0, 12)
  }
  if (currentTaskLogGroup.value) {
    currentTaskLogGroup.value.logs.unshift(log)
    currentTaskLogGroup.value.logs = currentTaskLogGroup.value.logs.slice(0, 24)
    if (currentTaskLogGroup.value.logs.length > 10 && currentTaskLogGroup.value.expanded) {
      currentTaskLogGroup.value.expanded = false
    }
  }
  syncTaskCard()
  scheduleConversationPersist()
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
    currentTaskId: currentTaskId.value,
    currentTask: currentTask.value,
    failedReason: failedReason.value,
    failedStage: failedStage.value,
    artifacts: artifacts.value,
    executionLogs: executionLogs.value,
    stepList: stepList.map(step => ({
      key: step.key,
      status: step.status,
      message: step.message,
      subs: step.subs,
      score: step.score,
      passed: step.passed
    }))
  }
}

function serializeMessages() {
  return messages.value.map((msg) => ({
    id: msg.id || createMessageId('msg'),
    role: msg.role,
    text: msg.text || '',
    html: msg.html || '',
    kind: msg.kind || '',
    time: msg.time || '',
    createdAt: msg.createdAt || new Date().toISOString(),
    taskState: msg.taskState ? JSON.parse(JSON.stringify(msg.taskState)) : null,
    group: msg.group ? JSON.parse(JSON.stringify(msg.group)) : null
  }))
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

  const restoredStepMap = new Map((state.stepList || []).map(item => [item.key, item]))
  stepList.forEach(step => {
    const restored = restoredStepMap.get(step.key)
    step.status = restored?.status || 'pending'
    step.message = restored?.message || ''
    step.subs = restored?.subs || []
    if ('score' in step) {
      step.score = restored?.score ?? null
      step.passed = !!restored?.passed
    }
  })

  currentTask.value = state.currentTask || null
  currentTaskId.value = state.currentTaskId || ''
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
  if (['execution', 'streaming', 'document'].includes(savedWsState) && !failedReason.value) {
    failedReason.value = '这是一次已恢复的历史会话，原任务执行过程不会自动继续。'
  }

  const lastTaskCardMsg = [...messages.value].reverse().find(msg => msg.kind === 'task-card')
  currentTaskCard.value = lastTaskCardMsg?.taskState || null
  const lastTaskLogGroupMsg = [...messages.value].reverse().find(msg => msg.kind === 'task-log-group')
  currentTaskLogGroup.value = lastTaskLogGroupMsg?.group || null
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
  currentTaskId.value = ''
  currentTaskCard.value = null
  currentTaskLogGroup.value = null
  pendingIntake.value = null
  pendingLoading.value = null
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

// ── AI 需求解析 ──────────────────────────────────────────────────
async function parseTaskWithAI(text, draft = {}, round = 0) {
  const response = await fetch('/api/ai/parse-task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      draft,
      round,
      apiKeys: settings.apiKeys
    })
  })

  let res
  try {
    res = await response.json()
  } catch (err) {
    console.error('[parse-task] invalid json', { status: response.status, err })
    throw new Error(`需求解析接口返回异常（${response.status}）`)
  }

  if (!response.ok || !res.success) {
    console.error('[parse-task] request failed', { status: response.status, response: res })
    const error = new Error(res.error || `需求解析失败（${response.status}）`)
    error.code = res.code || ''
    throw error
  }

  return {
    taskIntent: !!res.taskIntent,
    decisionMode: res.decisionMode || (res.ready ? 'proceed' : 'clarify'),
    confidence: Number(res.confidence || 0),
    parsed: {
      ...(res.parsed || {}),
      assumptions: Array.isArray(res.assumptions) ? res.assumptions : []
    },
    missing: Array.isArray(res.missing) ? res.missing : [],
    ready: !!res.ready
  }
}

function missingFieldLabel(field) {
  return {
    brand: '品牌 / 项目名称',
    productCategory: '产品类别',
    eventType: '活动类型',
    scale: '活动规模',
    budget: '预算区间'
  }[field] || field
}

async function generateIntakeMessage(mode, parsed, missing = [], round = 1, maxRounds = 3) {
  const response = await fetch('/api/ai/intake-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode,
      parsed,
      missing,
      round,
      maxRounds,
      apiKeys: settings.apiKeys
    })
  })

  let res
  try {
    res = await response.json()
  } catch (err) {
    console.error('[intake-message] invalid json', { mode, status: response.status, err })
    throw new Error(`接口返回异常（${response.status}）`)
  }

  if (!response.ok) {
    console.error('[intake-message] request failed', {
      mode,
      status: response.status,
      response: res
    })
    const error = new Error(res.error || `接口请求失败（${response.status}）`)
    error.code = res.code || ''
    throw error
  }

  if (res.success && res.reply) return res.reply
  console.error('[intake-message] empty reply', { mode, response: res })
  {
    const error = new Error(res.error || '需求确认话术生成失败')
    error.code = res.code || ''
    throw error
  }
}

async function summarizeSpaceContext(spaceId) {
  const response = await fetch('/api/ai/space-context-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      spaceId,
      apiKeys: settings.apiKeys
    })
  })

  let res
  try {
    res = await response.json()
  } catch (err) {
    console.error('[space-context-summary] invalid json', { status: response.status, err })
    throw new Error(`空间内容接口返回异常（${response.status}）`)
  }

  if (!response.ok || !res.success) {
    const error = new Error(res.error || `空间内容总结失败（${response.status}）`)
    error.code = res.code || ''
    throw error
  }

  return res
}

function humanizeIntakeError(errorLike = '', mode = 'clarify') {
  const code = errorLike?.code || ''
  const message = errorLike?.message || String(errorLike || '')

  if (code === 'MINIMAX_KEY_MISSING' || /MINIMAX_API_KEY 未配置/.test(message)) {
    return '我这边还没拿到可用的 MiniMax Key，先去配置中心补一下，就能继续需求确认。'
  }
  if (code === 'MINIMAX_AUTH_FAILED' || /401|login fail|Authorization|API secret key/i.test(message)) {
    return '我这边调用确认话术时鉴权失败了，通常是 MiniMax Key 无效、过期，或没填完整。去配置中心更新一下就能继续。'
  }
  if (code === 'MODEL_EMPTY' || /模型返回为空/.test(message)) {
    return mode === 'clarify'
      ? '我刚才没拿到有效的确认话术，麻烦你再发一次，我这边重新确认。'
      : '我刚才没拿到有效的启动确认话术，麻烦你再发一次，我这边重新启动。'
  }
  if (code === 'MODEL_REPLY_INVALID') {
    return '我刚才组织这句确认话时不够稳定，麻烦你再发一次，我这边换一种更稳的方式确认。'
  }
  if (code === 'UPSTREAM_NETWORK_ERROR' || /接口请求失败|接口返回异常/.test(message)) {
    return '我这边的确认接口刚才没有正常返回，你稍等一下再试一次。'
  }
  if (/Failed to fetch|NetworkError|网络/.test(message)) {
    return '我这边和服务的连接刚才断了一下，你稍后再发一次就好。'
  }
  return mode === 'clarify'
    ? `我刚才在整理需求确认时出了点问题：${message}`
    : `我刚才在生成启动确认时出了点问题：${message}`
}

function humanizeParseError(errorLike = '') {
  const code = errorLike?.code || ''
  const message = errorLike?.message || String(errorLike || '')

  if (code === 'MINIMAX_KEY_MISSING' || /MINIMAX_API_KEY 未配置/.test(message)) {
    return '我这边还没拿到可用的 MiniMax Key，先去配置中心补一下，才能帮你判断和整理需求。'
  }
  if (code === 'MINIMAX_AUTH_FAILED' || /401|login fail|Authorization|API secret key/i.test(message)) {
    return '我这边在理解需求时鉴权失败了，通常是 MiniMax Key 无效、过期，或没填完整。去配置中心更新一下就能继续。'
  }
  if (code === 'PARSE_JSON_INVALID' || code === 'PARSE_RESULT_UNSTABLE' || /JSON/.test(message)) {
    return '我刚才在整理这条需求时结果有点飘，我先按当前信息重新收一下。'
  }
  if (code === 'UPSTREAM_NETWORK_ERROR' || /接口请求失败|接口返回异常|需求解析失败/.test(message)) {
    return '我这边的需求解析接口刚才没有正常返回，你稍等一下再试一次。'
  }
  if (/Failed to fetch|NetworkError|网络/.test(message)) {
    return '我这边和服务的连接刚才断了一下，你稍后再发一次就好。'
  }
  return `我刚才在理解这条需求时出了点问题：${message}`
}

function maybeSuggestSettings(errorLike = '') {
  const code = errorLike?.code || ''
  const message = errorLike?.message || String(errorLike || '')
  if (code === 'MINIMAX_AUTH_FAILED' || code === 'MINIMAX_KEY_MISSING' || /401|login fail|Authorization|API secret key|MINIMAX_API_KEY/i.test(message)) {
    return ' 你可以先去配置中心更新 MiniMax Key。'
  }
  return ''
}

function loadingMarkup(label = '正在思考', detail = '') {
  return `<span class="chat-loading"><span class="chat-loading-orb"></span><span class="chat-loading-copy"><span class="chat-loading-text">${label}</span>${detail ? `<span class="chat-loading-detail">${detail}</span>` : ''}<span class="chat-loading-bar"><span class="chat-loading-bar-inner"></span></span></span></span>`
}

let pendingLoadingTicker = null
let pendingLoadingStartedAt = 0

function clearPendingLoadingTicker() {
  if (pendingLoadingTicker) {
    clearInterval(pendingLoadingTicker)
    pendingLoadingTicker = null
  }
}

function showPendingLoading(label = '正在思考', stages = []) {
  clearPendingLoadingTicker()
  pendingLoadingStartedAt = Date.now()
  pendingLoading.value = { label, detail: '' }

  if (!stages.length) return

  let idx = 0
  pendingLoadingTicker = setInterval(() => {
    idx = Math.min(idx + 1, stages.length - 1)
    const elapsed = Math.floor((Date.now() - pendingLoadingStartedAt) / 1000)
    pendingLoading.value = {
      label: stages[idx],
      detail: elapsed >= 6 ? `已等待 ${elapsed}s，正在继续处理` : ''
    }
  }, 1400)
}

function updatePendingLoading(label = '正在思考', detail = '') {
  pendingLoading.value = { label, detail }
}

async function resolvePendingLoading(text) {
  clearPendingLoadingTicker()
  pendingLoading.value = null
  pushMsg('ai', '', text)
  await nextTick()
  if (historyRef.value) historyRef.value.scrollTop = historyRef.value.scrollHeight
}

// ── 任务队列 ─────────────────────────────────────────────────────
const taskQueue  = ref([])   // { id, type:'chat'|'agent', text, msgIdx }
let   isBusy     = false     // 普通变量即可，JS 单线程保证同步读写安全
let   sse        = null      // SSE 连接实例（必须声明，防止全局污染）
let   resolveCurrent = null  // 当前 agent 任务的 resolve，用于外部终止
const IDEAL_INTAKE_ROUNDS = 2
const MAX_INTAKE_ROUNDS = 3
const pendingLoading = ref(null)

// 发送：消息立即显示，加入队列排队处理
async function send() {
  const text = inputText.value.trim()
  if (!text) return
  inputText.value = ''

  const conversationId = await ensureActiveConversation(text.slice(0, 24))
  if (!conversationId) {
    inputText.value = text
    return
  }

  // 消息立即出现在聊天区
  pushMsg('user', text)

  showPendingLoading('正在理解需求', ['正在理解需求', '正在提取关键信息', '正在判断是否直接推进'])
  await nextTick()
  if (historyRef.value) historyRef.value.scrollTop = historyRef.value.scrollHeight

  let parseResult
  const intakeRound = pendingIntake.value?.round || 0
  try {
    parseResult = await parseTaskWithAI(text, pendingIntake.value?.draft || {}, intakeRound)
  } catch (err) {
    await resolvePendingLoading(humanizeParseError(err) + maybeSuggestSettings(err))
    return
  }

  if (parseResult.taskIntent) {
    const candidateTask = parseResult.parsed
    const nextRound = intakeRound + 1
    const shouldProceed = parseResult.ready || parseResult.decisionMode === 'proceed'

    if (!shouldProceed) {
      pendingIntake.value = {
        draft: candidateTask,
        missing: parseResult.missing,
        round: nextRound
      }
      try {
        const reply = await generateIntakeMessage('clarify', candidateTask, parseResult.missing, nextRound, MAX_INTAKE_ROUNDS)
        await resolvePendingLoading(reply)
      } catch (err) {
        await resolvePendingLoading(
          humanizeIntakeError(err, 'clarify') + maybeSuggestSettings(err)
        )
      }
      return
    }

    pendingIntake.value = null
    clearPendingLoadingTicker()
    pendingLoading.value = null
    {
      pushMsg('ai', '', selectedSpaceId.value
        ? '我先快速看一下这个空间的索引和已有内容，也顺手把平台沉淀下来的经验过一遍，先把上下文对齐。'
        : '我先把平台这边沉淀下来的经验过一遍；如果当前空间里没有额外上下文，我就按这次需求本身往下推进。')
      showPendingLoading('正在读取空间内容', ['正在读取空间内容', '正在整理已有文档', '正在提炼可用上下文'])
      try {
        const contextRes = await summarizeSpaceContext(selectedSpaceId.value || '')
        clearPendingLoadingTicker()
        pendingLoading.value = null
        if (contextRes.hasContext) {
          candidateTask.spaceId = selectedSpaceId.value
          candidateTask.spaceContextSummary = contextRes.summary || ''
          candidateTask.spaceContextKeyPoints = contextRes.keyPoints || []
          candidateTask.spaceContextDocs = contextRes.docs || []
          if (contextRes.userConclusion) {
            pushMsg('ai', '', contextRes.userConclusion)
          }
        } else {
          candidateTask.spaceId = selectedSpaceId.value
          pushMsg('ai', '', contextRes.userConclusion || '我看过了，这个空间里暂时没有能直接影响这次判断的有效内容，我就按这次需求本身往下推进。')
        }
      } catch (err) {
        clearPendingLoadingTicker()
        pendingLoading.value = null
        candidateTask.spaceId = selectedSpaceId.value
        pushMsg('ai', '', '我刚才想先回看一下空间里的内容，但这一步没有顺利拿到结果，我先按当前需求继续往下推进。')
      }
    }
    candidateTask.spaceId = selectedSpaceId.value || ''

    updatePendingLoading('正在整理 brief', '')
    await nextTick()
    if (historyRef.value) historyRef.value.scrollTop = historyRef.value.scrollHeight
    try {
      const reply = await generateIntakeMessage('kickoff', candidateTask, [], Math.min(nextRound, MAX_INTAKE_ROUNDS), MAX_INTAKE_ROUNDS)
      await resolvePendingLoading(reply)
    } catch (err) {
      await resolvePendingLoading(
        humanizeIntakeError(err, 'kickoff') + maybeSuggestSettings(err)
      )
      pendingIntake.value = {
        draft: candidateTask,
        missing: parseResult.missing,
        round: Math.min(nextRound, MAX_INTAKE_ROUNDS)
      }
      return
    }
    taskQueue.value.push({
      id: Date.now() + Math.random(),
      type: 'agent',
      text: candidateTask.requirements,
      parsed: candidateTask,
      msgIdx: null
    })

    if (!isBusy) processQueue()
    return
  }

  // 加入闲聊队列，复用当前 loading 气泡
  taskQueue.value.push({
    id:     Date.now() + Math.random(),
    type:   'chat',
    text,
    parsed: null,
    msgIdx: null
  })

  // 若空闲则立刻开始处理
  if (!isBusy) processQueue()
}

function enqueueAgentTask(text) {
  inputText.value = text
  send()
}

function retryCurrentTask() {
  const parsed = currentTask.value
  const text = parsed?.requirements
  if (!text || isBusy) return
  pushMsg('user', text)
  taskQueue.value.push({
    id: Date.now() + Math.random(),
    type: 'agent',
    text,
    parsed: { ...parsed },
    msgIdx: null
  })
  if (!isBusy) processQueue()
}

function restoreTaskToInput() {
  if (currentTask.value?.requirements) {
    inputText.value = currentTask.value.requirements
  }
}

// 队列处理器：while 循环顺序执行，避免递归堆栈风险
async function processQueue() {
  if (isBusy) return   // 已有循环在跑，直接返回
  isBusy = true

  while (taskQueue.value.length > 0) {
    const task = taskQueue.value[0]
    try {
      if (task.type === 'chat') {
        await runChatTask(task)
      } else {
        await runAgentTask(task)
      }
    } catch (e) {
      console.error('[Queue] task error:', e)
    }
    taskQueue.value.shift()
  }

  isBusy = false
}

// ── 终止当前任务 ───────────────────────────────────────────────────
function stopTask() {
  if (sse) { sse.close(); sse = null }
  // 清空等待队列（终止后续排队任务）
  taskQueue.value = []
  isBusy = false
  isRunning.value  = false
  isBuilding.value = false
  // resolve 挂起的 Promise，让队列处理器正常退出
  if (resolveCurrent) { resolveCurrent(); resolveCurrent = null }
  pushMsg('ai', '', '已终止当前任务。')
}

// ── 闲聊任务 ──────────────────────────────────────────────────────
async function runChatTask(task) {
  showPendingLoading('正在思考')
  await nextTick()
  if (historyRef.value) historyRef.value.scrollTop = historyRef.value.scrollHeight

  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: task.text,
        history: messages.value.filter(m => m.text).map(m => ({ role: m.role, text: m.text })),
        apiKeys: settings.apiKeys
      })
    }).then(r => r.json())

    await resolvePendingLoading(res.reply || '抱歉，我没有理解你的意思。')
  } catch {
    await resolvePendingLoading('网络错误，请稍后重试。')
  }

  await nextTick()
  if (historyRef.value) historyRef.value.scrollTop = historyRef.value.scrollHeight
}

// ── Agent 策划任务 ────────────────────────────────────────────────
async function runAgentTask(task) {
  const parsed = task.parsed
  if (!parsed) throw new Error('缺少结构化任务信息，无法启动策划任务')
  currentTask.value = parsed
  wsState.value = 'execution'
  resetSteps()
  createTaskCard(parsed)
  createTaskLogGroup()
  syncTaskCard()
  isRunning.value = true
  addExecutionLog(`项目简报确认完成，开始处理「${parsed.topic || parsed.requirements.slice(0, 18)}」`)

  return new Promise(resolve => {
    // 超时保护：30 分钟后强制 resolve，防止队列永久卡住
    const timeoutId = setTimeout(() => {
      if (sse) { sse.close(); sse = null }
      failedReason.value = '任务执行超时，系统已自动中止。'
      failedStage.value = stepList.find(step => step.status === 'running')?.key || failedStage.value
      pushMsg('ai', '', failedReason.value)
      addExecutionLog(failedReason.value)
      isRunning.value = false
      isBuilding.value = false
      wsState.value = 'failed'
      resolve()
    }, 30 * 60 * 1000)

    const done = () => { clearTimeout(timeoutId); resolveCurrent = null; resolve() }
    resolveCurrent = done

    fetch('/api/multi-agent/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...parsed, apiKeys: settings.apiKeys })
    }).then(r => r.json()).then(res => {
      if (!res.success) throw new Error(res.message || '启动失败')
      currentTaskId.value = res.taskId
      connectSSE(res.streamUrl, done)
    }).catch(err => {
      pushMsg('ai', '', `启动失败：${err.message}`)
      const s = stepList.find(s => s.key === 'orchestrator')
      if (s) s.status = 'failed'
      isRunning.value = false
      failedReason.value = err.message
      failedStage.value = 'orchestrator'
      progressLabel.value = '任务启动失败'
      wsState.value = 'failed'
      addExecutionLog(`任务启动失败：${err.message}`)
      done()
    })
  })
}

function connectSSE(url, resolve = () => {}) {
  if (sse) sse.close()
  sse = new EventSource(url)

  sse.addEventListener('progress', e => handleProgress(JSON.parse(e.data)))
  sse.addEventListener('artifact', e => handleArtifact(JSON.parse(e.data)))
  sse.addEventListener('slide_added', e => handleSlideAdded(JSON.parse(e.data)))
  sse.addEventListener('doc_ready', e => handleDocReady(JSON.parse(e.data)))
  sse.addEventListener('done', e => {
    handleDone(JSON.parse(e.data))
    sse.close()
    resolve()
  })
  sse.addEventListener('error', e => {
    if (e.data) {
      try {
        const d = JSON.parse(e.data)
        failedReason.value = d.message || '生成失败'
        failedStage.value = d.stage || failedStage.value
        pushMsg('ai', '', failedReason.value)
        addExecutionLog(`任务失败：${failedReason.value}`, d.timestamp || Date.now())
      } catch {}
    } else if (!failedReason.value) {
      failedReason.value = '任务连接中断，请稍后重试。'
      addExecutionLog(failedReason.value)
    }
    sse.close()
    isRunning.value  = false
    isBuilding.value = false
    if (wsState.value !== 'done') {
      progressLabel.value = '任务执行失败'
      wsState.value = 'failed'
    }
    resolve()
  })
}

function handleProgress(d) {
  const { stage, agentId, status, message, score, passed, round, timestamp } = d
  const step = stepList.find(s => s.key === stage)
  if (!step) return

  // Map status
  const mapped = status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'running'
  step.status  = mapped
  if (message) step.message = message
  if (stage === 'critic' && score != null) { step.score = score; step.passed = passed }

  // Research sub-agents
  if (stage === 'research' && agentId) {
    const idx = parseInt(agentId.split('-')[1] || '1', 10) - 1
    if (!step.subs[idx]) step.subs[idx] = { label: `搜索 Agent ${idx + 1}`, done: false }
    step.subs[idx].done = status === 'completed'
  }

  // Progress
  if (status === 'completed' && STAGE_PROGRESS[stage]) {
    progress.value = STAGE_PROGRESS[stage]
    progressLabel.value = `${step.title}完成`
  } else if (status === 'running') {
    progressLabel.value = `正在${step.title}...`
  }

  if (stage === 'research' && status === 'running' && !researchSummaryLogged.value) {
    researchSummaryLogged.value = true
    addExecutionLog('已启动并行搜索，正在同步收集趋势、案例和玩法。', timestamp || Date.now())
    return
  }

  if (stage === 'research' && agentId) {
    const doneCount = step.subs.filter(Boolean).filter(item => item.done).length
    const totalCount = step.subs.filter(Boolean).length || 3
    if (status === 'completed' && doneCount === totalCount) {
      addExecutionLog(`并行搜索已完成，收回 ${doneCount} 个方向的发现，开始汇总。`, timestamp || Date.now())
    }
    return
  }

  const stageName = step.title
  let logText = message || `${stageName}${status === 'completed' ? '完成' : status === 'failed' ? '失败' : '开始'}`
  if (stage === 'critic' && score != null) {
    logText = `第 ${round || 1} 轮评审完成，得分 ${score}${passed ? '，通过' : '，继续优化'}`
  }
  if (stage === 'orchestrator' && status === 'completed') return
  addExecutionLog(logText, timestamp || Date.now())
}

function handleArtifact(d) {
  artifacts.value.unshift({
    id: `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    artifactType: d.artifactType,
    payload: d.payload || {}
  })
  if (d.artifactType === 'ppt_page') return
  addExecutionLog(`${artifactTypeLabel(d.artifactType)}已更新：${artifactTimelineText({ artifactType: d.artifactType, payload: d.payload || {} })}`, d.timestamp || Date.now())
}

function handleDocReady(d) {
  docContent.value = d.docHtml || ''
  docTitle.value   = d.title   || '策划方案'
  progress.value   = 90
  progressLabel.value = '策划文档已生成，等待确认'
  wsState.value    = 'document'
  isRunning.value  = false
  syncTaskCard()
  addExecutionLog('策划文档已生成，请在右侧查看并确认后生成 PPT。')
  pushMsg('ai', '', `策划文档已生成！请在右侧查看「${d.title}」，确认无误后点击「生成 PPT」。`)
  // 注意：SSE 连接保持打开，等待 slide_added / done 事件
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
  progress.value = 100
  progressLabel.value = '策划方案生成完成！'
  stepList.forEach(s => { if (s.status !== 'failed') s.status = 'completed' })

  isBuilding.value = false
  resultSlides.value       = d.previewSlides || []
  resultDownloadUrl.value  = d.downloadUrl   || ''
  resultData.value         = d
  if (d.previewData?.title && currentTask.value) {
    currentTask.value = { ...currentTask.value, topic: d.previewData.title }
  }

  pushMsg('ai', '', '策划方案已生成完成！可在右侧预览，或点击"进入编辑器"精修。')
  wsState.value   = 'done'
  syncTaskCard()
  addExecutionLog('任务已完成，支持预览、编辑和保存。')
  isRunning.value = false
  failedReason.value = ''
  failedStage.value = ''
  // resolve 由 connectSSE 的 done 监听器调用
}

async function triggerPptBuild({ content: editedHtml } = {}) {
  if (!currentTaskId.value) {
    Message.error('任务 ID 丢失，请重新生成')
    return
  }
  isRunning.value  = true
  isBuilding.value = false
  wsState.value    = 'execution'
  progress.value   = 90
  progressLabel.value = '正在生成 PPT...'

  try {
    const res = await fetch(`/api/multi-agent/${currentTaskId.value}/build-ppt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docContent: editedHtml })
    }).then(r => r.json())

    if (!res.success) throw new Error(res.message || '启动失败')
    // SSE 连接已经开着，slide_added 事件会自动被现有监听器处理
    // 但如果 SSE 断开了，需要重连
    if (!sse || sse.readyState === EventSource.CLOSED) {
      connectSSE(res.streamUrl, () => {})
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
  syncTaskCard()
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

.chat-history {
  flex: 1;
  overflow-y: auto;
  width: 100%;
  max-width: 720px;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 气泡 */
.bubble-wrap {
  display: flex;
}
.bubble-wrap.user { justify-content: flex-end; }
.bubble-wrap.ai   { justify-content: flex-start; }

.bubble {
  max-width: 86%;
  padding: 9px 13px;
  border-radius: 14px;
  font-size: 13px;
  line-height: 1.55;
  word-break: break-word;
}

.bubble.user {
  background: rgb(var(--arcoblue-6));
  color: #fff;
  border-bottom-right-radius: 4px;
}

.bubble.ai {
  background: var(--color-fill-2);
  color: var(--color-text-1);
  border-bottom-left-radius: 4px;
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
  border: 1px solid #e5e7eb;
}

.task-card-step.pending { opacity: 0.55; }
.task-card-step.running { border-color: rgba(var(--arcoblue-6), 0.28); background: rgba(var(--arcoblue-1), 0.6); }
.task-card-step.completed { border-color: rgba(var(--green-6), 0.24); }
.task-card-step.failed { border-color: rgba(var(--red-6), 0.24); background: rgba(var(--red-1), 0.6); }

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
  background: #fff4f4;
  border: 1px solid rgba(var(--red-6), 0.16);
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

.task-log-group {
  min-width: 320px;
}

.task-log-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.task-log-group-title {
  font-size: 13px;
  font-weight: 700;
  color: #1d2129;
}

.task-log-group-toggle {
  border: none;
  background: transparent;
  padding: 0;
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--arcoblue-6));
  cursor: pointer;
}

.task-log-group-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.task-log-group-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.72);
}

.task-log-group-foot {
  margin-top: 10px;
  font-size: 11px;
  color: #86909c;
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
  border: 1px solid var(--color-border);
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
  border: 1px solid #edf1f7;
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
  border: 1px solid #edf1f7;
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
  border: 1px solid #edf1f7;
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
  background: #fbfcff;
  border: 1px solid #edf1f7;
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
  border: 1px solid #edf1f7;
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
  border: 1px solid #edf1f7;
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
  border-color: rgba(var(--orange-6), 0.16);
  background: linear-gradient(180deg, #fffaf3 0%, #ffffff 100%);
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
  background: rgba(var(--arcoblue-1), 0.68);
  border: 1px solid rgba(var(--arcoblue-6), 0.12);
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
  border: 1px solid #edf1f7;
}

.section-live-item.active {
  border-color: rgba(var(--arcoblue-6), 0.22);
  box-shadow: 0 0 0 3px rgba(var(--arcoblue-6), 0.08);
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
</style>
