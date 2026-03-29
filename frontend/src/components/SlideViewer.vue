<template>
  <div class="sv-panel" ref="panelRef">
    <!-- 控制栏 -->
    <div class="sv-controls">
      <div class="sv-left">
        <a-button size="small" @click="toggleFullscreen">
          <template #icon>
            <icon-fullscreen v-if="!isFullscreen" />
            <icon-fullscreen-exit v-else />
          </template>
          {{ isFullscreen ? '退出全屏' : '全屏' }}
        </a-button>
      </div>
      <div class="sv-center">
        <a-button size="small" :disabled="current === 0" @click="go(current - 1)">‹</a-button>
        <span class="sv-counter">{{ current + 1 }} / {{ internalSlides.length }}</span>
        <a-button size="small" :disabled="current === internalSlides.length - 1" @click="go(current + 1)">›</a-button>
      </div>
      <div class="sv-right">
        <a-button
          v-if="!isBuilding && internalSlides.length > 0"
          size="small"
          type="outline"
          @click="$emit('open-editor')"
        >
          <template #icon><icon-edit /></template>
          进入编辑器
        </a-button>
        <a-button v-if="showSave && !isBuilding" size="small" status="success" @click="$emit('save')">
          <template #icon><icon-save /></template>
          保存到文档空间
        </a-button>
        <a-button v-if="downloadUrl && !isBuilding" size="small" type="primary" @click="download">
          <template #icon><icon-download /></template>
          下载 PPTX
        </a-button>
      </div>
    </div>

    <!-- 构建进度条（流式生成中显示） -->
    <div v-if="isBuilding" class="sv-build-bar">
      <div class="sv-build-track">
        <div
          class="sv-build-fill"
          :style="{ width: buildTotal > 0 ? `${Math.round((internalSlides.length / buildTotal) * 100)}%` : '0%' }"
        />
      </div>
      <span class="sv-build-label">
        正在生成第 {{ internalSlides.length }}
        <template v-if="buildTotal > 0"> / {{ buildTotal }}</template>
        页...
      </span>
    </div>

    <!-- 主幻灯片区 -->
    <div class="sv-stage" ref="stageRef">
      <div
        class="sv-wrapper"
        ref="wrapperRef"
        :class="{ 'sv-wrapper--new': isNewSlide }"
      >
        <iframe
          v-if="internalSlides[current]"
          class="sv-frame"
          :srcdoc="slideSrc(internalSlides[current])"
          scrolling="no"
        />
      </div>
    </div>

    <!-- 缩略图条 -->
    <div class="sv-thumbs" ref="thumbsRef">
      <div
        v-for="(slide, i) in internalSlides"
        :key="i"
        class="sv-thumb"
        :class="{ active: i === current, 'sv-thumb--new': i === internalSlides.length - 1 && isNewSlide }"
        @click="go(i)"
      >
        <iframe
          :srcdoc="slideSrc(slide)"
          scrolling="no"
          style="width:960px;height:540px;border:none;transform:scale(0.125);transform-origin:top left;pointer-events:none"
        />
        <span class="sv-thumb-num">{{ i + 1 }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'

const props = defineProps({
  slides:      { type: Array,   default: () => [] },
  downloadUrl: { type: String,  default: '' },
  showSave:    { type: Boolean, default: false },
  isBuilding:  { type: Boolean, default: false },
  buildTotal:  { type: Number,  default: 0 },
  currentIndex:{ type: Number,  default: 0 }
})
const emit = defineEmits(['save', 'open-editor', 'update:currentIndex'])

const panelRef   = ref(null)
const stageRef   = ref(null)
const wrapperRef = ref(null)
const thumbsRef  = ref(null)
const current    = ref(0)
const isFullscreen = ref(false)
const isNewSlide   = ref(false)  // 新页入场动画标记

// 内部幻灯片数组，支持流式追加
const internalSlides = ref([])

// ── 流式追加接口（由父组件调用）────────────────────────────────
function appendSlide(html) {
  internalSlides.value.push(html)
  // 自动跳到最新页
  nextTick(() => {
    current.value = internalSlides.value.length - 1
    emit('update:currentIndex', current.value)
    scaleSlide()
    // 触发入场动画
    isNewSlide.value = true
    setTimeout(() => { isNewSlide.value = false }, 500)
    // 缩略图滚动到末尾
    if (thumbsRef.value) {
      thumbsRef.value.scrollLeft = thumbsRef.value.scrollWidth
    }
  })
}

defineExpose({ appendSlide })

// ── prop slides 变化时同步（生成完成后的全量覆盖）──────────────
watch(() => props.slides, (newSlides) => {
  if (newSlides.length > 0) {
    internalSlides.value = [...newSlides]
    // 不重置 current，保持用户当前浏览位置
    if (current.value >= newSlides.length) current.value = 0
    nextTick(scaleSlide)
  }
})

watch(() => props.currentIndex, (nextIndex) => {
  if (!internalSlides.value.length) return
  const clamped = Math.max(0, Math.min(internalSlides.value.length - 1, Number(nextIndex || 0)))
  if (clamped !== current.value) {
    current.value = clamped
    nextTick(scaleSlide)
  }
})

// ── 幻灯片内联 CSS（注入 iframe）──────────────────────────────
const SLIDE_STYLES = `
.slide{width:960px;height:540px;position:relative;overflow:hidden;font-family:'PingFang SC','Noto Sans SC','Microsoft YaHei',sans-serif;background:#fff;color:#1A1A1A;box-sizing:border-box}
.slide-cover{background:var(--secondary,#1A1A1A);color:#fff}
.slide-cover .cover-bg{position:absolute;inset:0;background:var(--secondary,#1A1A1A)}
.slide-cover .cover-accent{position:absolute;left:0;top:0;width:12px;height:100%;background:var(--primary,#333)}
.slide-cover .cover-content{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px}
.slide-cover .cover-title{font-size:56px;font-weight:700;color:#fff;text-align:center;line-height:1.2}
.slide-cover .cover-subtitle{font-size:26px;color:rgba(255,255,255,.85);margin-top:16px;text-align:center}
.slide-cover .cover-divider{width:80px;height:3px;background:var(--primary,#666);margin:24px auto}
.slide-cover .cover-meta{font-size:16px;color:rgba(255,255,255,.6);text-align:center}
.slide-cover .cover-brand{position:absolute;bottom:24px;left:0;right:0;text-align:center;font-size:13px;color:rgba(255,255,255,.4)}
.slide-topbar{position:absolute;top:0;left:0;right:0;height:6px;background:var(--primary,#333)}
.slide-heading{font-size:26px;font-weight:700;color:var(--secondary,#1A1A1A);padding:20px 40px 12px}
.slide-heading .section-num{color:var(--primary,#333);margin-right:8px}
.slide-toc .toc-list{display:grid;grid-template-columns:1fr 1fr;gap:10px 40px;padding:8px 40px}
.slide-toc .toc-item{display:flex;align-items:center;gap:14px;padding:8px 0;border-bottom:1px solid #f0f0f0}
.slide-toc .toc-num{font-size:22px;font-weight:700;color:var(--primary,#333);min-width:36px}
.slide-toc .toc-text{font-size:16px;color:#333}
.slide-content .content-sections{display:flex;gap:16px;padding:0 40px;max-height:280px;overflow:hidden}
.content-card{background:#f8f9fa;border-radius:8px;padding:16px;flex:1;min-width:0}
.content-card-title{font-size:15px;font-weight:700;color:var(--primary,#333);margin-bottom:10px}
.content-card-list{list-style:none;padding:0}
.content-card-list li{font-size:13px;color:#444;padding:3px 0 3px 14px;position:relative;line-height:1.5}
.content-card-list li::before{content:'•';position:absolute;left:0;color:var(--primary,#333)}
.kpi-row{display:flex;gap:16px;padding:16px 40px 0}
.kpi-item{flex:1;background:var(--secondary,#1A1A1A);border-radius:8px;padding:14px;text-align:center}
.kpi-value{font-size:26px;font-weight:700;color:#fff}
.kpi-label{font-size:12px;color:rgba(255,255,255,.7);margin-top:4px}
.slide-two-column .columns-row{display:flex;gap:16px;padding:0 40px;height:380px}
.col-card{flex:1;background:#f8f9fa;border-radius:8px;overflow:hidden}
.col-header{background:var(--secondary,#1A1A1A);color:#fff;font-size:16px;font-weight:700;padding:12px 16px;text-align:center}
.col-list{list-style:none;padding:16px}
.col-list li{font-size:14px;color:#333;padding:6px 0 6px 16px;position:relative;border-bottom:1px solid #eee}
.col-list li::before{content:'•';position:absolute;left:0;color:var(--primary,#333)}
.slide-cards .cards-row{display:flex;gap:16px;padding:0 40px;height:380px}
.card{flex:1;background:#f8f9fa;border-radius:8px;overflow:hidden}
.card-header{background:var(--secondary,#1A1A1A);padding:16px;display:flex;flex-direction:column;align-items:center;gap:6px}
.card-icon{font-size:28px}.card-title{font-size:16px;font-weight:700;color:#fff;text-align:center}
.card-tag{font-size:11px;color:rgba(255,255,255,.6)}
.card-desc{font-size:13px;color:#666;padding:12px 16px 0;text-align:center}
.card-price{font-size:16px;font-weight:700;color:var(--primary,#333);padding:8px 16px 0;text-align:center}
.card-features{list-style:none;padding:12px 16px}
.card-features li{font-size:12px;color:#444;padding:4px 0 4px 14px;position:relative}
.card-features li::before{content:'◆';position:absolute;left:0;font-size:8px;color:var(--primary,#333);top:6px}
.slide-timeline .timeline-row{display:flex;gap:12px;padding:0 40px;height:380px;overflow-x:auto}
.timeline-phase{flex:1;min-width:150px;display:flex;flex-direction:column}
.phase-date{background:var(--secondary,#1A1A1A);color:#fff;font-size:13px;font-weight:700;padding:8px;text-align:center;border-radius:6px 6px 0 0}
.phase-name{background:var(--primary,#333);color:#fff;font-size:12px;font-weight:600;padding:6px 8px;text-align:center}
.phase-tasks{background:#f5f5f5;flex:1;list-style:none;padding:12px 10px;border-radius:0 0 6px 6px}
.phase-tasks li{font-size:11px;color:#333;padding:4px 0 4px 12px;position:relative;line-height:1.4}
.phase-tasks li::before{content:'•';position:absolute;left:0;color:var(--primary,#333)}
.slide-end{background:var(--primary,#1A1A1A);color:#fff}
.end-topbar{position:absolute;top:0;left:0;right:0;height:6px;background:rgba(255,255,255,.3)}
.end-content{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.end-title{font-size:52px;font-weight:700;color:#fff;text-align:center}
.end-sub{font-size:20px;color:rgba(255,255,255,.6);margin-top:16px;text-align:center}
.end-brand{font-size:15px;color:rgba(255,255,255,.4);margin-top:24px}
.end-contact{font-size:13px;color:rgba(255,255,255,.35);margin-top:8px}
`

function slideSrc(html) {
  return `<!DOCTYPE html><html><head><style>body{margin:0;overflow:hidden;background:#fff}${SLIDE_STYLES}</style></head><body>${html}</body></html>`
}

// ── 缩放幻灯片 ─────────────────────────────────────────────────
function scaleSlide() {
  if (!stageRef.value || !wrapperRef.value) return
  const w = stageRef.value.clientWidth  - 40
  const h = stageRef.value.clientHeight - 40
  const scale = Math.min(w / 960, h / 540, 1)
  // 同步 CSS 变量，让入场动画 keyframe 使用正确的缩放值
  wrapperRef.value.style.setProperty('--slide-scale', scale)
  wrapperRef.value.style.transform = `scale(${scale})`
  wrapperRef.value.style.transformOrigin = 'top center'
  wrapperRef.value.style.width  = '960px'
  wrapperRef.value.style.height = '540px'
}

// ── 跳转 ────────────────────────────────────────────────────────
function go(i) {
  const n = internalSlides.value.length
  current.value = Math.max(0, Math.min(n - 1, i))
  emit('update:currentIndex', current.value)
  nextTick(scaleSlide)
}

// ── 下载 ─────────────────────────────────────────────────────────
function download() {
  if (props.downloadUrl) window.location.href = props.downloadUrl
}

// ── 全屏 ─────────────────────────────────────────────────────────
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    panelRef.value?.requestFullscreen()
  } else {
    document.exitFullscreen()
  }
}

