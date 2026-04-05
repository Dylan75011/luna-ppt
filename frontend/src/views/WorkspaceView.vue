<template>
  <div class="page-layout">
    <!-- Header -->
    <div class="page-header">
      <div class="page-header-inner">
        <div class="page-title">策划空间</div>
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
            <button class="tree-add-btn" @click="showNewSpaceModal = true">
              <PhPlus :size="13" weight="bold" />
            </button>
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
                    <PhDotsThree :size="15" weight="bold" />
                  </span>
                  <template #content>
                    <template v-if="node.nType === 'space' || node.nType === 'folder'">
                      <a-doption value="new-folder">
                        <template #icon><icon-folder-add /></template>
                        新建文件夹
                      </a-doption>
                      <a-doption value="new-doc">
                        <template #icon><icon-file /></template>
                        新建文档
                      </a-doption>
                      <a-doption value="import-word">
                        <template #icon><icon-upload /></template>
                        导入 Word
                      </a-doption>
                      <a-divider style="margin:4px 0" />
                    </template>
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
              <PhStack       v-if="node.nType === 'space'"      :size="14" weight="duotone" />
              <PhFolder      v-else-if="node.nType === 'folder'" :size="14" weight="duotone" />
              <PhFilePdf     v-else-if="node.docType === 'ppt'"  :size="14" weight="duotone" />
              <PhImageSquare v-else-if="node.docType === 'image'" :size="14" weight="duotone" />
              <PhFileText    v-else                              :size="14" weight="duotone" />
            </template>
          </a-tree>
        </div>

        <div v-else class="tree-empty">
          <PhFolderSimpleDashed :size="32" weight="thin" class="tree-empty-icon" />
          <p class="tree-empty-text">暂无工作空间</p>
          <button class="tree-empty-btn" @click="showNewSpaceModal = true">新建空间</button>
        </div>
      </div>

      <!-- 右侧内容区 -->
      <div class="ws-content-panel" ref="contentPanelRef">

        <!-- 空状态 -->
        <div v-if="!selectedNode" class="ws-empty">
          <div class="ws-empty-art">
            <PhPresentationChart :size="40" weight="thin" />
          </div>
          <div class="ws-empty-title">从左侧选择文档</div>
          <div class="ws-empty-desc">或点击 + 新建一个工作空间开始策划</div>
        </div>

        <!-- Space / Folder 选中 -->
        <template v-else-if="selectedNode.nType === 'space' || selectedNode.nType === 'folder'">
          <div class="content-header">
            <span class="content-title">
              <PhStack   v-if="selectedNode.nType === 'space'" :size="16" weight="duotone" style="margin-right:7px;vertical-align:-2px" />
              <PhFolder  v-else                                 :size="16" weight="duotone" style="margin-right:7px;vertical-align:-2px" />
              {{ selectedNode.title }}
            </span>
          </div>
          <div v-if="selectedChildren.length" class="folder-overview">
            <div
              v-for="item in selectedChildren"
              :key="item.key"
              class="folder-overview-card"
              @click="selectNodeFromOverview(item)"
            >
              <div class="folder-overview-icon">
                <PhStack v-if="item.nType === 'space'" :size="18" weight="duotone" />
                <PhFolder v-else-if="item.nType === 'folder'" :size="18" weight="duotone" />
                <PhFilePdf v-else-if="item.docType === 'ppt'" :size="18" weight="duotone" />
                <PhImageSquare v-else-if="item.docType === 'image'" :size="18" weight="duotone" />
                <PhFileText v-else :size="18" weight="duotone" />
              </div>
              <div class="folder-overview-main">
                <div class="folder-overview-title">{{ item.title }}</div>
                <div class="folder-overview-meta">{{ overviewTypeLabel(item) }}</div>
              </div>
            </div>
          </div>
          <div v-else class="ws-empty" style="flex:1">
            <div class="ws-empty-art"><PhFolder :size="40" weight="thin" /></div>
            <div class="ws-empty-title">{{ selectedNode.title }}</div>
            <div class="ws-empty-desc">点击节点右侧的 ··· 可新建子文件夹或文档</div>
          </div>
        </template>

        <!-- 文档 -->
        <template v-else-if="selectedNode.docType === 'document'">
          <div class="doc-page-shell">
            <div class="doc-page-meta">
              <div class="doc-page-breadcrumb">
                <PhFileText :size="13" weight="duotone" style="margin-right:5px;vertical-align:-1px" />
                <span>活动文档</span>
              </div>
              <span class="save-status" :class="{ visible: saveStatus }">{{ saveStatus }}</span>
            </div>

            <div class="doc-page-header">
              <div class="doc-page-icon">
                <PhNotePencil :size="22" weight="duotone" />
              </div>
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
            <div class="ws-empty-art"><PhPresentationChart :size="40" weight="thin" /></div>
            <div class="ws-empty-title">暂无预览</div>
            <div class="ws-empty-desc">该 PPT 文档没有可用的幻灯片数据</div>
          </div>
        </template>

        <!-- 图片 -->
        <template v-else-if="selectedNode.docType === 'image'">
          <div v-if="imagePreviewUrl" class="asset-preview-shell">
            <div class="asset-preview-meta">
              <div>
                <div class="asset-preview-kicker">图片产出物</div>
                <div class="asset-preview-title">{{ docTitle || selectedNode.title }}</div>
              </div>
              <a :href="imageDownloadUrl || imagePreviewUrl" target="_blank" rel="noopener" class="asset-download-link">查看原图</a>
            </div>
            <div class="asset-preview-stage">
              <img :src="imagePreviewUrl" :alt="docTitle || selectedNode.title" class="asset-preview-image" />
            </div>
          </div>
          <div v-else class="ws-empty">
            <div class="ws-empty-art"><PhImageSquare :size="40" weight="thin" /></div>
            <div class="ws-empty-title">暂无图片预览</div>
            <div class="ws-empty-desc">该图片产出物没有可用的预览地址</div>
          </div>
        </template>
      </div>
    </div>

    <!-- 新建空间 Modal -->
    <a-modal v-model:visible="showNewSpaceModal" title="新建工作空间" @ok="createSpace" @cancel="newSpaceName=''">
      <a-form :model="{ name: newSpaceName }" layout="vertical">
        <a-form-item label="空间名称">
          <a-input v-model="newSpaceName" placeholder="如：小米 2025 / 大疆品牌展" autofocus @keyup.enter="createSpace" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 重命名 Modal -->
    <a-modal v-model:visible="showRenameModal" title="重命名" @ok="doRename" @cancel="renameValue=''">
      <a-input v-model="renameValue" autofocus @keyup.enter="doRename" />
    </a-modal>

    <input ref="wordFileInput" type="file" accept=".docx" style="display:none" @change="onWordFileSelected" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Message, Modal } from '@arco-design/web-vue'
