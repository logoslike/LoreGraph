<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/components/layout/AppShell.vue'
import Inspector from '@/components/layout/Inspector.vue'
import Sidebar from '@/components/layout/Sidebar.vue'
import HelpDialog from '@/components/common/HelpDialog.vue'
import { useShortcuts } from '@/composables/useShortcuts'
import { useToast } from '@/composables/useToast'
import { services } from '@/services'
import { useGraphStore } from '@/stores/graph'
import { useTypesStore } from '@/stores/types'
import { useUiStore } from '@/stores/ui'
import { useUniverseStore } from '@/stores/universe'
import GraphCanvas from '@/components/graph/GraphCanvas.vue'

const route = useRoute()
const router = useRouter()
const universes = useUniverseStore()
const graph = useGraphStore()
const types = useTypesStore()
const ui = useUiStore()
const toast = useToast()

const shellRef = ref<InstanceType<typeof AppShell> | null>(null)
const graphCanvasRef = ref<InstanceType<typeof GraphCanvas> | null>(null)
const ready = ref(false)

/** 工作区标题：当前世界名 + 固定后缀；切换世界或重命名后随 store 自动更新。 */
const title = computed(() => {
  const name = universes.current?.name
  return name === undefined || name === '' ? 'Graph' : `${name} / Graph`
})

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 校验路由参数并加载世界、图谱与类型；无效 id 回到世界列表。 */
async function loadWorkspace(universeId: string): Promise<void> {
  if (universeId === '') {
    await router.replace({ name: 'universes' })
    return
  }
  const target = await services.universes.get(universeId)
  if (!target) {
    toast.danger('世界不存在或已被删除')
    await router.replace({ name: 'universes' })
    return
  }
  universes.setCurrent(universeId)
  try {
    await Promise.all([universes.loadAll(), graph.load(universeId), types.load(universeId)])
    ready.value = true
  } catch (error) {
    toast.danger(`工作区加载失败：${formatError(error)}`)
  }
}

watch(
  () => route.params.universeId,
  (value) => {
    const universeId = typeof value === 'string' ? value : ''
    void loadWorkspace(universeId)
  },
  { immediate: true },
)

/** 侧栏按钮与 N 键统一走 GraphCanvas 暴露的对话框，落点由画布视口决定。 */
function openCreateNode(): void {
  if (ready.value) {
    graphCanvasRef.value?.openCreateDialog()
  }
}

/**
 * 侧栏点击节点：可见性处理统一交给画布（退出聚焦、解除冲突筛选、展开折叠祖先），
 * 再选中并把节点定位到视口中心。普通画布点击不走这里：聚焦中心不随选中自动变化。
 */
function selectNodeFromSidebar(id: string): void {
  void graphCanvasRef.value?.locateNode(id)
}

async function deleteSelection(): Promise<void> {
  if (graph.selectedNodeId !== null) {
    await graph.deleteNode(graph.selectedNodeId)
    return
  }
  if (graph.selectedEdgeId !== null) {
    await graph.deleteEdge(graph.selectedEdgeId)
  }
}

useShortcuts({
  onCreateNode: () => {
    openCreateNode()
  },
  onDeleteSelection: () => {
    if (ready.value) {
      void deleteSelection()
    }
  },
  onEscape: () => {
    if (ui.helpOpen) {
      ui.helpOpen = false
      return
    }
    graph.selectNode(null)
    graph.selectEdge(null)
  },
  onExitFocus: () => {
    if (ui.focusNodeId !== null) {
      ui.exitFocus()
    }
  },
  onToggleFocus: () => {
    if (ready.value) {
      graphCanvasRef.value?.handleFocusShortcut()
    }
  },
  onFocusSearch: () => {
    shellRef.value?.focusSearch()
  },
  onToggleHelp: () => {
    if (ready.value) {
      ui.helpOpen = !ui.helpOpen
    }
  },
})

onBeforeUnmount(() => {
  void graph.flush()
})
</script>

<template>
  <div v-if="!ready" class="flex h-screen items-center justify-center bg-bg text-sm text-muted">
    正在加载工作区…
  </div>
  <template v-else>
    <AppShell ref="shellRef">
      <template #sidebar="{ collapsed }">
        <Sidebar
          :collapsed="collapsed"
          @create-node="openCreateNode"
          @select-node="selectNodeFromSidebar"
        />
      </template>
      <div class="flex h-full min-h-0 min-w-0 flex-col" data-testid="workspace-main">
        <header
          class="flex h-12 shrink-0 items-center border-b border-border bg-surface px-4"
          data-testid="workspace-context-header"
        >
          <h1 class="truncate text-sm font-semibold text-fg" data-testid="workspace-title">
            {{ title }}
          </h1>
        </header>
        <div class="min-h-0 min-w-0 flex-1">
          <GraphCanvas ref="graphCanvasRef" />
        </div>
      </div>
      <template #inspector>
        <Inspector />
      </template>
    </AppShell>
    <HelpDialog :open="ui.helpOpen" @close="ui.helpOpen = false" />
  </template>
</template>
