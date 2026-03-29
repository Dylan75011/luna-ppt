<template>
  <a-layout class="app-shell">
    <!-- 左侧导航 -->
    <a-layout-sider
      class="app-sider"
      :collapsed="collapsed"
      :collapsed-width="64"
      :width="200"
      collapsible
      :trigger="null"
      hide-trigger
    >
      <!-- Logo -->
      <div class="sider-logo">
        <span class="logo-mark">OC</span>
        <span class="logo-text" v-show="!collapsed">OpenClaw</span>
      </div>

      <!-- 导航菜单 -->
      <a-menu
        :selected-keys="[currentRoute]"
        :collapsed="collapsed"
        class="sider-menu"
        @menu-item-click="onNavClick"
      >
        <a-menu-item key="/workspace">
          <template #icon><icon-folder /></template>
          文档空间
        </a-menu-item>
        <a-menu-item key="/agent">
          <template #icon><icon-robot /></template>
          智能体
        </a-menu-item>
        <a-menu-item key="/settings">
          <template #icon><icon-settings /></template>
          配置中心
        </a-menu-item>
      </a-menu>

      <!-- 底部：折叠按钮 + 版本 -->
      <div class="sider-footer">
        <a-tooltip :content="collapsed ? '展开侧栏' : '收起侧栏'" position="right">
          <a-button
            class="collapse-btn"
            type="text"
            size="small"
            @click="collapsed = !collapsed"
          >
            <template #icon>
              <icon-menu-fold v-if="!collapsed" />
              <icon-menu-unfold v-else />
            </template>
          </a-button>
        </a-tooltip>
        <span v-show="!collapsed" class="sider-version">v2.0</span>
      </div>
    </a-layout-sider>

    <!-- 右侧内容 -->
    <a-layout class="app-content">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </a-layout>
  </a-layout>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route  = useRoute()
const APP_SIDER_COLLAPSED_KEY = 'oc_app_sider_collapsed'

function loadCollapsedState() {
  try {
    return localStorage.getItem(APP_SIDER_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

const collapsed = ref(loadCollapsedState())

const currentRoute = computed(() => route.path)

function onNavClick(key) {
  router.push(key)
}

watch(collapsed, (value) => {
  try {
    localStorage.setItem(APP_SIDER_COLLAPSED_KEY, value ? '1' : '0')
  } catch {}
})
</script>

<style>
/* ── 全局重置 ── */
*, *::before, *::after { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; padding: 0; overflow: hidden; }
body { font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', sans-serif; }

/* ── App Shell ── */
.app-shell {
  height: 100vh;
  overflow: hidden;
}

/* ── Sider ── */
.app-sider {
  background: #fff !important;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #e5e6eb;
}

.app-sider :deep(.arco-layout-sider-children) {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Logo */
.sider-logo {
  height: 56px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 18px;
  border-bottom: 1px solid #e5e6eb;
  flex-shrink: 0;
  user-select: none;
  overflow: hidden;
}

.logo-mark {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: linear-gradient(135deg, rgb(var(--arcoblue-6)), rgb(var(--arcoblue-4)));
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: -0.5px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.logo-text {
  font-size: 15px;
  font-weight: 700;
  color: #1d2129;
  white-space: nowrap;
  overflow: hidden;
}

/* Menu */
.sider-menu {
  flex: 1;
  background: transparent !important;
  border-right: none !important;
  padding: 8px 0;
}

.sider-menu :deep(.arco-menu-item) {
  color: #4e5969 !important;
  border-radius: 8px;
  margin: 2px 8px;
}

.sider-menu :deep(.arco-menu-item:hover) {
  background: #f2f3f5 !important;
  color: #1d2129 !important;
}

.sider-menu :deep(.arco-menu-item.arco-menu-selected) {
  background: rgb(var(--arcoblue-1)) !important;
  color: rgb(var(--arcoblue-6)) !important;
  font-weight: 600;
}

.sider-menu :deep(.arco-menu-item-icon) {
  font-size: 18px;
}

/* Footer */
.sider-footer {
  padding: 10px 14px;
  border-top: 1px solid #e5e6eb;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.collapse-btn {
  flex-shrink: 0;
  color: #86909c !important;
}

.collapse-btn:hover {
  background: #f2f3f5 !important;
  color: #1d2129 !important;
}

.sider-version {
  font-size: 11px;
  color: #c9cdd4;
  white-space: nowrap;
}

/* ── Content ── */
.app-content {
  flex: 1;
  overflow: hidden;
  background: #f5f6fa;
  display: flex;
  flex-direction: column;
}

/* ── Route transition ── */
.fade-enter-active, .fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
