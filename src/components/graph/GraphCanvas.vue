<script setup lang="ts">
import {
  computed,
  markRaw,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  shallowRef,
  watch,
  watchEffect,
} from 'vue'
import {
  MarkerType,
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
import { assignEdgeLanes, choosePorts, orderEdgesForVisualPriority, type Rect } from './edge-lanes'
import { EDGE_OBSTACLES, nodeRectOf, sameRect, type NodeRects } from './edge-obstacles'
import type { LoreEdgeData, LoreNodeData } from './types'
import GraphSearchPanel from './GraphSearchPanel.vue'
import { useGraphViewport } from '@/composables/useGraphViewport'
import { useNodeCollapse } from '@/composables/useNodeCollapse'
import { useNodeExpansion } from '@/composables/useNodeExpansion'
import { computeCollapseVisibility } from '@/services/collapse'
import { isBigGraph, relationCountsOf, visibleEdgesForGraph } from '@/services/expansion'
import { DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH } from '@/services/layout.service'
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
/** 指针当前悬停的节点 id；F 键据此优先聚焦悬停目标。 */
const hoveredNodeId = ref<string | null>(null)
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

/** 大图关系展开同样是视图状态：按世界持久化，不写节点模型、不进入导出文件。 */
const expansion = useNodeExpansion(() => graph.universeId ?? '')

/** 大图阈值只看 store 全量数据，不受类型筛选、聚焦或折叠影响。 */
const bigGraph = computed(() => isBigGraph(graph.nodes.length, graph.edges.length))
const expandedNodeIds = computed(() => new Set(expansion.expandedIds.value))

/** 大图停用「隐藏后代节点」的旧折叠：节点卡片常驻，展开状态只筛选关系线。 */
const EMPTY_COLLAPSE = { hiddenNodeIds: new Set<string>(), hiddenCounts: new Map<string, number>() }
const collapseVisibility = computed(() =>
  bigGraph.value
    ? EMPTY_COLLAPSE
    : computeCollapseVisibility(collapse.collapsedIds.value, graph.edges),
)

/**
 * 大图停用旧折叠时隐藏项全部恢复可见；节点删除到阈值以下后旧折叠重新生效。
 * 此时选中项或聚焦中心可能正好落在被重新藏起来的后代里，必须同步清除，
 * 否则 Inspector / 聚焦提示条会指向画布上已经不存在的节点。
 */
watch(bigGraph, (isBigGraphMode) => {
  if (isBigGraphMode) {
    return
  }
  clearHiddenSelection(collapseVisibility.value.hiddenNodeIds)
})

/** 每个节点的直接关系数：大图 chevron 的徽标与「是否可展开」判定。 */
const relationCounts = computed(() => relationCountsOf(graph.edges))
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

/** 节点被聚焦/筛选卸载时不会收到 mouseleave，悬停目标必须在不可见时立即失效。 */
watch(visibleNodeIds, (ids) => {
  if (hoveredNodeId.value !== null && !ids.has(hoveredNodeId.value)) {
    hoveredNodeId.value = null
  }
})

/**
 * 边只在两端节点都可见时渲染，避免筛选或聚焦后出现悬空连线；
 * 大图再叠加「至少一端已展开」，小图保持全部可见。
 */
const visibleEdges = computed(() =>
  visibleEdgesForGraph(graph.edges, visibleNodeIds.value, expandedNodeIds.value, bigGraph.value),
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
        isNeighbor:
          neighborhood.value !== null &&
          node.id !== graph.selectedNodeId &&
          neighborhood.value.nodeIds.has(node.id),
        isMatch: isMatch(node),
        isDimmed: neighborhood.value !== null && !neighborhood.value.nodeIds.has(node.id),
        // 大图停用旧折叠：节点常驻，卡片不显示折叠染色/徽标；collapsedIds 保留到恢复小图后再生效
        isCollapsed:
          !bigGraph.value && parentNodeIds.value.has(node.id) && collapse.isCollapsed(node.id),
        hiddenCount: bigGraph.value ? 0 : (collapseVisibility.value.hiddenCounts.get(node.id) ?? 0),
        hasChildren: !bigGraph.value && parentNodeIds.value.has(node.id),
        onToggleCollapse: () => toggleNodeCollapse(node.id),
        relationsMode: bigGraph.value,
        isExpanded: expandedNodeIds.value.has(node.id),
        relationCount: relationCounts.value.get(node.id) ?? 0,
        onToggleRelations: () => toggleNodeRelations(node.id),
      },
    }
  }),
)

