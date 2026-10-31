<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Panel,
  VueFlow,
  useVueFlow,
  type Connection,
  type Edge,
  type EdgeMouseEvent,
  type GraphNode,
  type Node,
  type NodeDragEvent,
  type NodeMouseEvent,
} from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import { Plus, Sparkles } from '@lucide/vue'
import BaseButton from '@/components/common/BaseButton.vue'
import GraphToolbar from './GraphToolbar.vue'
import LoreNode from './LoreNode.vue'
import CreateNodeDialog from './CreateNodeDialog.vue'
import RelationDialog from './RelationDialog.vue'
import TypeManagerDialog from './TypeManagerDialog.vue'
import type { LoreNodeData } from './types'
import { useGraphViewport } from '@/composables/useGraphViewport'
import type { LoreEdge } from '@/models/edge'
import type { LoreNode as LoreNodeModel } from '@/models/node'
import { useGraphStore } from '@/stores/graph'
import { useTypesStore } from '@/stores/types'
import { useUiStore } from '@/stores/ui'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'

const graph = useGraphStore()
const types = useTypesStore()
const ui = useUiStore()

/**
 * 在 GraphCanvas 的 setup 中创建 store：它会 provide 给下方 <VueFlow>，
 * 因此工具栏、对话框与画布共享同一实例，视口操作才能作用于这块画布。
 */
const flow = useVueFlow()
const viewport = useGraphViewport(flow)

const createOpen = ref(false)
const relationOpen = ref(false)
const typeManagerOpen = ref(false)
/** 待确认的连线：由 @connect 记录，确认后写入 store。 */
const pendingConnection = ref<{ source: string; target: string } | null>(null)

/** 自定义节点注册表：node.type === 'loreNode' 时使用 LoreNode 渲染。 */
const nodeTypes = { loreNode: markRaw(LoreNode) }

const filterActive = computed(() => ui.activeTypeKeys.length > 0)
const searchQuery = computed(() => ui.searchQuery.trim().toLowerCase())

/** 类型筛选：为空显示全部，否则只显示命中类型的节点。 */
function isVisible(node: LoreNodeModel): boolean {
  return !filterActive.value || ui.activeTypeKeys.includes(node.type)
}

/** 搜索命中：名称或描述包含搜索词（大小写不敏感）。 */
function isMatch(node: LoreNodeModel): boolean {
  if (searchQuery.value === '') {
    return false
  }
  return (
    node.name.toLowerCase().includes(searchQuery.value) ||
    node.description.toLowerCase().includes(searchQuery.value)
  )
}

const visibleNodes = computed(() => graph.nodes.filter(isVisible))
const visibleNodeIds = computed(() => new Set(visibleNodes.value.map((node) => node.id)))

/** store -> Vue Flow 的单向映射：画布只读，不回写。 */
const flowNodes = computed<Node<LoreNodeData>[]>(() =>
  visibleNodes.value.map((node) => {
    const typeDef = types.nodeTypeByKey(node.type)
    return {
      id: node.id,
      type: 'loreNode',
      position: { x: node.position.x, y: node.position.y },
      data: {
        name: node.name,
        typeLabel: typeDef?.label ?? node.type,
        color: typeDef?.color ?? '#6366f1',
        iconName: typeDef?.icon,
        isSelected: graph.selectedNodeId === node.id,
        isMatch: isMatch(node),
      },
    }
  }),
)

/** 边只在两端节点都可见时渲染，避免筛选后出现悬空连线。 */
const flowEdges = computed<Edge[]>(() =>
  graph.edges
    .filter(
      (edge) => visibleNodeIds.value.has(edge.source) && visibleNodeIds.value.has(edge.target),
    )
    .map((edge) => {
      const relation = types.relationTypeByKey(edge.relationType)
      const color = relation?.color ?? 'var(--muted)'
      const selected = graph.selectedEdgeId === edge.id
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'smoothstep',
        label: edge.label || undefined,
        style: {
          stroke: color,
          strokeWidth: selected ? 2.5 : 1.6,
          opacity: selected ? 1 : 0.8,
        },
        labelStyle: { fill: 'var(--fg)', fontSize: '11px' },
        labelBgStyle: { fill: 'var(--bg)', fillOpacity: 0.85 },
      }
    }),
)

