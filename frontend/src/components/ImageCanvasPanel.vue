<template>
  <div class="icp-shell">
    <div class="icp-summary">
      <div class="icp-summary-copy">
        <div class="icp-kicker">视觉资产工作台</div>
        <div class="icp-title">{{ payload?.title || '图片画布' }}</div>
        <div class="icp-desc">
          已收集 {{ summary.totalImages }} 张图片，覆盖 {{ summary.coveredPages }} 个页面。
          这里会同时展示搜图结果和生图结果，方便快速比对。
        </div>
      </div>
      <div class="icp-metrics">
        <div class="icp-metric"><span>总数</span><strong>{{ summary.totalImages }}</strong></div>
        <div class="icp-metric"><span>已选</span><strong>{{ summary.selectedImages }}</strong></div>
        <div class="icp-metric"><span>生图</span><strong>{{ summary.generatedImages }}</strong></div>
        <div class="icp-metric"><span>搜图</span><strong>{{ summary.searchedImages }}</strong></div>
      </div>
    </div>

    <div class="icp-toolbar">
      <div class="icp-chip-row">
        <button
          v-for="item in sourceFilters"
          :key="item.value"
          type="button"
          class="icp-chip"
          :class="{ active: sourceFilter === item.value }"
          @click="sourceFilter = item.value"
        >
          {{ item.label }}
        </button>
      </div>
      <div class="icp-chip-row">
        <button
          v-for="item in visibilityFilters"
          :key="item.value"
          type="button"
          class="icp-chip"
          :class="{ active: visibilityFilter === item.value }"
          @click="visibilityFilter = item.value"
        >
          {{ item.label }}
        </button>
      </div>
    </div>

    <div v-if="styleGuideBadges.length" class="icp-style-guide">
      <span v-for="badge in styleGuideBadges" :key="badge" class="icp-style-badge">{{ badge }}</span>
    </div>

    <div v-if="filteredSections.length" class="icp-board">
      <section v-for="section in filteredSections" :key="section.id" class="icp-section">
        <div class="icp-section-head">
          <div>
            <div class="icp-section-title">
              <template v-if="section.kind === 'page'">第 {{ (section.pageIndex ?? 0) + 1 }} 页 · </template>{{ section.pageTitle || section.title }}
            </div>
            <div class="icp-section-meta">
              <span v-if="section.sceneType">{{ section.sceneType }}</span>
              <span v-if="section.assetType">{{ section.assetType }}</span>
              <span v-if="section.insertMode">{{ section.insertMode }}</span>
            </div>
          </div>
          <div class="icp-section-count">{{ section.images.length }} 张</div>
        </div>

        <div class="icp-grid">
          <div
            v-for="image in section.images"
            :key="image.id"
            class="icp-card"
            :class="{ selected: image.selected, active: activeImageId === image.id }"
            @click="openImageDetail(image, section)"
          >
            <img :src="image.previewUrl" :alt="image.pageTitle || image.id" class="icp-card-image" />
            <span class="icp-card-badge" :class="image.source">{{ image.source === 'minimax' ? 'AI 生图' : '搜图' }}</span>
            <span v-if="image.selected" class="icp-card-picked">已选中</span>
            <a
              v-if="isLocalUrl(image.previewUrl)"
              :href="image.previewUrl"
              download
              class="icp-card-dl"
              title="下载图片"
              @click.stop
            >↓</a>
            <a
              v-else
              :href="image.previewUrl"
              target="_blank"
              rel="noopener"
              class="icp-card-dl"
              title="在新标签页打开"
              @click.stop
            >↗</a>
            <div class="icp-card-footer">
              <div class="icp-card-title">{{ image.pageTitle || section.pageTitle || section.title }}</div>
              <div class="icp-card-meta">
                <span v-if="image.score !== null">{{ image.score }}分</span>
                <span v-if="image.originQuery">{{ truncate(image.originQuery, 28) }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
    <div v-else class="icp-empty">
      当前还没有可展示的图片资产。
    </div>

    <a-modal
      v-model:visible="detailModalVisible"
      :footer="false"
      :width="1000"
      :unmount-on-close="true"
      class="image-detail-modal"
    >
      <template #title>
        <div class="icp-detail-kicker">{{ activeImage?.sectionKind === 'page' ? '页面候选图' : '全局候选图' }}</div>
        <div class="icp-detail-title">{{ activeImage?.sectionTitle || activeImage?.pageTitle || '图片详情' }}</div>
      </template>
      <div v-if="activeImage" class="icp-detail">
        <div class="icp-detail-stage">
          <img :src="activeImage.previewUrl" :alt="activeImage.id" class="icp-detail-image" />
        </div>
        <div class="icp-detail-copy">
          <div class="icp-detail-tags">
            <span class="icp-style-badge">{{ activeImage.source === 'minimax' ? 'AI 生图' : 'Pexels 搜图' }}</span>
            <span v-if="activeImage.selected" class="icp-style-badge picked">当前已选</span>
            <span v-if="activeImage.sceneType" class="icp-style-badge">{{ activeImage.sceneType }}</span>
            <span v-if="activeImage.assetType" class="icp-style-badge">{{ activeImage.assetType }}</span>
          </div>
          <div class="icp-detail-field"><span>页码</span><strong>{{ activeImage.pageIndex !== null && activeImage.pageIndex !== undefined ? activeImage.pageIndex + 1 : '—' }}</strong></div>
          <div class="icp-detail-field"><span>分数</span><strong>{{ activeImage.score !== null ? activeImage.score : '—' }}</strong></div>
          <div class="icp-detail-field"><span>插入方式</span><strong>{{ activeImage.insertMode || '—' }}</strong></div>
          <div v-if="activeImage.originQuery" class="icp-detail-block">
            <div class="icp-detail-label">搜索词</div>
            <div class="icp-detail-text">{{ activeImage.originQuery }}</div>
          </div>
          <div v-if="activeImage.query" class="icp-detail-block">
            <div class="icp-detail-label">页面查询</div>
            <div class="icp-detail-text">{{ activeImage.query }}</div>
          </div>
          <div v-if="activeImage.prompt" class="icp-detail-block">
            <div class="icp-detail-label">生图 Prompt</div>
            <div class="icp-detail-text">{{ activeImage.prompt }}</div>
          </div>
          <div class="icp-detail-actions">
            <a
              v-if="isLocalUrl(activeImage.previewUrl)"
              :href="activeImage.previewUrl"
              download
              class="icp-btn-download"
            >下载图片</a>
            <a
              v-else
              :href="activeImage.previewUrl"
              target="_blank"
              rel="noopener"
              class="icp-btn-download"
            >在新标签页打开</a>
            <a
              :href="activeImage.previewUrl"
              target="_blank"
              rel="noopener"
              class="icp-btn-open"
            >查看原图</a>
          </div>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  payload: { type: Object, default: () => ({}) }
})

