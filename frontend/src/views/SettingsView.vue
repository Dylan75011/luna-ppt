<template>
  <div class="page-layout">
    <div class="page-header">
      <div>
        <div class="page-title">配置中心</div>
        <div class="page-subtitle">管理 API Key 和生成参数</div>
      </div>
      <a-button type="primary" @click="handleSave" :loading="saving">
        <template #icon><icon-save /></template>
        保存配置
      </a-button>
    </div>

    <div class="settings-body">
      <a-form :model="form" layout="vertical" class="settings-form">

        <!-- MiniMax -->
        <a-card class="settings-card" title="MiniMax（主力模型 · 订阅制）">
          <a-form-item label="API Key">
            <a-input-password
              v-model="form.minimaxApiKey"
              placeholder="sk-cp-..."
              allow-clear
            />
            <template #extra>sk-cp- 开头为 token plan 订阅 key，主力模型免费多用</template>
          </a-form-item>
          <a-form-item label="模型版本">
            <a-select v-model="form.minimaxModel">
              <a-option value="MiniMax-M2.5">MiniMax-M2.5（Token Plan 推荐）</a-option>
              <a-option value="MiniMax-M2.5-highspeed">MiniMax-M2.5-highspeed（更快）</a-option>
              <a-option value="MiniMax-M2.7">MiniMax-M2.7（最新旗舰）</a-option>
              <a-option value="MiniMax-M2.7-highspeed">MiniMax-M2.7-highspeed</a-option>
            </a-select>
            <template #extra>Token Plan（sk-cp- 开头）订阅后可免费大量调用</template>
          </a-form-item>
        </a-card>

        <!-- DeepSeek -->
        <a-card class="settings-card" title="DeepSeek-R1（评审专用 · 按量付费）">
          <a-form-item label="API Key">
            <a-input-password
              v-model="form.deepseekApiKey"
              placeholder="sk-..."
              allow-clear
            />
            <template #extra>仅 Critic Agent 评审时调用，每次生成约 1-3 次</template>
          </a-form-item>
        </a-card>

        <!-- Tavily 搜索 -->
        <a-card class="settings-card" title="Tavily（搜索服务 · 推荐开启）">
          <a-form-item label="API Key">
            <a-input-password
              v-model="form.tavilyApiKey"
              placeholder="tvly-..."
              allow-clear
            />
            <template #extra>Tavily 是高精度搜索服务，可大幅提升策划方案的信息丰富度。<a href="https://tavily.com" target="_blank">获取 API Key</a>（免费额度 1000 次/月）</template>
          </a-form-item>
        </a-card>

        <!-- 评审参数 -->
        <a-card class="settings-card" title="评审参数">
          <a-row :gutter="24">
            <a-col :span="12">
              <a-form-item label="通过阈值（0-10）">
                <a-input-number
                  v-model="form.criticPassScore"
                  :min="0" :max="10" :step="0.5"
                  :precision="1"
                  style="width:100%"
                />
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="最大评审轮次">
                <a-input-number
                  v-model="form.criticMaxRounds"
                  :min="1" :max="5" :step="1"
                  style="width:100%"
                />
              </a-form-item>
            </a-col>
          </a-row>
        </a-card>

      </a-form>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { Message } from '@arco-design/web-vue'
import { useSettingsStore } from '../stores/settings'

const store = useSettingsStore()
const saving = ref(false)

const form = reactive({
  minimaxApiKey:   store.data.minimaxApiKey   || '',
  minimaxModel:    store.data.minimaxModel    || 'MiniMax-M2.5',
  deepseekApiKey:  store.data.deepseekApiKey  || '',
  tavilyApiKey:    store.data.tavilyApiKey    || '',
  criticPassScore: store.data.criticPassScore ?? 7.0,
  criticMaxRounds: store.data.criticMaxRounds ?? 3
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

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 28px;
  background: #fff;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.page-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text-1);
}

.page-subtitle {
  font-size: 13px;
  color: var(--color-text-3);
  margin-top: 2px;
}

.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px;
}

.settings-form {
  max-width: 640px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-card {
  border-radius: 12px;
}

.settings-card :deep(.arco-card-header) {
  font-weight: 600;
}
</style>
