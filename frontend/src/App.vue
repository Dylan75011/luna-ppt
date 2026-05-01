<template>
  <a-layout class="app-shell">
    <!-- 左侧导航 -->
    <a-layout-sider
      class="app-sider"
      :collapsed="collapsed"
      :collapsed-width="60"
      :width="220"
      collapsible
      :trigger="null"
      hide-trigger
    >
      <!-- Logo -->
      <div
        class="sider-logo"
        :class="{ collapsed }"
        :title="collapsed ? '点击展开侧栏' : ''"
        @click="onLogoClick"
      >
        <span class="logo-mark" v-show="collapsed">
          <img :src="logoUrl" alt="Luna" class="logo-img" />
        </span>
        <span class="logo-text-group" v-show="!collapsed">
          <span class="logo-text">Luna</span>
          <span class="logo-sub">活动策划助手</span>
        </span>
        <button
          v-show="!collapsed"
          class="collapse-btn"
          @click.stop="collapsed = true"
          aria-label="收起侧栏"
        >
          <PhCaretLeft :size="14" weight="bold" />
        </button>
      </div>

      <!-- 自定义导航列表，绕过 Arco 图标字体限制 -->
      <nav class="sider-nav">
        <button
          v-for="item in navItems"
          :key="item.path"
          class="nav-item"
          :class="{ active: currentRoute === item.path }"
          @click="onNavClick(item.path)"
        >
          <span class="nav-icon">
            <component :is="item.icon" :size="18" weight="duotone" />
          </span>
          <span class="nav-label" v-show="!collapsed">{{ item.label }}</span>
        </button>
      </nav>
    </a-layout-sider>

    <!-- 右侧内容 -->
    <a-layout class="app-content">
      <router-view v-slot="{ Component }">
        <transition name="page" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </a-layout>
  </a-layout>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  PhFolderOpen,
  PhSliders,
  PhCaretLeft,
  PhLayout,
} from '@phosphor-icons/vue'
import IconMuse from '@/components/icons/IconMuse.vue'
import logoUrl from '@/assets/logo.png'

const router = useRouter()
const route  = useRoute()
const APP_SIDER_COLLAPSED_KEY = 'oc_app_sider_collapsed'

const navItems = [
  { path: '/workspace', label: '策划空间', icon: PhFolderOpen },
  { path: '/agent',     label: '智能助手', icon: IconMuse     },
  { path: '/templates', label: '模版中心', icon: PhLayout     },
  { path: '/settings',  label: '配置中心', icon: PhSliders    },
]

function loadCollapsedState() {
  try { return localStorage.getItem(APP_SIDER_COLLAPSED_KEY) === '1' }
  catch { return false }
}

const collapsed    = ref(loadCollapsedState())
const currentRoute = computed(() => route.path)

function onNavClick(path) { router.push(path) }

function onLogoClick() {
  if (collapsed.value) collapsed.value = false
}

watch(collapsed, (value) => {
  try { localStorage.setItem(APP_SIDER_COLLAPSED_KEY, value ? '1' : '0') }
  catch {}
})
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=Satisfy&display=swap');

/* ── 全局重置 ── */
*, *::before, *::after { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; padding: 0; overflow: hidden; }

/* ── App Shell ── */
.app-shell { height: 100vh; overflow: hidden; background: var(--bg-stage); }

/* ── Sider ── */
.app-sider {
  background: var(--bg-stage-2) !important;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--line) !important;
}

.app-sider :deep(.arco-layout-sider-children) {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── Logo ── */
.sider-logo {
  height: 76px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 18px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
  user-select: none;
  overflow: hidden;
}

.sider-logo.collapsed {
  padding: 0;
  justify-content: center;
  cursor: pointer;
}

.sider-logo.collapsed:hover .logo-img {
  transform: scale(1.06);
}

.logo-mark {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  filter: brightness(1.05) contrast(0.9);
}

.logo-img {
  width: 30px;
  height: 30px;
  object-fit: contain;
  display: block;
  transition: transform var(--dur) var(--ease);
}

.logo-text-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.logo-text {
  font-family: var(--font-serif);
  font-style: italic;
  font-weight: 400;
  font-size: 24px;
  color: var(--ink-strong);
  white-space: nowrap;
  line-height: 1;
  letter-spacing: -0.02em;
}

.logo-sub {
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 400;
  color: var(--mute);
  white-space: nowrap;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  margin-top: 4px;
}

/* ── Nav ── */
.sider-nav {
  flex: 1;
  padding: 14px 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: calc(100% - 16px);
  margin: 0 8px;
  padding: 0 12px;
  height: 40px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--ink-3);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 400;
  letter-spacing: 0.01em;
  text-align: left;
  transition: background var(--dur-fast) var(--ease),
              color      var(--dur-fast) var(--ease),
              transform  var(--dur-fast) var(--ease);
  will-change: transform;
  overflow: hidden;
  white-space: nowrap;
  position: relative;
}

.nav-item:hover:not(.active) {
  background: var(--bg-card-hover);
  color: var(--ink);
  transform: translateX(2px);
}

/* Active: 白色细边指示器 */
.nav-item.active {
  background: var(--bg-card-hover);
  color: var(--ink-strong);
  font-weight: 500;
  width: calc(100% - 8px);
  margin-left: 0;
  margin-right: 8px;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  padding-left: 20px;
  box-shadow: inset 2px 0 0 0 var(--ink-strong);
}

.nav-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  transition: transform var(--dur-fast) var(--ease);
}

.nav-item:hover:not(.active) .nav-icon {
  transform: scale(1.12);
}

.nav-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.collapse-btn {
  margin-left: auto;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--mute);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), transform var(--dur) var(--ease);
}

.collapse-btn:hover {
  background: var(--bg-card-hover);
  color: var(--ink);
}

.collapse-btn svg {
  transition: transform var(--dur) var(--ease);
}

.collapse-btn svg.rotated {
  transform: rotate(180deg);
}

/* ── Content ── */
.app-content {
  flex: 1;
  overflow: hidden;
  background: var(--bg-stage);
  display: flex;
  flex-direction: column;
}

/* ── Route transition ── */
.page-enter-active {
  transition: opacity var(--dur) var(--ease), transform var(--dur) var(--ease);
}
.page-leave-active {
  transition: opacity var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}
.page-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.page-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