/**
 * 同一对节点之间的多条关系（双向关系、导入的重复关系）分配对称车道：
 * 连线绕到节点上方/下方，标签不再落在同一点上。唯一关系保持 lane=0，外观不变。
 */
const edgeLanes = computed(() => assignEdgeLanes(visibleEdges.value))

/** 节点尺寸只在挂载/尺寸变化时更新；拖动不改变尺寸，因此拖动期间保持稳定。 */
const nodeSizes = computed(() => {
  const sizes = new Map<string, { width: number; height: number }>()
  for (const node of flow.nodes.value) {
    const dimensions = node.dimensions
    sizes.set(node.id, {
      width: dimensions.width > 0 ? dimensions.width : DEFAULT_NODE_WIDTH,
      height: dimensions.height > 0 ? dimensions.height : DEFAULT_NODE_HEIGHT,
    })
  }
  return sizes
})

/**
 * 端口选择只看 store 里的坐标：拖动期间 store 不变，flowEdges 不会每帧重建，
 * 边组件也就不会整层重渲染；drop 回写坐标后才按新位置精确重算端口。
 * 这里刻意不读 Vue Flow 的 computedPosition，正是为了避免拖动期间每帧失效。
 */
const nodeRects = computed(() => {
  const rects = new Map<string, Rect>()
  for (const node of graph.nodes) {
    const size = nodeSizes.value.get(node.id)
    rects.set(node.id, {
      x: node.position.x,
      y: node.position.y,
      width: size?.width ?? DEFAULT_NODE_WIDTH,
      height: size?.height ?? DEFAULT_NODE_HEIGHT,
    })
  }
  return rects
})

/**
 * 共享障碍几何：所有关系复用同一份节点盒快照。
 * 拖动期间由 @node-drag 增量更新——只替换真正移动的节点盒，其余盒保持对象身份，
 * 移动中的节点因此实时参与避障，而远端关系的候选列表逐项不变、几何不会被重算。
 * 非拖动状态跟随 Vue Flow 的实际坐标（挂载、改尺寸、布局、删除后各同步一次）。
 */
const draggingNodeId = ref<string | null>(null)
const obstacleRects = shallowRef<NodeRects>(new Map())

/** 只更新传入节点里真的变了的盒；没变时连 Map 都不替换。 */
function updateObstacleRects(nodes: readonly GraphNode[]): void {
  const current = obstacleRects.value
  let next: Map<string, Rect> | null = null
  for (const node of nodes) {
    const rect = nodeRectOf(node)
    const existing = current.get(node.id)
    if (existing !== undefined && sameRect(existing, rect)) {
      continue
    }
    if (next === null) {
      next = new Map(current)
    }
    next.set(node.id, rect)
  }
  if (next !== null) {
    obstacleRects.value = next
  }
}

/** 全量同步：保留仍然相等的旧盒对象，节点增删或尺寸变化时才替换 Map。 */
function syncObstacleRects(nodes: readonly GraphNode[]): void {
  const current = obstacleRects.value
  const next = new Map<string, Rect>()
  let changed = false
  for (const node of nodes) {
    const existing = current.get(node.id)
    if (existing !== undefined) {
      const rect = nodeRectOf(node)
      if (sameRect(existing, rect)) {
        next.set(node.id, existing)
        continue
      }
      next.set(node.id, rect)
    } else {
      next.set(node.id, nodeRectOf(node))
    }
    changed = true
  }
  if (!changed && next.size === current.size) {
    return
  }
  obstacleRects.value = next
}

watchEffect(() => {
  // 拖动期间由 @node-drag 增量更新，避免每帧重建整张表、丢掉其它盒的对象身份
  if (draggingNodeId.value !== null) {
    return
  }
  syncObstacleRects(flow.nodes.value)
})
provide(EDGE_OBSTACLES, obstacleRects)

/**
 * 给箭头颜色叠加与描边一致的透明度：关系色是十六进制时生成 8 位色，
 * 其它值（例如未来出现的 CSS 变量）退回可读的灰蓝，避免 marker id 带括号/空格。
 */
function withAlpha(color: string, opacity: number): string {
  const alpha = Math.round(Math.min(1, Math.max(0, opacity)) * 255)
    .toString(16)
    .padStart(2, '0')
  const longHex = /^#([0-9a-f]{6})$/i.exec(color)
  if (longHex) {
    return `#${longHex[1]}${alpha}`
  }
  const shortHex = /^#([0-9a-f]{3})$/i.exec(color)
  if (shortHex) {
    const [red, green, blue] = shortHex[1]
    return `#${red}${red}${green}${green}${blue}${blue}${alpha}`
  }
  return `#94a3b8${alpha}`
}