import { workspaceApi } from '../api/workspace'
import SlideViewer from '../components/SlideViewer.vue'
import NotionEditor from '../components/NotionEditor.vue'
import {
  IconMore, IconDownload, IconUpload
} from '@arco-design/web-vue/es/icon'
import {
  PhPlus, PhDotsThree,
  PhStack, PhFolder, PhFilePdf, PhFileText,
  PhImageSquare,
  PhFolderSimpleDashed, PhPresentationChart,
  PhNotePencil,
} from '@phosphor-icons/vue'

// ── 树形数据 ─────────────────────────────────────────────────────
const rawTree     = ref({ spaces: [] })
const treeData    = computed(() => buildArcoTree(rawTree.value.spaces || []))
const selectedKeys = ref([])
const selectedNode = ref(null)

function buildArcoTree(spaces) {
  return spaces.map(buildArcoNode)
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
const imagePreviewUrl = ref('')
const imageDownloadUrl = ref('')
const saveStatus     = ref('')
const docContent     = ref({})
const docTitle       = ref('')
let   currentNodeId  = null
let   saveTimer      = null
let   renameTimer    = null
const contentPanelRef = ref(null)

const selectedChildren = computed(() => {
  const children = selectedNode.value?.raw?.children
  return Array.isArray(children) ? children.map(buildArcoNode) : []
})

function buildArcoNode(n) {
  const node = {
    key:      n.id,
    title:    n.name,
    nType:    n.type,
    docType:  n.docType,
    raw: n,
    selectable: true,
    draggable: false
  }
  if (n.children && n.children.length) {
    node.children = n.children.map(buildArcoNode)
  } else if (n.type === 'space' || n.type === 'folder') {
    node.children = []
  } else {
    node.isLeaf = true
  }
  return node
}

function overviewTypeLabel(node) {
  if (node.nType === 'folder') return `${(node.raw?.children || []).length} 项内容`
  if (node.docType === 'ppt') return 'PPT 预览文件'
  if (node.docType === 'image') return '图片产出物'
  return '可编辑文档'
}

function createEmptyDoc() {
  return { type: 'doc', content: [{ type: 'paragraph' }] }
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
  pptDownloadUrl.value = ''
  imagePreviewUrl.value = ''
  imageDownloadUrl.value = ''
  saveStatus.value   = ''
  docContent.value   = createEmptyDoc()
  docTitle.value     = ''
  currentNodeId      = null

  if (!node || node.nType === 'space' || node.nType === 'folder') return

  try {
    const res = await workspaceApi.getContent(node.key)
    const doc = res.content || {}
    if (node.docType === 'ppt') {
      pptSlides.value      = doc.previewSlides || []
      pptDownloadUrl.value = doc.downloadUrl   || ''
    } else if (node.docType === 'image') {
      docTitle.value = node.title || doc.name || ''
      imagePreviewUrl.value = doc.previewUrl || doc.downloadUrl || ''
      imageDownloadUrl.value = doc.downloadUrl || doc.previewUrl || ''
    } else {
      currentNodeId    = node.key
      docTitle.value   = node.title || doc.name || ''
      docContent.value = normalizeDocContent(doc.content, doc.contentFormat)
    }
  } catch { Message.error('加载文档失败') }
}

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
  if (!selectedNode.value?.key || !docTitle.value.trim() || selectedNode.value?.docType !== 'document') return
  saveStatus.value = '标题更新中...'
  clearTimeout(renameTimer)
  renameTimer = setTimeout(async () => {
    try {
      await workspaceApi.rename(selectedNode.value.key, docTitle.value.trim())
      if (selectedNode.value) selectedNode.value.title = docTitle.value.trim()
      saveStatus.value = '已保存'
      await loadTree()
      setTimeout(() => { saveStatus.value = '' }, 1500)
    } catch { saveStatus.value = '标题保存失败' }
  }, 500)
}

