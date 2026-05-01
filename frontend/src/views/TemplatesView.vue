<template>
  <div class="tpl-root">

    <!-- ── Header ── -->
    <div class="tpl-header">
      <div class="tpl-header-copy">
        <div class="tpl-category-label">
          <PhCalendar :size="13" weight="duotone" />
          活动策划模版
        </div>
        <h1 class="tpl-title">模版中心</h1>
        <p class="tpl-subtitle">从预设框架出发，快速生成专业活动策划与视觉方案</p>
      </div>
      <div class="tpl-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="tab-pill"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id; closePreview()"
        >
          <component :is="tab.icon" :size="14" weight="duotone" />
          {{ tab.label }}
        </button>
      </div>
    </div>

    <!-- ── Body ── -->
    <div class="tpl-body">

      <!-- 活动策划 -->
      <transition name="fade-up" mode="out-in">
        <div v-if="activeTab === 'planning'" key="planning" class="planning-grid">
          <div
            v-for="(tpl, idx) in planningTemplates"
            :key="tpl.id"
            class="plan-card"
            :class="{ selected: previewItem?.id === tpl.id }"
            :style="{ '--accent': tpl.accent, '--index': idx }"
            @mousemove="onSpotlight"
            @mouseleave="clearSpotlight"
            @click="openPreview(tpl)"
          >
            <div class="card-glow" />
            <div class="card-inner">
              <div class="card-top">
                <div class="card-icon" :style="{ background: `${tpl.accent}14`, color: tpl.accent }">
                  <component :is="tpl.icon" :size="18" weight="duotone" />
                </div>
                <div class="card-slides-badge">{{ tpl.slides.length }} 张</div>
              </div>
              <div class="card-text">
                <h3 class="card-name">{{ tpl.name }}</h3>
                <p class="card-desc">{{ tpl.desc }}</p>
              </div>
              <div class="outline-chips">
                <span
                  v-for="s in tpl.slides.filter(s => s.type !== 'cover' && s.type !== 'end' && s.type !== 'toc').slice(0, 4)"
                  :key="s.title"
                  class="chip"
                >{{ s.title }}</span>
              </div>
              <div class="card-footer">
                <div class="footer-tags">
                  <span v-for="t in tpl.tags" :key="t" class="tag">{{ t }}</span>
                </div>
                <button class="preview-btn" @click.stop="openPreview(tpl)">
                  <PhEye :size="12" weight="bold" />
                  预览结构
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- PPT 排版 -->
        <div v-else key="layout" class="layout-grid">
          <div
            v-for="(tpl, idx) in layoutTemplates"
            :key="tpl.id"
            class="layout-card"
            :class="{ active: activeLayoutId === tpl.id, selected: previewItem?.id === tpl.id }"
            :style="{ '--index': idx }"
            @click="openPreview(tpl)"
          >
            <div class="slide-strip">
              <div class="mini-slide mini-slide--cover" :style="{ background: tpl.coverBg }">
                <div class="ms-cover">
                  <div class="ms-cover-brand" :style="{ color: tpl.titleColor + '80' }">品牌</div>
                  <div class="ms-cover-title" :style="{ color: tpl.titleColor }">新品发布会</div>
                  <div class="ms-cover-divider" :style="{ background: tpl.titleColor + '40' }" />
                </div>
              </div>
              <div class="mini-slide mini-slide--content" :style="{ background: tpl.contentBg }">
                <div class="ms-content-header" :style="{ background: tpl.primary }" />
                <div class="ms-content-body">
                  <div class="ms-content-title" :style="{ color: tpl.primary }">活动背景</div>
                  <div class="ms-lines">
                    <div class="ms-line-full" :style="{ background: tpl.primary + '15' }" />
                    <div class="ms-line-full" :style="{ background: tpl.primary + '15' }" />
                    <div class="ms-line-partial" :style="{ background: tpl.primary + '10' }" />
                  </div>
                </div>
              </div>
              <div class="mini-slide mini-slide--end" :style="{ background: tpl.endBg }">
                <div class="ms-end">
                  <div class="ms-end-circle" :style="{ borderColor: tpl.titleColor + '30' }">
                    <div class="ms-end-dot" :style="{ background: tpl.titleColor }" />
                  </div>
                  <div class="ms-end-title" :style="{ color: tpl.titleColor }">感谢</div>
                </div>
              </div>
            </div>
            <div class="layout-meta">
              <div class="layout-name-row">
                <span class="layout-name">{{ tpl.name }}</span>
                <span v-if="activeLayoutId === tpl.id" class="active-badge">
                  <PhCheckCircle :size="12" weight="fill" />已应用
                </span>
              </div>
              <p class="layout-desc">{{ tpl.desc }}</p>
              <div class="swatches">
                <span v-for="c in tpl.colors" :key="c" class="swatch" :style="{ background: c }" />
              </div>
            </div>
            <div v-if="activeLayoutId === tpl.id" class="active-ring" />
          </div>
        </div>
      </transition>

      <!-- ── Preview Modal ── -->
      <a-modal
        v-model:visible="previewVisible"
        :width="800"
        :footer="null"
        :mask-closable="true"
        class="tpl-preview-modal"
        @cancel="closePreview"
      >
        <template v-if="previewItem">
          <!-- Planning preview -->
          <template v-if="activeTab === 'planning'">
            <div class="modal-header" :style="{ '--accent': previewItem.accent }">
              <div class="modal-header-left">
                <div class="modal-badge">
                  <PhCalendar :size="12" weight="duotone" />
                  活动策划模版
                </div>
                <h2 class="modal-title">{{ previewItem.name }}</h2>
                <div class="modal-meta">
                  <span class="modal-badge-tag">{{ previewItem.slides.length }} 张幻灯片</span>
                  <span class="modal-badge-tag">{{ previewItem.duration }}</span>
                </div>
              </div>
              <div class="modal-icon-wrap" :style="{ background: `${previewItem.accent}14` }">
                <component :is="previewItem.icon" :size="28" weight="duotone" :style="{ color: previewItem.accent }" />
              </div>
            </div>

            <p class="modal-desc">{{ previewItem.desc }}</p>

            <div class="modal-doc-outline">
              <div
                v-for="(slide, i) in previewItem.slides"
                :key="i"
                class="doc-item"
              >
                <div class="doc-item-header">
                  <span class="doc-num">{{ String(i + 1).padStart(2, '0') }}</span>
                  <span class="doc-title">{{ slide.title }}</span>
                </div>
                <ul v-if="slide.points?.length" class="doc-points">
                  <li v-for="p in slide.points.slice(0, 3)" :key="p">{{ p }}</li>
                </ul>
              </div>
            </div>

            <div class="modal-prompt-section">
              <div class="modal-section-title" style="margin-top: 12px;">AI 提示词</div>
              <div class="modal-prompt-preview">
                <div class="prompt-icon">
                  <PhRocket :size="16" weight="duotone" />
                </div>
                <div class="prompt-content">
                  <div class="prompt-text">{{ previewItem.prompt }}</div>
                  <div class="prompt-cursor">|</div>
                </div>
              </div>
              <div class="prompt-hint">使用后将自动填入智能助手对话框，可继续补充活动细节</div>
            </div>

            <div class="modal-footer">
              <div class="modal-tags">
                <span v-for="t in previewItem.tags" :key="t" class="modal-tag">{{ t }}</span>
              </div>
              <button
                class="modal-use-btn"
                :style="{ background: previewItem.accent }"
                @click="usePlanningTemplate(previewItem)"
              >
                使用此模版，开始策划
                <PhArrowRight :size="14" weight="bold" />
              </button>
            </div>
          </template>

          <!-- Layout preview -->
          <template v-else>
            <div class="modal-header">
              <div class="modal-header-left">
                <div class="modal-badge">
                  <PhLayout :size="12" weight="duotone" />
                  PPT 排版风格
                </div>
                <h2 class="modal-title">{{ previewItem.name }}</h2>
                <div class="modal-meta">
                  <span v-if="activeLayoutId === previewItem.id" class="modal-badge-tag active">当前已应用</span>
                </div>
              </div>
              <div class="modal-color-swatch-lg" :style="{ background: `linear-gradient(135deg, ${previewItem.primary} 0%, ${previewItem.colors[1]} 100%)` }" />
            </div>

            <p class="modal-desc">{{ previewItem.desc }}</p>

            <div class="modal-section-title" style="margin-top: 16px; margin-bottom: 12px;">
              幻灯片预览
              <button class="fullscreen-trigger" @click="openFullscreen(0)">
                <PhMagnifyingGlassPlus :size="13" weight="bold" />
                全屏预览
              </button>
            </div>
            <div class="modal-slides-preview">
              <div class="modal-slide-preview-card" @click="openFullscreen(0)">
                <div class="msp-slide msp-slide--cover" :style="{ background: previewItem.coverBg }">
                  <div class="msp-cover-content">
                    <div class="msp-cover-brand" :style="{ color: previewItem.titleColor + '80' }">品牌名称</div>
                    <div class="msp-cover-title" :style="{ color: previewItem.titleColor }">新品发布会</div>
                    <div class="msp-cover-divider" :style="{ background: previewItem.titleColor + '40' }" />
                    <div class="msp-cover-info" :style="{ color: previewItem.titleColor + '70' }">2026 · 城市</div>
                  </div>
                  <div class="msp-hover-overlay"><PhMagnifyingGlassPlus :size="20" weight="bold" /></div>
                </div>
                <div class="msp-label">封面页</div>
              </div>
              <div class="modal-slide-preview-card" @click="openFullscreen(1)">
                <div class="msp-slide msp-slide--content" :style="{ background: previewItem.contentBg }">
                  <div class="msp-content-header" :style="{ background: previewItem.primary }">
                    <div class="msp-content-header-title" :style="{ color: '#fff' }">活动背景</div>
                  </div>
                  <div class="msp-content-body">
                    <div class="msp-content-main" :style="{ color: previewItem.primary }">市场趋势与竞争格局</div>
                    <div class="msp-content-lines">
                      <div class="msp-line-full" :style="{ background: previewItem.primary + '15' }" />
                      <div class="msp-line-full" :style="{ background: previewItem.primary + '15' }" />
                      <div class="msp-line-partial" :style="{ background: previewItem.primary + '10' }" />
                    </div>
                    <div class="msp-content-chips">
                      <div class="msp-chip" :style="{ background: previewItem.primary + '15', color: previewItem.primary }">关键数据</div>
                    </div>
                  </div>
                </div>
                <div class="msp-label">内容页</div>
              </div>
              <div class="modal-slide-preview-card" @click="openFullscreen(2)">
                <div class="msp-slide msp-slide--content" :style="{ background: previewItem.contentBg }">
                  <div class="msp-content-header" :style="{ background: previewItem.primary }">
                    <div class="msp-content-header-title" :style="{ color: '#fff' }">目标受众</div>
                  </div>
                  <div class="msp-content-body">
                    <div class="msp-two-col">
                      <div class="msp-col-item" v-for="item in ['核心用户画像', '媒体邀请策略', 'KOL矩阵']" :key="item">
                        <div class="msp-col-dot" :style="{ background: previewItem.primary }" />
                        <div class="msp-col-line" :style="{ background: previewItem.primary + '20' }" />
                      </div>
                    </div>
                  </div>
                  <div class="msp-hover-overlay"><PhMagnifyingGlassPlus :size="20" weight="bold" /></div>
                </div>
                <div class="msp-label">内容页</div>
              </div>
              <div class="modal-slide-preview-card" @click="openFullscreen(4)">
                <div class="msp-slide msp-slide--end" :style="{ background: previewItem.endBg }">
                  <div class="msp-end-content">
                    <div class="msp-end-circle" :style="{ borderColor: previewItem.titleColor + '30' }">
                      <div class="msp-end-dot" :style="{ background: previewItem.titleColor }" />
                    </div>
                    <div class="msp-end-title" :style="{ color: previewItem.titleColor }">感谢观看</div>
                    <div class="msp-end-sub" :style="{ color: previewItem.titleColor + '60' }">THANK YOU</div>
                    <div class="msp-end-contact" :style="{ color: previewItem.titleColor + '40' }">contact@brand.com</div>
                  </div>
                  <div class="msp-hover-overlay"><PhMagnifyingGlassPlus :size="20" weight="bold" /></div>
                </div>
                <div class="msp-label">结尾页</div>
              </div>
            </div>

            <div class="modal-palette">
              <div
                v-for="(c, i) in previewItem.colors"
                :key="c"
                class="modal-palette-chip"
                :style="{ background: c }"
              >
                <span class="modal-palette-hex">{{ c }}</span>
              </div>
            </div>

            <button
              class="modal-use-btn layout"
              :style="{ background: previewItem.primary }"
              @click="applyLayout(previewItem)"
            >
              <PhCheckCircle :size="14" weight="bold" />
              {{ activeLayoutId === previewItem.id ? '已应用此风格' : '应用此风格' }}
            </button>
          </template>
        </template>
      </a-modal>
    </div>

    <!-- Toast -->
    <transition name="toast-slide">
      <div v-if="toastVisible" class="toast">
        <PhCheckCircle :size="15" weight="fill" />{{ toastText }}
      </div>
    </transition>

    <!-- Fullscreen PPT Preview -->
    <transition name="fade">
      <div v-if="fullscreenVisible" class="fullscreen-overlay" @click.self="closeFullscreen" @keydown.esc="closeFullscreen" @keydown.left="prevSlide" @keydown.right="nextSlide" tabindex="0">
        <div class="fullscreen-header">
          <div class="fullscreen-title">{{ previewItem?.name }}</div>
          <div class="fullscreen-counter">{{ fullscreenIndex + 1 }} / {{ fullscreenSlides.length }}</div>
          <button class="fullscreen-close" @click="closeFullscreen"><PhX :size="20" weight="bold" /></button>
        </div>
        <div class="fullscreen-slides">
          <button class="fullscreen-nav fullscreen-nav--prev" @click="prevSlide"><PhCaretLeft :size="32" weight="bold" /></button>
          <div class="fullscreen-slide-wrap">
            <transition name="slide-fade" mode="out-in">
              <div v-if="fullscreenSlides[fullscreenIndex]" :key="fullscreenIndex" class="fullscreen-slide" :style="{ background: fullscreenSlides[fullscreenIndex].bg }">
                <template v-if="fullscreenSlides[fullscreenIndex].type === 'cover'">
                  <div class="fs-cover">
                    <div class="fs-cover-brand" :style="{ color: fullscreenSlides[fullscreenIndex].titleColor + '80' }">品牌名称 BRAND</div>
                    <div class="fs-cover-title" :style="{ color: fullscreenSlides[fullscreenIndex].titleColor }">{{ fullscreenSlides[fullscreenIndex].subtitle }}</div>
                    <div class="fs-cover-divider" :style="{ background: fullscreenSlides[fullscreenIndex].titleColor + '50' }" />
                    <div class="fs-cover-info" :style="{ color: fullscreenSlides[fullscreenIndex].titleColor + '70' }">{{ fullscreenSlides[fullscreenIndex].info }}</div>
                  </div>
                </template>
                <template v-else-if="fullscreenSlides[fullscreenIndex].type === 'toc'">
                  <div class="fs-toc">
                    <div class="fs-toc-header" :style="{ background: fullscreenSlides[fullscreenIndex].primary }">
                      <div class="fs-toc-label" :style="{ color: fullscreenSlides[fullscreenIndex].titleColor + '80' }">目录 CONTENTS</div>
                      <div class="fs-toc-title" :style="{ color: fullscreenSlides[fullscreenIndex].titleColor }">策划大纲</div>
                    </div>
                    <div class="fs-toc-items">
                      <div v-for="(item, i) in fullscreenSlides[fullscreenIndex].items" :key="item" class="fs-toc-item" :style="{ borderColor: fullscreenSlides[fullscreenIndex].primary + '20' }">
                        <span class="fs-toc-num" :style="{ color: fullscreenSlides[fullscreenIndex].primary }">0{{ i + 1 }}</span>
                        <span class="fs-toc-text" :style="{ color: fullscreenSlides[fullscreenIndex].primary }">{{ item }}</span>
                      </div>
                    </div>
                  </div>
                </template>
                <template v-else-if="fullscreenSlides[fullscreenIndex].type === 'content'">
                  <div class="fs-content">
                    <div class="fs-content-header" :style="{ background: fullscreenSlides[fullscreenIndex].primary }">
                      <div class="fs-content-label" :style="{ color: '#ffffff80' }">CONTENTS</div>
                      <div class="fs-content-title">{{ fullscreenSlides[fullscreenIndex].title }}</div>
                    </div>
                    <div class="fs-content-body">
                      <div class="fs-content-subtitle" :style="{ color: fullscreenSlides[fullscreenIndex].primary }">{{ fullscreenSlides[fullscreenIndex].subtitle }}</div>
                      <div class="fs-content-points">
                        <div v-for="point in fullscreenSlides[fullscreenIndex].points" :key="point" class="fs-point">
                          <div class="fs-point-dot" :style="{ background: fullscreenSlides[fullscreenIndex].primary }" />
                          <div class="fs-point-text">{{ point }}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
                <template v-else-if="fullscreenSlides[fullscreenIndex].type === 'end'">
                  <div class="fs-end">
                    <div class="fs-end-circle" :style="{ borderColor: fullscreenSlides[fullscreenIndex].titleColor + '30' }">
                      <div class="fs-end-dot" :style="{ background: fullscreenSlides[fullscreenIndex].titleColor }" />
                    </div>
                    <div class="fs-end-title" :style="{ color: fullscreenSlides[fullscreenIndex].titleColor }">{{ fullscreenSlides[fullscreenIndex].title }}</div>
                    <div class="fs-end-sub" :style="{ color: fullscreenSlides[fullscreenIndex].titleColor + '60' }">{{ fullscreenSlides[fullscreenIndex].sub }}</div>
                    <div class="fs-end-contact" :style="{ color: fullscreenSlides[fullscreenIndex].titleColor + '40' }">{{ fullscreenSlides[fullscreenIndex].contact }}</div>
                  </div>
                </template>
              </div>
            </transition>
          </div>
          <button class="fullscreen-nav fullscreen-nav--next" @click="nextSlide"><PhCaretRight :size="32" weight="bold" /></button>
        </div>
        <div class="fullscreen-dots">
          <button v-for="(_, i) in fullscreenSlides" :key="i" class="fullscreen-dot" :class="{ active: i === fullscreenIndex }" @click="fullscreenIndex = i" />
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import {
  PhCalendar, PhLayout, PhArrowRight, PhCheckCircle,
  PhRocket, PhCar, PhMicrophone, PhStar, PhUsers, PhChartBar,
  PhEye, PhX, PhMagnifyingGlassPlus, PhCaretLeft, PhCaretRight,
} from '@phosphor-icons/vue'

