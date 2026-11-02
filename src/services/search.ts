import type { LoreNode } from '@/models/node'

/**
 * 名称或描述是否命中查询词（大小写不敏感）。
 * 画布高亮、侧栏节点库与画布查找共用同一条匹配规则，避免「列表没有、画布却高亮」。
 */
export function matchesNodeQuery(
  node: Pick<LoreNode, 'name' | 'description'>,
  query: string,
): boolean {
  const keyword = query.trim().toLowerCase()
  if (keyword === '') {
    return false
  }
  return (
    node.name.toLowerCase().includes(keyword) || node.description.toLowerCase().includes(keyword)
  )
}

/** 按名称或描述做不区分大小写的子串搜索；空查询返回全部。 */
export function searchNodes(nodes: readonly LoreNode[], query: string): LoreNode[] {
  if (query.trim() === '') {
    return [...nodes]
  }
  return nodes.filter((node) => matchesNodeQuery(node, query))
}

export interface VisibleNodesOptions {
  /** 选中的类型 key；为空表示不过滤。 */
  activeTypeKeys?: readonly string[]
  searchQuery?: string
}

/** 组件层使用的节点可见性过滤：先按类型过滤，再按搜索词过滤。 */
export function visibleNodes(
  nodes: readonly LoreNode[],
  options: VisibleNodesOptions = {},
): LoreNode[] {
  const { activeTypeKeys = [], searchQuery = '' } = options
  const typed =
    activeTypeKeys.length === 0
      ? [...nodes]
      : nodes.filter((node) => activeTypeKeys.includes(node.type))
  return searchNodes(typed, searchQuery)
}
