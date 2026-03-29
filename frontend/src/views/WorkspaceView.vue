<template>
  <div class="page-layout">
    <!-- Header -->
    <div class="page-header">
      <div>
        <div class="page-title">文档空间</div>
        <div class="page-subtitle">管理活动策划文档与生成的 PPT 方案</div>
      </div>
    </div>

    <!-- Body: tree + content -->
    <div class="ws-body">
      <!-- 左侧树形面板 -->
      <div class="ws-tree-panel">
        <div class="tree-toolbar">
          <span class="tree-panel-title">工作空间</span>
          <a-tooltip content="新建空间">
            <a-button size="mini" @click="showNewSpaceModal = true">
              <template #icon><icon-plus /></template>
            </a-button>
          </a-tooltip>
        </div>

        <div class="tree-scroll" v-if="treeData.length > 0">
          <a-tree
            :data="treeData"
            :selected-keys="selectedKeys"
            :default-expand-all="false"
            block-node
            @select="onTreeSelect"
          >
            <template #title="node">
              <div class="tree-node-row">
                <span class="tree-node-label">{{ node.title }}</span>
                <a-dropdown trigger="click" position="br" @select="(key) => onNodeAction(key, node)">
                  <span class="tree-node-more" @click.stop>
                    <icon-more />
                  </span>
                  <template #content>
                    <!-- space / folder 特有操作 -->
                    <template v-if="node.nodeType === 'space' || node.nodeType === 'folder'">
                      <a-doption value="new-folder">
                        <template #icon><icon-folder-add /></template>
                        新建文件夹
                      </a-doption>
                      <a-doption value="new-doc">
                        <template #icon><icon-file-add /></template>
                        新建文档
                      </a-doption>
                      <a-doption value="import-word">
                        <template #icon><icon-upload /></template>
                        导入 Word
                      </a-doption>
                      <a-divider style="margin:4px 0" />
                    </template>
                    <!-- document 特有操作 -->
                    <template v-if="node.docType === 'document'">
                      <a-doption value="import-word">
                        <template #icon><icon-upload /></template>
                        导入 Word
                      </a-doption>
                      <a-doption value="export-word">
                        <template #icon><icon-download /></template>
                        导出 Word
                      </a-doption>
                      <a-divider style="margin:4px 0" />
                    </template>
                    <a-doption value="rename">
                      <template #icon><icon-edit /></template>
                      重命名
                    </a-doption>
                    <a-doption value="delete" class="danger-option">
                      <template #icon><icon-delete /></template>
                      删除
                    </a-doption>
                  </template>
                </a-dropdown>
              </div>
            </template>
            <template #icon="node">
              <icon-layers   v-if="node.nodeType === 'space'" />
              <icon-folder   v-else-if="node.nodeType === 'folder'" />
              <icon-file-pdf v-else-if="node.docType === 'ppt'" />
              <icon-file     v-else />
            </template>
          </a-tree>
        </div>

        <div v-else class="tree-empty">
          <p>暂无工作空间</p>
          <a-button size="small" type="outline" @click="showNewSpaceModal = true">新建空间</a-button>
        </div>
      </div>

      <!-- 右侧内容区 -->
      <div class="ws-content-panel" ref="contentPanelRef">
        <!-- 空状态 -->
        <div v-if="!selectedNode" class="ws-empty">
          <icon-folder-add style="font-size:48px;color:var(--color-fill-4)" />
          <div class="ws-empty-title">选择或新建文档</div>
          <div class="ws-empty-desc">从左侧选择节点，或点击 ＋ 新建工作空间</div>
        </div>

        <!-- Space / Folder 选中 -->
        <template v-else-if="selectedNode.nodeType === 'space' || selectedNode.nodeType === 'folder'">
          <div class="content-header">
            <span class="content-title">
              <icon-layers v-if="selectedNode.nodeType === 'space'" style="margin-right:6px" />
              <icon-folder v-else style="margin-right:6px" />
              {{ selectedNode.title }}
            </span>
          </div>
          <div class="ws-empty" style="flex:1">
            <div class="ws-empty-title">{{ selectedNode.title }}</div>
            <div class="ws-empty-desc">右键节点可新建子文件夹或文档</div>
          </div>
        </template>

        <!-- 文档 -->
        <template v-else-if="selectedNode.docType === 'document'">
          <div class="doc-page-shell">
            <div class="doc-page-meta">
              <div class="doc-page-breadcrumb">
                <icon-file style="margin-right:6px" />
                <span>活动文档</span>
              </div>
              <span class="save-status">{{ saveStatus }}</span>
            </div>

            <div class="doc-page-header">
              <div class="doc-page-icon">📝</div>
              <input
                v-model="docTitle"
                class="doc-page-title"
                placeholder="无标题"
                @input="onDocTitleInput"
              />
            </div>

            <NotionEditor
              v-model="docContent"
              class="doc-editor-area"
              @change="onDocChange"
            />
          </div>
        </template>

        <!-- PPT -->
        <template v-else-if="selectedNode.docType === 'ppt'">
          <SlideViewer
            v-if="pptSlides.length"
            :slides="pptSlides"
            :download-url="pptDownloadUrl"
            :show-save="false"
          />
          <div v-else class="ws-empty">
            <div class="ws-empty-title">暂无预览</div>
            <div class="ws-empty-desc">该 PPT 文档没有可用的幻灯片数据</div>
          </div>
        </template>
      </div>
    </div>

    <!-- 新建空间 Modal -->
    <a-modal v-model:visible="showNewSpaceModal" title="新建工作空间" @ok="createSpace" @cancel="newSpaceName=''">
      <a-form layout="vertical">
        <a-form-item label="空间名称">
          <a-input v-model="newSpaceName" placeholder="如：小米 2025 / 大疆品牌展" autofocus @keyup.enter="createSpace" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 重命名 Modal -->
    <a-modal v-model:visible="showRenameModal" title="重命名" @ok="doRename" @cancel="renameValue=''">
      <a-input v-model="renameValue" autofocus @keyup.enter="doRename" />
    </a-modal>

    <!-- 导入 Word：隐藏 file input，由 JS 触发 -->
    <input
      ref="wordFileInput"
      type="file"
      accept=".docx"
      style="display:none"
      @change="onWordFileSelected"
    />
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted } from 'vue'
import { Message, Modal } from '@arco-design/web-vue'
import { workspaceApi } from '../api/workspace'
import SlideViewer from '../components/SlideViewer.vue'
import NotionEditor from '../components/NotionEditor.vue'
import {
  IconMore, IconDownload, IconUpload
} from '@arco-design/web-vue/es/icon'

