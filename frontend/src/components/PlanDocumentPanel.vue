<template>
  <div class="doc-panel">
    <div class="doc-header">
      <div class="doc-header-left">
        <div class="doc-title-row">
          <span class="doc-badge">策划文档</span>
          <span class="doc-title">{{ title }}</span>
          <span v-if="loading" class="doc-status">整理中</span>
        </div>
        <div class="doc-subtitle">
          {{ loading ? '文档内容正在按章节逐步整理，右侧会持续更新。' : '先在对话里确认这版方案是否满意，右侧只用来查看和核对内容。' }}
        </div>
      </div>
      <div class="doc-header-actions">
        <button
          v-if="!loading"
          class="review-btn"
          title="让 AI 专家对方案质量打分评审"
          @click="$emit('review')"
        >评审</button>
      </div>
    </div>

    <div class="doc-body">
      <NotionEditor v-model="localContent" :auto-scroll="loading" />
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import NotionEditor from './NotionEditor.vue'

const props = defineProps({
  content:  { type: [String, Object],  default: '' },
  title:    { type: String,  default: '策划方案' },
  spaces:   { type: Array,   default: () => [] },
  loading:  { type: Boolean, default: false }
})

const emit = defineEmits(['review'])

const localContent = ref(props.content)

watch(() => props.content, v => {
  localContent.value = v || ''
})
</script>

<style scoped>
.doc-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.08), transparent 34%),
    linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
}

.doc-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 24px 14px;
  border-bottom: 1px solid #f0f0f0;
  flex-shrink: 0;
}

.doc-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.doc-badge {
  font-size: 11px;
  font-weight: 600;
  color: rgb(var(--arcoblue-6));
  background: rgb(var(--arcoblue-1));
  padding: 2px 8px;
  border-radius: 4px;
  letter-spacing: 0.02em;
}

.doc-title {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 320px;
}

.doc-status {
  font-size: 11px;
  font-weight: 700;
  color: rgb(var(--orange-6));
  background: rgba(var(--orange-6), 0.12);
  padding: 2px 8px;
  border-radius: 999px;
}

.doc-subtitle {
  font-size: 12px;
  color: #6b7280;
}

.doc-header-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.review-btn {
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--arcoblue-6));
  background: rgb(var(--arcoblue-1));
  border: 1px solid rgb(var(--arcoblue-3));
  border-radius: 6px;
  padding: 4px 12px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  white-space: nowrap;
}

.review-btn:hover {
  background: rgb(var(--arcoblue-2));
  border-color: rgb(var(--arcoblue-5));
}

.doc-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px;
}

/* ╔════════════════════════════════════════════╗
   ║  CINEMA THEME OVERRIDES                     ║
   ╚════════════════════════════════════════════╝ */

.doc-panel {
  background:
    radial-gradient(800px 400px at 100% 0%, var(--accent-soft), transparent 60%),
    linear-gradient(180deg, var(--bg-stage) 0%, var(--bg-stage-2) 100%);
  color: var(--ink);
}

.doc-header {
  border-bottom: 1px solid var(--line);
}
.doc-badge {
  background: var(--accent-soft);
  color: var(--accent);
  border: 1px solid var(--accent-line);
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  border-radius: var(--radius-sm);
  padding: 3px 8px;
}
.doc-title {
  color: var(--ink-strong);
  font-family: var(--font-serif);
  font-weight: 400;
  font-size: 18px;
  letter-spacing: -0.015em;
}
.doc-status {
  background: var(--warn-soft);
  color: var(--warn);
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  border-radius: var(--radius-sm);
}
.doc-subtitle {
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
}

.review-btn {
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--line-strong);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  border-radius: var(--radius-sm);
  padding: 6px 14px;
}
.review-btn:hover {
  background: var(--bg-card-hover);
  border-color: var(--accent);
  color: var(--accent);
}
</style>
