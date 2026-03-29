<template>
  <div
    class="notion-editor-wrap"
    @mousedown="focusEditorFromWrap"
    @mousemove="onWrapMouseMove"
    @mouseleave="onWrapMouseLeave"
  >
    <!-- 气泡菜单（选中文字时出现） -->
    <div
      v-if="bubbleMenu.show && editor"
      class="bubble-menu"
      :style="{ top: bubbleMenu.top + 'px', left: bubbleMenu.left + 'px' }"
      @mousedown.prevent
    >
      <button @click="editor.chain().focus().toggleBold().run()" :class="{ active: editor.isActive('bold') }"><b>B</b></button>
      <button @click="editor.chain().focus().toggleItalic().run()" :class="{ active: editor.isActive('italic') }"><i>I</i></button>
      <button @click="editor.chain().focus().toggleStrike().run()" :class="{ active: editor.isActive('strike') }"><s>S</s></button>
      <button @click="editor.chain().focus().toggleHighlight().run()" :class="{ active: editor.isActive('highlight') }">高亮</button>
      <div class="bubble-divider" />
      <button @click="editor.chain().focus().toggleHeading({ level: 1 }).run()" :class="{ active: editor.isActive('heading', { level: 1 }) }">H1</button>
      <button @click="editor.chain().focus().toggleHeading({ level: 2 }).run()" :class="{ active: editor.isActive('heading', { level: 2 }) }">H2</button>
      <button @click="editor.chain().focus().toggleCodeBlock().run()" :class="{ active: editor.isActive('codeBlock') }">&lt;/&gt;</button>
    </div>

    <!-- 斜杠命令浮层 -->
    <div
      v-if="slashMenu.show"
      class="slash-menu"
      :style="{ top: slashMenu.top + 'px', left: slashMenu.left + 'px' }"
      ref="slashMenuRef"
    >
      <div
        v-for="(cmd, idx) in slashMenu.filtered"
        :key="cmd.id"
        class="slash-item"
        :class="{ selected: idx === slashMenu.index }"
        @mousedown.prevent="execSlash(cmd)"
      >
        <span class="slash-icon">{{ cmd.icon }}</span>
        <div class="slash-info">
          <div class="slash-label">{{ cmd.label }}</div>
          <div class="slash-desc">{{ cmd.desc }}</div>
        </div>
      </div>
      <div v-if="slashMenu.filtered.length === 0" class="slash-empty">无匹配命令</div>
    </div>

    <div
      v-if="hoveredBlock.show && editor"
      class="block-toolbar"
      :style="{ top: hoveredBlock.top + 'px', left: hoveredBlock.left + 'px' }"
    >
      <button
        class="block-tool-btn"
        title="插入块"
        @mousedown.stop.prevent="openInsertMenu"
        @click.stop
      >+</button>
      <button
        class="block-tool-btn drag"
        title="块操作"
        @mousedown.stop.prevent="openBlockActions"
        @click.stop
      >⋮⋮</button>
    </div>

    <div
      v-if="blockMenu.show"
      ref="blockMenuRef"
      class="slash-menu block-command-menu"
      :style="{ top: blockMenu.top + 'px', left: blockMenu.left + 'px' }"
      @mousedown.stop
      @click.stop
    >
      <div
        v-for="(cmd, idx) in blockMenu.mode === 'insert' ? slashCommands : blockActions"
        :key="cmd.id"
        class="slash-item"
        :class="{ selected: idx === slashMenu.index, danger: cmd.danger }"
        @mousedown.prevent="execBlockCommand(cmd)"
      >
        <span class="slash-icon">{{ cmd.icon }}</span>
        <div class="slash-info">
          <div class="slash-label">{{ cmd.label }}</div>
          <div v-if="cmd.desc" class="slash-desc">{{ cmd.desc }}</div>
        </div>
      </div>
    </div>

    <!-- 编辑器主体 -->
    <editor-content :editor="editor" class="notion-editor" />
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import { Node, mergeAttributes } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Link from '@tiptap/extension-link'
import Highlight from '@tiptap/extension-highlight'
import { TextStyle } from '@tiptap/extension-text-style'
import TextAlign from '@tiptap/extension-text-align'

