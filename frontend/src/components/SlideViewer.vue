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
          保存到策划空间
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
        :class="{ 'sv-wrapper--new': isNewSlide, 'sv-wrapper--zoom': useZoomScaling }"
      >
        <iframe
          v-if="internalSlides[current]"
          ref="frameRef"
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
          style="width:960px;height:540px;border:none;zoom:0.125;pointer-events:none"
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
const frameRef   = ref(null)
const thumbsRef  = ref(null)
const current    = ref(0)
const isFullscreen = ref(false)
const isNewSlide   = ref(false)  // 新页入场动画标记
const useZoomScaling = ref(false)

const SLIDE_WIDTH = 960
const SLIDE_HEIGHT = 540

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
  if (!Array.isArray(newSlides) || newSlides.length === 0) {
    internalSlides.value = []
    current.value = 0
    return
  }
  internalSlides.value = [...newSlides]
  // 不重置 current，保持用户当前浏览位置
  if (current.value >= newSlides.length) current.value = 0
  nextTick(scaleSlide)
}, { immediate: true })

watch(() => props.currentIndex, (nextIndex) => {
  if (!internalSlides.value.length) return
  const clamped = Math.max(0, Math.min(internalSlides.value.length - 1, Number(nextIndex || 0)))
  if (clamped !== current.value) {
    current.value = clamped
    nextTick(scaleSlide)
  }
})