const router = useRouter()

const tabs = [
  { id: 'planning', label: '活动策划', icon: PhCalendar },
  { id: 'layout',   label: 'PPT 排版',  icon: PhLayout   },
]
const activeTab = ref('planning')

const previewItem = shallowRef(null)
const previewVisible = ref(false)
function openPreview(tpl)  { previewItem.value = tpl; previewVisible.value = true }
function closePreview()    { previewVisible.value = false }

const fullscreenVisible = ref(false)
const fullscreenIndex = ref(0)
const fullscreenSlides = ref([])
function openFullscreen(idx) {
  fullscreenSlides.value = getLayoutSlides(previewItem.value)
  fullscreenIndex.value = idx
  fullscreenVisible.value = true
}
function closeFullscreen() { fullscreenVisible.value = false }
function nextSlide() { fullscreenIndex.value = (fullscreenIndex.value + 1) % fullscreenSlides.value.length }
function prevSlide() { fullscreenIndex.value = (fullscreenIndex.value - 1 + fullscreenSlides.value.length) % fullscreenSlides.value.length }

function getLayoutSlides(tpl) {
  return [
    { type: 'cover', bg: tpl.coverBg, titleColor: tpl.titleColor, subtitle: '2026年度新品发布会', info: '科技改变世界 · 北京国际会议中心' },
    { type: 'toc', bg: tpl.contentBg, primary: tpl.primary, titleColor: tpl.titleColor, items: ['活动背景与目标', '产品核心亮点', '市场定位分析', '目标受众洞察', '传播策略规划'] },
    { type: 'content', bg: tpl.contentBg, primary: tpl.primary, titleColor: tpl.titleColor, title: '活动背景', subtitle: '市场趋势与品牌机遇', points: ['全球科技产业持续高速增长，创新产品迭代加速', '消费者对智能化产品的需求爆发，AIoT成为新风口', '品牌需要一场重量级发布会抢占用户心智'] },
    { type: 'content', bg: tpl.contentBg, primary: tpl.primary, titleColor: tpl.titleColor, title: '核心亮点', subtitle: '三大技术创新引领行业', points: ['自研芯片性能提升300%，重新定义行业标准', '全场景AI助手，实现真正的人机协同', '生态互联互通，打造智慧生活新体验'] },
    { type: 'end', bg: tpl.endBg, titleColor: tpl.titleColor, title: '感谢观看', sub: 'THANK YOU', contact: 'www.brand.com' }
  ]
}

