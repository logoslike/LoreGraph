<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Panel,
  VueFlow,
  useNodesInitialized,
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
import { Plus, ScanSearch, Sparkles, X } from '@lucide/vue'
import BaseButton from '@/components/common/BaseButton.vue'
import GraphToolbar from './GraphToolbar.vue'
import LoreEdgeView from './LoreEdge.vue'
import LoreNode from './LoreNode.vue'
import CreateNodeDialog from './CreateNodeDialog.vue'
import RelationDialog from './RelationDialog.vue'
import TypeManagerDialog from './TypeManagerDialog.vue'
import { assignEdgeLanes, orderEdgesForVisualPriority } from './edge-lanes'
import type { LoreEdgeData, LoreNodeData } from './types'
import GraphSearchPanel from './GraphSearchPanel.vue'
import { useGraphViewport } from '@/composables/useGraphViewport'
import { useNodeCollapse } from '@/composables/useNodeCollapse'
import { computeCollapseVisibility } from '@/services/collapse'
import type { LayoutMode } from '@/services/layout.service'
import { neighborhoodOf } from '@/services/neighborhood'
import { matchesNodeQuery } from '@/services/search'
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
/** 所有节点都量到尺寸后 Vue Flow 才会报 true，用于布局/导入后等待新节点可被 fitView 计入。 */
const nodesInitialized = useNodesInitialized()

/** 视口缩小到该阈值以下时隐藏全部边标签，避免标签互相压叠。 */
const EDGE_LABEL_MIN_ZOOM = 0.6

/** 画布根元素：尺寸变化时用它保持中心内容不动。 */
const canvasRef = ref<HTMLElement | null>(null)
let stopObserveResize: (() => void) | null = null
/** 等待 nodesInitialized 后再适应视图的 watcher，卸载时兜底停止。 */
let pendingFitStop: (() => void) | null = null

const createOpen = ref(false)
const relationOpen = ref(false)
const typeManagerOpen = ref(false)
const searchOpen = ref(false)
/** 待确认的连线：由 @connect 记录，确认后写入 store。 */
const pendingConnection = ref<{ source: string; target: string } | null>(null)

/** 自定义节点注册表：node.type === 'loreNode' 时使用 LoreNode 渲染。 */
const nodeTypes = { loreNode: markRaw(LoreNode) }
/** 自定义关系注册表：需要在同一对节点间为多条关系分道，故不能使用内置 smoothstep。 */
const edgeTypes = { loreEdge: markRaw(LoreEdgeView) }

const filterActive = computed(() => ui.activeTypeKeys.length > 0)
const searchQuery = computed(() => ui.searchQuery.trim().toLowerCase())

/** 节点折叠是视图状态：按当前世界持久化，不写节点模型、不进入导出文件。 */
const collapse = useNodeCollapse(() => graph.universeId ?? '')
const collapseVisibility = computed(() =>
  computeCollapseVisibility(collapse.collapsedIds.value, graph.edges),
)
/** 有出边的节点才显示折叠按钮，与「子节点」定义一致。 */
const parentNodeIds = computed(() => new Set(graph.edges.map((edge) => edge.source)))

/** 类型筛选：为空显示全部，否则只显示命中类型的节点。 */
function isVisible(node: LoreNodeModel): boolean {
  return !filterActive.value || ui.activeTypeKeys.includes(node.type)
}

/** 搜索命中：名称或描述包含搜索词（与侧栏、画布查找共用同一规则）。 */
function isMatch(node: LoreNodeModel): boolean {
  return matchesNodeQuery(node, ui.searchQuery)
}

/** 聚焦模式保留的节点 id；未聚焦时为 null。类型筛选与它在 visibleNodes 里取交集。 */
const focusNodeIds = computed<Set<string> | null>(() => {
  const centerId = ui.focusNodeId
  if (centerId === null) {
    return null
  }
  return (
    neighborhoodOf(graph.nodes, graph.edges, { nodeId: centerId, edgeId: null })?.nodeIds ?? null
  )
})

/** 聚焦中心节点，用于顶部提示条。 */
const focusCenter = computed(() =>
  ui.focusNodeId === null ? null : graph.nodeById(ui.focusNodeId),
)

