<template>
  <div class="ppt-editor-overlay">
    <div class="ppt-editor-shell">
      <!-- 顶部工具栏 -->
      <div class="ppt-editor-header">
        <div class="ppt-editor-title">
          <icon-edit />
          <span>PPT 精修编辑器</span>
          <a-tag v-if="status === 'loading'" color="blue" size="small">加载中</a-tag>
          <a-tag v-else-if="status === 'ready'" color="green" size="small">就绪</a-tag>
          <a-tag v-else-if="status === 'error'" color="red" size="small">加载失败</a-tag>
        </div>
        <div class="ppt-editor-actions">
          <a-button size="small" @click="$emit('close')">
            <template #icon><icon-close /></template>
            关闭
          </a-button>
        </div>
      </div>

      <!-- iframe 区域 -->
      <div class="ppt-editor-body">
        <!-- PPTist 未部署时的占位提示 -->
        <div v-if="!pptistUrl" class="ppt-editor-placeholder">
          <icon-edit class="placeholder-icon" />
          <p class="placeholder-title">编辑器尚未配置</p>
          <p class="placeholder-desc">
            需要在本地部署 PPTist，并在 <code>.env</code> 中配置：
          </p>
          <code class="placeholder-code">VITE_PPTIST_URL=http://localhost:9527</code>
          <div class="placeholder-steps">
            <p>部署步骤：</p>
            <ol>
              <li>克隆 PPTist：<code>git clone https://github.com/pipipi-pikachu/PPTist</code></li>
              <li>安装依赖并启动：<code>npm install && npm run dev</code></li>
              <li>在 <code>.env.local</code> 中添加上述环境变量后重启前端</li>
            </ol>
          </div>
        </div>

        <!-- PPTist iframe -->
        <iframe
          v-else
          ref="iframeRef"
          :src="pptistUrl"
          class="ppt-editor-iframe"
          @load="onIframeLoad"
          @error="status = 'error'"
          allow="fullscreen"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  pptData: { type: Object, default: null }
})
defineEmits(['close'])

const iframeRef = ref(null)
const status    = ref('loading')  // 'loading' | 'ready' | 'error'

// 从环境变量读取 PPTist 部署地址
const pptistUrl = import.meta.env.VITE_PPTIST_URL || ''

function onIframeLoad() {
  status.value = 'ready'
  // iframe 加载完成后推送数据
  if (props.pptData && iframeRef.value?.contentWindow) {
    injectData()
  }
}

/**
 * 将 pptData 通过 postMessage 注入 PPTist
 * PPTist 需要在其 main.js 中添加监听：
 *   window.addEventListener('message', e => {
 *     if (e.data?.type === 'OPENCLAW_SET_SLIDES') {
 *       store.dispatch('setSlides', e.data.slides)
 *     }
 *   })
 */
function injectData() {
  iframeRef.value.contentWindow.postMessage(
    { type: 'OPENCLAW_SET_SLIDES', slides: props.pptData },
    pptistUrl || '*'
  )
}

// 接收 PPTist 回传的数据变更
function onMessage(e) {
  if (!pptistUrl) return
  try {
    if (!e.origin.startsWith(new URL(pptistUrl).origin)) return
  } catch {
    return
  }
  if (e.data?.type === 'OPENCLAW_SLIDES_UPDATED') {
    // 此处可触发自动保存
    console.log('[PptEditor] 收到编辑器数据更新')
  }
}

onMounted(() => {
  window.addEventListener('message', onMessage)
})

onUnmounted(() => {
  window.removeEventListener('message', onMessage)
})
</script>

<style scoped>
.ppt-editor-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: stretch;
  justify-content: center;
}

.ppt-editor-shell {
  width: 100%;
  max-width: 1600px;
  margin: 20px;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.ppt-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: #252525;
  flex-shrink: 0;
}

.ppt-editor-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #eee;
  font-size: 14px;
  font-weight: 600;
}

.ppt-editor-actions {
  display: flex;
  gap: 8px;
}

.ppt-editor-body {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.ppt-editor-iframe {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}

/* 未配置占位 */
.ppt-editor-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 40px;
  background: #f5f5f5;
  text-align: center;
}

.placeholder-icon {
  font-size: 48px;
  color: #ccc;
  margin-bottom: 16px;
}

.placeholder-title {
  font-size: 20px;
  font-weight: 600;
  color: #333;
  margin-bottom: 8px;
}

.placeholder-desc {
  font-size: 14px;
  color: #666;
  margin-bottom: 12px;
}

.placeholder-code {
  display: inline-block;
  background: #e8e8e8;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 13px;
  margin-bottom: 24px;
}

.placeholder-steps {
  text-align: left;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 16px 24px;
  max-width: 520px;
  font-size: 13px;
  color: #444;
  line-height: 2;
}

.placeholder-steps ol {
  padding-left: 20px;
}

.placeholder-steps code {
  background: #f0f0f0;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 12px;
}
</style>