const SLIDE_TYPE_LABELS = {
  cover:      '封面',
  toc:        '目录',
  content:    '内容',
  two_column: '双栏',
  cards:      '卡片',
  timeline:   '时间线',
  data:       '数据',
  end:        '结尾',
}
function slideTypeLabel(type) { return SLIDE_TYPE_LABELS[type] || type }

/* ─────────────── Planning Templates ─────────────── */
const planningTemplates = [
  {
    id: 'product-launch',
    name: '新品发布会',
    desc: '产品亮点呈现、媒体邀请策略、现场互动设计与传播方案全链路策划',
    icon: PhRocket,
    accent: '#165dff',
    duration: '60-90 分钟',
    span: 7,
    tags: ['发布会', '科技', '媒体'],
    prompt: '帮我做一个新品发布会的活动策划PPT，',
    slides: [
      { type: 'cover',      title: '新品发布会',     note: '主视觉封面，产品形象图 + 发布会标题 + 日期地点' },
      { type: 'toc',        title: '议程目录',       points: ['活动背景', '产品亮点', '用户洞察', '发布现场', '传播方案', '行动计划'] },
      { type: 'content',    title: '活动背景',       points: ['市场趋势与竞争格局', '品牌发展阶段与发布契机', '本次发布会核心目标'] },
      { type: 'content',    title: '核心产品亮点',   points: ['三大差异化卖点拆解', '技术创新与用户价值', '对标竞品优势对比'] },
      { type: 'two_column', title: '目标受众分析',   points: ['核心用户画像', '媒体邀请策略', 'KOL 合作矩阵'] },
      { type: 'cards',      title: '发布会形式设计', points: ['线下主会场方案', '线上直播同步互动', '媒体专区与采访安排'] },
      { type: 'timeline',   title: '现场活动流程',   points: ['签到入场 (18:00)', '开场视频 (18:30)', '高管致辞 (18:40)', '产品揭幕 (19:00)', '体验互动 (19:30)', '媒体晚宴 (20:00)'] },
      { type: 'two_column', title: '传播方案',       points: ['预热期：悬念营销 & 媒体预告', '爆发期：直播 & 话题发酵', '长尾期：UGC 征集 & 电商承接'] },
      { type: 'data',       title: '传播目标与 KPI', points: ['预期曝光量 5000 万+', '直播观看 200 万+', '话题热搜 TOP 10', '社媒互动率 ≥ 8%'] },
      { type: 'content',    title: '场地与搭建方案', points: ['主舞台视觉设计方向', '互动体验区规划', '媒体采访区布置'] },
      { type: 'two_column', title: '预算规划',       points: ['场地与搭建 40%', '传播推广 35%', '嘉宾与接待 15%', '应急备用 10%'] },
      { type: 'timeline',   title: '执行时间线',     points: ['T-60天 场地确认', 'T-45天 媒体邀请', 'T-30天 物料制作', 'T-7天 彩排走场', 'T+1天 复盘报告'] },
      { type: 'content',    title: '风险预案',       points: ['设备故障应急方案', '嘉宾缺席替代预案', '舆情管理预案'] },
      { type: 'end',        title: '感谢',           note: '联系信息 + 项目组署名' },
    ],
  },
  {
    id: 'auto-show',
    name: '汽车展览会',
    desc: '车型介绍、试驾安排与展台视觉设计，打造沉浸式品牌体验',
    icon: PhCar,
    accent: '#374151',
    duration: '3-5 天',
    span: 5,
    tags: ['展览', '汽车', '体验'],
    prompt: '帮我做一个汽车展览会的活动策划PPT，',
    slides: [
      { type: 'cover',      title: '品牌车展策划',   note: '主视觉：旗舰车型侧面 + 展会标题 + 参展日期' },
      { type: 'toc',        title: '策划目录',       points: ['品牌定位', '参展车型', '展台设计', '试驾方案', '传播计划', '预算时间线'] },
      { type: 'content',    title: '品牌参展定位',   points: ['本届车展核心传播主题', '目标受众画像与购车决策路径', '差异化竞争策略'] },
      { type: 'cards',      title: '参展车型矩阵',   points: ['旗舰轿车：全球首发款', '新能源 SUV：量产上市版', '概念车：未来出行愿景', '运动款：限量特别版'] },
      { type: 'two_column', title: '展台空间规划',   points: ['主展台：旗舰车型 360° 舞台', '互动区：科技配置体验舱', '洽谈区：VIP 接待室', '媒体区：独立采访间'] },
      { type: 'content',    title: '展台视觉方案',   points: ['主色调与材质方向', '灯光设计与动态显示', '品牌 IP 互动装置'] },
      { type: 'timeline',   title: '试驾活动方案',   points: ['媒体试驾日 (Day 1)', '专业买家试驾 (Day 2)', '公众开放试驾 (Day 3-5)', '试驾路线规划', '安全保障方案'] },
      { type: 'content',    title: '现场活动设计',   points: ['发布会 / 技术说明会', 'VIP 客户专属体验日', '互动游戏与礼品方案'] },
      { type: 'two_column', title: '传播方案',       points: ['展前：悬念预热 + 媒体提前探营', '展中：直播 + 实时话题运营', '展后：精华内容二次传播'] },
      { type: 'data',       title: '预期成效',       points: ['到场观众目标 8 万人次', '媒体曝光 2 亿次+', '线索收集 5000 条', '意向订单 300+'] },
      { type: 'two_column', title: '预算分解',       points: ['展台搭建 45%', '车辆运输与保险 15%', '传播推广 25%', '接待与人员 15%'] },
      { type: 'end',        title: '感谢',           note: '项目组 + 联系方式' },
    ],
  },
  {
    id: 'annual-summit',
    name: '年度峰会',
    desc: '大会议程规划、演讲嘉宾阵容与分论坛管理，配合直播传播方案',
    icon: PhMicrophone,
    accent: '#0369a1',
    duration: '1-2 天',
    span: 5,
    tags: ['峰会', '行业', '直播'],
    prompt: '帮我做一个年度行业峰会的活动策划PPT，',
    slides: [
      { type: 'cover',      title: '年度峰会策划方案', note: '峰会主题视觉 + 时间地点 + 主办方' },
      { type: 'toc',        title: '策划目录',         points: ['峰会定位', '议程规划', '嘉宾矩阵', '会场方案', '直播传播', '执行保障'] },
      { type: 'content',    title: '峰会战略定位',     points: ['本届主题与核心议题', '目标群体：决策者 / 专业人士 / 媒体', '峰会品牌价值与往届回顾'] },
      { type: 'cards',      title: '峰会规模',         points: ['参会嘉宾 500+ 人', '演讲嘉宾 20+ 位', '分论坛 6 个', '合作媒体 50+'] },
      { type: 'timeline',   title: '主论坛议程 (Day 1)', points: ['09:00 开幕典礼 & 主旨演讲', '10:30 圆桌对话：行业趋势', '12:00 商务午餐 & 1v1 会面', '14:00 专题演讲 × 3', '16:00 闪电演讲 × 5', '18:00 颁奖晚宴'] },
      { type: 'timeline',   title: '分论坛议程 (Day 2)', points: ['论坛A：战略与投资', '论坛B：技术与创新', '论坛C：品牌与营销', '论坛D：出海与全球化', '论坛E：ESG 可持续', '论坛F：青年领袖'] },
      { type: 'cards',      title: '嘉宾阵容',         points: ['主旨演讲：行业顶级领袖 3 位', '圆桌嘉宾：上市公司 CEO × 5', '创业明星：独角兽创始人 × 4', '学界专家：顶尖研究机构 × 3'] },
      { type: 'two_column', title: '会场空间规划',     points: ['主论坛：3000 席宴会厅', '分论坛：6 个独立会议室', 'VIP 休息室 & 商务洽谈区', '展览区 & 赞助商展位'] },
      { type: 'content',    title: '直播传播方案',     points: ['多平台同步直播（官网/微博/视频号）', '实时文字直播与精华剪辑', '会后白皮书与演讲视频输出'] },
      { type: 'data',       title: '传播目标',         points: ['线下参会 500 人', '线上直播 50 万观看', '话题阅读量 3 亿+', '白皮书下载 1 万份+'] },
      { type: 'content',    title: '赞助权益体系',     points: ['首席赞助：全场权益 + 专属演讲', '战略赞助：展位 + 分论坛冠名', '支持赞助：品牌曝光 + 参会名额'] },
      { type: 'two_column', title: '预算规划',         points: ['场地与搭建 35%', '嘉宾接待差旅 20%', '传播与直播 25%', '餐饮与接待 20%'] },
      { type: 'timeline',   title: '执行时间线',       points: ['T-90天 主题确认', 'T-60天 嘉宾邀请', 'T-45天 赞助签约', 'T-30天 传播预热', 'T-7天 全流程彩排', 'T+7天 总结报告'] },
      { type: 'content',    title: '应急预案',         points: ['嘉宾临时缺席替代方案', '设备技术故障处理流程', '突发舆情应对机制'] },
      { type: 'end',        title: '感谢',             note: '主办方 / 承办方 / 合作伙伴鸣谢' },
    ],
  },
  {
    id: 'brand-anniversary',
    name: '品牌周年庆',
    desc: '品牌历程回顾、用户感恩互动与礼遇计划，强化情感连接与传播',
    icon: PhStar,
    accent: '#c2410c',
    duration: '1 天',
    span: 7,
    tags: ['品牌', '庆典', '用户'],
    prompt: '帮我做一个品牌周年庆活动策划PPT，',
    slides: [
      { type: 'cover',      title: 'X 周年庆典策划',   note: '品牌主视觉 + 周年标识 + 时间地点' },
      { type: 'toc',        title: '策划目录',          points: ['品牌历程', '活动主题', '感恩礼遇', '互动设计', '传播方案', '执行计划'] },
      { type: 'timeline',   title: '品牌发展历程',      points: ['创立初心与第一个里程碑', '关键增长节点（3 个）', '重大产品 / 服务突破', '当前规模与成就'] },
      { type: 'content',    title: '核心成就展示',      points: ['服务用户总量与增长曲线', '行业荣誉与媒体认可', '社会影响力数据'] },
      { type: 'content',    title: '周年庆主题方案',    points: ['主题定位：情感共鸣还是未来展望？', '视觉主题色 & 专属 LOGO', '核心 slogan 方向建议'] },
      { type: 'cards',      title: '用户感恩礼遇',      points: ['超级会员专属礼品盒', '老用户免费升级权益', '忠诚用户专属庆典邀请', '限量周年纪念款产品'] },
      { type: 'two_column', title: '现场活动设计',      points: ['品牌历史长廊 & 互动装置', '用户故事展区 & 征集视频', 'CEO 与用户圆桌对话', '周年纪念品抽奖环节'] },
      { type: 'content',    title: '明星 & KOL 助阵',   points: ['品牌代言人周年特别内容', '核心 KOL 邀请参与 & 传播', '用户代表 UGC 征集活动'] },
      { type: 'content',    title: '数字化互动方案',    points: ['专属 H5 时光机回忆生成', '话题挑战赛 & 投票活动', '线上直播 & 全球用户连线'] },
      { type: 'two_column', title: '传播方案',          points: ['预热期：用户故事征集 & 悬念', '爆发期：庆典直播 & 话题冲榜', '长尾期：纪念内容二次传播'] },
      { type: 'data',       title: '传播目标',          points: ['话题曝光 5 亿+', '直播观看 300 万+', 'UGC 内容 10 万条+', '品牌好感度提升 15%'] },
      { type: 'two_column', title: '预算规划',          points: ['用户礼品 30%', '活动场地 25%', '传播推广 30%', '接待与其他 15%'] },
      { type: 'end',        title: '感谢每一位陪伴者',  note: '感谢用户 + 团队 + 合作伙伴' },
    ],
  },
  {
    id: 'industry-forum',
    name: '行业论坛',
    desc: '议题框架搭建、圆桌讨论设计与会后白皮书输出，建立行业影响力',
    icon: PhUsers,
    accent: '#166534',
    duration: '半天',
    span: 6,
    tags: ['论坛', '圆桌', '白皮书'],
    prompt: '帮我做一个行业论坛的活动策划PPT，',
    slides: [
      { type: 'cover',      title: '行业论坛策划方案', note: '论坛主题视觉 + 主办方 + 时间地点' },
      { type: 'toc',        title: '策划目录',         points: ['论坛定位', '议题框架', '嘉宾阵容', '圆桌设计', '会后输出', '赞助方案'] },
      { type: 'content',    title: '论坛战略定位',     points: ['本届核心议题与行业痛点', '目标参会群体：高管 / 专家 / 投资人', '论坛品牌价值主张'] },
      { type: 'cards',      title: '四大核心议题',     points: ['议题一：行业变革趋势研判', '议题二：技术创新落地路径', '议题三：政策环境与合规应对', '议题四：全球化机遇与挑战'] },
      { type: 'two_column', title: '嘉宾阵容',         points: ['主题演讲：行业权威专家 × 3', '圆桌主持：资深行业观察者', '对话嘉宾：头部企业高管 × 6', '特邀观察：政策研究机构'] },
      { type: 'timeline',   title: '论坛议程',         points: ['09:00 开场 & 主题演讲', '10:00 专题对话 × 2', '11:30 圆桌讨论（封闭式）', '12:30 工作午餐 & 1v1 交流', '14:00 行业倡议发布', '14:30 闭幕总结'] },
      { type: 'content',    title: '圆桌讨论设计',     points: ['议题聚焦方向与主持人提纲', '参与嘉宾遴选标准', '讨论成果呈现与共识声明形式'] },
      { type: 'content',    title: '互动参与设计',     points: ['现场问答 & 话题投票', '行业调研实时数据发布', '参会者专属 APP 互动功能'] },
      { type: 'two_column', title: '会后成果输出',     points: ['行业白皮书（精华版 / 完整版）', '圆桌讨论实录整理', '演讲视频及 PPT 开放下载', '媒体报道与专访内容'] },
      { type: 'content',    title: '赞助权益体系',     points: ['首席赞助：冠名权 + 主旨演讲', '共同主办：议题设置参与权', '支持赞助：展位 + 品牌曝光'] },
      { type: 'end',        title: '感谢',             note: '主办方 / 合作机构 / 赞助伙伴' },
    ],
  },
  {
    id: 'roadshow',
    name: '路演推介',
    desc: '投资人洞察、核心指标呈现与融资逻辑闭环，为资本对话做充分准备',
    icon: PhChartBar,
    accent: '#3730a3',
    duration: '20-30 分钟',
    span: 6,
    tags: ['融资', '投资人', '数据'],
    prompt: '帮我做一个融资路演推介的PPT，',
    slides: [
      { type: 'cover',      title: '融资路演',         note: '公司 Logo + 核心一句话定位 + 融资轮次' },
      { type: 'content',    title: '公司使命',         points: ['一句话描述解决什么问题', '核心愿景与长期目标', '为什么是现在'] },
      { type: 'content',    title: '市场机会',         points: ['目标市场规模 TAM / SAM / SOM', '市场增速与驱动因素', '政策 & 产业背景利好'] },
      { type: 'content',    title: '痛点与解决方案',   points: ['现有方案的核心缺陷', '我们的差异化解决路径', '产品 / 服务核心功能演示'] },
      { type: 'data',       title: '产品核心数据',     points: ['活跃用户数 & 增长趋势', '关键留存率 & NPS 分数', '核心效率指标对比行业基准'] },
      { type: 'content',    title: '技术与产品壁垒',   points: ['核心技术专利 / 算法优势', '数据飞轮与网络效应', '关键资源与不可复制性'] },
      { type: 'two_column', title: '商业模式',         points: ['收入来源与定价逻辑', '获客成本 CAC vs 用户价值 LTV', '毛利率结构与改善路径'] },
      { type: 'data',       title: '财务表现',         points: ['近 12 个月 ARR / GMV 增长', '月均收入及增速', '当前 Burn Rate & Runway'] },
      { type: 'cards',      title: '竞争格局',         points: ['直接竞争对手矩阵分析', '差异化维度比较', '行业第一梯队与我们的关系'] },
      { type: 'content',    title: '增长策略',         points: ['获客渠道与 GTM 计划', '产品路线图（18 个月）', '关键里程碑与节点'] },
      { type: 'cards',      title: '核心团队',         points: ['CEO：背景与相关经验', 'CTO：技术能力证明', '核心高管：行业资源', '顾问：背书与赋能'] },
      { type: 'content',    title: '融资计划',         points: ['本轮融资金额与估值', '资金使用分配（产品/销售/团队）', '使用后能达到的里程碑'] },
      { type: 'data',       title: '股权结构',         points: ['现有股东及持股比例', '本轮稀释比例', '期权池预留方案'] },
      { type: 'content',    title: '已有投资方',       points: ['现有机构投资人背书', '战略资源与赋能能力', '联合投资欢迎方向'] },
      { type: 'two_column', title: '关键风险与应对',   points: ['市场风险 & 应对策略', '技术风险 & 备选路径', '监管风险 & 合规准备'] },
      { type: 'content',    title: '为什么现在投？',   points: ['市场窗口期判断', '团队当前动能证明', '本轮投资后的价值创造路径'] },
      { type: 'end',        title: '期待合作',         note: '联系方式 + 数据室访问申请' },
    ],
  },
]