// ── 节点操作 ─────────────────────────────────────────────────────
const showNewSpaceModal = ref(false)
const showRenameModal   = ref(false)
const newSpaceName      = ref('')
const renameValue       = ref('')
let   actionNode        = ref(null)
const wordFileInput     = ref(null)
let   importTargetNode  = null

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
  } else if (action === 'new-doc') {
    const name = prompt('文档名称：')
    if (!name) return
    await workspaceApi.createDocument(node.key, name, 'document')
    Message.success('文档已创建')
    await loadTree()
  } else if (action === 'rename') {
    renameValue.value = node.title
    showRenameModal.value = true
  } else if (action === 'import-word') {
    importTargetNode = node
    if (wordFileInput.value) {
      wordFileInput.value.value = ''
      wordFileInput.value.click()
    }
  } else if (action === 'export-word') {
    const url = workspaceApi.exportWordUrl(node.key)
    window.open(url, '_blank')
  } else if (action === 'delete') {
    const isSpace = node.nType === 'space'
    const content = isSpace
      ? `确定删除「${node.title}」？空间内的文档、图片、PPT 和关联对话都会一起删除，且不可恢复。`
      : `确定删除「${node.title}」？此操作不可撤销。`
    Modal.warning({
      title: '确认删除',
      content,
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

async function onWordFileSelected(e) {
  const file = e.target.files?.[0]
  if (!file || !importTargetNode) return
  const node = importTargetNode
  importTargetNode = null
  try {
    Message.loading({ content: '正在解析 Word 文件...', duration: 0, id: 'word-import' })
    const isFolder = node.nType === 'space' || node.nType === 'folder'
    if (isFolder) {
      const docName = file.name.replace(/\.docx?$/i, '') || '导入文档'
      const created = await workspaceApi.createDocument(node.key, docName, 'document')
      const nodeId  = created.node?.id || created.id
      const result  = await workspaceApi.importWord(nodeId, file)
      Message.remove('word-import')
      Message.success({ content: `已导入到「${docName}」`, id: 'word-import' })
      await loadTree()
      selectedKeys.value  = [nodeId]
      currentNodeId       = nodeId
      docTitle.value      = docName
      docContent.value    = result.content || createEmptyDoc()
      selectedNode.value  = { key: nodeId, title: docName, nType: 'document', docType: 'document' }
    } else {
      const result = await workspaceApi.importWord(node.key, file)
      if (currentNodeId === node.key) docContent.value = result.content || createEmptyDoc()
      Message.remove('word-import')
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

function selectNodeFromOverview(node) {
  selectedKeys.value = [node.key]
  onTreeSelect([node.key], { node })
}

let _wsBroadcast = null

onMounted(() => {
  try {
    _wsBroadcast = new BroadcastChannel('oc_workspace_updated')
    _wsBroadcast.onmessage = () => loadTree()
  } catch {}
})

onUnmounted(() => {
  clearTimeout(saveTimer)
  clearTimeout(renameTimer)
  _wsBroadcast?.close()
})
</script>

<style scoped>
/* ── 调色板 ──────────────────────────────────────────────────────
   tree-bg:   #faf9f7  暖奶油
   content:   #ffffff  纯白
   accent:    #44403c  暖炭色（克制，不刺眼）
   border:    rgba(0,0,0,0.06)
   text-1:    #1c1917
   text-2:    #57534e
   text-3:    #a8a29e
─────────────────────────────────────────────────────────────── */

.page-layout {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── Header ── */
.page-header {
  background: #fff;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
  padding: 0 24px;
}

.page-header-inner {
  height: 56px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.page-title {
  font-size: 15px;
  font-weight: 700;
  color: #1c1917;
  letter-spacing: -0.2px;
}

.page-subtitle {
  font-size: 12px;
  color: #a8a29e;
  margin-top: 1px;
}

/* ── Body ── */
.ws-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* ── Tree panel ── */
.ws-tree-panel {
  width: 240px;
  min-width: 180px;
  flex-shrink: 0;
  background: #faf9f7;
  border-right: 1px solid rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tree-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  flex-shrink: 0;
}

.tree-panel-title {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #a8a29e;
}

.tree-add-btn {
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  border-radius: 5px;
  cursor: pointer;
  color: #a8a29e;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;
}

.tree-add-btn:hover {
  background: rgba(68, 64, 60, 0.08);
  color: #44403c;
}

/* ── Tree scroll ── */
.tree-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 6px 6px;
}

.tree-scroll::-webkit-scrollbar { width: 4px; }
.tree-scroll::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.08); border-radius: 2px; }

/* ── Arco tree overrides ── */
:deep(.arco-tree-node) {
  border-radius: 6px;
  transition: background 0.15s ease;
}

:deep(.arco-tree-node-title) {
  flex: 1;
  overflow: hidden;
  display: flex;
  align-items: center;
  min-width: 0;
  border-radius: 6px;
  transition: background 0.15s ease;
}

:deep(.arco-tree-node-title:hover) {
  background: rgba(68, 64, 60, 0.05) !important;
}

:deep(.arco-tree-node-selected > .arco-tree-node-title) {
  background: rgba(68, 64, 60, 0.08) !important;
}

:deep(.arco-tree-node-selected .arco-tree-node-title-text) {
  color: #1c1917 !important;
  font-weight: 600;
}

:deep(.arco-tree-node-icon) {
  color: #78716c;
}

/* ── Tree node row ── */
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
  color: #57534e;
}

:deep(.arco-tree-node-selected) .tree-node-label {
  color: #1c1917;
}

.tree-node-more {
  opacity: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  cursor: pointer;
  color: #a8a29e;
  flex-shrink: 0;
  margin-left: 2px;
  transition: opacity 0.15s, background 0.12s;
}

:deep(.arco-tree-node:hover) .tree-node-more,
:deep(.arco-tree-node-selected) .tree-node-more { opacity: 1; }
.tree-node-more:hover { background: rgba(68, 64, 60, 0.1); color: #44403c; }

/* ── Tree empty ── */
.tree-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px 16px;
}

.tree-empty-icon { color: #d6d3d1; }
.tree-empty-text { font-size: 13px; color: #a8a29e; margin: 0; }

.tree-empty-btn {
  padding: 5px 14px;
  border: 1px solid rgba(68, 64, 60, 0.2);
  background: transparent;
  border-radius: 6px;
  font-family: inherit;
  font-size: 12.5px;
  color: #57534e;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.tree-empty-btn:hover {
  background: rgba(68, 64, 60, 0.06);
  border-color: rgba(68, 64, 60, 0.35);
}

:deep(.danger-option) { color: rgb(var(--red-6)) !important; }

/* ── Content panel ── */
.ws-content-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
}

/* ── Empty state ── */
.ws-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #a8a29e;
}

.ws-empty-art {
  width: 64px;
  height: 64px;
  border-radius: 18px;
  background: #f5f5f4;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #c4c0bb;
  margin-bottom: 4px;
}

.ws-empty-title {
  font-size: 15px;
  font-weight: 600;
  color: #57534e;
}

.ws-empty-desc {
  font-size: 13px;
  color: #a8a29e;
}

/* ── Folder/Space header ── */
.content-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  height: 52px;
  background: #fff;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
}

.content-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1917;
  display: flex;
  align-items: center;
}

.folder-overview {
  padding: 20px 24px 28px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
  overflow: auto;
}

.folder-overview-card {
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 14px;
  padding: 14px;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.folder-overview-card:hover {
  transform: translateY(-1px);
  border-color: rgba(68, 64, 60, 0.16);
  box-shadow: 0 14px 30px rgba(28, 25, 23, 0.06);
}

.folder-overview-icon {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: #f5f5f4;
  color: #57534e;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.folder-overview-main {
  min-width: 0;
}

.folder-overview-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1917;
  line-height: 1.4;
  word-break: break-word;
}

.folder-overview-meta {
  margin-top: 4px;
  font-size: 12px;
  color: #a8a29e;
}

/* ── Document page ── */
.doc-page-shell {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
}

.doc-page-meta {
  max-width: 860px;
  width: 100%;
  margin: 0 auto;
  padding: 16px 32px 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.doc-page-breadcrumb {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  color: #a8a29e;
}

.save-status {
  font-size: 11.5px;
  color: #a8a29e;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.asset-preview-shell {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 24px;
  gap: 18px;
  overflow: auto;
}

.asset-preview-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.asset-preview-kicker {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: #a8a29e;
}

.asset-preview-title {
  margin-top: 6px;
  font-size: 22px;
  font-weight: 700;
  color: #1c1917;
}

.asset-download-link {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  background: #1c1917;
  color: #fff;
  text-decoration: none;
}

.asset-preview-stage {
  flex: 1;
  min-height: 320px;
  border-radius: 20px;
  background:
    radial-gradient(circle at top, rgba(120, 113, 108, 0.08), transparent 42%),
    linear-gradient(180deg, #f8f7f5 0%, #f3f1ee 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
}

.asset-preview-image {
  max-width: 100%;
  max-height: 100%;
  border-radius: 16px;
  object-fit: contain;
  box-shadow: 0 24px 60px rgba(28, 25, 23, 0.14);
}

.save-status.visible { opacity: 1; }

.doc-page-header {
  max-width: 860px;
  width: 100%;
  margin: 0 auto;
  padding: 8px 32px 0;
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.doc-page-icon {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: #f5f5f4;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #78716c;
  flex-shrink: 0;
  margin-top: 4px;
}

.doc-page-title {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  font-size: 38px;
  line-height: 1.2;
  font-weight: 700;
  color: #1c1917;
  font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
  letter-spacing: -0.5px;
  padding: 2px 0 0;
}

.doc-page-title::placeholder { color: #d6d3d1; }

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
</style>
