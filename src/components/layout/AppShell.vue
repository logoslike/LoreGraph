<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import PanelToggle from './PanelToggle.vue'
import { SEARCH_INPUT_ID } from '@/composables/useShortcuts'
import { useUiStore } from '@/stores/ui'

/** 窄屏断点：低于该宽度时左右面板改为抽屉。 */
const MOBILE_QUERY = '(max-width: 899px)'

const ui = useUiStore()

const mediaQuery =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(MOBILE_QUERY)
    : null

const isMobile = ref(mediaQuery?.matches ?? false)
const sidebarOpen = computed(() => !ui.sidebarCollapsed)
const inspectorOpen = computed(() => !ui.inspectorCollapsed)
const drawerOpen = computed(() => isMobile.value && (sidebarOpen.value || inspectorOpen.value))

// 首帧前同步收起窄屏面板，避免抽屉在挂载瞬间闪现
if (isMobile.value) {
  ui.sidebarCollapsed = true
  ui.inspectorCollapsed = true
}

/** 进入窄屏时默认收起两侧面板，避免遮挡画布。 */
function onMediaChange(event: MediaQueryListEvent): void {
  isMobile.value = event.matches
  if (event.matches) {
    ui.sidebarCollapsed = true
    ui.inspectorCollapsed = true
  }
}

onMounted(() => {
  mediaQuery?.addEventListener('change', onMediaChange)
})

onBeforeUnmount(() => {
  mediaQuery?.removeEventListener('change', onMediaChange)
})

function openSidebar(): void {
  ui.sidebarCollapsed = false
}

function openInspector(): void {
  ui.inspectorCollapsed = false
}

/** 点击遮罩关闭抽屉（仅窄屏生效）。 */
function closeDrawers(): void {
  if (!isMobile.value) {
    return
  }
  ui.sidebarCollapsed = true
  ui.inspectorCollapsed = true
}

/** Ctrl/Cmd+K 使用：展开侧边栏并聚焦搜索框。 */
function focusSearch(): void {
  ui.sidebarCollapsed = false
  void nextTick(() => {
    const input = document.getElementById(SEARCH_INPUT_ID)
    if (input instanceof HTMLInputElement) {
      input.focus()
      input.select()
    }
  })
}

defineExpose({ openSidebar, openInspector, focusSearch })
</script>

<template>
  <div class="app-shell">
    <div v-if="drawerOpen" class="app-shell__backdrop" @click="closeDrawers" />

    <aside v-show="sidebarOpen" class="app-shell__sidebar" aria-label="侧边栏">
      <slot name="sidebar" />
    </aside>

    <main class="app-shell__main">
      <slot />
    </main>

    <aside v-show="inspectorOpen" class="app-shell__inspector" aria-label="检查器">
      <slot name="inspector" />
    </aside>

    <PanelToggle
      v-if="!sidebarOpen"
      side="left"
      label="展开侧边栏"
      data-testid="toggle-sidebar"
      @toggle="openSidebar"
    />
    <PanelToggle
      v-if="!inspectorOpen"
      side="right"
      label="展开检查器"
      data-testid="toggle-inspector"
      @toggle="openInspector"
    />
  </div>
</template>

<style scoped>
.app-shell {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background-color: var(--bg);
  color: var(--fg);
}

.app-shell__sidebar {
  width: 264px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.app-shell__inspector {
  width: 336px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.app-shell__main {
  position: relative;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  background-color: var(--bg);
}

.app-shell__backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
  background-color: color-mix(in srgb, var(--fg) 30%, transparent);
}

@media (max-width: 899px) {
  .app-shell {
    grid-template-columns: minmax(0, 1fr);
  }

  .app-shell__sidebar,
  .app-shell__inspector {
    position: fixed;
    top: 0;
    bottom: 0;
    z-index: 40;
    width: min(86vw, 320px);
    overflow: auto;
    background-color: var(--bg);
    box-shadow: 0 12px 32px rgb(0 0 0 / 0.28);
  }

  .app-shell__sidebar {
    left: 0;
    border-right: 1px solid var(--border);
  }

  .app-shell__inspector {
    right: 0;
    border-left: 1px solid var(--border);
  }
}
</style>