const canDelete = computed(() => graph.selectedNodeId !== null || graph.selectedEdgeId !== null)

/** 小地图节点颜色跟随节点类型色。 */
function miniMapNodeColor(node: GraphNode): string {
  return String(node.data?.color ?? 'var(--muted)')
}

function fitView(): void {
  void viewport.fitAll()
}

function zoomIn(): void {
  void viewport.zoomIn()
}

function zoomOut(): void {
  void viewport.zoomOut()
}

function openCreateDialog(): void {
  createOpen.value = true
}

async function onNodeDragStop(event: NodeDragEvent): Promise<void> {
  // 拖拽结束才回写 store，拖动过程不产生保存
  const position = {
    x: Math.round(event.node.position.x),
    y: Math.round(event.node.position.y),
  }
  await graph.moveNode(event.node.id, position)
}

function onNodeClick(event: NodeMouseEvent): void {
  graph.selectNode(event.node.id)
}

function onEdgeClick(event: EdgeMouseEvent): void {
  graph.selectEdge(event.edge.id)
}

function onPaneClick(): void {
  graph.selectNode(null)
  graph.selectEdge(null)
}

/** 连线：先做自连/重复校验，合法则打开关系对话框，确认后才 createEdge。 */
function onConnect(connection: Connection): void {
  const source = connection.source
  const target = connection.target
  if (!source || !target) {
    return
  }
  if (source === target) {
    ui.notify('不能把节点连接到自身', { variant: 'danger' })
    return
  }
  if (graph.edgeBetween(source, target)) {
    ui.notify('这两个节点之间已存在同向关系', { variant: 'danger' })
    return
  }
  pendingConnection.value = { source, target }
  relationOpen.value = true
}

function onRelationCreated(edge: LoreEdge): void {
  pendingConnection.value = null
  relationOpen.value = false
  graph.selectEdge(edge.id)
}

function onRelationClosed(): void {
  pendingConnection.value = null
}

watch(relationOpen, (open) => {
  if (!open) {
    pendingConnection.value = null
  }
})

