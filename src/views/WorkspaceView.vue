<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
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
      <template #sidebar>
        <Sidebar @create-node="openCreateNode" />
      </template>
      <GraphCanvas ref="graphCanvasRef" />
      <template #inspector>
        <Inspector />
      </template>
    </AppShell>
    <HelpDialog :open="ui.helpOpen" @close="ui.helpOpen = false" />
  </template>
</template>