// ── 树形数据 ─────────────────────────────────────────────────────
const rawTree     = ref({ spaces: [] })
const treeData    = computed(() => buildArcoTree(rawTree.value.spaces || []))
const selectedKeys = ref([])
const selectedNode = ref(null)

// nodeIcon removed — icons now rendered as components in template

function buildArcoTree(spaces) {
  function buildNode(n) {
    const node = {
      key:      n.id,
      title:    n.name,
      nodeType: n.type,
      docType:  n.docType,
      // raw data
      raw: n,
      selectable: true,
      draggable: false
    }
    if (n.children && n.children.length) {
      node.children = n.children.map(buildNode)
    } else if (n.type === 'space' || n.type === 'folder') {
      node.children = []
    } else {
      node.isLeaf = true
    }
    return node
  }
  return spaces.map(buildNode)
}

async function loadTree() {
  try {
    const res = await workspaceApi.getTree()
    rawTree.value = res.data || { spaces: [] }
  } catch { Message.error('加载工作空间失败') }
}

loadTree()

// ── 节点选中 ────────────────────────────────────────────────────
const pptSlides      = ref([])
const pptDownloadUrl = ref('')
const saveStatus     = ref('')
const docContent     = ref({})
const docTitle       = ref('')
let   currentNodeId  = null
let   saveTimer      = null
let   renameTimer    = null
const contentPanelRef = ref(null)

function createEmptyDoc() {
  return {
    type: 'doc',
    content: [{ type: 'paragraph' }]
  }
}

function normalizeDocContent(raw, contentFormat) {
  if (!raw) return createEmptyDoc()
  if (typeof raw === 'object' && raw.type === 'doc') return raw

  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return createEmptyDoc()

    if (contentFormat === 'tiptap-json' || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed?.type === 'doc') return parsed
        if (parsed?.ops) return createEmptyDoc()
      } catch {}
    }

    if (trimmed.includes('"ops"')) return createEmptyDoc()
    return trimmed
  }

  return createEmptyDoc()
}

