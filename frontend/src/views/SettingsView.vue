<template>
  <div class="page-layout">

    <!-- Header -->
    <div class="page-header">
      <div class="page-header-inner">
        <div class="page-title">配置中心</div>
        <div class="page-subtitle">管理 API Key 和生成参数</div>
      </div>
      <button class="save-btn" @click="handleSave" :disabled="saving">
        <PhCheck :size="14" weight="bold" />
        {{ saving ? '保存中…' : '保存配置' }}
      </button>
    </div>

    <!-- Body -->
    <div class="settings-body">
      <a-form :model="form" layout="vertical" class="settings-form">

        <!-- MiniMax -->
        <div class="settings-section">
          <div class="section-header">
            <span class="section-title">MiniMax</span>
            <span class="section-badge">主力模型 · 订阅制</span>
          </div>
          <div class="section-fields">
            <a-form-item label="API Key">
              <a-input-password
                v-model="form.minimaxApiKey"
                placeholder="sk-cp-..."
                allow-clear
              />
              <template #extra>sk-cp- 开头为 Token Plan 订阅 key，主力模型免费大量调用</template>
            </a-form-item>
            <a-form-item label="模型版本">
              <a-select v-model="form.minimaxModel">
                <a-option value="MiniMax-M2.7-highspeed">MiniMax-M2.7-highspeed（最新旗舰 · 高速版）</a-option>
              </a-select>
              <template #extra>Token Plan（sk-cp- 开头）订阅后可免费大量调用</template>
            </a-form-item>
          </div>
        </div>

        <!-- DeepSeek -->
        <div class="settings-section">
          <div class="section-header">
            <span class="section-title">DeepSeek V4-Pro</span>
            <span class="section-badge">评审专用 · 按量付费</span>
          </div>
          <div class="section-fields">
            <a-form-item label="API Key">
              <a-input-password
                v-model="form.deepseekApiKey"
                placeholder="sk-..."
                allow-clear
              />
              <template #extra>仅 Critic Agent 评审时调用，每次生成约 1–3 次</template>
            </a-form-item>
          </div>
        </div>

        <!-- 图片搜索 -->
        <div class="settings-section">
          <div class="section-header">
            <span class="section-title">图片搜索</span>
            <span class="section-badge">搜图功能 · 三源优先级：SerpAPI → Bing → Pexels</span>
          </div>
          <div class="section-fields">
            <a-form-item label="SerpAPI Key（首选，支持谷歌/百度图片）">
              <a-input-password
                v-model="form.serpApiKey"
                placeholder="serpapi key..."
                allow-clear
              />
              <template #extra>中文查询走谷歌图片，英文查询走 Bing 图片，结果最丰富</template>
            </a-form-item>
            <a-form-item label="Bing Image Search Key（备选）">
              <a-input-password
                v-model="form.bingApiKey"
                placeholder="Azure Cognitive Services key..."
                allow-clear
              />
              <template #extra>Azure 认知服务 Bing Image Search v7，SerpAPI 无结果时启用</template>
            </a-form-item>
            <a-form-item label="Pexels API Key（兜底，已内置免费 Key）">
              <a-input-password
                v-model="form.pexelsApiKey"
                placeholder="留空使用内置 Key..."
                allow-clear
              />
              <template #extra>Pexels 免版权摄影图库，无中文产品图，适合氛围背景图</template>
            </a-form-item>
          </div>
        </div>

        <!-- 网络搜索 -->
        <div class="settings-section">
          <div class="section-header">
            <span class="section-title">网络搜索</span>
            <span class="section-badge">方案调研 · 双源优先级：MiniMax → Tavily</span>
          </div>
          <div class="section-fields">
            <a-form-item label="Tavily API Key（备选）">
              <a-input-password
                v-model="form.tavilyApiKey"
                placeholder="tvly-..."
                allow-clear
              />
              <template #extra>MiniMax 无结果或不可用时降级使用</template>
            </a-form-item>
          </div>
        </div>

        <!-- 评审参数 -->
        <div class="settings-section">
          <div class="section-header">
            <span class="section-title">评审参数</span>
          </div>
          <div class="section-fields">
            <div class="fields-row">
              <a-form-item label="通过阈值（0–10）" style="flex:1">
                <a-input-number
                  v-model="form.criticPassScore"
                  :min="0" :max="10" :step="0.5" :precision="1"
                  style="width:100%"
                />
              </a-form-item>
              <a-form-item label="最大评审轮次" style="flex:1">
                <a-input-number
                  v-model="form.criticMaxRounds"
                  :min="1" :max="5" :step="1"
                  style="width:100%"
                />
              </a-form-item>
            </div>
          </div>
        </div>

      </a-form>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { Message } from '@arco-design/web-vue'
import { useSettingsStore } from '../stores/settings'
import { PhCheck } from '@phosphor-icons/vue'

const store  = useSettingsStore()
const saving = ref(false)

const form = reactive({
  minimaxApiKey:   store.data.minimaxApiKey   || '',
  minimaxModel:    store.data.minimaxModel    || 'MiniMax-M2.7-highspeed',
  deepseekApiKey:  store.data.deepseekApiKey  || '',
  serpApiKey:      store.data.serpApiKey      || '',
  bingApiKey:      store.data.bingApiKey      || '',
  pexelsApiKey:    store.data.pexelsApiKey    || '',
  tavilyApiKey:    store.data.tavilyApiKey    || '',
  criticPassScore: store.data.criticPassScore ?? 7.0,
  criticMaxRounds: store.data.criticMaxRounds ?? 3,
})

async function handleSave() {
  saving.value = true
  store.save({ ...form })
  await new Promise(r => setTimeout(r, 300))
  saving.value = false
  Message.success('配置已保存')
}
</script>

