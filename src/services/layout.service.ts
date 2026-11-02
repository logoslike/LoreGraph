import type { ELK, ElkNode } from 'elkjs'
import type { NodePosition } from '@/models/node'

/** 自动布局算法：力导向（默认）、分层（从上到下）与按节点类型聚集。 */
export type LayoutMode = 'force' | 'layered' | 'clustered'

/** 单张图（整图或某一簇内部）的布局模式。 */
type GraphLayoutMode = Exclude<LayoutMode, 'clustered'>

/** LoreNode 组件的固定宽度与最小高度（见 LoreNode.vue 样式），未提供尺寸时按此估算占位。 */
export const DEFAULT_NODE_WIDTH = 210
export const DEFAULT_NODE_HEIGHT = 52

/**
 * 簇之间的间距：水平大于一个节点宽度、垂直大于一个节点高度，
 * 保证跨类型关系在两簇之间仍有一段可见的连线，不会缩成一点。
 */
const CLUSTER_GAP_X = 240
const CLUSTER_GAP_Y = 200
/** 聚集布局整体的左上留白，与单张图的 padding 一致。 */
const CLUSTER_PADDING = 40

export interface LayoutNodeInput {
  id: string
  width?: number
  height?: number
  /** 聚集布局的分组键（store 传节点 type）；其它模式忽略。缺省归入同一簇。 */
  group?: string
}

export interface LayoutEdgeInput {
  source: string
  target: string
}

/** 节点 id 到取整后左上角坐标的映射。 */
export type LayoutPositions = Record<string, NodePosition>

/**
 * 两种整图模式的 ELK 选项：间距按 210×52 的节点尺寸取值，保证包围盒不重叠。
 * 分层用 thoroughness=5、力导向用 120 次迭代，在 100 节点图上都远低于 1 秒。
 * 聚集模式的簇内布局复用这里的 force 选项。
 */
function layoutOptions(mode: GraphLayoutMode): Record<string, string> {
  const padding = '[top=40,left=40,bottom=40,right=40]'
  if (mode === 'layered') {
    return {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.spacing.nodeNode': '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.layered.spacing.edgeNodeBetweenLayers': '30',
      'elk.spacing.componentComponent': '80',
      // 与 force 一样固定随机种子，保证同一份输入得到同一份层级布局
      'elk.randomSeed': '1',
      // 只对 layered 增加交叉最小化迭代：固定 40 节点/60 边样本上
      // 节点中心线代理交叉从 55 降到 40，100 节点/300 边布局耗时基本不变。
      'elk.layered.thoroughness': '5',
      'elk.padding': padding,
    }
  }
  return {
    'elk.algorithm': 'force',
    'elk.spacing.nodeNode': '80',
    'elk.spacing.edgeNode': '40',
    'elk.spacing.componentComponent': '80',
    'elk.force.iterations': '120',
    'elk.force.repulsion': '10',
    // 固定随机种子，同一张图总是得到同一份布局
    'elk.randomSeed': '1',
    'elk.padding': padding,
  }
}

let elkPromise: Promise<ELK> | null = null

/** 动态加载 elkjs 打包版（UMD，默认导出构造函数），只在首次布局时加载。 */
function loadElk(): Promise<ELK> {
  elkPromise ??= import('elkjs/lib/elk.bundled.js').then((module) => new module.default())
  return elkPromise
}

/** 对一张图执行 ELK 布局，只返回整数坐标；空图返回空映射。 */
async function layoutGraph(
  nodes: readonly LayoutNodeInput[],
  edges: readonly LayoutEdgeInput[],
  mode: GraphLayoutMode,
): Promise<LayoutPositions> {
  if (nodes.length === 0) {
    return {}
  }
  const ids = new Set(nodes.map((node) => node.id))
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: layoutOptions(mode),
    children: nodes.map((node) => ({
      id: node.id,
      width: node.width ?? DEFAULT_NODE_WIDTH,
      height: node.height ?? DEFAULT_NODE_HEIGHT,
    })),
    // 只提交两端都存在且非自连的边，脏数据不会让 ELK 失败
    edges: edges
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target) && edge.source !== edge.target)
      .map((edge, index) => ({
        id: `edge-${index}`,
        sources: [edge.source],
        targets: [edge.target],
      })),
  }
  const result = await (await loadElk()).layout(graph)
  const positions: LayoutPositions = {}
  for (const child of result.children ?? []) {
    positions[child.id] = { x: Math.round(child.x ?? 0), y: Math.round(child.y ?? 0) }
  }
  return positions
}