async function onTreeSelect(keys, { node }) {
  clearTimeout(saveTimer)
  clearTimeout(renameTimer)
  selectedKeys.value = keys
  selectedNode.value = node
  pptSlides.value    = []
  saveStatus.value   = ''
  docContent.value   = createEmptyDoc()
  docTitle.value     = ''
  currentNodeId      = null

  if (!node || node.nodeType === 'space' || node.nodeType === 'folder') return

  try {
    const res = await workspaceApi.getContent(node.key)
    const doc = res.content || {}
    if (node.docType === 'ppt') {
      pptSlides.value      = doc.previewSlides || []
      pptDownloadUrl.value = doc.downloadUrl   || ''
    } else {
      currentNodeId = node.key
      docTitle.value = node.title || doc.name || ''
      docContent.value = normalizeDocContent(doc.content, doc.contentFormat)
    }
  } catch { Message.error('加载文档失败') }
}

// 防抖自动保存
function onDocChange(content) {
  saveStatus.value = '编辑中...'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    if (!currentNodeId) return
    try {
      await workspaceApi.saveContent(currentNodeId, content, 'tiptap-json')
      saveStatus.value = '已保存'
      setTimeout(() => { saveStatus.value = '' }, 2000)
    } catch { saveStatus.value = '保存失败' }
  }, 1500)
}

function onDocTitleInput() {
  if (!selectedNode.value?.key || !docTitle.value.trim()) return
  saveStatus.value = '标题更新中...'
  clearTimeout(renameTimer)
  renameTimer = setTimeout(async () => {
    try {
      await workspaceApi.rename(selectedNode.value.key, docTitle.value.trim())
      if (selectedNode.value) selectedNode.value.title = docTitle.value.trim()
      saveStatus.value = '已保存'
      await loadTree()
      setTimeout(() => { saveStatus.value = '' }, 1500)
    } catch {
      saveStatus.value = '标题保存失败'
    }
  }, 500)
}

// ── 节点操作 ─────────────────────────────────────────────────────
const showNewSpaceModal = ref(false)
const showRenameModal   = ref(false)
const newSpaceName      = ref('')
const renameValue       = ref('')
let   actionNode        = ref(null)
const wordFileInput     = ref(null)
let   importTargetNode  = null   // 触发导入时记录目标节点

async function createSpace() {
  if (!newSpaceName.value.trim()) return
  try {
    await workspaceApi.createSpace(newSpaceName.value.trim())
    showNewSpaceModal.value = false
    newSpaceName.value = ''
    Message.success('工作空间已创建')
    await loadTree()
  } catch { Message.error('创建失败') }
}

async function onNodeAction(action, node) {
  actionNode.value = node
  if (action === 'new-folder') {
    const name = prompt('文件夹名称：')
    if (!name) return
    await workspaceApi.createFolder(node.key, name)
    Message.success('文件夹已创建')
    await loadTree()
  }
  else if (action === 'new-doc') {
    const name = prompt('文档名称：')
    if (!name) return
    await workspaceApi.createDocument(node.key, name, 'document')
    Message.success('文档已创建')
    await loadTree()
  }
  else if (action === 'rename') {
    renameValue.value = node.title
    showRenameModal.value = true
  }
  else if (action === 'import-word') {
    // 对 space/folder：先在其下建新文档，再导入；对 document：直接替换内容
    importTargetNode = node
    if (wordFileInput.value) {
      wordFileInput.value.value = ''   // 清空，确保同一文件可重复选
      wordFileInput.value.click()
    }
  }
  else if (action === 'export-word') {
    const url = workspaceApi.exportWordUrl(node.key)
    window.open(url, '_blank')
  }
  else if (action === 'delete') {
    Modal.warning({
      title: '确认删除',
      content: `确定删除「${node.title}」？此操作不可撤销。`,
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        await workspaceApi.remove(node.key)
        if (selectedNode.value?.key === node.key) selectedNode.value = null
        Message.success('已删除')
        await loadTree()
      }
    })
  }
}

