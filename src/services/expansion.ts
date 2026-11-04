import type { LoreEdge } from '@/models/edge'

/**
 * 大图阈值：节点数达到该值时，画布默认收起全部关系线，只保留节点卡片。
 * 节点与关系任一达到阈值即按大图处理（关系密集的小图同样会看不清）。
 */
export const BIG_GRAPH_NODE_THRESHOLD = 100
export const BIG_GRAPH_EDGE_THRESHOLD = 300

/** 是否按「大图」处理：节点数或关系数任一达到阈值。 */
export function isBigGraph(nodeCount: number, edgeCount: number): boolean {
  return nodeCount >= BIG_GRAPH_NODE_THRESHOLD || edgeCount >= BIG_GRAPH_EDGE_THRESHOLD
}

/** 关系两端的最小结构，便于直接用 store 里的边计算可见性。 */
export type ExpansionEdge = Pick<LoreEdge, 'source' | 'target'>

/**
 * 一条关系在当前展开状态下是否可见。
 * 小图始终可见；大图要求至少一个端点已展开（入边与出边都算）。
 */
export function isEdgeVisibleForExpansion(
  edge: ExpansionEdge,
  expandedNodeIds: ReadonlySet<string>,
  bigGraph: boolean,
): boolean {
  if (!bigGraph) {
    return true
  }
  return expandedNodeIds.has(edge.source) || expandedNodeIds.has(edge.target)
}

/**
 * 画布最终可见的关系：两端节点都必须可见（类型筛选/聚焦/折叠），
 * 大图还要满足至少一端已展开。小图保持原有「两端可见即显示」。
 */
export function visibleEdgesForGraph<T extends ExpansionEdge>(
  edges: readonly T[],
  visibleNodeIds: ReadonlySet<string>,
  expandedNodeIds: ReadonlySet<string>,
  bigGraph: boolean,
): T[] {
  return edges.filter(
    (edge) =>
      visibleNodeIds.has(edge.source) &&
      visibleNodeIds.has(edge.target) &&
      isEdgeVisibleForExpansion(edge, expandedNodeIds, bigGraph),
  )
}

/**
 * 每个节点的直接关系数（入边 + 出边），用于节点 chevron 的徽标与「是否可展开」判断。
 * 自环只计一次；悬空端点同样计数，避免脏数据让按钮闪断。
 */
export function relationCountsOf(edges: readonly ExpansionEdge[]): Map<string, number> {
  const counts = new Map<string, number>()
  const bump = (id: string): void => {
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  for (const edge of edges) {
    bump(edge.source)
    if (edge.target !== edge.source) {
      bump(edge.target)
    }
  }
  return counts
}