/* ─────────────── Layout Templates ─────────────── */
const layoutTemplates = [
  {
    id: 'deep-blue-gold',
    name: '深邃蓝金',
    desc: '藏青与金色交织，高端峰会与颁奖典礼首选',
    primary: '#1e3a5f',
    accent: '#d4af37',
    bgColor: '#f8fafc',
    coverBg: 'linear-gradient(135deg, #1e3a5f 0%, #0f2744 100%)',
    contentBg: '#ffffff',
    endBg: '#0a1929',
    titleColor: '#d4af37',
    colors: ['#1e3a5f', '#d4af37', '#f8fafc', '#0f2744'],
  },
  {
    id: 'minimal-white',
    name: '极简白',
    desc: '黑白极简主义，现代艺术与高端展览专用',
    primary: '#18181b',
    bgColor: '#ffffff',
    coverBg: '#ffffff',
    contentBg: '#ffffff',
    endBg: '#09090b',
    titleColor: '#18181b',
    colors: ['#18181b', '#09090b', '#ffffff', '#71717a'],
  },
  {
    id: 'cyber-orange',
    name: '活力橙黑',
    desc: '黑橙强对比，科技产品发布与创投活动专用',
    primary: '#f97316',
    bgColor: '#fff7ed',
    coverBg: 'linear-gradient(135deg, #1c1917 0%, #292524 100%)',
    contentBg: '#fff7ed',
    endBg: '#1c1917',
    titleColor: '#f97316',
    colors: ['#f97316', '#1c1917', '#fff7ed', '#292524'],
  },
  {
    id: 'nature-green',
    name: '自然绿',
    desc: '绿色渐变，健康公益与可持续发展主题活动',
    primary: '#059669',
    bgColor: '#f0fdf4',
    coverBg: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
    contentBg: '#f0fdf4',
    endBg: '#064e3b',
    titleColor: '#ffffff',
    colors: ['#059669', '#047857', '#d1fae5', '#064e3b'],
  },
  {
    id: 'elegant-purple',
    name: '优雅紫',
    desc: '紫粉渐变，时尚品牌与女性论坛活动',
    primary: '#7c3aed',
    bgColor: '#faf5ff',
    coverBg: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)',
    contentBg: '#faf5ff',
    endBg: '#4c1d95',
    titleColor: '#ffffff',
    colors: ['#7c3aed', '#a855f7', '#faf5ff', '#4c1d95'],
  },
  {
    id: 'red-gala',
    name: '红色庆典',
    desc: '深红金配色，年会颁奖与奢华庆典专用',
    primary: '#dc2626',
    accent: '#fbbf24',
    bgColor: '#fef2f2',
    coverBg: 'linear-gradient(135deg, #991b1b 0%, #dc2626 100%)',
    contentBg: '#fef2f2',
    endBg: '#450a0a',
    titleColor: '#fbbf24',
    colors: ['#dc2626', '#991b1b', '#fef2f2', '#fbbf24'],
  },
  {
    id: 'space-gray',
    name: '深空灰金',
    desc: '深灰与金，低调奢华，投资路演与私募首选',
    primary: '#64748b',
    accent: '#fbbf24',
    bgColor: '#f8fafc',
    coverBg: 'linear-gradient(135deg, #334155 0%, #0f172a 100%)',
    contentBg: '#f8fafc',
    endBg: '#020617',
    titleColor: '#fbbf24',
    colors: ['#334155', '#0f172a', '#fbbf24', '#f8fafc'],
  },
  {
    id: 'soft-pink',
    name: '柔和粉',
    desc: '粉色渐变，女性峰会、美妆与生活方式活动',
    primary: '#ec4899',
    bgColor: '#fdf2f8',
    coverBg: 'linear-gradient(135deg, #ec4899 0%, #f472b6 100%)',
    contentBg: '#fdf2f8',
    endBg: '#831843',
    titleColor: '#ffffff',
    colors: ['#ec4899', '#f472b6', '#fdf2f8', '#831843'],
  },
  {
    id: 'industrial',
    name: '工业风',
    desc: '水泥金属质感，创投论坛与建筑主题活动',
    primary: '#78716c',
    accent: '#f59e0b',
    bgColor: '#fafaf9',
    coverBg: 'linear-gradient(135deg, #44403c 0%, #292524 100%)',
    contentBg: '#fafaf9',
    endBg: '#1c1917',
    titleColor: '#fafaf9',
    accentColor: '#f59e0b',
    colors: ['#44403c', '#292524', '#fafaf9', '#f59e0b'],
  },
  {
    id: 'chinese-ink',
    name: '水墨风',
    desc: '黑白水墨意境，国潮文化与传统品牌活动',
    primary: '#18181b',
    bgColor: '#fafaf9',
    coverBg: 'linear-gradient(180deg, #18181b 0%, #09090b 100%)',
    contentBg: '#fafaf9',
    endBg: '#0c0a09',
    titleColor: '#18181b',
    colors: ['#18181b', '#09090b', '#fafaf9', '#525252'],
  },
  {
    id: 'ocean-blue',
    name: '海洋蓝',
    desc: '深海渐变，航海主题与海洋环保活动',
    primary: '#0369a1',
    bgColor: '#f0f9ff',
    coverBg: 'linear-gradient(180deg, #0369a1 0%, #0c4a6e 100%)',
    contentBg: '#f0f9ff',
    endBg: '#082f49',
    titleColor: '#ffffff',
    colors: ['#0369a1', '#0c4a6e', '#e0f2fe', '#082f49'],
  },
  {
    id: 'amber',
    name: '琥珀色',
    desc: '琥珀金调，高端酒会、威士忌与雪茄活动',
    primary: '#b45309',
    bgColor: '#fffbeb',
    coverBg: 'linear-gradient(135deg, #92400e 0%, #b45309 100%)',
    contentBg: '#fffbeb',
    endBg: '#78350f',
    titleColor: '#ffffff',
    colors: ['#b45309', '#92400e', '#fffbeb', '#78350f'],
  },
  {
    id: 'aurora',
    name: '极光色',
    desc: '青紫极光渐变，音乐节与电子科技活动',
    primary: '#06b6d4',
    accent: '#8b5cf6',
    bgColor: '#f5f3ff',
    coverBg: 'linear-gradient(135deg, #0891b2 0%, #7c3aed 50%, #db2777 100%)',
    contentBg: '#f5f3ff',
    endBg: '#4c1d95',
    titleColor: '#ffffff',
    colors: ['#06b6d4', '#8b5cf6', '#f5f3ff', '#4c1d95'],
  },
  {
    id: 'marble',
    name: '大理石白',
    desc: '黑白大理石纹，奢侈品与高端珠宝活动',
    primary: '#374151',
    accent: '#d4af37',
    bgColor: '#ffffff',
    coverBg: 'linear-gradient(135deg, #1f2937 0%, #111827 100%)',
    contentBg: '#ffffff',
    endBg: '#030712',
    titleColor: '#ffffff',
    colors: ['#111827', '#374151', '#ffffff', '#d4af37'],
  },
  {
    id: 'cyberpunk',
    name: '赛博朋克',
    desc: '霓虹深色，科技展会与游戏发布会',
    primary: '#06b6d4',
    accent: '#f0abfc',
    bgColor: '#18181b',
    coverBg: 'linear-gradient(135deg, #0c0a0f 0%, #1e1b4b 50%, #0c0a0f 100%)',
    contentBg: '#18181b',
    endBg: '#050508',
    titleColor: '#06b6d4',
    colors: ['#06b6d4', '#f0abfc', '#18181b', '#0c0a0f'],
  },
  {
    id: 'morandi',
    name: '莫兰迪',
    desc: '低饱和莫兰迪色系，低调奢华与艺术活动',
    primary: '#6b7280',
    accent: '#a8a29e',
    bgColor: '#f9fafb',
    coverBg: 'linear-gradient(135deg, #6b7280 0%, #57534e 100%)',
    contentBg: '#f9fafb',
    endBg: '#44403c',
    titleColor: '#fafaf9',
    colors: ['#6b7280', '#57534e', '#f9fafb', '#a8a29e'],
  },
  {
    id: 'vintage',
    name: '复古风',
    desc: '棕绿色复古调，老字号品牌与文化活动',
    primary: '#78716c',
    accent: '#166534',
    bgColor: '#fef7ed',
    coverBg: 'linear-gradient(135deg, #78716c 0%, #57534e 100%)',
    contentBg: '#fef7ed',
    endBg: '#292524',
    titleColor: '#fef7ed',
    colors: ['#78716c', '#57534e', '#fef7ed', '#166534'],
  },
  {
    id: 'contemporary',
    name: '当代艺术',
    desc: '黑白红极简，当代艺术展与画廊活动',
    primary: '#18181b',
    accent: '#ef4444',
    bgColor: '#ffffff',
    coverBg: 'linear-gradient(135deg, #18181b 0%, #09090b 100%)',
    contentBg: '#ffffff',
    endBg: '#0c0a09',
    titleColor: '#18181b',
    colors: ['#18181b', '#09090b', '#ffffff', '#ef4444'],
  },
  {
    id: 'nordic',
    name: '北欧风',
    desc: '蓝白北欧设计，家居品牌与极简生活活动',
    primary: '#1e40af',
    bgColor: '#f8fafc',
    coverBg: 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%)',
    contentBg: '#f8fafc',
    endBg: '#1e3a8a',
    titleColor: '#ffffff',
    colors: ['#1e3a8a', '#1e40af', '#f8fafc', '#dbeafe'],
  },
  {
    id: 'tropical',
    name: '热带海岛',
    desc: '青绿热带风情，海岛度假村与旅游推广活动',
    primary: '#0891b2',
    accent: '#84cc16',
    bgColor: '#f0fdf4',
    coverBg: 'linear-gradient(135deg, #0891b2 0%, #0e7490 50%, #84cc16 100%)',
    contentBg: '#f0fdf4',
    endBg: '#134e4a',
    titleColor: '#ffffff',
    colors: ['#0891b2', '#0e7490', '#f0fdf4', '#84cc16'],
  },
]