// ── Word 导入处理 ────────────────────────────────────────────────
async function onWordFileSelected(e) {
  const file = e.target.files?.[0]
  if (!file || !importTargetNode) return

  const node = importTargetNode
  importTargetNode = null

  try {
    Message.loading({ content: '正在解析 Word 文件...', duration: 0, id: 'word-import' })

    const isFolder = node.nodeType === 'space' || node.nodeType === 'folder'

    if (isFolder) {
      // 在 space/folder 下新建文档，再写入内容
      const docName = file.name.replace(/\.docx?$/i, '') || '导入文档'
      const created = await workspaceApi.createDocument(node.key, docName, 'document')
      const nodeId  = created.node?.id || created.id
      const result  = await workspaceApi.importWord(nodeId, file)
      await workspaceApi.saveContent(nodeId, result.html, 'legacy-html')
      Message.success({ content: `已导入到「${docName}」`, id: 'word-import' })
      await loadTree()
      // 自动选中新节点（刷新树后选中）
      selectedKeys.value  = [nodeId]
      currentNodeId       = nodeId
      docTitle.value      = docName
      docContent.value    = result.html
      selectedNode.value  = { key: nodeId, title: docName, nodeType: 'document', docType: 'document' }
    } else {
      // document 节点：直接覆盖内容（先上传解析）
      const result = await workspaceApi.importWord(node.key, file)
      await workspaceApi.saveContent(node.key, result.html, 'legacy-html')
      // 刷新当前编辑器内容
      if (currentNodeId === node.key) {
        docContent.value = result.html
      }
      Message.success({ content: '已导入 Word 内容', id: 'word-import' })
    }
  } catch (err) {
    Message.error({ content: '导入失败：' + err.message, id: 'word-import' })
  }
}

async function doRename() {
  if (!renameValue.value.trim() || !actionNode.value) return
  await workspaceApi.rename(actionNode.value.key, renameValue.value.trim())
  showRenameModal.value = false
  renameValue.value = ''
  Message.success('已重命名')
  await loadTree()
}

onUnmounted(() => {
  clearTimeout(saveTimer)
  clearTimeout(renameTimer)
})
</script>

<style scoped>
.page-layout {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  background: #fff;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.page-title   { font-size: 17px; font-weight: 700; color: var(--color-text-1); }
.page-subtitle { font-size: 13px; color: var(--color-text-3); margin-top: 2px; }

/* Body */
.ws-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* Tree panel */
.ws-tree-panel {
  width: 260px;
  min-width: 200px;
  flex-shrink: 0;
  background: #fff;
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tree-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.tree-panel-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-3);
}

.tree-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px 4px;
}

.tree-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--color-text-3);
  font-size: 13px;
}

/* Tree node custom */

/* 让 Arco Tree 的 title slot 撑满全行，right-align 才生效 */
:deep(.arco-tree-node-title) {
  flex: 1;
  overflow: hidden;
  display: flex;
  align-items: center;
  min-width: 0;
}

.tree-node-row {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
}

.tree-node-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.tree-node-more {
  opacity: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--color-text-3);
  flex-shrink: 0;
  margin-left: 4px;
  transition: opacity 0.15s, background 0.1s;
}

:deep(.arco-tree-node:hover) .tree-node-more,
:deep(.arco-tree-node-selected) .tree-node-more { opacity: 1; }
.tree-node-more:hover { background: var(--color-fill-3); color: var(--color-text-1); }

:deep(.danger-option) { color: rgb(var(--red-6)) !important; }

/* Content panel */
.ws-content-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fafafa;
}

.ws-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--color-text-3);
}

.ws-empty-title { font-size: 16px; font-weight: 600; color: var(--color-text-2); }
.ws-empty-desc  { font-size: 13px; }

.content-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: #fff;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.content-title { font-size: 15px; font-weight: 600; color: var(--color-text-1); }
.save-status   { font-size: 12px; color: var(--color-text-3); }

/* Document page */
.doc-page-shell {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background:
    linear-gradient(180deg, #fcfcfd 0%, #ffffff 120px);
}

.doc-page-meta {
  max-width: 920px;
  width: 100%;
  margin: 0 auto;
  padding: 18px 24px 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--color-text-3);
  font-size: 12px;
}

.doc-page-breadcrumb {
  display: inline-flex;
  align-items: center;
  color: var(--color-text-3);
}

.doc-page-header {
  max-width: 920px;
  width: 100%;
  margin: 0 auto;
  padding: 6px 24px 0;
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.doc-page-icon {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: #f7f8fa;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  flex-shrink: 0;
}

.doc-page-title {
  width: 100%;
  border: none;
  background: transparent;
  outline: none;
  font-size: 42px;
  line-height: 1.15;
  font-weight: 700;
  color: #111827;
  padding: 2px 0 0;
}

.doc-page-title::placeholder {
  color: #c4cad4;
}

.doc-editor-area {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: transparent;
}

.doc-editor-area :deep(.notion-editor) {
  max-width: none;
  width: 100%;
  margin: 0 auto;
}

@media (max-width: 768px) {
  .doc-page-meta,
  .doc-page-header {
    padding-left: 24px;
    padding-right: 24px;
  }

  .doc-page-title {
    font-size: 32px;
  }
}
</style>
