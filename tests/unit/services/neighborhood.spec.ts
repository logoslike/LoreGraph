import { describe, expect, it } from 'vitest'
import { neighborhoodOf } from '@/services/neighborhood'
import { makeEdge, makeNode } from '../models/fixtures'

/** 三个节点的链：a - b - c，两条边都从前往后。 */
function chain() {
  const nodes = [
    makeNode({ id: 'a', name: '澜舟' }),
    makeNode({ id: 'b', name: '墨鸦' }),
    makeNode({ id: 'c', name: '沉钟湾' }),
  ]
  const edges = [
    makeEdge({ id: 'ab', source: 'a', target: 'b' }),
    makeEdge({ id: 'bc', source: 'b', target: 'c' }),
  ]
  return { nodes, edges }
}

describe('neighborhoodOf 未选中', () => {
  it('没有选中节点或边时返回 null，画布不变淡', () => {
    const { nodes, edges } = chain()
    expect(neighborhoodOf(nodes, edges, { nodeId: null, edgeId: null })).toBeNull()
  })
})

describe('neighborhoodOf 选中节点', () => {
  it('返回节点自身、直接相邻节点（不分方向）与关联边', () => {
    const { nodes, edges } = chain()
    const result = neighborhoodOf(nodes, edges, { nodeId: 'b', edgeId: null })

    expect(result).not.toBeNull()
    expect([...(result?.nodeIds ?? [])].sort()).toEqual(['a', 'b', 'c'])
    expect([...(result?.edgeIds ?? [])].sort()).toEqual(['ab', 'bc'])
  })

  it('只保留 1 跳：两端之外的元素不在集合里', () => {
    const nodes = ['a', 'b', 'c', 'd'].map((id) => makeNode({ id }))
    const edges = [
      makeEdge({ id: 'ab', source: 'a', target: 'b' }),
      makeEdge({ id: 'bc', source: 'b', target: 'c' }),
      makeEdge({ id: 'cd', source: 'c', target: 'd' }),
    ]

    const result = neighborhoodOf(nodes, edges, { nodeId: 'b', edgeId: null })

    expect([...(result?.nodeIds ?? [])].sort()).toEqual(['a', 'b', 'c'])
    expect([...(result?.edgeIds ?? [])].sort()).toEqual(['ab', 'bc'])
  })

  it('反向边同样算作相邻：指向该节点的边也在邻域内', () => {
    const { nodes, edges } = chain()
    const reversed = [makeEdge({ id: 'ba', source: 'b', target: 'a' })]
    const result = neighborhoodOf(nodes, reversed, { nodeId: 'a', edgeId: null })

    expect([...(result?.nodeIds ?? [])].sort()).toEqual(['a', 'b'])
    expect([...(result?.edgeIds ?? [])]).toEqual(['ba'])
    // 原边方向不影响结果：a 是 b 的邻居
    expect(neighborhoodOf(nodes, edges, { nodeId: 'a', edgeId: null })?.nodeIds.has('b')).toBe(true)
  })

  it('孤立节点只有它自己，没有关联边', () => {
    const nodes = [makeNode({ id: 'lone' })]
    const result = neighborhoodOf(nodes, [], { nodeId: 'lone', edgeId: null })

    expect([...(result?.nodeIds ?? [])]).toEqual(['lone'])
    expect(result?.edgeIds.size).toBe(0)
  })

  it('忽略端点缺失的悬空边，不会把不存在的节点算进邻域', () => {
    const nodes = [makeNode({ id: 'a' }), makeNode({ id: 'b' })]
    const edges = [
      makeEdge({ id: 'ab', source: 'a', target: 'b' }),
      makeEdge({ id: 'bc', source: 'b', target: 'missing' }),
    ]

    const result = neighborhoodOf(nodes, edges, { nodeId: 'b', edgeId: null })

    expect([...(result?.nodeIds ?? [])].sort()).toEqual(['a', 'b'])
    expect([...(result?.edgeIds ?? [])]).toEqual(['ab'])
  })

  it('选中的节点不在传入集合里时返回 null（例如被类型筛掉）', () => {
    const { nodes, edges } = chain()
    expect(neighborhoodOf(nodes, edges, { nodeId: 'missing', edgeId: null })).toBeNull()
  })
})

describe('neighborhoodOf 选中边', () => {
  it('返回选中边与它的两个端点', () => {
    const { nodes, edges } = chain()
    const result = neighborhoodOf(nodes, edges, { nodeId: null, edgeId: 'ab' })

    expect([...(result?.nodeIds ?? [])].sort()).toEqual(['a', 'b'])
    expect([...(result?.edgeIds ?? [])]).toEqual(['ab'])
  })

  it('选中的边不存在时返回 null', () => {
    const { nodes, edges } = chain()
    expect(neighborhoodOf(nodes, edges, { nodeId: null, edgeId: 'missing' })).toBeNull()
  })
})
