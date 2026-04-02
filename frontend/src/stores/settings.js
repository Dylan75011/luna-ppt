import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const STORAGE_KEY = 'oc_api_keys'

const DEFAULTS = {
  minimaxModel:    'MiniMax-M2.5',
  criticPassScore: 7.0,
  criticMaxRounds: 3
}

export const useSettingsStore = defineStore('settings', () => {
  const data = ref(load())

  function load() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}
      return { ...DEFAULTS, ...stored }   // DEFAULTS 兜底，stored 覆盖
    } catch { return { ...DEFAULTS } }
  }

  function save(payload) {
    data.value = { ...payload }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data.value))
  }

  const hasMinimaxKey  = computed(() => !!data.value.minimaxApiKey)
  const hasDeepseekKey = computed(() => !!data.value.deepseekApiKey)
  const minimaxModel   = computed(() => data.value.minimaxModel   || 'MiniMax-M2.5')
  const criticPassScore = computed(() => data.value.criticPassScore ?? 7.0)
  const criticMaxRounds = computed(() => data.value.criticMaxRounds ?? 3)

  // 供 API 调用注入
  const apiKeys = computed(() => ({
    minimaxApiKey:  data.value.minimaxApiKey  || '',
    deepseekApiKey: data.value.deepseekApiKey || '',
    minimaxModel:   data.value.minimaxModel   || 'MiniMax-M2.5',
    tavilyApiKey:   data.value.tavilyApiKey   || ''
  }))

  return { data, save, hasMinimaxKey, hasDeepseekKey, minimaxModel, criticPassScore, criticMaxRounds, apiKeys }
})
