import type { ELK, ElkNode } from 'elkjs'
import type { NodePosition } from '@/models/node'

/** 自动布局算法：力导向（默认）与分层（从上到下）。 */
export type LayoutMode = 'force' | 'layered'

/** LoreNode 组件的固定宽度与最小高度（见 LoreNode.vue 样式），未提供尺寸时按此估算占位。 */
export const DEFAULT_NODE_WIDTH = 210
export const DEFAULT_NODE_HEIGHT = 52

export interface LayoutNodeInput {
  id: string
  width?: number
  height?: number
}

export interface LayoutEdgeInput {
  source: string
  target: string
}

/** 节点 id 到取整后左上角坐标的映射。 */
export type LayoutPositions = Record<string, NodePosition>

/**
 * 两种模式的 ELK 选项：间距按 210×52 的节点尺寸取值，保证包围盒不重叠。
 * 分层用 thoroughness=3、力导向用 120 次迭代，在 100 节点图上都远低于 1 秒。
 */
function layoutOptions(mode: LayoutMode): Record<string, string> {
  const padding = '[top=40,left=40,bottom=40,right=40]'
  if (mode === 'layered') {
    return {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.spacing.nodeNode': '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.layered.spacing.edgeNodeBetweenLayers': '30',
      'elk.spacing.componentComponent': '80',
      'elk.layered.thoroughness': '3',
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

/** 计算布局，只返回坐标；空图返回空映射。 */
export async function computeLayout(
  nodes: readonly LayoutNodeInput[],
  edges: readonly LayoutEdgeInput[],
  mode: LayoutMode = 'force',
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