const visibleNodes = computed(() =>
  graph.nodes.filter(
    (node) =>
      isVisible(node) &&
      !collapseVisibility.value.hiddenNodeIds.has(node.id) &&
      (focusNodeIds.value === null || focusNodeIds.value.has(node.id)),
  ),
)
const visibleNodeIds = computed(() => new Set(visibleNodes.value.map((node) => node.id)))

/** 边只在两端节点都可见时渲染，避免筛选或聚焦后出现悬空连线。 */
const visibleEdges = computed(() =>
  graph.edges.filter(
    (edge) => visibleNodeIds.value.has(edge.source) && visibleNodeIds.value.has(edge.target),
  ),
)

/** 相邻高亮的保留集合；无选中时为 null，画布不变淡。 */
const neighborhood = computed(() =>
  neighborhoodOf(visibleNodes.value, visibleEdges.value, {
    nodeId: graph.selectedNodeId,
    edgeId: graph.selectedEdgeId,
  }),
)

/** 视口缩放低于阈值时隐藏所有边标签。 */
const edgeLabelsVisible = computed(() => flow.viewport.value.zoom >= EDGE_LABEL_MIN_ZOOM)

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
        isDimmed: neighborhood.value !== null && !neighborhood.value.nodeIds.has(node.id),
        isCollapsed: parentNodeIds.value.has(node.id) && collapse.isCollapsed(node.id),
        hiddenCount: collapseVisibility.value.hiddenCounts.get(node.id) ?? 0,
        hasChildren: parentNodeIds.value.has(node.id),
        onToggleCollapse: () => toggleNodeCollapse(node.id),
      },
    }
  }),
)

/**
 * 同一对节点之间的多条关系（双向关系、导入的重复关系）分配对称车道：
 * 连线绕到节点上方/下方，标签不再落在同一点上。唯一关系保持 lane=0，外观不变。
 */
const edgeLanes = computed(() => assignEdgeLanes(visibleEdges.value))

const flowEdges = computed<Edge<LoreEdgeData>[]>(() =>
  // 选中的关系最后绘制，标签与描边不会被其他关系压住
  orderEdgesForVisualPriority(visibleEdges.value, graph.selectedEdgeId).map((edge) => {
    const relation = types.relationTypeByKey(edge.relationType)
    const color = relation?.color ?? 'var(--muted)'
    const selected = graph.selectedEdgeId === edge.id
    // 有选中时变淡的边不显示标签；缩小到阈值以下时全部隐藏
    const dimmed = neighborhood.value !== null && !neighborhood.value.edgeIds.has(edge.id)
    const label = edge.label && !dimmed && edgeLabelsVisible.value ? edge.label : undefined
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'loreEdge',
      data: { lane: edgeLanes.value.get(edge.id) ?? 0 },
      label,
      style: {
        stroke: color,
        strokeWidth: selected ? 2.5 : 1.6,
        opacity: dimmed ? 0.15 : selected ? 1 : 0.8,
      },
      labelStyle: { fill: 'var(--fg)', fontSize: '11px' },
      labelBgStyle: { fill: 'var(--bg)', fillOpacity: 0.85 },
      // 圆角 + 内边距，标签不再紧贴文字
      labelBgPadding: [6, 3],
      labelBgBorderRadius: 4,
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function stopPendingFit(): void {
  pendingFitStop?.()
  pendingFitStop = null
}

/**
 * 新节点还没量出尺寸时 fitView 会漏算它们：先等一拍让 Vue Flow 收下新节点（此时尺寸还是 0），
 * 再等 nodesInitialized 变回 true 才适应视图。
 */
function fitAllWhenNodesReady(): void {
  stopPendingFit()
  void nextTick(() => {
    if (graph.nodes.length === 0) {
      return
    }
    if (nodesInitialized.value) {
      void viewport.fitAll()
      return
    }
    pendingFitStop = watch(nodesInitialized, (ready) => {
      if (!ready) {
        return
      }
      stopPendingFit()
      void viewport.fitAll()
    })
  })
}

/**
 * 自动布局：store 只回滚坐标并抛出，提示由这里负责。
 * 布局写回后 Vue Flow 的节点位置在 post flush 才更新，先等一拍再 fitView，否则会按旧坐标算包围盒。
 */
async function onAutoLayout(mode: LayoutMode): Promise<void> {
  if (graph.isLayouting || graph.nodes.length === 0) {
    return
  }
  try {
    await graph.applyLayout(mode)
  } catch (error) {
    ui.notify(`自动布局失败：${formatError(error)}`, { variant: 'danger' })
    return
  }
  // 计算期间可能切换了世界，结果作废，此时不会留下快照
  if (!graph.canRestoreLayout) {
    return
  }
  await nextTick()
  await viewport.fitAll()
  ui.notify('已自动布局', {
    // 连续布局只保留最后一条提示，撤销仍回到第一次布局前的位置
    key: 'auto-layout',
    actionLabel: '撤销',
    duration: 8000,
    onAction: () => {
      void restoreLayout()
    },
  })
}

/** 恢复到上一次自动布局前的坐标。 */
async function restoreLayout(): Promise<void> {
  if (graph.isLayouting || !graph.canRestoreLayout) {
    return
  }
  try {
    await graph.restoreLayout()
  } catch (error) {
    ui.notify(`恢复布局失败：${formatError(error)}`, { variant: 'danger' })
    return
  }
  await nextTick()
  await viewport.fitAll()
}

function onRestoreLayout(): void {
  void restoreLayout()
}

/** 图谱片段合并导入成功后节点变多，重新适应视图。 */
function onGraphImported(): void {
  fitAllWhenNodesReady()
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

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      resolve()
      return
    }
    requestAnimationFrame(() => resolve())
  })
}

