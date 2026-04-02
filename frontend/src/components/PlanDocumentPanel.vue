<template>
  <div class="doc-panel">
    <!-- 顶部操作栏 -->
    <div class="doc-header">
      <div class="doc-header-left">
        <div class="doc-title-row">
          <span class="doc-badge">策划文档</span>
          <span class="doc-title">{{ title }}</span>
        </div>
        <div class="doc-subtitle">AI 已生成策划文档，可直接编辑后生成 PPT</div>
      </div>
      <div class="doc-header-actions">
        <a-button size="small" @click="showSave = true">
          <template #icon><icon-save /></template>
          保存到空间
        </a-button>
        <a-button type="primary" size="small" :loading="props.loading" @click="handleGenerate">
          <template #icon><icon-play-arrow /></template>
          {{ props.loading ? '生成中...' : '生成 PPT' }}
        </a-button>
      </div>
    </div>

    <!-- 文档编辑区 -->
    <div class="doc-body">
      <NotionEditor v-model="localContent" />
    </div>

    <!-- 保存对话框 -->
    <a-modal
      v-model:visible="showSave"
      title="保存策划文档到工作空间"
      @ok="doSave"
      @cancel="showSave = false"
      :ok-loading="saving"
    >
      <a-form layout="vertical">
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
import { ref, watch } from 'vue'
import { Message } from '@arco-design/web-vue'
import { IconSave, IconPlayArrow } from '@arco-design/web-vue/es/icon'
import NotionEditor from './NotionEditor.vue'
import { workspaceApi } from '../api/workspace.js'

const props = defineProps({
  content:  { type: String,  default: '' },
  title:    { type: String,  default: '策划方案' },
  spaces:   { type: Array,   default: () => [] },
  loading:  { type: Boolean, default: false }
})

const emit = defineEmits(['generate-ppt', 'saved'])

// 本地内容副本（用户可编辑）
const localContent = ref(props.content)
watch(() => props.content, v => { if (v && !localContent.value) localContent.value = v })

function handleGenerate() {
  emit('generate-ppt', { content: localContent.value })
}

// 保存到空间
const showSave    = ref(false)
const saving      = ref(false)
const saveSpaceId = ref(props.spaces[0]?.id || '')
const saveName    = ref(props.title)

watch(() => props.spaces, v => {
  if (v.length && !saveSpaceId.value) saveSpaceId.value = v[0].id
})
watch(() => props.title, v => { saveName.value = v })

async function doSave() {
  if (!saveSpaceId.value) { Message.warning('请选择工作空间'); return }
  saving.value = true
  try {
    const node = await workspaceApi.createDocument(saveSpaceId.value, saveName.value, 'document')
    await workspaceApi.saveContent(node.node?.id || node.id, localContent.value, 'html')
    Message.success('已保存到文档空间')
    showSave.value = false
    emit('saved', node)
  } catch (e) {
    Message.error('保存失败：' + e.message)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.doc-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
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

.doc-subtitle {
  font-size: 12px;
  color: #9ca3af;
}

.doc-header-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  align-items: center;
}

.doc-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px;
}
</style>
