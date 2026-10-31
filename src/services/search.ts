import type { LoreNode } from '@/models/node'

/** 按名称做不区分大小写的子串搜索；空查询返回全部。 */
export function searchNodes(nodes: readonly LoreNode[], query: string): LoreNode[] {
  const keyword = query.trim().toLowerCase()
  if (keyword === '') {
    return [...nodes]
  }
  return nodes.filter((node) => node.name.toLowerCase().includes(keyword))
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