/* ── Active layout ── */
const activeLayoutId = ref(localStorage.getItem('oc_active_layout') || '')
function applyLayout(tpl) {
  activeLayoutId.value = tpl.id
  localStorage.setItem('oc_active_layout', tpl.id)
  showToast(`已应用「${tpl.name}」风格`)
}

function usePlanningTemplate(tpl) {
  sessionStorage.setItem('oc_prefill_prompt', tpl.prompt)
  router.push('/agent')
}

/* ── Toast ── */
const toastVisible = ref(false)
const toastText    = ref('')
let   toastTimer   = null
function showToast(text) {
  toastText.value    = text
  toastVisible.value = true
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastVisible.value = false }, 2800)
}

/* ── Spotlight ── */
function onSpotlight(e) {
  const el = e.currentTarget, r = el.getBoundingClientRect()
  el.style.setProperty('--glow-x', `${e.clientX - r.left}px`)
  el.style.setProperty('--glow-y', `${e.clientY - r.top}px`)
}
function clearSpotlight(e) {
  const el = e.currentTarget
  el.style.removeProperty('--glow-x')
  el.style.removeProperty('--glow-y')
}
</script>

<style scoped>
.tpl-root {
  height: 100%;
  overflow: hidden;
  padding: 32px 36px 0;
  background: #faf9f7;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* ── Header ── */
.tpl-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  flex-shrink: 0;
}
.tpl-category-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  color: #44403c;
  background: rgba(68,64,60,0.08);
  padding: 4px 10px;
  border-radius: 10px;
  margin-bottom: 8px;
  letter-spacing: 0.3px;
}
.tpl-title  { margin: 0 0 4px; font-size: 22px; font-weight: 700; color: #1c1917; letter-spacing: -0.4px; }
.tpl-subtitle { margin: 0; font-size: 13px; color: #a8a29e; }

.tpl-tabs { display: flex; gap: 4px; background: rgba(68,64,60,0.06); border-radius: 10px; padding: 3px; flex-shrink: 0; }
.tab-pill {
  display: flex; align-items: center; gap: 5px; padding: 6px 14px;
  border: none; background: transparent; border-radius: 7px;
  font-family: inherit; font-size: 13px; font-weight: 500; color: #57534e;
  cursor: pointer; white-space: nowrap;
  transition: background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
}
.tab-pill.active { background: #fff; color: #1c1917; box-shadow: 0 1px 4px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04); }

/* ── Body ── */
.tpl-body {
  flex: 1; overflow: hidden;
  display: flex; flex-direction: column; min-height: 0;
}
.tpl-body > .fade-up {
  flex: 1; overflow-y: auto; padding-bottom: 32px; min-width: 0;
}

/* ── Planning grid ── */
.planning-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; align-content: start; }

.plan-card {
  position: relative; background: #fff; border-radius: 10px;
  border: 1.5px solid rgba(0,0,0,0.06); cursor: pointer; overflow: hidden;
  animation: card-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: calc(var(--index, 0) * 55ms);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform;
  min-height: 180px;
}
.plan-card:hover  { border-color: rgba(0,0,0,0.1); box-shadow: 0 8px 32px rgba(0,0,0,0.07); transform: translateY(-2px); }
.plan-card:active { transform: translateY(0) scale(0.99); }
.plan-card.selected { border-color: var(--ink-strong); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ink-strong) 12%, transparent); }

