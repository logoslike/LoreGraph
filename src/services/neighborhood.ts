import type { LoreEdge } from '@/models/edge'
import type { LoreNode } from '@/models/node'

/** 选中项对应的 1 跳邻域：相邻高亮与聚焦模式共用。 */
export interface Neighborhood {
  /** 需要保持原样的节点 id。 */
  nodeIds: Set<string>
  /** 需要保持原样的边 id。 */
  edgeIds: Set<string>
}

/** 当前选中：节点与边互斥，null 表示未选中。 */
export interface GraphSelection {
  nodeId: string | null
  edgeId: string | null
}

/**
 * 计算相邻高亮要保留的元素（纯函数，不读 store）：
 * 选中节点时是该节点、直接相邻节点（不分方向）与关联边；选中边时是它的两个端点与这条边。
 * 未选中返回 null，画布不变淡。
 * 端点缺失的悬空边会被忽略；选中的节点或边不在传入集合里时同样返回 null
 * （画布只传可见节点与可见边，因此选中项被筛掉时不会把整张图变淡）。
 */
export function neighborhoodOf(
  nodes: readonly LoreNode[],
  edges: readonly LoreEdge[],
  selection: GraphSelection,
): Neighborhood | null {
  const knownNodeIds = new Set(nodes.map((node) => node.id))

  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()

  if (selection.nodeId !== null) {
    if (!knownNodeIds.has(selection.nodeId)) {
      return null
    }
    nodeIds.add(selection.nodeId)
    for (const edge of edges) {
      if (edge.source !== selection.nodeId && edge.target !== selection.nodeId) {
        continue
      }
      const otherId = edge.source === selection.nodeId ? edge.target : edge.source
      if (!knownNodeIds.has(otherId)) {
        continue
      }
      nodeIds.add(otherId)
      edgeIds.add(edge.id)
    }
    return { nodeIds, edgeIds }
  }

  if (selection.edgeId !== null) {
    const edge = edges.find((item) => item.id === selection.edgeId)
    if (!edge) {
      return null
    }
    edgeIds.add(edge.id)
    for (const endpointId of [edge.source, edge.target]) {
      if (knownNodeIds.has(endpointId)) {
        nodeIds.add(endpointId)
      }
    }
    return { nodeIds, edgeIds }
  }

  return null
}