const sourceFilter = ref('all')
const visibilityFilter = ref('all')
const activeImageId = ref(null)
const detailModalVisible = ref(false)

const sourceFilters = [
  { value: 'all', label: '全部来源' },
  { value: 'minimax', label: '只看生图' },
  { value: 'pexels', label: '只看搜图' }
]

const visibilityFilters = [
  { value: 'all', label: '全部图片' },
  { value: 'selected', label: '只看已选' }
]

const summary = computed(() => props.payload?.summary || {
  totalImages: 0,
  selectedImages: 0,
  generatedImages: 0,
  searchedImages: 0,
  coveredPages: 0
})

const styleGuideBadges = computed(() => {
  const guide = props.payload?.styleGuide || {}
  return [guide.visualStyle, guide.palette, guide.lighting].filter(Boolean)
})

const filteredSections = computed(() => {
  const sections = Array.isArray(props.payload?.sections) ? props.payload.sections : []
  return sections
    .map((section) => {
      const images = (Array.isArray(section.images) ? section.images : []).filter((image) => {
        if (sourceFilter.value !== 'all' && image.source !== sourceFilter.value) return false
        if (visibilityFilter.value === 'selected' && !image.selected) return false
        return true
      })
      return { ...section, images }
    })
    .filter(section => section.images.length)
})

const activeImage = computed(() => {
  if (!activeImageId.value) return null
  for (const section of filteredSections.value) {
    const found = section.images.find(img => img.id === activeImageId.value)
    if (found) {
      return {
        ...found,
        sectionTitle: section.pageTitle || section.title,
        sectionKind: section.kind
      }
    }
  }
  return null
})

function openImageDetail(image, section) {
  activeImageId.value = image.id
  detailModalVisible.value = true
}

watch(filteredSections, (next) => {
  if (!next.length) {
    activeImageId.value = null
    detailModalVisible.value = false
  }
}, { immediate: true })

