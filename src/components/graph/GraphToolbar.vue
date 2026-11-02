<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Download,
  Ellipsis,
  Focus,
  GitBranch,
  LoaderCircle,
  Maximize,
  Network,
  Plus,
  Search,
  Shapes,
  Trash,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from '@lucide/vue'
import BaseButton from '@/components/common/BaseButton.vue'
import GraphExportDialog from './GraphExportDialog.vue'
import GraphImportDialog from './GraphImportDialog.vue'
import type { LayoutMode } from '@/services/layout.service'

withDefaults(
  defineProps<{
    /** 当前是否有可删除的选中项（节点或关系）。 */
    canDelete?: boolean
    /** 是否选中了可聚焦的节点。 */
    canFocus?: boolean
    /** 是否处于聚焦模式。 */
    focused?: boolean
    /** 自动布局进行中：布局项禁用并显示进行中。 */
    layouting?: boolean
    /** 是否存在可恢复的布局快照。 */
    canRestoreLayout?: boolean
    /** 画布右上角的节点查找面板是否打开。 */
    searchOpen?: boolean
    /** 当前搜索词非空：查找按钮保持高亮，提示搜索仍在生效。 */
    searchActive?: boolean
  }>(),
  {
    canDelete: false,
    canFocus: false,
    focused: false,
    layouting: false,
    canRestoreLayout: false,
    searchOpen: false,
    searchActive: false,
  },
)

const emit = defineEmits<{
  (event: 'create-node'): void
  (event: 'manage-types'): void
  (event: 'fit-view'): void
  (event: 'zoom-in'): void
  (event: 'zoom-out'): void
  (event: 'toggle-search'): void
  (event: 'delete-selected'): void
  (event: 'toggle-focus'): void
  (event: 'auto-layout', mode: LayoutMode): void
  (event: 'restore-layout'): void
  (event: 'graph-imported'): void
}>()

const menuOpen = ref(false)
const menuRoot = ref<HTMLElement | null>(null)
const exportOpen = ref(false)
const importDialog = ref<InstanceType<typeof GraphImportDialog> | null>(null)

function closeMenu(): void {
  menuOpen.value = false
}

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value
}

/** 点击菜单外部关闭。 */
function onDocumentPointerDown(event: MouseEvent): void {
  if (!menuOpen.value) {
    return
  }
  const root = menuRoot.value
  if (root && event.target instanceof Node && root.contains(event.target)) {
    return
  }
  closeMenu()
}

/** Esc 关闭菜单。 */
function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && menuOpen.value) {
    closeMenu()
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocumentPointerDown)
  document.addEventListener('keydown', onDocumentKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeydown)
})

function onAutoLayout(mode: LayoutMode): void {
  closeMenu()
  emit('auto-layout', mode)
}

function onRestoreLayout(): void {
  closeMenu()
  emit('restore-layout')
}

function onImportGraph(): void {
  closeMenu()
  importDialog.value?.openPicker()
}

function onExportGraph(): void {
  closeMenu()
  exportOpen.value = true
}
</script>