const props = defineProps({
  modelValue: { type: [String, Object], default: '' }
})
const emit = defineEmits(['update:modelValue', 'change'])

const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'inline*',
  marks: '_',
  defining: true,
  draggable: true,
  addAttributes() {
    return {
      emoji: { default: '💡' }
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'callout',
        class: 'notion-callout'
      }),
      ['span', { class: 'notion-callout-emoji', contenteditable: 'false' }, HTMLAttributes.emoji || '💡'],
      ['div', { class: 'notion-callout-content' }, 0]
    ]
  },
  addCommands() {
    return {
      setCallout:
        (attrs = {}) =>
        ({ commands }) =>
          commands.setNode(this.name, attrs),
    }
  }
})

function createEmptyDoc() {
  return {
    type: 'doc',
    content: [{ type: 'paragraph' }]
  }
}

function isTiptapDoc(value) {
  return !!value && typeof value === 'object' && value.type === 'doc'
}

function normalizeContent(value) {
  if (!value) return createEmptyDoc()
  if (isTiptapDoc(value)) return value

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return createEmptyDoc()

    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (isTiptapDoc(parsed)) return parsed
        if (parsed?.ops) return createEmptyDoc()
      } catch {}
    }

    if (trimmed.includes('"ops"')) return createEmptyDoc()
    return trimmed
  }

  return createEmptyDoc()
}

function createTextNode(text) {
  return text ? [{ type: 'text', text }] : []
}

function paragraphBlock(text = '') {
  return { type: 'paragraph', content: createTextNode(text) }
}

function buildBlockByType(type, text = '') {
  switch (type) {
    case 'heading1':
      return { type: 'heading', attrs: { level: 1 }, content: createTextNode(text) }
    case 'heading2':
      return { type: 'heading', attrs: { level: 2 }, content: createTextNode(text) }
    case 'heading3':
      return { type: 'heading', attrs: { level: 3 }, content: createTextNode(text) }
    case 'bullet':
      return { type: 'bulletList', content: [{ type: 'listItem', content: [paragraphBlock(text)] }] }
    case 'ordered':
      return { type: 'orderedList', content: [{ type: 'listItem', content: [paragraphBlock(text)] }] }
    case 'task':
      return { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [paragraphBlock(text)] }] }
    case 'quote':
      return { type: 'blockquote', content: [paragraphBlock(text)] }
    case 'code':
      return { type: 'codeBlock', content: createTextNode(text) }
    case 'divider':
      return { type: 'horizontalRule' }
    case 'callout':
      return { type: 'callout', attrs: { emoji: '💡' }, content: createTextNode(text) }
    default:
      return paragraphBlock(text)
  }
}

function extractPlainText(node) {
  if (!node) return ''
  if (Array.isArray(node)) return node.map(extractPlainText).join(' ')
  if (node.type === 'text') return node.text || ''
  return extractPlainText(node.content || [])
}

const bubbleMenu = ref({ show: false, top: 0, left: 0 })
const slashMenu = ref({ show: false, query: '', top: 0, left: 0, index: 0, filtered: [] })
const blockMenu = ref({ show: false, top: 0, left: 0, mode: 'insert' })
const hoveredBlock = ref({ show: false, top: 0, left: 0, index: -1, pos: 0, node: null })
const slashMenuRef = ref(null)
const blockMenuRef = ref(null)
let slashStartPos = null