function truncate(value = '', limit = 24) {
  const text = String(value || '').trim()
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

// 本地 /output/ 路径或绝对 URL 但指向同服务器的均可直接 download
function isLocalUrl(url = '') {
  if (!url) return false
  if (url.startsWith('/output/')) return true
  try {
    const u = new URL(url)
    return u.origin === window.location.origin
  } catch {
    return false
  }
}
</script>

<style scoped>
.icp-shell { display:flex; flex-direction:column; gap:16px; padding:4px 2px 18px; }
.icp-summary { display:flex; justify-content:space-between; gap:16px; padding:18px 20px; background:linear-gradient(135deg, #faf7f2 0%, #f5efe7 100%); border:1px solid rgba(68,64,60,0.08); border-radius:16px; }
.icp-kicker { font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:#a16207; }
.icp-title { margin-top:6px; font-size:24px; font-weight:800; color:#1c1917; }
.icp-desc { margin-top:8px; max-width:620px; font-size:13px; line-height:1.6; color:#57534e; }
.icp-metrics { display:grid; grid-template-columns:repeat(2, minmax(88px, 1fr)); gap:10px; min-width:240px; }
.icp-metric { padding:12px 14px; background:#fff; border:1px solid rgba(68,64,60,0.08); border-radius:12px; display:flex; flex-direction:column; gap:6px; }
.icp-metric span { font-size:11px; color:#a8a29e; }
.icp-metric strong { font-size:20px; color:#1c1917; }
.icp-toolbar, .icp-style-guide { display:flex; flex-wrap:wrap; gap:10px; }
.icp-chip-row { display:flex; flex-wrap:wrap; gap:8px; }
.icp-chip { border:none; background:#f5f5f4; color:#57534e; border-radius:999px; padding:8px 12px; font-size:12px; font-weight:600; cursor:pointer; }
.icp-chip.active { background:#1c1917; color:#fff; }
.icp-style-badge { display:inline-flex; align-items:center; padding:6px 10px; border-radius:999px; background:#fafaf9; border:1px solid rgba(68,64,60,0.08); font-size:11px; color:#57534e; }
.icp-style-badge.picked { color:#166534; background:#ecfdf5; border-color:#bbf7d0; }
.icp-board { display:flex; flex-direction:column; gap:16px; }
.icp-section { padding:16px; background:#fff; border:1px solid rgba(68,64,60,0.08); border-radius:16px; box-shadow:0 8px 24px rgba(28,25,23,0.04); }
.icp-section-head { display:flex; justify-content:space-between; gap:16px; margin-bottom:14px; }
.icp-section-title { font-size:16px; font-weight:700; color:#1c1917; }
.icp-section-meta { display:flex; flex-wrap:wrap; gap:8px; margin-top:6px; font-size:11px; color:#78716c; text-transform:uppercase; letter-spacing:.04em; }
.icp-section-count { font-size:12px; color:#a8a29e; white-space:nowrap; }
.icp-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(170px, 1fr)); gap:12px; }
.icp-card { position:relative; border:none; background:#fafaf9; border-radius:14px; overflow:hidden; padding:0; cursor:pointer; text-align:left; box-shadow:0 1px 3px rgba(0,0,0,0.05); transition:transform .16s ease, box-shadow .16s ease, outline-color .16s ease; outline:2px solid transparent; }
.icp-card:hover { transform:translateY(-2px); box-shadow:0 12px 24px rgba(28,25,23,0.10); }
.icp-card.selected { outline-color:#16a34a; }
.icp-card.active { outline-color:#0f766e; }
.icp-card-image { display:block; width:100%; aspect-ratio:16/10; object-fit:cover; background:#e7e5e4; }
.icp-card-badge, .icp-card-picked { position:absolute; top:10px; padding:4px 8px; border-radius:999px; font-size:10px; font-weight:700; }
.icp-card-badge { left:10px; background:rgba(28,25,23,0.78); color:#fff; }
.icp-card-badge.minimax { background:rgba(15,118,110,0.92); }
.icp-card-badge.pexels { background:rgba(30,64,175,0.92); }
.icp-card-picked { right:10px; background:rgba(22,163,74,0.92); color:#fff; }
.icp-card-footer { padding:10px 12px 12px; }
.icp-card-title { font-size:12px; font-weight:700; color:#1c1917; line-height:1.4; }
.icp-card-meta { display:flex; flex-wrap:wrap; gap:8px; margin-top:6px; font-size:10px; color:#78716c; }
.icp-card-dl { position:absolute; bottom:46px; right:8px; display:flex; align-items:center; justify-content:center; width:26px; height:26px; border-radius:50%; background:rgba(28,25,23,0.72); color:#fff; font-size:13px; font-weight:700; text-decoration:none; opacity:0; transition:opacity .14s; line-height:1; }
.icp-card:hover .icp-card-dl { opacity:1; }
.icp-empty { padding:40px 20px; text-align:center; color:#a8a29e; background:#fafaf9; border-radius:16px; border:1px dashed rgba(68,64,60,0.16); }
.icp-detail { display:grid; grid-template-columns:minmax(0, 1.2fr) minmax(320px, .8fr); gap:16px; padding:16px; border-radius:16px; background:#1c1917; color:#fff; }
.icp-detail-stage { min-height:240px; border-radius:14px; overflow:hidden; background:#292524; }
.icp-detail-image { display:block; width:100%; height:100%; object-fit:cover; }
.icp-detail-copy { display:flex; flex-direction:column; gap:12px; min-width:0; }
.icp-detail-head { display:flex; justify-content:space-between; gap:12px; }
.icp-detail-kicker { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:#fbbf24; }
.icp-detail-title { margin-top:6px; font-size:20px; font-weight:800; }
.icp-detail-close { border:none; background:#44403c; color:#fff; padding:8px 12px; border-radius:10px; cursor:pointer; }
.icp-detail-tags { display:flex; flex-wrap:wrap; gap:8px; }
.icp-detail-field { display:flex; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.08); font-size:13px; }
.icp-detail-field span { color:rgba(255,255,255,0.64); }
.icp-detail-block { display:flex; flex-direction:column; gap:6px; }
.icp-detail-label { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:rgba(255,255,255,0.56); }
.icp-detail-text { font-size:13px; line-height:1.6; color:rgba(255,255,255,0.88); word-break:break-word; }
.icp-detail-actions { display:flex; gap:10px; margin-top:auto; padding-top:8px; }
.icp-btn-download { display:inline-flex; align-items:center; justify-content:center; padding:10px 18px; border-radius:10px; background:#16a34a; color:#fff; font-size:13px; font-weight:700; text-decoration:none; transition:background .14s; }
.icp-btn-download:hover { background:#15803d; }
.icp-btn-open { display:inline-flex; align-items:center; justify-content:center; padding:10px 18px; border-radius:10px; background:rgba(255,255,255,0.1); color:rgba(255,255,255,0.88); font-size:13px; font-weight:600; text-decoration:none; transition:background .14s; }
.icp-btn-open:hover { background:rgba(255,255,255,0.18); }

@media (max-width: 1100px) {
  .icp-summary, .icp-detail { grid-template-columns:1fr; display:flex; flex-direction:column; }
  .icp-metrics { grid-template-columns:repeat(4, minmax(0, 1fr)); min-width:0; }
}

/* ╔════════════════════════════════════════════╗
   ║  CINEMA THEME OVERRIDES                     ║
   ╚════════════════════════════════════════════╝ */

.icp-summary {
  background: linear-gradient(135deg, var(--bg-card) 0%, var(--accent-soft) 100%);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
}
.icp-kicker {
  color: var(--accent-ink);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.icp-title {
  color: var(--ink-strong);
  font-family: var(--font-serif);
  font-weight: 400;
  font-size: 28px;
  letter-spacing: -0.025em;
}
.icp-desc { color: var(--ink-2); }

.icp-metric {
  background: var(--bg-card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}
.icp-metric span {
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.icp-metric strong {
  color: var(--ink-strong);
  font-family: var(--font-serif);
  font-weight: 400;
  font-size: 22px;
  letter-spacing: -0.02em;
}

.icp-chip {
  background: var(--bg-card);
  color: var(--ink-2);
  border: 1px solid var(--line);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  border-radius: var(--radius-sm);
}
.icp-chip:hover { background: var(--bg-card-hover); color: var(--ink); }
.icp-chip.active {
  background: var(--ink);
  color: var(--bg-stage);
  border-color: var(--ink);
}
.icp-style-badge {
  background: var(--bg-card);
  border: 1px solid var(--line);
  color: var(--ink-2);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  border-radius: var(--radius-sm);
}
.icp-style-badge.picked {
  color: var(--ink-strong);
  background: var(--bg-card-hover);
  border-color: var(--line-strong);
}

.icp-section {
  background: var(--bg-card);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: none;
}
.icp-section-title {
  color: var(--ink-strong);
  font-family: var(--font-serif);
  font-weight: 400;
  letter-spacing: -0.015em;
  font-size: 18px;
}
.icp-section-meta {
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
}
.icp-section-count {
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
}

.icp-card {
  background: var(--bg-card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: none;
}
.icp-card:hover {
  border-color: var(--line-strong);
  box-shadow: 0 12px 32px -8px rgba(0,0,0,0.4);
}
.icp-card.selected { outline-color: var(--ink-strong); }
.icp-card.active   { outline-color: var(--ink-2); }
.icp-card-image { background: var(--bg-stage-2); }
.icp-card-badge {
  background: rgba(0,0,0,0.7);
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  border-radius: 2px;
  backdrop-filter: blur(8px);
}
.icp-card-badge.minimax { background: rgba(168,197,214,0.85); color: var(--bg-stage); }
.icp-card-badge.pexels  { background: rgba(196,189,222,0.85); color: var(--bg-stage); }
.icp-card-picked {
  background: var(--ink-strong);
  color: var(--bg-stage);
  font-family: var(--font-mono);
  letter-spacing: 0.14em;
  border-radius: 2px;
}
.icp-card-footer { padding: 12px 14px 14px; }
.icp-card-title {
  color: var(--ink-strong);
  font-family: var(--font-serif);
  font-weight: 400;
  letter-spacing: -0.01em;
  font-size: 13px;
}
.icp-card-meta { color: var(--mute); font-family: var(--font-mono); font-size: 9.5px; letter-spacing: 0.06em; }
.icp-card-dl {
  background: rgba(0,0,0,0.7);
  color: var(--ink);
  backdrop-filter: blur(8px);
}

.icp-empty {
  background: var(--bg-card);
  color: var(--mute);
  border: 1px dashed var(--line);
  border-radius: var(--radius-lg);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
}

/* Detail (when card opens, dark cinematic stage) */
.icp-detail {
  background: var(--bg-stage-2);
  border: 1px solid var(--line);
  color: var(--ink);
  border-radius: var(--radius-lg);
}
.icp-detail-stage { background: var(--bg-stage); }
.icp-detail-kicker {
  color: var(--accent-ink);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.icp-detail-title {
  font-family: var(--font-serif);
  font-weight: 400;
  letter-spacing: -0.02em;
  color: var(--ink-strong);
  font-size: 22px;
}
.icp-detail-close {
  background: transparent;
  color: var(--ink-2);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.icp-detail-close:hover { background: var(--bg-card-hover); color: var(--ink); border-color: var(--ink-3); }
.icp-detail-field { border-bottom: 1px solid var(--line); color: var(--ink); }
.icp-detail-field span { color: var(--ink-3); }
.icp-detail-label {
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.icp-detail-text { color: var(--ink-2); }
.icp-btn-download {
  background: var(--accent);
  color: var(--bg-stage);
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-weight: 500;
  font-size: 12px;
  letter-spacing: 0.04em;
}
.icp-btn-download:hover { background: var(--ink); color: var(--bg-stage); }
.icp-btn-open {
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.icp-btn-open:hover { background: var(--bg-card-hover); border-color: var(--ink-3); }
</style>

<style>
.image-detail-modal .arco-modal {
  background: var(--bg-stage-2) !important;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: 0 32px 80px -16px rgba(0,0,0,0.7);
}
.image-detail-modal .arco-modal-body {
  padding: 0;
  background: var(--bg-stage-2) !important;
}
.image-detail-modal .arco-modal-header {
  background: var(--bg-stage-2) !important;
  border-bottom: 1px solid var(--line);
}
.image-detail-modal .arco-modal-title {
  color: var(--ink-strong) !important;
  font-family: var(--font-serif);
  font-weight: 400;
  letter-spacing: -0.02em;
}
.image-detail-modal .icp-detail-kicker {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent-ink);
}
.image-detail-modal .icp-detail-title {
  font-family: var(--font-serif);
  font-weight: 400;
  font-size: 20px;
  letter-spacing: -0.02em;
  color: var(--ink-strong);
}
</style>
