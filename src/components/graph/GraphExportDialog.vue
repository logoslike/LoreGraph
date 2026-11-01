<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Link2, Search } from '@lucide/vue'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import TypeDot from '@/components/common/TypeDot.vue'
import { useToast } from '@/composables/useToast'
import { services } from '@/services'
import { expandWithNeighbors } from '@/services/export.service'
import { useGraphStore } from '@/stores/graph'
import { useTypesStore } from '@/stores/types'
import { useUniverseStore } from '@/stores/universe'

/** 图谱片段导出：勾选节点、预览将导出的节点与关系，再交给 exporter 生成文件。 */
const props = defineProps<{ open: boolean }>()

const emit = defineEmits<{
  (event: 'update:open', value: boolean): void
  (event: 'exported'): void
}>()

const graph = useGraphStore()
const types = useTypesStore()
const universe = useUniverseStore()
const toast = useToast()

const selectedIds = ref<Set<string>>(new Set())
const keyword = ref('')
const exporting = ref(false)

const filteredNodes = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (query === '') {
    return graph.nodes
  }
  return graph.nodes.filter((node) => node.name.toLowerCase().includes(query))
})

const selectedNodes = computed(() => graph.nodes.filter((node) => selectedIds.value.has(node.id)))
const includedEdges = computed(() =>
  graph.edges.filter(
    (edge) => selectedIds.value.has(edge.source) && selectedIds.value.has(edge.target),
  ),
)
// 与 export.service 的统计规则一致：只统计一端在选中集合内、另一端在外的关系
const omittedEdgeCount = computed(
  () =>
    graph.edges.filter(
      (edge) => selectedIds.value.has(edge.source) !== selectedIds.value.has(edge.target),
    ).length,
)
const canExport = computed(() => selectedNodes.value.length > 0 && !exporting.value)

/** 打开时重置筛选，并预选当前选中的节点。 */
watch(
  () => props.open,
  (open) => {
    if (!open) {
      return
    }
    keyword.value = ''
    selectedIds.value = new Set(graph.selectedNodeId ? [graph.selectedNodeId] : [])
    exporting.value = false
  },
  { immediate: true },
)

function typeLabelOf(typeKey: string): string {
  return types.nodeTypeByKey(typeKey)?.label ?? typeKey
}

function colorOf(typeKey: string): string {
  return types.nodeTypeByKey(typeKey)?.color ?? '#6366f1'
}

function toggleNode(id: string): void {
  const next = new Set(selectedIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  selectedIds.value = next
}

/** 全选作用于当前筛选结果；未筛选时即全选全部节点。 */
function selectAll(): void {
  const next = new Set(selectedIds.value)
  for (const node of filteredNodes.value) {
    next.add(node.id)
  }
  selectedIds.value = next
}

function selectNone(): void {
  selectedIds.value = new Set()
}

/** 加入与已选节点直接相邻的一层节点。 */
function addNeighbors(): void {
  selectedIds.value = expandWithNeighbors(graph.edges, selectedIds.value)
}

function sanitizeFilenamePart(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|]/g, '-').trim()
  return cleaned === '' ? '未命名世界' : cleaned
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function onExport(): Promise<void> {
  if (!canExport.value) {
    return
  }
  exporting.value = true
  try {
    const universeId = graph.requireUniverseId()
    const ids = [...selectedIds.value]
    const result = await services.exporter.exportGraph(universeId, ids)
    const worldName = sanitizeFilenamePart(universe.current?.name ?? '')
    const filename = `${worldName}-图谱片段.loregraph.json`
    services.exporter.download(result.data, filename)
    toast.info(`已导出 ${result.data.nodes.length} 个节点、${result.data.edges.length} 条关系`)
    emit('update:open', false)
    emit('exported')
  } catch (error) {
    toast.danger(`导出失败：${formatError(error)}`)
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <BaseDialog
    :open="open"
    title="导出图谱片段"
    width="520px"
    data-testid="graph-export-dialog"
    @close="emit('update:open', false)"
  >
    <div class="space-y-3">
      <label class="relative block">
        <Search
          :size="14"
          class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted"
        />
        <input
          v-model="keyword"
          type="text"
          placeholder="按节点名称筛选"
          data-testid="graph-export-search-input"
          class="w-full rounded-md border border-border bg-bg py-1.5 pr-2.5 pl-8 text-sm text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      <div class="flex flex-wrap items-center gap-1.5">
        <BaseButton
          variant="secondary"
          size="sm"
          data-testid="graph-export-select-all-btn"
          @click="selectAll"
        >
          全选{{ keyword.trim() === '' ? '' : '筛选结果' }}
        </BaseButton>
        <BaseButton
          variant="secondary"
          size="sm"
          data-testid="graph-export-select-none-btn"
          @click="selectNone"
        >
          全不选
        </BaseButton>
        <BaseButton
          variant="secondary"
          size="sm"
          class="ml-auto"
          :disabled="selectedIds.size === 0"
          data-testid="graph-export-add-neighbors-btn"
          @click="addNeighbors"
        >
          <Link2 :size="14" />
          加入直接关联节点
        </BaseButton>
      </div>

      <ul
        v-if="filteredNodes.length > 0"
        class="max-h-64 space-y-0.5 overflow-y-auto rounded-lg border border-border bg-bg p-1"
        data-testid="graph-export-node-list"
      >
        <li v-for="node in filteredNodes" :key="node.id">
          <label
            class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2"
            data-testid="graph-export-node-item"
            :data-node-name="node.name"
          >
            <input
              type="checkbox"
              class="size-3.5 shrink-0 accent-accent"
              :checked="selectedIds.has(node.id)"
              data-testid="graph-export-node-checkbox"
              @change="toggleNode(node.id)"
            />
            <TypeDot :color="colorOf(node.type)" />
            <span class="truncate text-sm">{{ node.name }}</span>
            <span class="ml-auto shrink-0 text-xs text-muted">{{ typeLabelOf(node.type) }}</span>
          </label>
        </li>
      </ul>

      <p
        v-else-if="graph.nodes.length === 0"
        class="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted"
        data-testid="graph-export-empty"
      >
        当前世界还没有节点，先创建节点后再导出图谱片段。
      </p>
      <p
        v-else
        class="px-2 py-3 text-center text-xs text-muted"
        data-testid="graph-export-no-match"
      >
        没有匹配的节点，换个关键词试试。
      </p>

      <div class="space-y-0.5 border-t border-border pt-2">
        <p class="text-xs text-fg" data-testid="graph-export-summary">
          将导出 {{ selectedNodes.length }} 个节点、{{ includedEdges.length }} 条关系
        </p>
        <p
          v-if="omittedEdgeCount > 0"
          class="text-xs text-muted"
          data-testid="graph-export-omitted"
        >
          {{ omittedEdgeCount }} 条关系因另一端未选中而不导出
        </p>
        <p v-else-if="selectedNodes.length === 0" class="text-xs text-muted">
          至少勾选一个节点才能导出。
        </p>
      </div>
    </div>

    <template #footer>
      <BaseButton
        variant="secondary"
        size="sm"
        data-testid="graph-export-cancel-btn"
        @click="emit('update:open', false)"
      >
        取消
      </BaseButton>
      <BaseButton
        size="sm"
        :disabled="!canExport"
        data-testid="graph-export-confirm-btn"
        @click="onExport"
      >
        {{ exporting ? '导出中…' : '导出片段' }}
      </BaseButton>
    </template>
  </BaseDialog>
</template>