/**
 * 等节点被 Vue Flow 收下并量到尺寸：类型筛选被清除后重新出现的节点，
 * 首帧尺寸为 0，此时 fitNode 会按零尺寸包围盒计算，节点只会贴到视口边缘而不居中。
 */
async function waitForNodeMeasured(nodeId: string, maxFrames = 30): Promise<boolean> {
  for (let frame = 0; frame < maxFrames; frame += 1) {
    const node = flow.findNode(nodeId)
    if (node && node.dimensions.width > 0 && node.dimensions.height > 0) {
      return true
    }
    await nextFrame()
  }
  return false
}

/**
 * 把指定节点定位到视口中心（供侧栏点击节点等画布外入口调用）。
 * 节点可能刚被类型筛选放出来，先等它被挂载并量到尺寸，再做单节点 fitView。
 */
async function focusNode(nodeId: string): Promise<boolean> {
  await nextTick()
  if (!(await waitForNodeMeasured(nodeId))) {
    return false
  }
  return await viewport.fitNode(nodeId)
}

/**
 * 收起/展开一个节点。折叠会隐藏它的后代与相关边；
 * 如果当前选中项或聚焦中心被藏起来，同时清除，避免 Inspector 指向画布上不存在的元素。
 */
function toggleNodeCollapse(nodeId: string): void {
  collapse.toggle(nodeId)
  const hidden = computeCollapseVisibility(collapse.collapsedIds.value, graph.edges).hiddenNodeIds
  if (graph.selectedNodeId !== null && hidden.has(graph.selectedNodeId)) {
    graph.selectNode(null)
  }
  const selectedEdge = graph.selectedEdge
  if (selectedEdge && (hidden.has(selectedEdge.source) || hidden.has(selectedEdge.target))) {
    graph.selectEdge(null)
  }
  if (ui.focusNodeId !== null && hidden.has(ui.focusNodeId)) {
    ui.exitFocus()
  }
}

/**
 * 把目标节点带回可见状态：退出聚焦、解除冲突的类型筛选、展开藏起它的折叠祖先。
 * 侧栏、查找结果和快捷键共用这一套规则，避免入口之间行为不一致。
 */
function prepareNodeNavigation(nodeId: string): boolean {
  const node = graph.nodeById(nodeId)
  if (!node) {
    return false
  }
  if (ui.focusNodeId !== null) {
    ui.exitFocus()
  }
  if (ui.activeTypeKeys.length > 0 && !ui.activeTypeKeys.includes(node.type)) {
    ui.clearTypeFilters()
  }
  collapse.revealNode(nodeId, graph.edges)
  graph.selectNode(nodeId)
  return true
}

/** 选中节点并把视口中心移到它身上；目标被隐藏时先恢复可见。 */
async function locateNode(nodeId: string): Promise<boolean> {
  if (!prepareNodeNavigation(nodeId)) {
    return false
  }
  await nextTick()
  return await focusNode(nodeId)
}

