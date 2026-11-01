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

/**
 * 侧栏的槽位属性：收起状态由 AppShell 通过栅格列宽表达，
 * 但 Rail 与展开控件由 Sidebar 自己渲染，因此需要把状态传给它。
 */
defineSlots<{
  default?: () => unknown
  sidebar?: (props: { collapsed: boolean }) => unknown
  inspector?: () => unknown
}>()

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
  <div
    class="app-shell"
    :class="{
      'app-shell--sidebar-collapsed': ui.sidebarCollapsed,
      'app-shell--inspector-collapsed': ui.inspectorCollapsed,
    }"
  >
    <div
      v-if="drawerOpen"
      class="app-shell__backdrop"
      data-testid="app-shell-backdrop"
      @click="closeDrawers"
    />

    <!-- 桌面三列：侧栏收起时仍占 56px 的 Rail 列；窄屏只在抽屉打开时显示 -->
    <aside
      v-show="!isMobile || sidebarOpen"
      class="app-shell__sidebar"
      aria-label="侧边栏"
      data-testid="sidebar-column"
    >
      <slot name="sidebar" :collapsed="ui.sidebarCollapsed" />
    </aside>

    <main class="app-shell__main">
      <slot />
    </main>

    <aside v-show="inspectorOpen" class="app-shell__inspector" aria-label="检查器">
      <slot name="inspector" />
    </aside>

    <!-- 桌面收起时由 Sidebar 自己渲染 Rail 内的展开控件，这里只在窄屏保留抽屉入口 -->
    <PanelToggle
      v-if="isMobile && !sidebarOpen"
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
  --sidebar-width: 264px;
  --inspector-width: 336px;

  position: relative;
  display: grid;
  /* 固定三列：侧栏（264px 展开 / 56px Rail）、主区、检查器。
     侧栏收起时仍在栅格内，画布因此只释放 264px - 56px = 208px。 */
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr) var(--inspector-width);
  /* 具名区域固定三块面板的列位置：v-show 收起时 display:none 的元素不再参与
     栅格自动排布，若依赖自动排布，主区会落进第一列（auto → 0 宽），画布随之塌成 0 宽。 */
  grid-template-areas: 'sidebar main inspector';
  width: 100%;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background-color: var(--bg);
  color: var(--fg);
}

.app-shell--sidebar-collapsed {
  --sidebar-width: 56px;
}

/* 检查器收起时列宽归零：隐藏的检查器不再占据右侧空间 */
.app-shell--inspector-collapsed {
  --inspector-width: 0px;
}

.app-shell__sidebar {
  grid-area: sidebar;
  width: 100%;
  min-width: 0;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.app-shell__inspector {
  grid-area: inspector;
  width: 100%;
  min-width: 0;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.app-shell__main {
  grid-area: main;
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
    /* 窄屏只剩主区一列，两侧面板改为固定定位的抽屉 */
    grid-template-areas: 'main';
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