function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement
  nextTick(scaleSlide)
}

// ── 键盘 ─────────────────────────────────────────────────────────
function onKeydown(e) {
  if (!panelRef.value?.isConnected) return
  if (e.key === 'ArrowLeft')  { e.preventDefault(); go(current.value - 1) }
  if (e.key === 'ArrowRight') { e.preventDefault(); go(current.value + 1) }
  if (e.key === 'f' || e.key === 'F') toggleFullscreen()
}

// ── Resize ──────────────────────────────────────────────────────
let ro = null

onMounted(() => {
  nextTick(scaleSlide)
  ro = new ResizeObserver(scaleSlide)
  if (stageRef.value) ro.observe(stageRef.value)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  ro?.disconnect()
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.sv-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #f6f8fc;
}

.sv-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.92);
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
  gap: 12px;
}

.sv-left, .sv-right { display: flex; gap: 8px; min-width: 160px; }
.sv-right { justify-content: flex-end; }
.sv-center { display: flex; align-items: center; gap: 10px; }
.sv-counter { font-size: 13px; color: #4b5563; min-width: 55px; text-align: center; }

/* 构建进度条 */
.sv-build-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 16px;
  background: #ffffff;
  flex-shrink: 0;
  border-bottom: 1px solid #edf1f7;
}
.sv-build-track {
  flex: 1;
  height: 3px;
  background: #e5e7eb;
  border-radius: 2px;
  overflow: hidden;
}
.sv-build-fill {
  height: 100%;
  background: rgb(var(--arcoblue-6));
  border-radius: 2px;
  transition: width 0.4s ease;
}
.sv-build-label {
  font-size: 12px;
  color: #6b7280;
  white-space: nowrap;
}

