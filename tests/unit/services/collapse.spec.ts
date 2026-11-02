import { describe, expect, it } from 'vitest'
import type { CollapseEdge } from '@/services/collapse'
import {
  collapsedAncestorsOf,
  computeCollapseVisibility,
  revealedCollapsedIds,
} from '@/services/collapse'

/** 只保留折叠算法关心的两端 id，测试里不必造完整 LoreEdge。 */
function edge(source: string, target: string): CollapseEdge {
  return { source, target }
}

function names(ids: Iterable<string>): string[] {
  return [...ids].sort()
}

describe('computeCollapseVisibility', () => {
  it('没有折叠节点时不隐藏任何节点', () => {
    const result = computeCollapseVisibility([], [edge('a', 'b'), edge('b', 'c')])
    expect(result.hiddenNodeIds.size).toBe(0)
    expect(result.hiddenCounts.size).toBe(0)
  })

  it('折叠一个节点隐藏它的全部后代，折叠根自身保持可见', () => {
    const result = computeCollapseVisibility(['a'], [edge('a', 'b'), edge('b', 'c')])

    expect(names(result.hiddenNodeIds)).toEqual(['b', 'c'])
    expect(result.hiddenNodeIds.has('a')).toBe(false)
    expect(result.hiddenCounts.get('a')).toBe(2)
  })

  it('分支与菱形结构按唯一节点计数，不重复计算同一后代', () => {
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')]
    const result = computeCollapseVisibility(['a'], edges)

    expect(names(result.hiddenNodeIds)).toEqual(['b', 'c', 'd'])
    expect(result.hiddenCounts.get('a')).toBe(3)
  })

  it('多个外层折叠节点互不影响，各自统计自己的后代', () => {
    const edges = [edge('a', 'b'), edge('c', 'd')]
    const result = computeCollapseVisibility(['a', 'c'], edges)

    expect(names(result.hiddenNodeIds)).toEqual(['b', 'd'])
    expect(result.hiddenCounts.get('a')).toBe(1)
    expect(result.hiddenCounts.get('c')).toBe(1)
  })

  it('嵌套折叠：祖先折叠时后代折叠节点也隐藏，但折叠状态保留供展开后继续生效', () => {
    const edges = [edge('a', 'b'), edge('b', 'c')]
    const result = computeCollapseVisibility(['a', 'b'], edges)

    expect(names(result.hiddenNodeIds)).toEqual(['b', 'c'])
    // b 本身也是折叠根，但被 a 藏住；它的后代数量仍单独统计
    expect(result.hiddenCounts.get('a')).toBe(2)
    expect(result.hiddenCounts.get('b')).toBe(1)

    // 展开 a 后 b 成为最外层折叠根：b 可见，c 仍隐藏
    const afterExpand = computeCollapseVisibility(['b'], edges)
    expect(names(afterExpand.hiddenNodeIds)).toEqual(['c'])
  })

  it('重复的折叠 id 不会重复统计', () => {
    const result = computeCollapseVisibility(['a', 'a', 'a'], [edge('a', 'b')])
    expect(names(result.hiddenNodeIds)).toEqual(['b'])
    expect(result.hiddenCounts.get('a')).toBe(1)
  })

  it('环与双向边不会死循环，也不会把折叠根自己藏起来', () => {
    const result = computeCollapseVisibility(['a'], [edge('a', 'b'), edge('b', 'a')])

    expect(names(result.hiddenNodeIds)).toEqual(['b'])
    expect(result.hiddenCounts.get('a')).toBe(1)
  })

  it('所有折叠节点都在同一个环里时退回可见的折叠根，避免画布被清空', () => {
    const result = computeCollapseVisibility(['a', 'b'], [edge('a', 'b'), edge('b', 'a')])

    expect(result.hiddenNodeIds.size).toBe(0)
    // 环内节点最终仍然可见，不能计入「已收起」数量
    expect(result.hiddenCounts.get('a')).toBe(0)
    expect(result.hiddenCounts.get('b')).toBe(0)
  })

  it('计数只包含最终被隐藏的节点：可见的孤立折叠根不计入', () => {
    // a、b 互为嵌套折叠根而被隐藏；c 是独立折叠根、自身可见，数量徽标应为 0。
    const result = computeCollapseVisibility(['a', 'b', 'c'], [edge('a', 'b'), edge('b', 'a')])

    expect(names(result.hiddenNodeIds)).toEqual(['a', 'b'])
    expect(result.hiddenCounts.get('a')).toBe(1)
    expect(result.hiddenCounts.get('b')).toBe(1)
    expect(result.hiddenCounts.get('c')).toBe(0)
  })

  it('忽略当前图中不存在的折叠 id 与缺失端点的脏边', () => {
    const dirty = [{ source: 'a' }, { target: 'b' }] as unknown as CollapseEdge[]
    const result = computeCollapseVisibility(['missing'], dirty)

    expect(result.hiddenNodeIds.size).toBe(0)
    expect(result.hiddenCounts.get('missing')).toBe(0)
  })

  it('出边为空的折叠节点隐藏数量为 0', () => {
    const result = computeCollapseVisibility(['leaf'], [edge('a', 'leaf')])
    expect(result.hiddenCounts.get('leaf')).toBe(0)
  })
})

describe('collapsedAncestorsOf 与 revealedCollapsedIds', () => {
  const chain = [edge('a', 'b'), edge('b', 'c'), edge('x', 'y')]

  it('反向沿入边收集全部祖先，不含目标自身', () => {
    expect(names(collapsedAncestorsOf('c', chain))).toEqual(['a', 'b'])
    expect(names(collapsedAncestorsOf('a', chain))).toEqual([])
  })

  it('定位深层节点时只展开藏起它的祖先，无关折叠分支保持原样', () => {
    expect(names(revealedCollapsedIds(['a', 'b', 'x'], 'c', chain))).toEqual(['x'])
  })

  it('直接父节点被折叠时同样会被展开', () => {
    expect(names(revealedCollapsedIds(['b'], 'c', chain))).toEqual([])
  })

  it('目标自身折叠时保持折叠（折叠根仍然可见）', () => {
    expect(names(revealedCollapsedIds(['b'], 'b', chain))).toEqual(['b'])
  })

  it('环里的目标不会把自己当作祖先删掉', () => {
    const result = revealedCollapsedIds(['a', 'b'], 'a', [edge('a', 'b'), edge('b', 'a')])
    expect(names(result)).toEqual(['a'])
  })
})