/** 点击输入框/可编辑区域时不要抢 Delete 键。 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
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

/**
 * 自定义 Delete：Vue Flow 自带删除键已通过 :delete-key-code="null" 关闭。
 * 工作区视图的全局快捷键会先处理并 preventDefault，这里用 defaultPrevented 避免重复删除。
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing) {
    return
  }
  if (event.key !== 'Delete' && event.key !== 'Backspace') {
    return
  }
  if (isEditableTarget(event.target)) {
    return
  }
  if (typeof document !== 'undefined' && document.querySelector('dialog[open]') !== null) {
    return
  }
  if (graph.selectedNodeId === null && graph.selectedEdgeId === null) {
    return
  }
  event.preventDefault()
  void deleteSelection()
}

/** 首次进入与切换到新世界时自动适应视图。 */
function autoFit(): void {
  void nextTick(() => {
    if (graph.nodes.length > 0) {
      fitView()
    }
  })
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  autoFit()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

watch(
  () => graph.universeId,
  () => autoFit(),
)

// 供父组件/E2E 调用
defineExpose({ fitView, openCreateDialog, openTypeManager: () => (typeManagerOpen.value = true) })
</script>

<template>
  <div class="graph-canvas" data-testid="graph-canvas">
    <VueFlow
      :nodes="flowNodes"
      :edges="flowEdges"
      :node-types="nodeTypes"
      :delete-key-code="null"
      :min-zoom="0.2"
      :max-zoom="1.8"
      :snap-to-grid="true"
      :snap-grid="[16, 16]"
      :fit-view-on-init="true"
      class="graph-canvas__flow"
      @connect="onConnect"
      @node-click="onNodeClick"
      @edge-click="onEdgeClick"
      @pane-click="onPaneClick"
      @node-drag-stop="onNodeDragStop"
    >
      <Background :gap="18" :size="1.2" color="var(--graph-dot)" />
      <Controls position="bottom-left" />
      <MiniMap
        position="bottom-right"
        :pannable="true"
        :zoomable="true"
        :node-color="miniMapNodeColor"
        mask-color="var(--surface)"
      />
      <Panel position="top-left">
        <GraphToolbar
          :can-delete="canDelete"
          @create-node="openCreateDialog"
          @manage-types="typeManagerOpen = true"
          @fit-view="fitView"
          @zoom-in="zoomIn"
          @zoom-out="zoomOut"
          @delete-selected="deleteSelection"
        />
      </Panel>
    </VueFlow>

    <!-- 空状态：还没有任何节点 -->
    <div v-if="graph.nodes.length === 0" class="graph-canvas__overlay" data-testid="graph-empty">
      <div class="graph-canvas__card">
        <span class="graph-canvas__icon"><Sparkles :size="22" /></span>
        <h2 class="text-base font-semibold text-fg">空白画布</h2>
        <p class="text-xs text-muted">
          从这个世界的第一个节点开始：新建人物、地点或事件，再从节点两侧拖出连线建立关系。
        </p>
        <BaseButton
          class="mt-1"
          size="sm"
          data-testid="empty-create-node-btn"
          @click="openCreateDialog"
        >
          <Plus :size="16" />
          新建节点
        </BaseButton>
      </div>
    </div>

    <!-- 筛选/搜索后没有可显示的节点 -->
    <div
      v-else-if="visibleNodes.length === 0"
      class="graph-canvas__overlay"
      data-testid="graph-filtered-empty"
    >
      <div class="graph-canvas__card">
        <h2 class="text-base font-semibold text-fg">没有匹配的节点</h2>
        <p class="text-xs text-muted">当前类型筛选没有命中任何节点。</p>
        <BaseButton class="mt-1" size="sm" variant="secondary" @click="ui.clearTypeFilters()">
          清除类型筛选
        </BaseButton>
      </div>
    </div>

    <CreateNodeDialog v-model:open="createOpen" />
    <RelationDialog
      v-model:open="relationOpen"
      :source-id="pendingConnection?.source ?? null"
      :target-id="pendingConnection?.target ?? null"
      @created="onRelationCreated"
      @closed="onRelationClosed"
    />
    <TypeManagerDialog v-model:open="typeManagerOpen" />
  </div>
</template>

<style scoped>
.graph-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg);
}

.graph-canvas__flow {
  width: 100%;
  height: 100%;
}

.graph-canvas__overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.graph-canvas__card {
  display: flex;
  max-width: 22rem;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 20px 24px;
  border: 1px dashed var(--border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  text-align: center;
  pointer-events: auto;
}

.graph-canvas__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin-bottom: 2px;
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--accent);
}

/* Vue Flow 内置控件与小地图跟随主题令牌，避免深色下出现白色面板。 */
:deep(.vue-flow__controls) {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 2px 10px rgb(0 0 0 / 12%);
}

:deep(.vue-flow__controls-button) {
  border-bottom-color: var(--border);
  background: var(--surface);
  color: var(--fg);
}

:deep(.vue-flow__controls-button:hover) {
  background: var(--surface-2);
}

:deep(.vue-flow__controls-button svg) {
  fill: currentColor;
}

:deep(.vue-flow__minimap) {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

:deep(.vue-flow__minimap-mask) {
  fill: color-mix(in srgb, var(--fg) 10%, transparent);
}
</style>