<template>
  <div
    class="flex flex-col items-center gap-0.5 rounded-xl border border-border bg-bg p-1 shadow-lg"
    role="toolbar"
    aria-label="图谱工具栏"
    data-testid="graph-toolbar"
  >
    <BaseButton
      variant="ghost"
      size="sm"
      data-testid="create-node-btn"
      aria-label="新建节点"
      title="新建节点（N）"
      @click="emit('create-node')"
    >
      <Plus :size="16" />
    </BaseButton>
    <BaseButton
      variant="ghost"
      size="sm"
      data-testid="type-manager-btn"
      aria-label="类型管理"
      title="类型管理"
      @click="emit('manage-types')"
    >
      <Shapes :size="16" />
    </BaseButton>

    <span class="my-0.5 h-px w-6 bg-border" aria-hidden="true" />

    <BaseButton
      variant="ghost"
      size="sm"
      data-testid="fit-view-btn"
      aria-label="适应视图"
      title="适应视图"
      @click="emit('fit-view')"
    >
      <Maximize :size="16" />
    </BaseButton>
    <BaseButton
      variant="ghost"
      size="sm"
      data-testid="zoom-in-btn"
      aria-label="放大"
      title="放大"
      @click="emit('zoom-in')"
    >
      <ZoomIn :size="16" />
    </BaseButton>
    <BaseButton
      variant="ghost"
      size="sm"
      data-testid="zoom-out-btn"
      aria-label="缩小"
      title="缩小"
      @click="emit('zoom-out')"
    >
      <ZoomOut :size="16" />
    </BaseButton>
    <BaseButton
      variant="ghost"
      size="sm"
      data-testid="graph-search-btn"
      aria-label="查找节点"
      title="查找节点"
      :aria-expanded="searchOpen"
      @click="emit('toggle-search')"
    >
      <Search :size="16" :class="searchActive ? 'text-accent' : ''" />
    </BaseButton>

    <span class="my-0.5 h-px w-6 bg-border" aria-hidden="true" />

    <!-- 更多：布局与数据操作收进下拉菜单，避免工具栏不断变长 -->
    <div ref="menuRoot" class="relative">
      <BaseButton
        variant="ghost"
        size="sm"
        data-testid="more-menu-btn"
        aria-label="更多操作"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        :title="layouting ? '布局进行中…' : '布局与数据'"
        @click="toggleMenu"
      >
        <LoaderCircle v-if="layouting" :size="16" class="animate-spin text-accent" />
        <Ellipsis v-else :size="16" />
      </BaseButton>

      <div
        v-if="menuOpen"
        class="absolute top-0 left-full z-20 ml-1 w-52 rounded-lg border border-border bg-bg p-1 shadow-lg"
        role="menu"
        data-testid="more-menu"
      >
        <p class="px-2 py-1 text-[11px] font-medium tracking-wide text-muted uppercase">布局</p>
        <button
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
          :disabled="layouting"
          data-testid="auto-layout-force-btn"
          @click="onAutoLayout('force')"
        >
          <Network :size="14" />
          自动布局（力导向）
        </button>
        <button
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
          :disabled="layouting"
          data-testid="auto-layout-layered-btn"
          @click="onAutoLayout('layered')"
        >
          <GitBranch :size="14" />
          自动布局（层级）
        </button>
        <button
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
          :disabled="!canRestoreLayout || layouting"
          data-testid="restore-layout-btn"
          @click="onRestoreLayout"
        >
          <Undo2 :size="14" />
          恢复布局前位置
        </button>
        <p v-if="layouting" class="px-2 py-1 text-xs text-muted" data-testid="layouting-hint">
          布局进行中…
        </p>

        <span class="my-1 block h-px bg-border" aria-hidden="true" />

        <p class="px-2 py-1 text-[11px] font-medium tracking-wide text-muted uppercase">数据</p>
        <button
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg hover:bg-surface-2"
          data-testid="import-graph-btn"
          @click="onImportGraph"
        >
          <Upload :size="14" />
          导入图谱片段
        </button>
        <button
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg hover:bg-surface-2"
          data-testid="export-graph-btn"
          @click="onExportGraph"
        >
          <Download :size="14" />
          导出图谱片段
        </button>
      </div>
    </div>

    <!-- 聚焦模式：选中节点后可进入，再次点击或按 F 退出 -->
    <BaseButton
      variant="ghost"
      size="sm"
      data-testid="focus-mode-btn"
      :disabled="!focused && !canFocus"
      :aria-pressed="focused"
      :aria-label="focused ? '退出聚焦' : '聚焦选中节点'"
      :title="focused ? '退出聚焦（F）' : '聚焦选中节点（F）'"
      @click="emit('toggle-focus')"
    >
      <Focus :size="16" :class="focused ? 'text-accent' : ''" />
    </BaseButton>

    <BaseButton
      variant="ghost"
      size="sm"
      data-testid="delete-selected-btn"
      :disabled="!canDelete"
      aria-label="删除选中"
      title="删除选中（支持撤销）"
      @click="emit('delete-selected')"
    >
      <Trash :size="16" :class="canDelete ? 'text-danger' : ''" />
    </BaseButton>

    <GraphExportDialog v-model:open="exportOpen" />
    <GraphImportDialog ref="importDialog" @imported="emit('graph-imported')" />
  </div>
</template>