<style scoped>
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
  display: flex;
  align-items: center;
  justify-content: space-between;
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

/* Save button */
.save-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  height: 32px;
  border: 1px solid rgba(68, 64, 60, 0.18);
  background: #fff;
  border-radius: 7px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  color: #44403c;
  cursor: pointer;
  transition: background 0.16s ease, border-color 0.16s ease, transform 0.12s ease;
}

.save-btn:hover {
  background: #faf9f7;
  border-color: rgba(68, 64, 60, 0.3);
}

.save-btn:active { transform: scale(0.98); }
.save-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── Body ── */
.settings-body {
  flex: 1;
  overflow-y: auto;
  background: #faf9f7;
}

.settings-body::-webkit-scrollbar { width: 5px; }
.settings-body::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.08); border-radius: 3px; }

.settings-form {
  max-width: 680px;
  margin: 0 auto;
  padding: 8px 0 40px;
}

/* ── Section ── */
.settings-section {
  background: #fff;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  margin-bottom: -1px; /* collapse borders */
  padding: 20px 28px 4px;
}

.settings-section:first-of-type {
  margin-top: 20px;
  border-radius: 12px 12px 0 0;
}

.settings-section:last-of-type {
  border-radius: 0 0 12px 12px;
  margin-bottom: 0;
}

.section-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 16px;
}

.section-title {
  font-size: 13.5px;
  font-weight: 700;
  color: #1c1917;
  letter-spacing: -0.1px;
}

.section-badge {
  font-size: 11.5px;
  color: #a8a29e;
  font-weight: 400;
}

.section-fields {
  display: flex;
  flex-direction: column;
}

/* Row layout for paired fields */
.fields-row {
  display: flex;
  gap: 20px;
}

/* ── Arco form overrides ── */
:deep(.arco-form-item-label) {
  font-size: 12.5px;
  font-weight: 500;
  color: #57534e;
}

:deep(.arco-form-item-message) {
  font-size: 12px;
  color: #a8a29e;
}

:deep(.arco-input-wrapper),
:deep(.arco-select-view) {
  border-color: rgba(0, 0, 0, 0.1) !important;
  border-radius: 7px !important;
  background: #faf9f7 !important;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

:deep(.arco-input-wrapper:hover),
:deep(.arco-select-view:hover) {
  border-color: rgba(68, 64, 60, 0.3) !important;
}

:deep(.arco-input-wrapper.arco-input-focus),
:deep(.arco-select-view-focus) {
  border-color: #44403c !important;
  box-shadow: 0 0 0 2px rgba(68, 64, 60, 0.1) !important;
}

:deep(.arco-input-number) {
  border-color: rgba(0, 0, 0, 0.1) !important;
  border-radius: 7px !important;
  background: #faf9f7 !important;
}

.settings-link {
  color: #78716c;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.settings-link:hover { color: #44403c; }

/* ╔════════════════════════════════════════════╗
   ║  CINEMA THEME OVERRIDES                     ║
   ╚════════════════════════════════════════════╝ */

.page-layout { background: var(--bg-stage); color: var(--ink); }

.page-header {
  background: transparent;
  border-bottom: 1px solid var(--line);
}
.page-title {
  color: var(--ink-strong);
  font-family: var(--font-serif);
  font-weight: 400;
  font-size: 18px;
  letter-spacing: -0.015em;
}
.page-subtitle {
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  margin-top: 4px;
}

.save-btn {
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--line-strong);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  border-radius: var(--radius-sm);
  padding: 6px 16px;
  height: 32px;
}
.save-btn:hover {
  background: var(--bg-card-hover);
  border-color: var(--ink-3);
}
.save-btn[disabled],
.save-btn:disabled { opacity: 0.4; }

.settings-body { background: var(--bg-stage); }
.settings-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); }

.settings-section {
  background: var(--bg-card);
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.settings-section:first-of-type { border-radius: var(--radius-lg) var(--radius-lg) 0 0; }
.settings-section:last-of-type { border-radius: 0 0 var(--radius-lg) var(--radius-lg); }

.section-title {
  color: var(--ink-strong);
  font-family: var(--font-serif);
  font-weight: 400;
  font-size: 16px;
  letter-spacing: -0.01em;
}
.section-badge {
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* Arco form overrides — 暗场 */
:deep(.arco-form-item-label) {
  color: var(--ink-2) !important;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
:deep(.arco-form-item-message) {
  color: var(--mute) !important;
  font-family: var(--font-mono);
  font-size: 10.5px;
}
:deep(.arco-input-wrapper),
:deep(.arco-select-view),
:deep(.arco-input-number) {
  background: var(--bg-input) !important;
  border-color: var(--line) !important;
  color: var(--ink) !important;
}
:deep(.arco-input-wrapper input),
:deep(.arco-input-number input),
:deep(.arco-select-view-input) {
  color: var(--ink) !important;
  background: transparent !important;
}
:deep(.arco-input-wrapper input::placeholder) {
  color: var(--mute) !important;
}
:deep(.arco-input-wrapper:hover),
:deep(.arco-select-view:hover),
:deep(.arco-input-number:hover) {
  border-color: var(--ink-3) !important;
}
:deep(.arco-input-wrapper.arco-input-focus),
:deep(.arco-select-view-focus),
:deep(.arco-input-number-focus) {
  background: var(--bg-input-focus) !important;
  border-color: var(--accent-line) !important;
  box-shadow: 0 0 0 2px var(--accent-soft) !important;
}

.settings-link {
  color: var(--ink-2);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.settings-link:hover { color: var(--accent); }
</style>
