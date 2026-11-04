import { describe, expect, it } from 'vitest'
import type { GraphNode } from '@vue-flow/core'
import { DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH } from '@/services/layout.service'
import type { Bounds, Rect } from '@/components/graph/edge-lanes'
import {
  nodeRectOf,
  pickObstacles,
  reuseObstacles,
  sameRect,
  type NodeRects,
} from '@/components/graph/edge-obstacles'

function fakeNode(
  id: string,
  position: { x: number; y: number },
  size: { width: number; height: number },
): GraphNode {
  return {
    id,
    computedPosition: position,
    dimensions: size,
  } as unknown as GraphNode
}

const BOUNDS: Bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 }

describe('nodeRectOf', () => {
  it('用画布坐标与已量尺寸生成节点盒', () => {
    const rect = nodeRectOf(fakeNode('a', { x: 32, y: 64 }, { width: 210, height: 52 }))

    expect(rect).toEqual({ x: 32, y: 64, width: 210, height: 52 })
  })

  it('尺寸未量到时退回默认卡片尺寸', () => {
    const rect = nodeRectOf(fakeNode('a', { x: 0, y: 0 }, { width: 0, height: 0 }))

    expect(rect.width).toBe(DEFAULT_NODE_WIDTH)
    expect(rect.height).toBe(DEFAULT_NODE_HEIGHT)
  })
})

describe('sameRect', () => {
  it('坐标与尺寸全等才算同一个盒', () => {
    const rect = { x: 10, y: 20, width: 210, height: 52 }

    expect(sameRect(rect, { ...rect })).toBe(true)
    expect(sameRect(rect, { ...rect, x: 11 })).toBe(false)
    expect(sameRect(rect, { ...rect, width: 211 })).toBe(false)
  })
})

describe('pickObstacles', () => {
  const near: Rect = { x: 10, y: 10, width: 20, height: 20 }
  const far: Rect = { x: 500, y: 500, width: 20, height: 20 }
  const sourceRect: Rect = { x: 50, y: 50, width: 20, height: 20 }
  const targetRect: Rect = { x: 60, y: 60, width: 20, height: 20 }
  const rects: NodeRects = new Map([
    ['source', sourceRect],
    ['target', targetRect],
    ['near', near],
    ['far', far],
  ])

  it('排除两端节点，只保留可能命中候选曲线的盒', () => {
    const picked = pickObstacles(rects, 'source', 'target', BOUNDS)

    expect(picked).toHaveLength(1)
    expect(picked[0]).toBe(near)
  })

  it('保留共享快照里的矩形对象身份，供下游做逐项比较', () => {
    const picked = pickObstacles(rects, 'source', 'target', BOUNDS)

    expect(picked[0]).toBe(rects.get('near'))
  })
})

describe('reuseObstacles', () => {
  const first: Rect = { x: 0, y: 0, width: 10, height: 10 }
  const second: Rect = { x: 20, y: 0, width: 10, height: 10 }

  it('矩形逐项身份一致时返回上一份数组，截断下游重算', () => {
    const previous = [first, second]
    const next = [first, second]

    expect(reuseObstacles(previous, next)).toBe(previous)
  })

  it('移动中的节点盒换了对象就返回新数组', () => {
    const previous = [first]
    const moved: Rect = { ...first, x: 16 }

    const reused = reuseObstacles(previous, [moved])

    expect(reused).not.toBe(previous)
    expect(reused[0]).toBe(moved)
  })

  it('列表长度变化时返回新数组', () => {
    const previous = [first]

    expect(reuseObstacles(previous, [])).not.toBe(previous)
    expect(reuseObstacles(previous, [first, second])).not.toBe(previous)
  })
})
