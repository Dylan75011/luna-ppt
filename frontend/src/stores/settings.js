import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const STORAGE_KEY = 'oc_api_keys'

const DEFAULTS = {
  minimaxModel:    'MiniMax-M2.7-highspeed',
  criticPassScore: 7.0,
  criticMaxRounds: 3
}

const ALLOWED_MINIMAX_MODELS = new Set(['MiniMax-M2.7-highspeed'])

function sanitizeSettings(raw = {}) {
  return {
    minimaxApiKey:  raw.minimaxApiKey  || '',
    deepseekApiKey: raw.deepseekApiKey || '',
    minimaxModel:   ALLOWED_MINIMAX_MODELS.has(raw.minimaxModel) ? raw.minimaxModel : DEFAULTS.minimaxModel,
    tavilyApiKey:   raw.tavilyApiKey   || '',
    serpApiKey:     raw.serpApiKey     || '',
    bingApiKey:     raw.bingApiKey     || '',
    pexelsApiKey:   raw.pexelsApiKey   || '',
    criticPassScore: raw.criticPassScore ?? DEFAULTS.criticPassScore,
    criticMaxRounds: raw.criticMaxRounds ?? DEFAULTS.criticMaxRounds
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const data = ref(load())

  function load() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}
      const sanitized = sanitizeSettings(stored)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized))
      return sanitized
    } catch { return { ...DEFAULTS } }
  }

  function save(payload) {
    data.value = sanitizeSettings(payload)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data.value))
  }

  const hasMinimaxKey  = computed(() => !!data.value.minimaxApiKey)
  const hasDeepseekKey = computed(() => !!data.value.deepseekApiKey)
  const minimaxModel   = computed(() => data.value.minimaxModel   || DEFAULTS.minimaxModel)
  const criticPassScore = computed(() => data.value.criticPassScore ?? 7.0)
  const criticMaxRounds = computed(() => data.value.criticMaxRounds ?? 3)

  // 供 API 调用注入
  const apiKeys = computed(() => ({
    minimaxApiKey:  data.value.minimaxApiKey  || '',
    deepseekApiKey: data.value.deepseekApiKey || '',
    minimaxModel:   data.value.minimaxModel   || DEFAULTS.minimaxModel,
    tavilyApiKey:   data.value.tavilyApiKey   || '',
    serpApiKey:     data.value.serpApiKey     || '',
    bingApiKey:     data.value.bingApiKey     || '',
    pexelsApiKey:   data.value.pexelsApiKey   || '',
  }))

  return { data, save, hasMinimaxKey, hasDeepseekKey, minimaxModel, criticPassScore, criticMaxRounds, apiKeys }
})
