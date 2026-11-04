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
 * 点击节点时判断它是否与当前已展开的节点有关联。
 *
 * 关联的定义：存在一条直接关系（入边或出边都算），另一端是「另一个」已展开节点。
 * - 自身已在集合里（重复点击）或集合为空时视为关联：调用方因此只做幂等展开，不收起旧分支；
 * - 自环只把节点与它自己连起来，不能证明与其它已展开节点有关，所以不算关联；
 * - 这样点开一条关系链后继续点链上的邻居会保留已有展开，点到无关分支才整组收起。
 */
export function isRelatedToExpanded(
  nodeId: string,
  expandedNodeIds: Iterable<string>,
  edges: readonly ExpansionEdge[],
): boolean {
  const expanded = new Set(expandedNodeIds)
  if (expanded.size === 0 || expanded.has(nodeId)) {
    return true
  }
  return edges.some((edge) => {
    if (edge.source === nodeId) {
      return edge.target !== nodeId && expanded.has(edge.target)
    }
    if (edge.target === nodeId) {
      return expanded.has(edge.source)
    }
    return false
  })
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