/** 一簇的簇内相对坐标与真实包围盒。 */
interface ClusterBox {
  positions: LayoutPositions
  minX: number
  minY: number
  width: number
  height: number
}

/**
 * 用簇内节点的实际尺寸算包围盒，而不是按固定格子估算：
 * 大簇（节点多、尺寸不一）才不会侵入相邻簇。
 */
function clusterBoxOf(nodes: readonly LayoutNodeInput[], positions: LayoutPositions): ClusterBox {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const node of nodes) {
    const position = positions[node.id]
    if (!position) {
      continue
    }
    const width = node.width ?? DEFAULT_NODE_WIDTH
    const height = node.height ?? DEFAULT_NODE_HEIGHT
    minX = Math.min(minX, position.x)
    minY = Math.min(minY, position.y)
    maxX = Math.max(maxX, position.x + width)
    maxY = Math.max(maxY, position.y + height)
  }
  if (!Number.isFinite(minX)) {
    return { positions, minX: 0, minY: 0, width: 0, height: 0 }
  }
  return { positions, minX, minY, width: maxX - minX, height: maxY - minY }
}

/**
 * 按真实包围盒逐行排簇：同一行按簇宽累加，行高取本行最高的簇。
 * 不使用等宽等高格，因此大簇不会与相邻簇重叠。
 */
function packClusters(boxes: readonly ClusterBox[]): LayoutPositions {
  const columns = Math.ceil(Math.sqrt(boxes.length))
  const positions: LayoutPositions = {}
  let cursorX = CLUSTER_PADDING
  let cursorY = CLUSTER_PADDING
  let rowHeight = 0
  boxes.forEach((box, index) => {
    if (index > 0 && index % columns === 0) {
      cursorY += rowHeight + CLUSTER_GAP_Y
      cursorX = CLUSTER_PADDING
      rowHeight = 0
    }
    for (const [id, position] of Object.entries(box.positions)) {
      positions[id] = {
        x: Math.round(position.x - box.minX + cursorX),
        y: Math.round(position.y - box.minY + cursorY),
      }
    }
    cursorX += box.width + CLUSTER_GAP_X
    rowHeight = Math.max(rowHeight, box.height)
  })
  return positions
}

/**
 * 按节点类型分成若干簇：每簇只用簇内边做一次 force 布局，再按真实包围盒排簇。
 * 跨类型边不参与簇内布局——它只影响坐标，边本身仍由画布完整渲染。
 */
async function computeClustered(
  nodes: readonly LayoutNodeInput[],
  edges: readonly LayoutEdgeInput[],
): Promise<LayoutPositions> {
  const groups = new Map<string, LayoutNodeInput[]>()
  for (const node of nodes) {
    const key = node.group ?? ''
    const bucket = groups.get(key)
    if (bucket) {
      bucket.push(node)
    } else {
      groups.set(key, [node])
    }
  }
  // 单簇（含全部节点都没有类型）退化为整图力导向，行为与 force 完全一致
  if (groups.size <= 1) {
    return layoutGraph(nodes, edges, 'force')
  }
  const boxes: ClusterBox[] = []
  // 簇 key 排序保证同一份数据每次得到相同的簇顺序
  const ordered = [...groups.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )
  for (const [, groupNodes] of ordered) {
    const ids = new Set(groupNodes.map((node) => node.id))
    const innerEdges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target))
    const local = await layoutGraph(groupNodes, innerEdges, 'force')
    boxes.push(clusterBoxOf(groupNodes, local))
  }
  return packClusters(boxes)
}

/** 计算布局，只返回坐标；空图返回空映射。 */
export async function computeLayout(
  nodes: readonly LayoutNodeInput[],
  edges: readonly LayoutEdgeInput[],
  mode: LayoutMode = 'force',
): Promise<LayoutPositions> {
  if (nodes.length === 0) {
    return {}
  }
  if (mode === 'clustered') {
    return await computeClustered(nodes, edges)
  }
  return await layoutGraph(nodes, edges, mode)
}
