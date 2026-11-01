<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
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
 * 侧栏点击节点：先退出聚焦模式（聚焦只保留中心节点的邻域，目标可能不在画布上，
 * 画布也就找不到它），再清除会隐藏目标节点的类型筛选（筛选是包含式的，非空且不含
 * 目标类型就会把节点藏起来），最后选中，并由画布把该节点定位到视口中心。
 * 普通画布点击不走这里：聚焦中心不随选中自动变化。
 */
function selectNodeFromSidebar(id: string): void {
  if (ui.focusNodeId !== null) {
    ui.exitFocus()
  }
  const node = graph.nodeById(id)
  if (node && ui.activeTypeKeys.length > 0 && !ui.activeTypeKeys.includes(node.type)) {
    ui.clearTypeFilters()
  }
  graph.selectNode(id)
  // 等聚焦退出、筛选与选中状态落到画布（Vue Flow 收到节点）后再定位，否则 fitNode 找不到目标
  void nextTick(() => {
    void graphCanvasRef.value?.focusNode(id)
  })
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
      graphCanvasRef.value?.toggleFocus()
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
      <GraphCanvas ref="graphCanvasRef" />
      <template #inspector>
        <Inspector />
      </template>
    </AppShell>
    <HelpDialog :open="ui.helpOpen" @close="ui.helpOpen = false" />
  </template>
</template>