.card-glow {
  pointer-events: none; position: absolute; inset: 0; border-radius: inherit; z-index: 0;
  background: radial-gradient(280px circle at var(--glow-x, -999px) var(--glow-y, -999px),
    color-mix(in srgb, var(--accent) 8%, transparent), transparent 65%);
}
.card-inner { position: relative; z-index: 1; padding: 20px 22px 18px; display: flex; flex-direction: column; gap: 12px; height: 100%; min-height: 160px; }
.card-top { display: flex; align-items: center; justify-content: space-between; }
.card-icon { width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.card-slides-badge { font-size: 11px; font-weight: 600; color: #a8a29e; background: rgba(68,64,60,0.06); padding: 3px 8px; border-radius: 10px; }
.card-text { flex: 1; }
.card-name { margin: 0 0 5px; font-size: 15px; font-weight: 700; color: #1c1917; letter-spacing: -0.2px; }
.card-desc { margin: 0; font-size: 12.5px; color: #57534e; line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.outline-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: auto; }
.chip { font-size: 11px; font-weight: 500; color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); padding: 3px 9px; border-radius: 10px; white-space: nowrap; }
.card-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 8px; border-top: 1px solid rgba(0,0,0,0.05); margin-top: auto; }
.footer-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.tag { font-size: 10.5px; color: #a8a29e; background: rgba(68,64,60,0.06); padding: 2px 7px; border-radius: 10px; white-space: nowrap; }
.preview-btn {
  display: flex; align-items: center; gap: 4px; padding: 5px 12px;
  border: 1.5px solid rgba(68,64,60,0.15); background: transparent; color: #44403c;
  font-family: inherit; font-size: 11.5px; font-weight: 600; border-radius: 8px;
  cursor: pointer; white-space: nowrap; flex-shrink: 0;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
}
.preview-btn:hover  { background: rgba(68,64,60,0.04); border-color: rgba(68,64,60,0.25); }
.preview-btn:active { transform: scale(0.96); }

/* ── Layout grid ── */
.layout-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; align-content: start; }

.layout-card {
  position: relative; background: #fff; border-radius: 10px;
  border: 1.5px solid rgba(0,0,0,0.07); cursor: pointer; overflow: hidden;
  animation: card-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: calc(var(--index, 0) * 60ms);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform;
}
.layout-card:hover  { border-color: rgba(0,0,0,0.12); box-shadow: 0 8px 28px rgba(0,0,0,0.07); transform: translateY(-2px); }
.layout-card:active { transform: scale(0.99); }
.layout-card.active, .layout-card.selected { border-color: #165dff; box-shadow: 0 0 0 3px rgba(22, 93, 255, 0.1); }
.active-ring { pointer-events: none; position: absolute; inset: 0; border-radius: inherit; background: rgba(22,93,255,0.025); }

.slide-strip { display: flex; gap: 6px; padding: 14px 14px 12px; background: rgba(68,64,60,0.03); border-bottom: 1px solid rgba(0,0,0,0.05); }
.mini-slide { flex: 1; aspect-ratio: 16/9; border-radius: 4px; overflow: hidden; position: relative; }
.mini-slide--cover {
  display: flex;
  align-items: center;
  justify-content: center;
}
.ms-cover {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 0 8px;
  width: 100%;
}
.ms-cover-brand {
  font-size: 5px;
  font-weight: 500;
}
.ms-cover-title {
  font-size: 8px;
  font-weight: 700;
  letter-spacing: -0.2px;
}
.ms-cover-divider {
  width: 16px;
  height: 1.5px;
  border-radius: 1px;
  margin-top: 1px;
}
.mini-slide--content {
  display: flex;
  flex-direction: column;
}
.ms-content-header {
  height: 5px;
}
.ms-content-body {
  flex: 1;
  padding: 5px 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.ms-content-title {
  font-size: 6px;
  font-weight: 700;
}
.ms-lines {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ms-line-full {
  height: 2px;
  border-radius: 1px;
}
.ms-line-partial {
  height: 2px;
  border-radius: 1px;
  width: 60%;
}
.mini-slide--end {
  display: flex;
  align-items: center;
  justify-content: center;
}
.ms-end {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.ms-end-circle {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1.5px solid;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ms-end-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
}
.ms-end-title {
  font-size: 5px;
  font-weight: 600;
}

.layout-meta { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 6px; }
.layout-name-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.layout-name { font-size: 14px; font-weight: 700; color: #1c1917; letter-spacing: -0.2px; }
.active-badge { display: flex; align-items: center; gap: 3px; font-size: 11px; font-weight: 600; color: #165dff; background: rgba(22,93,255,0.08); padding: 2px 8px; border-radius: 10px; flex-shrink: 0; }
.layout-desc { margin: 0; font-size: 12px; color: #a8a29e; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.swatches { display: flex; gap: 5px; margin-top: 2px; }
.swatch { width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,0.7); box-shadow: 0 1px 3px rgba(0,0,0,0.15); display: inline-block; }

/* ── Modal ── */
.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}
.modal-header-left {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.modal-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #44403c;
  background: rgba(68,64,60,0.08);
  padding: 5px 12px;
  border-radius: 10px;
}
.modal-title {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  color: #1c1917;
  letter-spacing: -0.4px;
}
.modal-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.modal-badge-tag {
  font-size: 11px;
  font-weight: 500;
  color: #57534e;
  background: rgba(68,64,60,0.06);
  padding: 3px 10px;
  border-radius: 10px;
}
.modal-badge-tag.active {
  color: #165dff;
  background: rgba(22,93,255,0.08);
}
.modal-icon-wrap {
  width: 52px;
  height: 52px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.modal-color-swatch {
  width: 52px;
  height: 52px;
  border-radius: 8px;
  flex-shrink: 0;
}
.modal-color-swatch-lg {
  width: 80px;
  height: 80px;
  border-radius: 10px;
  flex-shrink: 0;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
}

.layout-style-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

/* Slide preview */
.modal-slides-preview {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}
.modal-slide-preview-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.msp-slide {
  aspect-ratio: 16/10;
  border-radius: 6px;
  overflow: hidden;
  position: relative;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
}
.msp-slide--cover {
  display: flex;
  align-items: center;
  justify-content: center;
}
.msp-cover-content {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 0 14px;
  width: 100%;
}
.msp-cover-brand {
  font-size: 6px;
  font-weight: 500;
  letter-spacing: 0.5px;
}
.msp-cover-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: -0.3px;
  line-height: 1.2;
}
.msp-cover-divider {
  width: 24px;
  height: 2px;
  border-radius: 1px;
  margin: 2px 0;
}
.msp-cover-info {
  font-size: 6px;
}
.msp-slide--content {
  display: flex;
  flex-direction: column;
}
.msp-content-header {
  padding: 6px 10px;
}
.msp-content-header-title {
  font-size: 8px;
  font-weight: 600;
}
.msp-content-body {
  flex: 1;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.msp-content-main {
  font-size: 7px;
  font-weight: 700;
}
.msp-content-lines {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.msp-line-full {
  height: 3px;
  border-radius: 2px;
}
.msp-line-partial {
  height: 3px;
  border-radius: 2px;
  width: 65%;
}
.msp-content-chips {
  margin-top: 2px;
}
.msp-chip {
  font-size: 6px;
  font-weight: 600;
  padding: 2px 5px;
  border-radius: 3px;
}
.msp-two-col {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.msp-col-item {
  display: flex;
  align-items: center;
  gap: 4px;
}
.msp-col-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  flex-shrink: 0;
}
.msp-col-line {
  height: 4px;
  flex: 1;
  border-radius: 2px;
}
.msp-slide--end {
  display: flex;
  align-items: center;
  justify-content: center;
}
.msp-end-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}
.msp-end-circle {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid;
  display: flex;
  align-items: center;
  justify-content: center;
}
.msp-end-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.msp-end-title {
  font-size: 8px;
  font-weight: 700;
}
.msp-end-sub {
  font-size: 5px;
  font-weight: 600;
  letter-spacing: 1px;
}
.msp-end-contact {
  font-size: 5px;
  margin-top: 1px;
}
.msp-label {
  font-size: 9px;
  color: #a8a29e;
  text-align: center;
}
.style-tag {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 14px;
  background: #fafaf9;
  border-radius: 10px;
  border: 1px solid rgba(0,0,0,0.04);
  min-width: 100px;
}
.style-tag-label {
  font-size: 10px;
  color: #a8a29e;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.style-tag-value {
  font-size: 12px;
  font-weight: 600;
  color: #44403c;
}
.modal-desc {
  margin: 0 0 12px;
  font-size: 13px;
  color: #57534e;
  line-height: 1.5;
}
.modal-section-title {
  font-size: 11px;
  font-weight: 700;
  color: #44403c;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  margin-bottom: 10px;
}

/* Document outline */
.modal-doc-outline {
  display: flex;
  flex-direction: column;
  background: #fafaf9;
  border-radius: 10px;
  max-height: 280px;
  overflow-y: auto;
}
.doc-item {
  padding: 8px 16px;
  border-bottom: 1px solid rgba(0,0,0,0.04);
}
.doc-item:last-child {
  border-bottom: none;
}
.doc-item-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.doc-num {
  font-size: 10px;
  font-weight: 600;
  color: #a8a29e;
  font-variant-numeric: tabular-nums;
  width: 18px;
  flex-shrink: 0;
}
.doc-title {
  font-size: 12px;
  color: #1c1917;
  font-weight: 500;
}
.doc-points {
  margin: 3px 0 0 28px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  list-style: none;
}
.doc-points li {
  font-size: 11px;
  color: #57534e;
  line-height: 1.5;
  padding-left: 10px;
  position: relative;
}
.doc-points li::before {
  content: '—';
  position: absolute;
  left: 0;
  color: #d4d0cb;
}

/* Modal footer */
.modal-footer {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
  padding-top: 12px;
  background: #fff;
  border-top: 1px solid rgba(0,0,0,0.06);
}

/* Prompt preview */
.modal-prompt-section {
  margin-top: 12px;
}
.modal-prompt-preview {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: linear-gradient(135deg, rgba(68,64,60,0.03) 0%, rgba(68,64,60,0.06) 100%);
  border: 1px solid rgba(0,0,0,0.06);
  border-radius: 8px;
  padding: 10px 12px;
}
.prompt-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: rgba(68,64,60,0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #44403c;
  flex-shrink: 0;
}
.prompt-content {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
}
.prompt-text {
  font-size: 12px;
  color: #44403c;
  line-height: 1.5;
}
.prompt-cursor {
  color: #44403c;
  font-weight: 700;
  animation: blink 1.1s step-end infinite;
}
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
.prompt-hint {
  margin: 4px 0 0;
  font-size: 11px;
  color: #a8a29e;
}
.modal-tags { display: flex; gap: 5px; flex-wrap: wrap; }
.modal-tag {
  font-size: 11px;
  color: #57534e;
  background: rgba(68,64,60,0.06);
  padding: 4px 10px;
  border-radius: 10px;
}
.modal-use-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  border: none;
  color: #fff;
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  border-radius: 10px;
  cursor: pointer;
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.modal-use-btn:hover { opacity: 0.88; }
.modal-use-btn:active { transform: scale(0.97); }
.modal-use-btn.layout { width: 100%; justify-content: center; margin-top: 24px; }

.modal-palette {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.modal-palette-chip {
  flex: 1;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal-palette-hex {
  font-size: 8px;
  font-weight: 700;
  color: rgba(255,255,255,0.9);
  text-shadow: 0 1px 2px rgba(0,0,0,0.3);
}

/* Toast */
.toast {
  position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 6px; padding: 9px 18px;
  background: #1c1917; color: #fff; font-size: 13px; font-weight: 500;
  border-radius: 100px; box-shadow: 0 4px 20px rgba(0,0,0,0.22);
  white-space: nowrap; z-index: 200; pointer-events: none;
}

/* Transitions */
@keyframes card-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

.fade-up-enter-active { transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.16, 1, 0.3, 1); }
.fade-up-leave-active { transition: opacity 0.14s ease, transform 0.14s ease; }
.fade-up-enter-from   { opacity: 0; transform: translateY(6px); }
.fade-up-leave-to     { opacity: 0; transform: translateY(-4px); }

.toast-slide-enter-active { transition: opacity 0.22s ease, transform 0.28s cubic-bezier(0.16, 1, 0.3, 1); }
.toast-slide-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.toast-slide-enter-from   { opacity: 0; transform: translateX(-50%) translateY(10px); }
.toast-slide-leave-to     { opacity: 0; transform: translateX(-50%) translateY(6px); }

/* Fullscreen trigger */
.fullscreen-trigger {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px; font-size: 11px; font-weight: 600;
  background: rgba(0,0,0,0.06); color: #57534e;
  border: none; border-radius: 6px; cursor: pointer; margin-left: 10px;
  transition: background 0.15s;
}
.fullscreen-trigger:hover { background: rgba(0,0,0,0.1); }

/* Slide hover overlay */
.msp-hover-overlay {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.4); opacity: 0; transition: opacity 0.15s;
  border-radius: 6px;
}
.modal-slide-preview-card:hover .msp-hover-overlay { opacity: 1; }
.modal-slide-preview-card { cursor: pointer; }

/* Fullscreen PPT Preview */
.fullscreen-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.92); z-index: 9999;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  outline: none;
}
.fullscreen-header {
  position: absolute; top: 0; left: 0; right: 0;
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 24px; background: rgba(0,0,0,0.5); backdrop-filter: blur(8px);
}
.fullscreen-title { font-size: 15px; font-weight: 700; color: #fff; }
.fullscreen-counter { font-size: 13px; color: rgba(255,255,255,0.6); font-weight: 500; }
.fullscreen-close {
  width: 36px; height: 36px; border-radius: 50%; border: none;
  background: rgba(255,255,255,0.1); color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s;
}
.fullscreen-close:hover { background: rgba(255,255,255,0.2); }

.fullscreen-slides {
  display: flex; align-items: center; gap: 20px; width: 100%;
  max-width: 1100px; padding: 0 20px;
}
.fullscreen-slide-wrap {
  flex: 1; display: flex; align-items: center; justify-content: center;
}
.fullscreen-slide {
  width: 100%; aspect-ratio: 16/9; border-radius: 8px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.5); overflow: hidden;
  position: relative;
}
.fullscreen-nav {
  width: 44px; height: 44px; border-radius: 50%; border: none;
  background: rgba(255,255,255,0.1); color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s; flex-shrink: 0;
}
.fullscreen-nav:hover { background: rgba(255,255,255,0.2); }
.fullscreen-nav--prev { }
.fullscreen-nav--next { }

.fullscreen-dots {
  position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 8px;
}
.fullscreen-dot {
  width: 8px; height: 8px; border-radius: 50%; border: none;
  background: rgba(255,255,255,0.3); cursor: pointer; transition: all 0.15s; padding: 0;
}
.fullscreen-dot.active { background: #fff; transform: scale(1.2); }

/* Fullscreen slide layouts */
.fs-cover {
  width: 100%; height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px;
  padding: 40px;
}
.fs-cover-brand { font-size: 14px; font-weight: 600; letter-spacing: 3px; text-transform: uppercase; }
.fs-cover-title { font-size: 42px; font-weight: 800; letter-spacing: -1px; text-align: center; line-height: 1.1; }
.fs-cover-divider { width: 60px; height: 3px; border-radius: 2px; }
.fs-cover-info { font-size: 14px; letter-spacing: 1px; }

.fs-toc {
  width: 100%; height: 100%; display: flex; flex-direction: column;
}
.fs-toc-header {
  padding: 30px 40px; display: flex; flex-direction: column; gap: 6px;
}
.fs-toc-label { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; opacity: 0.7; }
.fs-toc-title { font-size: 28px; font-weight: 700; }
.fs-toc-items {
  flex: 1; display: flex; flex-direction: column; gap: 0; padding: 20px 40px;
}
.fs-toc-item {
  display: flex; align-items: center; gap: 16px;
  padding: 14px 0; border-bottom: 1px solid;
}
.fs-toc-item:last-child { border-bottom: none; }
.fs-toc-num { font-size: 13px; font-weight: 700; opacity: 0.6; width: 24px; }
.fs-toc-text { font-size: 16px; font-weight: 600; }

.fs-content {
  width: 100%; height: 100%; display: flex; flex-direction: column;
}
.fs-content-header {
  padding: 24px 36px; display: flex; flex-direction: column; gap: 4px;
}
.fs-content-label { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; }
.fs-content-title { font-size: 22px; font-weight: 700; color: #fff; }
.fs-content-body {
  flex: 1; padding: 24px 36px; display: flex; flex-direction: column; gap: 16px;
}
.fs-content-subtitle { font-size: 16px; font-weight: 700; }
.fs-content-points { display: flex; flex-direction: column; gap: 12px; }
.fs-point { display: flex; align-items: flex-start; gap: 12px; }
.fs-point-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 5px; }
.fs-point-text { font-size: 14px; line-height: 1.6; opacity: 0.85; }

.fs-end {
  width: 100%; height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px;
}
.fs-end-circle {
  width: 60px; height: 60px; border-radius: 50%; border: 2px solid;
  display: flex; align-items: center; justify-content: center; margin-bottom: 8px;
}
.fs-end-dot { width: 16px; height: 16px; border-radius: 50%; }
.fs-end-title { font-size: 36px; font-weight: 800; }
.fs-end-sub { font-size: 14px; letter-spacing: 4px; font-weight: 600; }
.fs-end-contact { font-size: 13px; margin-top: 8px; }

/* Fullscreen transitions */
.fade-enter-active { transition: opacity 0.2s ease; }
.fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.slide-fade-enter-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.slide-fade-leave-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.slide-fade-enter-from { opacity: 0; transform: scale(0.98); }
.slide-fade-leave-to { opacity: 0; transform: scale(1.02); }

/* ╔════════════════════════════════════════════╗
   ║  CINEMA THEME OVERRIDES                     ║
   ╚════════════════════════════════════════════╝ */

.tpl-root { background: var(--bg-stage); color: var(--ink); }

/* Header */
.tpl-category-label {
  background: var(--bg-card-hover);
  color: var(--ink-2);
  border: 1px solid var(--line);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  border-radius: var(--radius-sm);
  padding: 4px 10px;
}
.tpl-title {
  color: var(--ink-strong);
  font-family: var(--font-serif);
  font-weight: 400;
  font-size: 32px;
  letter-spacing: -0.025em;
}
.tpl-subtitle {
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
}

/* Tab pills */
.tpl-tabs {
  background: var(--bg-card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 3px;
}
.tab-pill {
  color: var(--ink-2);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background: transparent;
}
.tab-pill:hover:not(.active) { color: var(--ink); background: var(--bg-card-hover); }
.tab-pill.active {
  background: var(--bg-card-hover);
  color: var(--ink-strong);
  box-shadow: inset 0 0 0 1px var(--line-strong);
}

/* ════════════════════════════════════════════
   Plan / Layout cards — Cinema Frame style
   21:9 黑场 still + REF stamp + 时间戳 + 衬线标题 + → 链接
   ════════════════════════════════════════════ */

.plan-card,
.layout-card {
  background: var(--bg-card);
  border: 1px solid var(--line);
  color: var(--ink);
  border-radius: var(--radius);
  overflow: hidden;
  display: flex !important;
  flex-direction: column;
  min-height: 280px;
  transition: transform var(--dur) var(--ease), border-color var(--dur) var(--ease);
}
.plan-card:hover,
.layout-card:hover {
  background: var(--bg-card-hover);
  border-color: var(--line-strong);
  transform: translateY(-2px);
  box-shadow: none;
}
.plan-card.selected,
.layout-card.selected {
  border-color: var(--line-strong);
  box-shadow: 0 0 0 1px var(--line-strong);
}

/* card-glow 关掉，cinema frame 不要这种光斑 */
.card-glow { display: none !important; }

/* card-inner 重排：top 撑开成 21:9 stage */
.card-inner {
  padding: 0 !important;
  gap: 0 !important;
  height: auto !important;
  min-height: 0 !important;
  display: flex !important;
  flex-direction: column;
}

/* card-top → 21:9 cinematic still */
.card-top {
  position: relative;
  aspect-ratio: 21/9;
  padding: 0 !important;
  background:
    radial-gradient(420px circle at 75% 30%, rgba(237,243,236,0.06), transparent 60%),
    radial-gradient(380px circle at 20% 80%, rgba(225,243,254,0.04), transparent 60%),
    linear-gradient(135deg, #2a2a28, #0e0e0d);
  overflow: hidden;
  border-bottom: 1px solid var(--line);
}
.card-top::before {
  /* 模糊抽象图形装饰 */
  content: '';
  position: absolute; inset: 0;
  background-image:
    radial-gradient(circle at 70% 50%, rgba(255,255,255,0.04) 0 80px, transparent 81px),
    radial-gradient(circle at 70% 50%, transparent 0 120px, rgba(255,255,255,0.02) 121px, transparent 130px);
  pointer-events: none;
}
.card-top::after {
  /* scrim 加深底部，让标签可读 */
  content: '';
  position: absolute; inset: 0;
  background: linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.5));
  pointer-events: none;
}

/* card-icon → 不再显示主区，改为左上角 REF stamp 容器（藏掉原 icon，用伪元素加文字） */
.card-icon {
  position: absolute !important;
  top: 14px !important;
  left: 14px !important;
  width: auto !important;
  height: auto !important;
  background: rgba(0,0,0,0.55) !important;
  color: var(--ink) !important;
  border: none !important;
  border-radius: 2px !important;
  padding: 4px 10px !important;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  backdrop-filter: blur(8px);
  z-index: 2;
}
.card-icon svg { width: 12px !important; height: 12px !important; opacity: 0.85; }

/* slides-badge → 右下角时间戳风 */
.card-slides-badge {
  position: absolute;
  bottom: 14px;
  right: 16px;
  background: transparent !important;
  color: rgba(255,255,255,0.7) !important;
  border: none !important;
  padding: 0 !important;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  z-index: 2;
}

/* card-text → body 区，padding 完整 */
.card-text {
  padding: 22px 24px 0 !important;
  flex: 0 0 auto !important;
}
.card-name {
  color: var(--ink-strong) !important;
  font-family: var(--font-serif) !important;
  font-weight: 400 !important;
  font-size: 18px !important;
  line-height: 1.3 !important;
  letter-spacing: -0.015em !important;
  margin: 0 0 8px !important;
}
.card-desc {
  color: var(--ink-3) !important;
  font-size: 12.5px !important;
  line-height: 1.6 !important;
  margin: 0 !important;
}

/* outline-chips（slide 标题）→ 转成"小帽来源"风格的内联文字行，去掉 chip 视觉 */
.outline-chips {
  padding: 12px 24px 0 !important;
  display: block !important;
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mute);
}
.outline-chips .chip {
  display: inline !important;
  background: transparent !important;
  color: inherit !important;
  border: none !important;
  padding: 0 !important;
  font: inherit !important;
  letter-spacing: inherit !important;
  text-transform: inherit !important;
}
/* chip 之间用 · 分隔 */
.outline-chips .chip + .chip::before {
  content: ' · ';
  color: var(--mute-2);
}

/* card-footer → 简化为底部链接行 */
.card-footer {
  padding: 16px 24px 18px !important;
  margin-top: auto !important;
  border-top: 1px solid var(--line);
}
.footer-tags { display: none !important; }

/* preview-btn → cinema underline link with → */
.preview-btn {
  background: transparent !important;
  border: none !important;
  border-bottom: 1px solid var(--ink) !important;
  border-radius: 0 !important;
  padding: 2px 0 !important;
  color: var(--ink) !important;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: color var(--dur) var(--ease), border-color var(--dur) var(--ease);
}
.preview-btn::after {
  content: '→';
  font-size: 13px;
  margin-left: 2px;
}
.preview-btn:hover {
  color: var(--accent) !important;
  border-color: var(--accent) !important;
  background: transparent !important;
}
/* 隐掉原本 PhEye 图标 */
.preview-btn svg { display: none !important; }

/* ════════════════════════════════════════════
   Layout cards (PPT 排版) — 保留 mini-slide 预览
   只统一 typography / 边框 / 色板 到 cinema 调
   ════════════════════════════════════════════ */

.layout-card {
  min-height: auto !important;
  display: flex !important;
  flex-direction: column;
}
.slide-strip {
  background: var(--bg-stage-2);
  padding: 10px;
  display: flex;
  gap: 6px;
  border-bottom: 1px solid var(--line);
}
.mini-slide {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}

.layout-meta {
  padding: 16px 18px 18px !important;
}
.layout-name {
  color: var(--ink-strong) !important;
  font-family: var(--font-serif) !important;
  font-weight: 400 !important;
  font-size: 16px !important;
  letter-spacing: -0.015em !important;
}
.layout-desc {
  color: var(--ink-3) !important;
  font-family: var(--font-sans);
  font-size: 12px !important;
  line-height: 1.6 !important;
}
.active-badge {
  background: var(--accent-soft) !important;
  color: var(--accent) !important;
  border: 1px solid var(--accent-line);
  font-family: var(--font-mono);
  font-size: 9.5px !important;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  border-radius: 2px !important;
  padding: 2px 6px !important;
}
.active-badge svg { display: none; }
.active-badge::before { content: '已应用'; font-family: inherit; }
/* 注：上面 ::before 会和模板里 "已应用" 文字重复，所以重新隐藏文字仅保留我们插入的 */
.active-badge { font-size: 0 !important; }
.active-badge::before { font-size: 9.5px !important; }

.swatches { gap: 5px !important; margin-top: 6px !important; }
.swatch {
  width: 10px !important;
  height: 10px !important;
  border: 1px solid var(--line) !important;
  box-shadow: none !important;
}
.active-badge {
  background: var(--ink-strong);
  color: var(--bg-stage);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.active-ring { box-shadow: 0 0 0 2px var(--line-strong); }

/* Doc item */
.doc-item {
  background: var(--bg-card);
  border: 1px solid var(--line);
  color: var(--ink);
  border-radius: var(--radius);
}
.doc-item:hover { background: var(--bg-card-hover); border-color: var(--line-strong); }
.doc-item-header { color: var(--ink-strong); font-family: var(--font-serif); font-weight: 400; }
.doc-num {
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
}
.doc-title { color: var(--ink-strong); font-family: var(--font-serif); font-weight: 400; }
.doc-points { color: var(--ink-2); }

/* Fullscreen preview overlay */
.fullscreen-header,
.fullscreen-nav,
.fullscreen-close,
.fullscreen-counter,
.fullscreen-dots {
  color: var(--ink);
}
.fullscreen-close,
.fullscreen-nav {
  background: rgba(0,0,0,0.5);
  border: 1px solid var(--line-strong);
  color: var(--ink);
  backdrop-filter: blur(8px);
}
.fullscreen-close:hover,
.fullscreen-nav:hover { background: rgba(0,0,0,0.7); border-color: var(--ink-3); }
.fullscreen-dot { background: var(--line-strong); }
.fullscreen-dot.current { background: var(--accent); }
.fullscreen-counter {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  color: var(--ink-2);
}

/* Headers */
.tpl-root h1, .tpl-root h2, .tpl-root h3 { color: var(--ink-strong); }
</style>

<style>
/* Modal customization - Arco Design override */
.tpl-preview-modal .arco-modal {
  border-radius: 10px;
  overflow: hidden;
  margin-top: 60px;
  margin-bottom: 60px;
}
.tpl-preview-modal .arco-modal-header {
  display: none;
}
.tpl-preview-modal .arco-modal-content {
  padding: 24px;
  max-height: calc(100vh - 120px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.tpl-preview-modal .arco-modal-footer {
  display: none;
}
.tpl-preview-modal .arco-modal-close-icon {
  color: var(--mute);
}
.tpl-preview-modal .arco-modal-close-icon:hover {
  color: var(--ink);
}

/* ── Preview modal 内文 ─────────────────────── */
.modal-badge {
  color: var(--mute) !important;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.modal-title {
  color: var(--ink-strong) !important;
  font-family: var(--font-serif);
  font-weight: 400;
  letter-spacing: -0.02em;
}
.modal-badge-tag {
  color: var(--ink-2) !important;
  background: var(--bg-card) !important;
  border: 1px solid var(--line) !important;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.modal-badge-tag.active {
  color: var(--ink-strong) !important;
  background: var(--bg-card-hover) !important;
  border-color: var(--line-strong) !important;
}
.modal-desc {
  color: var(--ink-2) !important;
}
.modal-section-title {
  color: var(--ink-strong) !important;
  font-family: var(--font-serif);
  font-weight: 400;
  letter-spacing: -0.015em;
}
.style-tag-value {
  color: var(--ink-2) !important;
}
.prompt-icon {
  color: var(--mute) !important;
}
.prompt-text {
  color: var(--ink-2) !important;
}
.doc-title {
  color: var(--ink-strong) !important;
}
.doc-points li {
  color: var(--ink-2) !important;
}
</style>