/** 选中节点并进入 Focus Mode；可见性处理与 locateNode 相同。 */
async function focusNodeInMode(nodeId: string): Promise<void> {
  if (!prepareNodeNavigation(nodeId)) {
    return
  }
  await nextTick()
  ui.enterFocus(nodeId)
}

function toggleSearch(): void {
  searchOpen.value = !searchOpen.value
}

function closeSearch(): void {
  searchOpen.value = false
}

function onSearchLocate(nodeId: string): void {
  void locateNode(nodeId)
}

function onSearchFocus(nodeId: string): void {
  void focusNodeInMode(nodeId)
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

/** 进入/退出聚焦模式：工具栏按钮与 F 键共用，未选中节点且未聚焦时是空操作。 */
function toggleFocus(): void {
  if (ui.focusNodeId !== null) {
    ui.exitFocus()
    return
  }
  if (graph.selectedNodeId !== null) {
    ui.enterFocus(graph.selectedNodeId)
  }
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
  // 窗口缩放或左右面板开合时保持画布中心的内容不动，不打断用户当前的平移缩放
  stopObserveResize = viewport.preserveCenterOnResize(canvasRef.value)
  autoFit()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  stopObserveResize?.()
  stopObserveResize = null
  stopPendingFit()
})

watch(
  () => graph.universeId,
  () => autoFit(),
)

/** 进入或退出聚焦后可见节点变化，重新适应视图。 */
watch(
  () => ui.focusNodeId,
  () => fitAllWhenNodesReady(),
)

// 供父组件/E2E 调用
defineExpose({
  fitView,
  focusNode,
  locateNode,
  openCreateDialog,
  openTypeManager: () => (typeManagerOpen.value = true),
  toggleFocus,
})
</script>

<template>
  <div ref="canvasRef" class="graph-canvas" data-testid="graph-canvas">
    <VueFlow
      :nodes="flowNodes"
      :edges="flowEdges"
      :node-types="nodeTypes"
      :edge-types="edgeTypes"
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
          :can-focus="graph.selectedNodeId !== null"
          :focused="ui.focusNodeId !== null"
          :layouting="graph.isLayouting"
          :can-restore-layout="graph.canRestoreLayout"
          :search-open="searchOpen"
          :search-active="searchQuery !== ''"
          @create-node="openCreateDialog"
          @toggle-search="toggleSearch"
          @toggle-focus="toggleFocus"
          @manage-types="typeManagerOpen = true"
          @fit-view="fitView"
          @zoom-in="zoomIn"
          @zoom-out="zoomOut"
          @delete-selected="deleteSelection"
          @auto-layout="onAutoLayout"
          @restore-layout="onRestoreLayout"
          @graph-imported="onGraphImported"
        />
      </Panel>

      <!-- 聚焦模式提示条：中心节点名 + 退出按钮 -->
      <Panel v-if="focusCenter" position="top-center">
        <div class="graph-focus-banner" data-testid="focus-banner">
          <ScanSearch :size="14" aria-hidden="true" />
          <span class="graph-focus-banner__label">聚焦：{{ focusCenter.name }}</span>
          <button
            type="button"
            class="graph-focus-banner__exit"
            data-testid="focus-exit-btn"
            aria-label="退出聚焦"
            title="退出聚焦（F）"
            @click="ui.exitFocus()"
          >
            <X :size="14" />
          </button>
        </div>
      </Panel>
    </VueFlow>

    <!-- 节点查找：与侧栏搜索共用 query，非模态，不铺遮罩 -->
    <GraphSearchPanel
      v-if="searchOpen"
      @close="closeSearch"
      @locate="onSearchLocate"
      @focus="onSearchFocus"
    />

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

/* 聚焦模式提示条：与侧栏卡片一致的主题令牌，圆角胶囊形 */
.graph-focus-banner {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 4px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg);
  color: var(--fg);
  font-size: 12px;
  box-shadow: 0 2px 10px rgb(0 0 0 / 12%);
}

.graph-focus-banner__label {
  max-width: 18rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.graph-focus-banner__exit {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  color: var(--muted);
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.graph-focus-banner__exit:hover {
  background: var(--surface-2);
  color: var(--fg);
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