const slashCommands = [
  { id: 'text', icon: 'Aa', label: '文本', desc: '普通正文段落', type: 'paragraph' },
  { id: 'h1', icon: 'H1', label: '标题 1', desc: '页面主标题', type: 'heading1' },
  { id: 'h2', icon: 'H2', label: '标题 2', desc: '章节标题', type: 'heading2' },
  { id: 'h3', icon: 'H3', label: '标题 3', desc: '小节标题', type: 'heading3' },
  { id: 'bullet', icon: '•', label: '无序列表', desc: '项目符号列表', type: 'bullet' },
  { id: 'ordered', icon: '1.', label: '有序列表', desc: '编号步骤列表', type: 'ordered' },
  { id: 'task', icon: '☑', label: '待办列表', desc: '带复选框的任务', type: 'task' },
  { id: 'callout', icon: '💡', label: 'Callout', desc: '强调提示信息', type: 'callout' },
  { id: 'quote', icon: '❝', label: '引用', desc: '引用内容块', type: 'quote' },
  { id: 'code', icon: '</>', label: '代码块', desc: '插入代码片段', type: 'code' },
  { id: 'divider', icon: '—', label: '分割线', desc: '分隔内容区块', type: 'divider' },
]

const blockActions = [
  { id: 'turn-text', icon: 'Aa', label: '转为文本', action: () => convertHoveredBlock('paragraph') },
  { id: 'turn-h2', icon: 'H2', label: '转为标题', action: () => convertHoveredBlock('heading2') },
  { id: 'turn-callout', icon: '💡', label: '转为 Callout', action: () => convertHoveredBlock('callout') },
  { id: 'turn-task', icon: '☑', label: '转为待办', action: () => convertHoveredBlock('task') },
  { id: 'move-up', icon: '↑', label: '上移', action: () => moveHoveredBlock(-1) },
  { id: 'move-down', icon: '↓', label: '下移', action: () => moveHoveredBlock(1) },
  { id: 'duplicate', icon: '⧉', label: '复制块', action: duplicateHoveredBlock },
  { id: 'delete', icon: '⌫', label: '删除块', danger: true, action: deleteHoveredBlock },
]

function focusEditorFromWrap(event) {
  if (!editor.value) return
  const target = event.target
  if (
    target instanceof HTMLElement &&
    (target.closest('.bubble-menu') || target.closest('.slash-menu') || target.closest('.block-toolbar'))
  ) return
  nextTick(() => editor.value?.chain().focus('end').run())
}

function getTopLevelBlockMeta(index) {
  if (!editor.value) return null
  let start = 0
  let found = null
  editor.value.state.doc.forEach((node, offset, currentIndex) => {
    if (currentIndex === index) found = { start: offset, node, index: currentIndex }
    start = offset + node.nodeSize
  })
  return found
}

function focusBlockByIndex(index) {
  const meta = getTopLevelBlockMeta(index)
  if (!meta || !editor.value) return
  const focusPos = Math.max(meta.start + 1, 1)
  editor.value.chain().focus().setTextSelection(focusPos).run()
}

function replaceTopLevelBlocks(blocks, focusIndex = null) {
  if (!editor.value) return
  const doc = {
    type: 'doc',
    content: blocks.length ? blocks : [paragraphBlock()]
  }
  editor.value.commands.setContent(doc, true)
  hideBlockMenu()
  nextTick(() => {
    if (focusIndex != null) focusBlockByIndex(Math.max(0, Math.min(focusIndex, doc.content.length - 1)))
  })
}

function getTopLevelBlocks() {
  const json = editor.value?.getJSON() || createEmptyDoc()
  return Array.isArray(json.content) ? json.content : []
}

function duplicateHoveredBlock() {
  const index = hoveredBlock.value.index
  if (index < 0) return
  const blocks = getTopLevelBlocks()
  blocks.splice(index + 1, 0, JSON.parse(JSON.stringify(blocks[index])))
  replaceTopLevelBlocks(blocks, index + 1)
}

