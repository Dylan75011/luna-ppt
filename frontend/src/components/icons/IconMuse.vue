<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    class="icon-muse"
  >
    <!-- 气泡填充：duotone 半透明 -->
    <path
      d="M4.2 6 C4.2 4.3, 5.6 3, 7.6 3 H16.4 C18.9 3, 20.4 4.3, 20.4 6 V10.8 C20.4 12.7, 18.9 13.9, 16.4 13.9 H13.2 C13.5 15.7, 14.1 17.4, 15 19 C15.2 19.4, 14.7 19.7, 14.2 19.4 C11.9 18.2, 9.9 16.3, 8.3 13.9 H7.6 C5.6 13.9, 4.2 12.7, 4.2 10.8 Z"
      fill="currentColor"
      fill-opacity="0.22"
    />
    <!-- 气泡描边 -->
    <path
      d="M4.2 6 C4.2 4.3, 5.6 3, 7.6 3 H16.4 C18.9 3, 20.4 4.3, 20.4 6 V10.8 C20.4 12.7, 18.9 13.9, 16.4 13.9 H13.2 C13.5 15.7, 14.1 17.4, 15 19 C15.2 19.4, 14.7 19.7, 14.2 19.4 C11.9 18.2, 9.9 16.3, 8.3 13.9 H7.6 C5.6 13.9, 4.2 12.7, 4.2 10.8 Z"
      stroke="currentColor"
      :stroke-width="mainStroke"
      stroke-linejoin="round"
      stroke-linecap="round"
      fill="none"
    />
    <!-- 内嵌灵感四角星 -->
    <path
      d="M12 5.2 C12.4 7, 13.3 7.9, 15.1 8.3 C13.3 8.7, 12.4 9.6, 12 11.4 C11.6 9.6, 10.7 8.7, 8.9 8.3 C10.7 7.9, 11.6 7, 12 5.2 Z"
      fill="currentColor"
    />
  </svg>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  size: { type: [Number, String], default: 18 },
  weight: { type: String, default: 'duotone' },
})

const mainStroke = computed(() => (props.weight === 'bold' ? 2 : 1.6))
</script>

<style scoped>
.icon-muse {
  display: block;
  overflow: visible;
}
</style>