.sv-stage {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 20px 20px 12px;
  overflow: hidden;
  background:
    radial-gradient(circle at top, rgba(var(--arcoblue-6), 0.06), transparent 38%),
    linear-gradient(180deg, #f8fafc 0%, #f3f6fb 100%);
}

.sv-wrapper {
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.12);
  border-radius: 10px;
  overflow: hidden;
  transition: opacity 0.1s;
  border: 1px solid rgba(226, 232, 240, 0.9);
}

.sv-frame {
  display: block;
  width: 960px;
  height: 540px;
  border: none;
  background: #fff;
  pointer-events: none;
}

/* 新页入场动画
   --slide-scale 由 scaleSlide() 同步写入，保证 keyframe 与内联 transform 一致 */
@keyframes slideIn {
  from { opacity: 0; transform: scale(var(--slide-scale, 1)) translateY(12px); }
  to   { opacity: 1; transform: scale(var(--slide-scale, 1)) translateY(0px); }
}
.sv-wrapper--new {
  animation: slideIn 0.35s ease-out forwards;
}

.sv-thumbs {
  height: 94px;
  background: rgba(255, 255, 255, 0.94);
  border-top: 1px solid #e5e7eb;
  display: flex;
  gap: 8px;
  padding: 8px 16px;
  overflow-x: auto;
  flex-shrink: 0;
  scrollbar-width: thin;
  scrollbar-color: #555 transparent;
}

.sv-thumb {
  width: 120px;
  height: 68px;
  flex-shrink: 0;
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  position: relative;
  background: #eef2f7;
  transition: border-color 0.15s, transform 0.12s;
}
.sv-thumb:hover { transform: translateY(-2px); border-color: #94a3b8; }
.sv-thumb.active { border-color: rgb(var(--arcoblue-6)); }

/* 新缩略图入场 */
@keyframes thumbIn {
  from { opacity: 0; transform: scale(0.85); }
  to   { opacity: 1; transform: scale(1); }
}
.sv-thumb--new {
  animation: thumbIn 0.3s ease-out;
}

.sv-thumb-num {
  position: absolute;
  bottom: 2px;
  right: 4px;
  font-size: 10px;
  color: rgba(255,255,255,0.86);
  background: rgba(15, 23, 42, 0.42);
  padding: 0 4px;
  border-radius: 3px;
}

.sv-panel:fullscreen { background: #eef2f7; }
.sv-panel:fullscreen .sv-stage { align-items: center; }
</style>