function deleteHoveredBlock() {
  const index = hoveredBlock.value.index
  if (index < 0) return
  const blocks = getTopLevelBlocks()
  blocks.splice(index, 1)
  replaceTopLevelBlocks(blocks, Math.max(0, index - 1))
}

function moveHoveredBlock(direction) {
  const index = hoveredBlock.value.index
  const target = index + direction
  const blocks = getTopLevelBlocks()
  if (index < 0 || target < 0 || target >= blocks.length) return
  const [block] = blocks.splice(index, 1)
  blocks.splice(target, 0, block)
  replaceTopLevelBlocks(blocks, target)
}

function convertHoveredBlock(type) {
  const index = hoveredBlock.value.index
  if (index < 0) return
  const blocks = getTopLevelBlocks()
  const text = extractPlainText(blocks[index])
  blocks.splice(index, 1, buildBlockByType(type, text))
  replaceTopLevelBlocks(blocks, index)
}

function insertBlockBelow(type) {
  const index = hoveredBlock.value.index
  const blocks = getTopLevelBlocks()
  const insertAt = index >= 0 ? index + 1 : blocks.length
  blocks.splice(insertAt, 0, buildBlockByType(type))
  replaceTopLevelBlocks(blocks, insertAt)
}

function updateBubbleMenu() {
  if (!editor.value) return
  const { state } = editor.value
  const { empty, from, to } = state.selection
  if (empty || from === to) { bubbleMenu.value.show = false; return }

  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) { bubbleMenu.value.show = false; return }
  const range = selection.getRangeAt(0)
  const rect = range.getBoundingClientRect()
  const wrap = editor.value.view.dom.closest('.notion-editor-wrap')
  const wRect = wrap?.getBoundingClientRect() || { top: 0, left: 0 }
  const menuWidth = 260
  const maxLeft = Math.max(12, wRect.width - menuWidth - 12)
  const nextLeft = rect.left - wRect.left + rect.width / 2 - menuWidth / 2
  const nextTop = rect.top - wRect.top - 44

  bubbleMenu.value = {
    show: true,
    top: Math.max(8, nextTop),
    left: Math.min(Math.max(12, nextLeft), maxLeft)
  }
}

function updateSlashMenu(query) {
  slashMenu.value.query = query
  slashMenu.value.filtered = slashCommands.filter((cmd) => {
    const keyword = query.toLowerCase()
    return !keyword || cmd.label.toLowerCase().includes(keyword) || cmd.id.includes(keyword) || cmd.desc.toLowerCase().includes(keyword)
  })
  slashMenu.value.index = 0
}

function hideSlash() {
  slashMenu.value.show = false
  slashStartPos = null
}

function hideBlockMenu() {
  blockMenu.value.show = false
}