const flowEdges = computed<Edge<LoreEdgeData>[]>(() =>
  // 选中的关系最后绘制，标签与描边不会被其他关系压住
  orderEdgesForVisualPriority(visibleEdges.value, graph.selectedEdgeId).map((edge) => {
    const relation = types.relationTypeByKey(edge.relationType)
    // 未知关系类型沿用主题的 muted 色；箭头颜色由 withAlpha 的灰蓝兜底
    const color = relation?.color ?? 'var(--muted)'
    const selected = graph.selectedEdgeId === edge.id
    // 有选中时变淡的边不显示标签；缩小到阈值以下时全部隐藏
    const dimmed = neighborhood.value !== null && !neighborhood.value.edgeIds.has(edge.id)
    const emphasized =
      !dimmed && !selected && neighborhood.value !== null && neighborhood.value.edgeIds.has(edge.id)
    const label = edge.label && !dimmed && edgeLabelsVisible.value ? edge.label : undefined
    // 平行/双向/自环沿用右出左入；普通边按相对方位选相向端口（仅视图映射）
    const lane = edgeLanes.value.get(edge.id) ?? 0
    const sourceRect = nodeRects.value.get(edge.source)
    const targetRect = nodeRects.value.get(edge.target)
    const ports =
      lane !== 0 || edge.source === edge.target || !sourceRect || !targetRect
        ? { sourceHandle: 'right', targetHandle: 'left' }
        : choosePorts(sourceRect, targetRect)
    // 关联边保持原色并加粗；非关联边保留可读性，但退到背景里
    const opacity = dimmed ? 0.2 : selected || emphasized ? 1 : 0.8
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'loreEdge',
      sourceHandle: ports.sourceHandle,
      targetHandle: ports.targetHandle,
      data: { lane },
      label,
      style: {
        stroke: color,
        strokeWidth: selected ? 2.5 : emphasized ? 2.15 : 1.6,
        opacity,
      },
      // 所有边共用同一个全局开关；颜色跟随关系色和当前高亮/变淡态
      markerEnd: ui.showEdgeArrows
        ? {
            type: MarkerType.ArrowClosed,
            color: withAlpha(color, opacity),
            width: 11,
            height: 11,
            markerUnits: 'userSpaceOnUse',
            strokeWidth: 1,
          }
        : undefined,
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
  clearHiddenSelection(
    computeCollapseVisibility(collapse.collapsedIds.value, graph.edges).hiddenNodeIds,
  )
}

/**
 * 选中项或聚焦中心落在给定的隐藏集合里时清除，避免 Inspector / 聚焦提示条
 * 指向画布上不存在的元素。折叠开关与「大图降回小图」共用这一套清理。
 */
function clearHiddenSelection(hidden: ReadonlySet<string>): void {
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
 * 大图里收起/展开一个节点的直接关系。收起后若当前选中的关系因此不可见，
 * 立即清除选中态，避免 Inspector 指向画布上已消失的关系。
 */
function toggleNodeRelations(nodeId: string): void {
  expansion.toggle(nodeId)
  clearHiddenEdgeSelection()
}

/** 当前可见关系里是否包含指定 id。 */
function isEdgeVisible(edgeId: string): boolean {
  return visibleEdges.value.some((edge) => edge.id === edgeId)
}

/** 选中关系被筛选/聚焦/收起隐藏时清空选中态。 */
function clearHiddenEdgeSelection(): void {
  if (graph.selectedEdgeId !== null && !isEdgeVisible(graph.selectedEdgeId)) {
    graph.selectEdge(null)
  }
}

/**
 * 显式选边（Inspector 的所属关系、画布点边）后若目标边不可见：
 * 大图只展开 source 端点一跳让这条边出现，不扩散到 target 或其它分支；
 * 展开后仍不可见（被筛选/聚焦排除）则清空选中，Inspector 回到空态。
 */
watch(
  () => graph.selectedEdgeId,
  (edgeId) => {
    if (edgeId === null || isEdgeVisible(edgeId)) {
      return
    }
    if (bigGraph.value) {
      const edge = graph.edgeById(edgeId)
      if (edge) {
        expansion.expand(edge.source)
      }
    }
    if (!isEdgeVisible(edgeId)) {
      graph.selectEdge(null)
    }
  },
)

/** 可见关系集合变化（收起、筛选、聚焦、删除）后，隐藏的选中边不再保留。 */
watch(visibleEdges, () => clearHiddenEdgeSelection())

/** 删除节点/切换世界后清理已不存在的展开记录，避免存储里留下幽灵 id。 */
watch(
  () => graph.nodes,
  (nodes) => {
    expansion.retain(new Set(nodes.map((node) => node.id)))
  },
  { flush: 'post' },
)

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
  if (bigGraph.value) {
    // 大图定位只展开目标自身一跳，不扩散到邻居分支
    expansion.expand(nodeId)
  } else {
    collapse.revealNode(nodeId, graph.edges)
  }
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

function onNodeDragStart(event: NodeDragEvent): void {
  // 拖动期间改由 @node-drag 增量更新；先把起点盒对齐到 Vue Flow 的实际坐标
  draggingNodeId.value = event.node.id
  updateObstacleRects(event.nodes)
}

/** 拖动每帧只替换移动中的节点盒，其余盒对象身份不变。 */
function onNodeDrag(event: NodeDragEvent): void {
  updateObstacleRects(event.nodes)
}

async function onNodeDragStop(event: NodeDragEvent): Promise<void> {
  // 解除增量模式：落点盒立即对齐，随后由 watchEffect 按 store 坐标全量同步一次
  draggingNodeId.value = null
  updateObstacleRects(event.nodes)
  // 拖拽结束才回写 store，拖动过程不产生保存
  const position = {
    x: Math.round(event.node.position.x),
    y: Math.round(event.node.position.y),
  }
  await graph.moveNode(event.node.id, position)
}

function onNodeMouseEnter(event: NodeMouseEvent): void {
  hoveredNodeId.value = event.node.id
}

function onNodeMouseLeave(event: NodeMouseEvent): void {
  if (hoveredNodeId.value === event.node.id) {
    hoveredNodeId.value = null
  }
}

function onNodeClick(event: NodeMouseEvent): void {
  // 大图：点击节点即展开它的全部直接关系（入边 + 出边），同时选中；
  // 与已展开节点无直接关联时说明换到了另一条关系链，旧展开与旧高亮一并收起
  if (bigGraph.value) {
    expansion.expandOnClick(event.node.id, graph.edges)
  }
  graph.selectNode(event.node.id)
}

function onEdgeClick(event: EdgeMouseEvent): void {
  graph.selectEdge(event.edge.id)
}

function onPaneClick(): void {
  graph.selectNode(null)
  graph.selectEdge(null)
  // 点击空白画布即离开当前关系链：收回点击节点时展开的直接关系，
  // 避免取消选中后仍留下上一组关系线
  if (bigGraph.value) {
    expansion.collapseAll()
  }
}

/** 进入/退出聚焦模式：工具栏按钮用，只看选中项与当前聚焦中心。 */
function toggleFocus(): void {
  if (ui.focusNodeId !== null) {
    ui.exitFocus()
    return
  }
  if (graph.selectedNodeId !== null) {
    ui.enterFocus(graph.selectedNodeId)
  }
}

/**
 * F 键专用：悬停的可见节点优先于选中项。已聚焦时悬停到其他节点则切换中心；
 * 悬停同一中心或没有有效悬停时退出，保持原有 F 的切换语义。
 */
function handleFocusShortcut(): void {
  const hovered =
    hoveredNodeId.value !== null && visibleNodeIds.value.has(hoveredNodeId.value)
      ? hoveredNodeId.value
      : null
  if (ui.focusNodeId !== null) {
    if (hovered !== null && hovered !== ui.focusNodeId) {
      void focusNodeInMode(hovered)
      return
    }
    ui.exitFocus()
    return
  }
  const target = hovered ?? graph.selectedNodeId
  if (target !== null) {
    void focusNodeInMode(target)
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
  handleFocusShortcut,
  /** 拖动进行中由父组件屏蔽 Ctrl+Z：落点回写前撤销会被随后的 moveNode 覆盖。 */
  isNodeDragging: () => draggingNodeId.value !== null,
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
      @node-mouse-enter="onNodeMouseEnter"
      @node-mouse-leave="onNodeMouseLeave"
      @edge-click="onEdgeClick"
      @pane-click="onPaneClick"
      @node-drag-start="onNodeDragStart"
      @node-drag="onNodeDrag"
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
          :show-edge-arrows="ui.showEdgeArrows"
          @create-node="openCreateDialog"
          @toggle-search="toggleSearch"
          @toggle-edge-arrows="ui.toggleEdgeArrows()"
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