// ── 幻灯片内联 CSS（注入 iframe）──────────────────────────────
// 与 src/services/previewRenderer.js 的 SLIDE_CSS 保持同步
// 字体通过 /api/slide-fonts.css 引入（与服务器 Puppeteer 截图同一套 Inter + Noto Sans SC），
// 避免预览和最终 PPT 因字体差异出现版式漂移。
const SLIDE_STYLES = `
*,*::before,*::after{box-sizing:border-box}*{margin:0;padding:0}
.slide{width:960px;height:540px;position:relative;overflow:hidden;font-family:"Inter","Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;background-color:#fff;color:#1A1A1A}
.slide-cover{background-color:var(--secondary,#0F172A);display:flex;align-items:center}
.cover-accent{position:absolute;left:0;top:0;width:8px;height:100%;background-color:var(--primary,#2563EB);z-index:2}
.cover-deco{position:absolute;right:-60px;top:-80px;width:300px;height:300px;border-radius:50%;background-color:var(--primary,#2563EB);opacity:.07}
.cover-deco2{position:absolute;right:60px;bottom:-100px;width:200px;height:200px;border-radius:50%;background-color:var(--primary,#2563EB);opacity:.04}
.cover-content{position:relative;z-index:2;padding:0 72px 0 88px}
.cover-tag{display:inline-block;padding:3px 10px;background-color:var(--primary,#2563EB);color:#fff;font-size:11px;font-weight:600;border-radius:3px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:18px}
.cover-title{font-size:52px;font-weight:800;color:#fff;line-height:1.15;letter-spacing:-.02em;margin-bottom:12px}
.cover-subtitle{font-size:20px;font-weight:400;color:rgba(255,255,255,.72);line-height:1.5;margin-bottom:28px}
.cover-divider{width:44px;height:3px;background-color:var(--primary,#2563EB);margin-bottom:14px}
.cover-meta{font-size:13px;color:rgba(255,255,255,.45);letter-spacing:.04em}
.cover-brand{position:absolute;right:40px;bottom:26px;font-size:12px;color:rgba(255,255,255,.35);z-index:2}
.slide-toc{background-color:#fff;display:flex}
.toc-sidebar{width:248px;flex-shrink:0;background-color:var(--primary,#2563EB);display:flex;flex-direction:column;justify-content:center;padding:48px 36px}
.toc-label{font-size:11px;font-weight:600;color:rgba(255,255,255,.55);letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px}
.toc-main-title{font-size:42px;font-weight:800;color:#fff;line-height:1.1}
.toc-sidebar-line{width:32px;height:2px;background-color:rgba(255,255,255,.3);margin-top:18px}
.toc-content{flex:1;display:flex;align-items:center;padding:40px 52px}
.toc-grid{width:100%;display:grid;grid-template-columns:1fr 1fr;gap:8px 40px}
.toc-item{display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #F1F5F9}
.toc-num{font-size:18px;font-weight:800;color:var(--primary,#2563EB);opacity:.75;min-width:30px;line-height:1}
.toc-text{font-size:14px;font-weight:500;color:var(--secondary,#1E293B);line-height:1.4}
.slide-topbar{height:4px;background-color:var(--primary,#2563EB);flex-shrink:0}
.slide-header{padding:16px 48px 14px;background-color:#fff;border-bottom:1px solid #E2E8F0;flex-shrink:0}
.slide-heading{font-size:22px;font-weight:700;color:var(--secondary,#1E293B);line-height:1.2;padding-left:12px;border-left:3px solid var(--primary,#2563EB)}
.slide-heading .section-num{color:var(--primary,#2563EB);margin-right:8px}
.slide-content{background-color:#F8FAFC;display:flex;flex-direction:column}
.content-sections{flex:1;display:flex;gap:12px;padding:12px 48px;min-height:0;overflow:hidden}
.content-card{flex:1;background-color:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.07),0 1px 2px rgba(0,0,0,.04);padding:14px 16px}
.content-card-title{font-size:13px;font-weight:700;color:var(--primary,#2563EB);margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #F1F5F9}
.content-card-list{list-style:none;display:flex;flex-direction:column;gap:5px}
.content-card-list li{font-size:12px;color:#475569;line-height:1.5;padding-left:12px;position:relative}
.content-card-list li::before{content:'';position:absolute;left:0;top:7px;width:4px;height:4px;background-color:var(--primary,#2563EB);border-radius:50%;opacity:.5}
.kpi-row{padding:10px 48px;background-color:#fff;border-top:1px solid #E2E8F0;display:flex;gap:12px;flex-shrink:0}
.kpi-item{flex:1;background-color:var(--primary,#2563EB);border-radius:7px;padding:10px 14px;text-align:center}
.kpi-value{font-size:24px;font-weight:800;color:#fff;line-height:1;margin-bottom:3px}
.kpi-label{font-size:11px;color:rgba(255,255,255,.75)}
.slide-two-column{background-color:#F8FAFC;display:flex;flex-direction:column}
.columns-row{flex:1;display:flex;gap:12px;padding:12px 48px;min-height:0;overflow:hidden}
.col-card{flex:1;background-color:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.07);display:flex;flex-direction:column}
.col-header{background-color:var(--secondary,#1E293B);color:#fff;font-size:14px;font-weight:700;padding:10px 16px;text-align:center;flex-shrink:0}
.col-list{list-style:none;padding:12px 16px;flex:1;overflow:hidden}
.col-list li{font-size:12px;color:#334155;padding:4px 0 4px 13px;position:relative;border-bottom:1px solid #F8FAFC;line-height:1.5}
.col-list li::before{content:'•';position:absolute;left:0;color:var(--primary,#2563EB)}
.slide-cards{background-color:#fff;display:flex;flex-direction:column}
.cards-row{flex:1;display:flex;gap:12px;padding:12px 48px;min-height:0}
.card{flex:1;background-color:#F8FAFC;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);display:flex;flex-direction:column}
.card-header{background-color:var(--secondary,#1E293B);padding:14px 16px;display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0}
.card-icon{font-size:22px}
.card-title{font-size:14px;font-weight:700;color:#fff;text-align:center}
.card-tag{font-size:10px;color:rgba(255,255,255,.55)}
.card-desc{font-size:11px;color:#64748B;padding:8px 12px 0;text-align:center;line-height:1.4}
.card-price{font-size:14px;font-weight:700;color:var(--primary,#2563EB);padding:6px 12px 0;text-align:center}
.card-features{list-style:none;padding:8px 12px;flex:1;overflow:hidden}
.card-features li{font-size:11px;color:#475569;padding:2px 0 2px 12px;position:relative;line-height:1.4}
.card-features li::before{content:'';position:absolute;left:0;top:7px;width:4px;height:4px;background-color:var(--primary,#2563EB);border-radius:50%}
.slide-timeline{background-color:#F8FAFC;display:flex;flex-direction:column}
.timeline-row{flex:1;display:flex;gap:8px;padding:12px 48px;min-height:0;overflow-x:auto}
.timeline-phase{flex:1;min-width:120px;display:flex;flex-direction:column;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.07)}
.phase-date{background-color:var(--secondary,#1E293B);color:#fff;font-size:12px;font-weight:700;padding:7px 8px;text-align:center;flex-shrink:0}
.phase-name{background-color:var(--primary,#2563EB);color:#fff;font-size:11px;font-weight:600;padding:5px 8px;text-align:center;flex-shrink:0}
.phase-tasks{background-color:#fff;flex:1;list-style:none;padding:8px 10px;overflow:hidden}
.phase-tasks li{font-size:11px;color:#334155;padding:3px 0 3px 10px;position:relative;line-height:1.4}
.phase-tasks li::before{content:'•';position:absolute;left:0;color:var(--primary,#2563EB)}
.slide-end{background-color:var(--secondary,#0F172A);display:flex;flex-direction:column;align-items:center;justify-content:center}
.end-topbar{position:absolute;top:0;left:0;right:0;height:4px;background-color:var(--primary,#2563EB)}
.end-corner{position:absolute;left:-80px;bottom:-80px;width:300px;height:300px;background-color:var(--primary,#2563EB);border-radius:50%;opacity:.06}
.end-corner2{position:absolute;right:-40px;top:-60px;width:200px;height:200px;background-color:var(--primary,#2563EB);border-radius:50%;opacity:.04}
.end-content{position:relative;z-index:1;text-align:center;padding:0 80px}
.end-title{font-size:50px;font-weight:800;color:#fff;line-height:1.2;margin-bottom:14px}
.end-sub{font-size:18px;font-weight:400;color:rgba(255,255,255,.62);margin-bottom:12px;line-height:1.5}
.end-brand{font-size:13px;color:rgba(255,255,255,.35)}
.end-contact{font-size:12px;color:rgba(255,255,255,.4);margin-top:8px}
`