function execSlash(cmd) {
  if (!editor.value) return
  const { from } = editor.value.state.selection
  const plainText = editor.value.state.doc.textBetween(Math.max(0, slashStartPos), from, '\n')
  editor.value.chain().focus().deleteRange({ from: slashStartPos, to: from }).run()
  editor.value.chain().focus().insertContent(buildBlockByType(cmd.type, plainText.replace(/^\//, '').trim())).run()
  hideSlash()
}

function execBlockCommand(cmd) {
  if (blockMenu.value.mode === 'insert') {
    insertBlockBelow(cmd.type)
  } else {
    cmd.action()
  }
}

function getEditorDom() {
  return editor.value?.view.dom.querySelector('.ProseMirror') || editor.value?.view.dom
}

function getTopLevelElement(target) {
  const root = getEditorDom()
  if (!root || !(target instanceof HTMLElement)) return null
  let current = target
  while (current && current !== root) {
    if (current.parentElement === root) return current
    current = current.parentElement
  }
  return null
}

function updateHoveredBlockFromElement(element) {
  const root = getEditorDom()
  if (!root || !element || !editor.value) {
    hoveredBlock.value.show = false
    return
  }

  const children = Array.from(root.children)
  const index = children.indexOf(element)
  if (index === -1) {
    hoveredBlock.value.show = false
    return
  }

  const meta = getTopLevelBlockMeta(index)
  if (!meta) return

  const rect = element.getBoundingClientRect()
  const wrap = root.closest('.notion-editor-wrap')
  const wrapRect = wrap?.getBoundingClientRect() || { top: 0, left: 0 }

  hoveredBlock.value = {
    show: true,
    top: rect.top - wrapRect.top + 2,
    left: -34,
    index,
    pos: meta.start,
    node: meta.node
  }
}

function onWrapMouseMove(event) {
  if (blockMenu.value.show) return
  if (
    event.target instanceof HTMLElement &&
    (event.target.closest('.block-toolbar') || event.target.closest('.block-command-menu'))
  ) return
  const element = getTopLevelElement(event.target)
  if (element) updateHoveredBlockFromElement(element)
  else hoveredBlock.value.show = false
}

function onWrapMouseLeave() {
  if (!blockMenu.value.show) hoveredBlock.value.show = false
}

function openInsertMenu() {
  blockMenu.value = {
    show: true,
    mode: 'insert',
    top: hoveredBlock.value.top + 28,
    left: 52
  }
  updateSlashMenu('')
}

function openBlockActions() {
  blockMenu.value = {
    show: true,
    mode: 'actions',
    top: hoveredBlock.value.top + 28,
    left: 52
  }
}

const editor = useEditor({
  content: normalizeContent(props.modelValue),
  extensions: [
    StarterKit.configure({ codeBlock: true }),
    Placeholder.configure({ placeholder: '输入 / 插入块，或开始写作...' }),
    Typography,
    TaskList,
    TaskItem.configure({ nested: true }),
    Link.configure({ openOnClick: false }),
    Highlight,
    TextStyle,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Callout,
  ],
  onUpdate({ editor }) {
    const json = editor.getJSON()
    emit('update:modelValue', json)
    emit('change', json)
  },
  onSelectionUpdate() {
    nextTick(updateBubbleMenu)
  },
  onBlur() {
    setTimeout(() => { bubbleMenu.value.show = false }, 150)
  },
  onKeyDown({ event }) {
    if (slashMenu.value.show) {
      if (event.key === 'ArrowDown') {
        slashMenu.value.index = Math.min(slashMenu.value.index + 1, slashMenu.value.filtered.length - 1)
        return true
      }
      if (event.key === 'ArrowUp') {
        slashMenu.value.index = Math.max(slashMenu.value.index - 1, 0)
        return true
      }
      if (event.key === 'Enter') {
        const cmd = slashMenu.value.filtered[slashMenu.value.index]
        if (cmd) {
          execSlash(cmd)
          return true
        }
      }
      if (event.key === 'Escape') {
        hideSlash()
        return true
      }
    }
    return false
  }
})

function handleEditorInput() {
  if (!editor.value) return
  const { state } = editor.value
  const { from } = state.selection
  const text = state.doc.textBetween(Math.max(0, from - 80), from, '\n')
  const slashIdx = text.lastIndexOf('/')

  if (slashIdx !== -1 && (slashIdx === 0 || /\s/.test(text[slashIdx - 1]))) {
    const query = text.slice(slashIdx + 1)
    if (!/\s/.test(query)) {
      slashStartPos = from - query.length - 1
      updateSlashMenu(query)
      nextTick(() => {
        const coords = editor.value.view.coordsAtPos(from)
        const wrap = editor.value.view.dom.closest('.notion-editor-wrap')
        const rect = wrap?.getBoundingClientRect() || { top: 0, left: 0 }
        slashMenu.value.top = coords.bottom - rect.top + 6
        slashMenu.value.left = coords.left - rect.left
        slashMenu.value.show = true
      })
      return
    }
  }
  if (slashMenu.value.show) hideSlash()
}

function onDocClick(event) {
  if (slashMenuRef.value && !slashMenuRef.value.contains(event.target)) hideSlash()
  if (
    event.target instanceof HTMLElement &&
    (event.target.closest('.block-toolbar') || event.target.closest('.block-command-menu'))
  ) return
  if (blockMenuRef.value && !blockMenuRef.value.contains(event.target)) hideBlockMenu()
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  nextTick(() => {
    const dom = editor.value?.view.dom
    dom?.addEventListener('keyup', handleEditorInput)
  })
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  const dom = editor.value?.view.dom
  dom?.removeEventListener('keyup', handleEditorInput)
  editor.value?.destroy()
})

watch(() => props.modelValue, (val) => {
  if (editor.value) {
    const normalized = normalizeContent(val)
    const current = editor.value.getJSON()
    if (JSON.stringify(normalized) !== JSON.stringify(current)) {
      editor.value.commands.setContent(normalized, false)
    }
  }
})

defineExpose({ editor })
</script>

<style>
/* ── 编辑器容器 ── */
.notion-editor-wrap {
  position: relative;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  --block-toolbar-left: -34px;
  max-width: 920px;
  width: 100%;
  margin: 0 auto;
}

.notion-editor {
  flex: 1;
  min-height: 420px;
  overflow-y: auto;
  padding: 12px 24px 100px 24px;
  outline: none;
  cursor: text;
}

/* ProseMirror 主体 */
.notion-editor .ProseMirror {
  min-height: 420px;
  outline: none;
  font-size: 16px;
  line-height: 1.8;
  color: #1a1a1a;
  caret-color: rgb(var(--arcoblue-6));
  width: 100%;
  cursor: text;
}

/* Placeholder */
.notion-editor .ProseMirror p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  color: #c2c7d0;
  pointer-events: none;
  float: left;
  height: 0;
}

/* 标题 */
.notion-editor .ProseMirror > * {
  position: relative;
  margin-left: 0;
}

.notion-editor .ProseMirror > *:first-child {
  margin-top: 0;
}

.notion-editor .ProseMirror h1 { font-size: 2em;   font-weight: 700; margin: 1.15em 0 0.38em; color: #111; letter-spacing: -0.02em; }
.notion-editor .ProseMirror h2 { font-size: 1.55em; font-weight: 700; margin: 1em 0 0.34em; color: #111; letter-spacing: -0.015em; }
.notion-editor .ProseMirror h3 { font-size: 1.18em; font-weight: 700; margin: 0.9em 0 0.3em; color: #111; }

/* 段落 */
.notion-editor .ProseMirror p { margin: 0.22em 0; }

/* 列表 */
.notion-editor .ProseMirror ul,
.notion-editor .ProseMirror ol {
  padding-left: 1.6em;
  margin: 0.3em 0;
}
.notion-editor .ProseMirror li { margin: 0.15em 0; }

/* 任务列表 */
.notion-editor .ProseMirror ul[data-type="taskList"] { list-style: none; padding-left: 0.2em; }
.notion-editor .ProseMirror ul[data-type="taskList"] li {
  display: flex; align-items: flex-start; gap: 8px;
}
.notion-editor .ProseMirror ul[data-type="taskList"] li > label {
  flex-shrink: 0; margin-top: 3px;
}
.notion-editor .ProseMirror ul[data-type="taskList"] li > label input[type="checkbox"] {
  width: 15px; height: 15px; cursor: pointer;
  accent-color: rgb(var(--arcoblue-6));
}
.notion-editor .ProseMirror ul[data-type="taskList"] li[data-checked="true"] > div {
  color: #9ca3af;
  text-decoration: line-through;
}

/* 引用块 */
.notion-editor .ProseMirror blockquote {
  border-left: 3px solid #e5e7eb;
  margin: 0.7em 0;
  padding: 0.4em 0 0.4em 1em;
  color: #6b7280;
  font-style: italic;
}

.notion-editor .ProseMirror .notion-callout {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin: 0.7em 0;
  padding: 14px 16px;
  border-radius: 14px;
  background: #f8fafc;
  border: 1px solid #edf2f7;
}

.notion-editor .ProseMirror .notion-callout-emoji {
  font-size: 18px;
  line-height: 1.5;
  flex-shrink: 0;
}

.notion-editor .ProseMirror .notion-callout-content {
  flex: 1;
  min-width: 0;
}

.notion-editor .ProseMirror .notion-callout-content p {
  margin: 0;
}

/* 代码 */
.notion-editor .ProseMirror code {
  background: #f3f4f6;
  border-radius: 4px;
  padding: 1px 5px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.875em;
  color: #e11d48;
}
.notion-editor .ProseMirror pre {
  background: #1e1e2e;
  border-radius: 8px;
  padding: 16px 20px;
  margin: 0.6em 0;
  overflow-x: auto;
}
.notion-editor .ProseMirror pre code {
  background: none;
  color: #cdd6f4;
  padding: 0;
  font-size: 0.875em;
}

/* 分割线 */
.notion-editor .ProseMirror hr {
  border: none;
  border-top: 1px solid #e5e7eb;
  margin: 1.5em 0;
}

/* 高亮 */
.notion-editor .ProseMirror mark {
  background: #fef08a;
  border-radius: 2px;
  padding: 1px 2px;
}

/* ── 气泡菜单 ── */
.bubble-menu {
  position: absolute;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 2px;
  background: #1a1a2e;
  border-radius: 8px;
  padding: 4px 6px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.2);
}

.bubble-menu button {
  padding: 4px 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: #e2e8f0;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
  line-height: 1;
  min-width: 26px;
  text-align: center;
}

.bubble-menu button:hover { background: rgba(255,255,255,0.1); }
.bubble-menu button.active { background: rgba(var(--arcoblue-6), 0.3); color: #93c5fd; }

.bubble-divider {
  width: 1px;
  height: 16px;
  background: rgba(255,255,255,0.15);
  margin: 0 3px;
}

/* ── 斜杠命令菜单 ── */
.slash-menu {
  position: absolute;
  z-index: 999;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 4px;
  box-shadow: 0 8px 30px rgba(0,0,0,0.12);
  min-width: 220px;
  max-height: 280px;
  overflow-y: auto;
}

.slash-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 7px;
  cursor: pointer;
  transition: background 0.1s;
}

.slash-item:hover,
.slash-item.selected { background: #f3f4f6; }

.slash-item.danger .slash-label {
  color: #dc2626;
}

.slash-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #374151;
  flex-shrink: 0;
}

.slash-label { font-size: 13px; font-weight: 500; color: #111; }
.slash-desc  { font-size: 11px; color: #9ca3af; margin-top: 1px; }
.slash-empty { padding: 10px 12px; font-size: 13px; color: #9ca3af; text-align: center; }

.block-toolbar {
  position: absolute;
  z-index: 20;
  display: flex;
  gap: 4px;
  align-items: center;
  left: var(--block-toolbar-left);
  padding: 4px;
  margin: -4px;
}

.block-tool-btn {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #9ca3af;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  font-size: 14px;
}

.block-tool-btn.drag {
  font-size: 12px;
  letter-spacing: -1px;
}

.block-tool-btn:hover {
  background: #f3f4f6;
  color: #374151;
}

.block-command-menu {
  min-width: 240px;
}

@media (max-width: 768px) {
  .notion-editor-wrap {
    --block-toolbar-left: -26px;
    max-width: 100%;
  }

  .notion-editor {
    min-height: 320px;
    padding: 12px 18px 90px 18px;
  }

  .notion-editor .ProseMirror {
    min-height: 320px;
  }

  .block-toolbar {
    left: var(--block-toolbar-left) !important;
  }
}
</style>
