import { describe, expect, it } from 'vitest'
import {
  BIG_GRAPH_EDGE_THRESHOLD,
  BIG_GRAPH_NODE_THRESHOLD,
  isBigGraph,
  isEdgeVisibleForExpansion,
  isRelatedToExpanded,
  relationCountsOf,
  visibleEdgesForGraph,
} from '@/services/expansion'

function edge(id: string, source: string, target: string) {
  return { id, source, target }
}

describe('isBigGraph', () => {
  it('阈值是闭区间：恰好 100 节点或 300 关系即按大图处理', () => {
    expect(BIG_GRAPH_NODE_THRESHOLD).toBe(100)
    expect(BIG_GRAPH_EDGE_THRESHOLD).toBe(300)
    expect(isBigGraph(99, 299)).toBe(false)
    expect(isBigGraph(100, 0)).toBe(true)
    expect(isBigGraph(0, 300)).toBe(true)
    expect(isBigGraph(100, 300)).toBe(true)
  })

  it('空图与远超阈值的图都按计数判定，不看其它状态', () => {
    expect(isBigGraph(0, 0)).toBe(false)
    expect(isBigGraph(1, 2)).toBe(false)
    expect(isBigGraph(5000, 0)).toBe(true)
  })
})

describe('isEdgeVisibleForExpansion', () => {
  const expanded = new Set(['a'])

  it('小图始终可见，与展开状态无关', () => {
    expect(isEdgeVisibleForExpansion(edge('e1', 'a', 'b'), new Set(), false)).toBe(true)
    expect(isEdgeVisibleForExpansion(edge('e1', 'x', 'y'), expanded, false)).toBe(true)
  })

  it('大图要求至少一端已展开（入边与出边都算）', () => {
    expect(isEdgeVisibleForExpansion(edge('e1', 'a', 'b'), expanded, true)).toBe(true)
    expect(isEdgeVisibleForExpansion(edge('e1', 'b', 'a'), expanded, true)).toBe(true)
    expect(isEdgeVisibleForExpansion(edge('e1', 'b', 'c'), expanded, true)).toBe(false)
  })

  it('大图里自环由展开的节点自身点亮', () => {
    expect(isEdgeVisibleForExpansion(edge('e1', 'a', 'a'), expanded, true)).toBe(true)
    expect(isEdgeVisibleForExpansion(edge('e1', 'b', 'b'), expanded, true)).toBe(false)
  })
})

describe('visibleEdgesForGraph', () => {
  const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'c', 'd')]
  const allNodes = new Set(['a', 'b', 'c', 'd'])

  it('小图保持原有规则：两端节点可见即显示，顺序不变', () => {
    expect(visibleEdgesForGraph(edges, allNodes, new Set(), false).map((item) => item.id)).toEqual([
      'e1',
      'e2',
      'e3',
    ])
  })

  it('大图只保留至少一端已展开的关系', () => {
    expect(
      visibleEdgesForGraph(edges, allNodes, new Set(['b']), true).map((item) => item.id),
    ).toEqual(['e1', 'e2'])
    expect(visibleEdgesForGraph(edges, allNodes, new Set(), true)).toEqual([])
  })

  it('端点被筛选/聚焦隐藏时，即使另一端已展开也不显示', () => {
    const visibleNodes = new Set(['a', 'b'])
    expect(
      visibleEdgesForGraph(edges, visibleNodes, new Set(['b', 'c']), true).map((item) => item.id),
    ).toEqual(['e1'])
  })

  it('展开集合里的幽灵 id 不会凭空点亮关系', () => {
    expect(visibleEdgesForGraph(edges, allNodes, new Set(['missing']), true)).toEqual([])
  })
})

describe('isRelatedToExpanded', () => {
  it('与任一已展开节点有直接边即算关联，入边出边都认', () => {
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'c', 'a')]
    expect(isRelatedToExpanded('b', ['a'], edges)).toBe(true)
    expect(isRelatedToExpanded('c', ['a'], edges)).toBe(true)
    expect(isRelatedToExpanded('c', ['a', 'b'], edges)).toBe(true)
  })

  it('关联到较早展开、而不是最后展开的节点时同样保留', () => {
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'x', 'y')]
    // a 先展开，y 后展开（最后点击）；x 只与 a 相邻，仍应算关联
    expect(isRelatedToExpanded('x', ['a', 'y'], edges)).toBe(true)
  })

  it('与已展开节点没有直接边时不算关联', () => {
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')]
    expect(isRelatedToExpanded('c', ['a'], edges)).toBe(false)
    expect(isRelatedToExpanded('d', ['a', 'b'], edges)).toBe(false)
  })

  it('自环不能让旧分支保留：只与自身相连不算关联', () => {
    const edges = [edge('e-loop', 'c', 'c'), edge('e1', 'a', 'b')]
    expect(isRelatedToExpanded('c', ['a'], edges)).toBe(false)
  })

  it('自身已展开（重复点击）或集合为空时视为关联，保持幂等', () => {
    expect(isRelatedToExpanded('a', ['a'], [])).toBe(true)
    expect(isRelatedToExpanded('a', [], [])).toBe(true)
    expect(isRelatedToExpanded('a', ['b'], [edge('e1', 'b', 'c')])).toBe(false)
  })
})

describe('relationCountsOf', () => {
  it('入边与出边都计入直接关系数', () => {
    const counts = relationCountsOf([
      edge('e1', 'a', 'b'),
      edge('e2', 'c', 'b'),
      edge('e3', 'b', 'd'),
    ])

    expect(counts.get('a')).toBe(1)
    expect(counts.get('b')).toBe(3)
    expect(counts.get('c')).toBe(1)
    expect(counts.get('d')).toBe(1)
  })

  it('自环只计一次，空输入返回空表', () => {
    expect(relationCountsOf([edge('e1', 'a', 'a')]).get('a')).toBe(1)
    expect(relationCountsOf([]).size).toBe(0)
  })

  it('悬空端点同样计数，避免脏数据让按钮闪断', () => {
    const counts = relationCountsOf([edge('e1', 'a', 'ghost')])
    expect(counts.get('a')).toBe(1)
    expect(counts.get('ghost')).toBe(1)
  })
})