function slideSrc(html) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><base href="${window.location.origin}/"><link rel="stylesheet" href="/api/slide-fonts.css"><style>body{margin:0;overflow:hidden;background:#fff;width:${SLIDE_WIDTH}px;height:${SLIDE_HEIGHT}px;font-family:"Inter","Noto Sans SC","PingFang SC",system-ui,sans-serif}${SLIDE_STYLES}</style></head><body>${html}</body></html>`
}

// ── 缩放幻灯片 ─────────────────────────────────────────────────
function scaleSlide() {
  if (!stageRef.value || !wrapperRef.value) return
  const w = stageRef.value.clientWidth  - 40
  const h = stageRef.value.clientHeight - 40
  const deviceScale = Math.max(1, window.devicePixelRatio || 1)
  const rawScale = Math.min(w / SLIDE_WIDTH, h / SLIDE_HEIGHT, 1)
  const scale = Math.max(0.2, Math.round(rawScale * deviceScale * 100) / (deviceScale * 100))
  wrapperRef.value.style.setProperty('--slide-scale', scale)

  if (useZoomScaling.value && frameRef.value) {
    wrapperRef.value.style.transform = 'none'
    wrapperRef.value.style.transformOrigin = 'top center'
    wrapperRef.value.style.width = `${Math.round(SLIDE_WIDTH * scale)}px`
    wrapperRef.value.style.height = `${Math.round(SLIDE_HEIGHT * scale)}px`
    frameRef.value.style.width = `${SLIDE_WIDTH}px`
    frameRef.value.style.height = `${SLIDE_HEIGHT}px`
    frameRef.value.style.zoom = String(scale)
    frameRef.value.style.transform = 'translateZ(0)'
  } else {
    wrapperRef.value.style.width  = `${SLIDE_WIDTH}px`
    wrapperRef.value.style.height = `${SLIDE_HEIGHT}px`
    wrapperRef.value.style.transform = `scale(${scale})`
    wrapperRef.value.style.transformOrigin = 'top center'
    if (frameRef.value) {
      frameRef.value.style.width = `${SLIDE_WIDTH}px`
      frameRef.value.style.height = `${SLIDE_HEIGHT}px`
      frameRef.value.style.zoom = ''
      frameRef.value.style.transform = 'translateZ(0)'
    }
  }
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
  useZoomScaling.value = typeof document !== 'undefined' && 'zoom' in document.documentElement.style
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
  will-change: transform;
}

.sv-frame {
  display: block;
  width: 960px;
  height: 540px;
  border: none;
  background: #fff;
  pointer-events: none;
  transform-origin: top center;
  backface-visibility: hidden;
  -webkit-font-smoothing: antialiased;
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

.sv-wrapper--zoom.sv-wrapper--new {
  animation: fadeIn 0.26s ease-out forwards;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
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
  will-change: transform;
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
