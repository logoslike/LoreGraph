import type { LoreEdge } from '@/models/edge'

/** 计算折叠可见性只需要边的两端 id：允许传完整 LoreEdge，也允许传最小结构。 */
export type CollapseEdge = Pick<LoreEdge, 'source' | 'target'>

/** 折叠后的画布可见性。 */
export interface CollapseVisibility {
  /** 因祖先被折叠而应从画布上隐藏的节点（不含作为折叠根的节点）。 */
  hiddenNodeIds: Set<string>
  /** 每个折叠节点自身被隐藏的后代数量，用于节点上的数量徽标。 */
  hiddenCounts: Map<string, number>
}

/** 把边按起点分组，忽略运行时缺失端点的脏数据。 */
function groupTargets(edges: readonly CollapseEdge[]): Map<string, string[]> {
  const targets = new Map<string, string[]>()
  for (const edge of edges) {
    if (typeof edge.source !== 'string' || typeof edge.target !== 'string') {
      continue
    }
    const siblings = targets.get(edge.source)
    if (siblings) {
      siblings.push(edge.target)
    } else {
      targets.set(edge.source, [edge.target])
    }
  }
  return targets
}

/** 从起点沿出边收集全部可达节点（包含起点）。 */
function reachableFrom(start: string, targets: Map<string, string[]>): Set<string> {
  const seen = new Set<string>([start])
  const queue: string[] = [start]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const target of targets.get(current) ?? []) {
      if (seen.has(target)) {
        continue
      }
      seen.add(target)
      queue.push(target)
    }
  }
  return seen
}

/**
 * 计算「节点折叠」后的画布可见性。
 *
 * 语义：
 * - 折叠一个节点会隐藏它沿出边可达的全部后代（传递式），折叠根自身保持可见；
 * - 后代中同样处于折叠态的节点仍然隐藏，其折叠状态保留，展开祖先后再作为折叠根生效；
 * - 环、双向往返与自连不会导致死循环，折叠根不会被自己的后代隐藏；
 * - 折叠状态里不存在于当前图中的 id 直接忽略。
 *
 * 返回的 hiddenCounts 按折叠节点统计其可达后代数量（含嵌套折叠节点的后代），
 * 后续由画布节点展示为「收起 N 个」。
 */
export function computeCollapseVisibility(
  collapsedIds: Iterable<string>,
  edges: readonly CollapseEdge[],
): CollapseVisibility {
  const collapsed = new Set<string>()
  for (const id of collapsedIds) {
    if (typeof id === 'string' && id !== '') {
      collapsed.add(id)
    }
  }

  const hiddenNodeIds = new Set<string>()
  const hiddenCounts = new Map<string, number>()
  if (collapsed.size === 0) {
    return { hiddenNodeIds, hiddenCounts }
  }

  const targets = groupTargets(edges)

  // 先做一次多源遍历：同时找出全部后代，以及「祖先也被折叠」的嵌套折叠节点。
  const descendants = new Set<string>()
  const nested = new Set<string>()
  const visited = new Set<string>(collapsed)
  const queue = [...collapsed]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const target of targets.get(current) ?? []) {
      descendants.add(target)
      if (collapsed.has(target)) {
        nested.add(target)
      }
      if (!visited.has(target)) {
        visited.add(target)
        queue.push(target)
      }
    }
  }

  // 只让「最外层」的折叠节点决定可见性。
  let roots = [...collapsed].filter((id) => !nested.has(id))
  // 全是互相可达的折叠节点（环）时退回全部折叠根，避免整个画布被隐藏。
  if (roots.length === 0) {
    roots = [...collapsed]
  }
  for (const id of descendants) {
    hiddenNodeIds.add(id)
  }
  // 折叠根自身始终可见；嵌套折叠根已被祖先隐藏，仍保留在 hidden 中。
  for (const root of roots) {
    hiddenNodeIds.delete(root)
  }

  // 数量徽标：只统计该折叠节点可达、且最终确实被隐藏的其他节点。
  // 环回退或互相折叠时，可达节点可能仍然可见，不能把它们算进「已收起 N 个」。
  for (const id of collapsed) {
    let count = 0
    for (const reached of reachableFrom(id, targets)) {
      if (reached !== id && hiddenNodeIds.has(reached)) {
        count += 1
      }
    }
    hiddenCounts.set(id, count)
  }

  return { hiddenNodeIds, hiddenCounts }
}

/**
 * 找出目标节点的全部祖先（沿入边反向可达，不含目标自身）。
 * 用于定位节点前展开那些把它藏起来的折叠节点。
 */
export function collapsedAncestorsOf(nodeId: string, edges: readonly CollapseEdge[]): Set<string> {
  const ancestors = new Set<string>()
  if (nodeId === '') {
    return ancestors
  }

  const parents = new Map<string, string[]>()
  for (const edge of edges) {
    if (typeof edge.source !== 'string' || typeof edge.target !== 'string') {
      continue
    }
    const siblings = parents.get(edge.target)
    if (siblings) {
      siblings.push(edge.source)
    } else {
      parents.set(edge.target, [edge.source])
    }
  }

  const visited = new Set<string>([nodeId])
  const queue: string[] = [nodeId]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const parent of parents.get(current) ?? []) {
      // 环里目标可能成为自己的祖先，不能把目标自身从折叠记录中删掉
      if (parent === nodeId) {
        continue
      }
      ancestors.add(parent)
      if (!visited.has(parent)) {
        visited.add(parent)
        queue.push(parent)
      }
    }
  }
  return ancestors
}

/**
 * 定位节点前要保留的折叠集合：移除所有「藏起目标」的祖先，
 * 与目标无关的折叠分支保持原样。目标自身折叠时保持折叠（折叠根仍然可见）。
 */
export function revealedCollapsedIds(
  collapsedIds: Iterable<string>,
  nodeId: string,
  edges: readonly CollapseEdge[],
): Set<string> {
  const collapsed = new Set<string>()
  for (const id of collapsedIds) {
    if (typeof id === 'string' && id !== '') {
      collapsed.add(id)
    }
  }
  if (collapsed.size === 0) {
    return collapsed
  }
  for (const ancestor of collapsedAncestorsOf(nodeId, edges)) {
    collapsed.delete(ancestor)
  }
  return collapsed
}
