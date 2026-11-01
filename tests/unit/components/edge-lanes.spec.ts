import { describe, expect, it } from 'vitest'
import { Position } from '@vue-flow/core'
import {
  EDGE_LANE_GAP,
  assignEdgeLanes,
  computeLanedEdgeGeometry,
  orderEdgesForVisualPriority,
  type Point,
  type Rect,
} from '@/components/graph/edge-lanes'

/** 与 LoreNode.vue 的固定尺寸一致，保证 fixture 的几何可复现。 */
const NODE_WIDTH = 210
const NODE_HEIGHT = 52

function nodeAt(x: number, y: number): Rect {
  return { x, y, width: NODE_WIDTH, height: NODE_HEIGHT }
}

/** 从源节点右侧连接点到目标节点左侧连接点，和画布上的实际连接方式一致。 */
function edgeBetween(source: Rect, target: Rect, lane: number) {
  return computeLanedEdgeGeometry({
    lane,
    sourceX: source.x + source.width,
    sourceY: source.y + source.height / 2,
    targetX: target.x,
    targetY: target.y + target.height / 2,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    sourceRect: source,
    targetRect: target,
  })
}

/** 分道后的折线都是轴对齐的：按水平/垂直线段判断是否穿过节点盒内部（贴边不算）。 */
function intersectsInterior(from: Point, to: Point, rect: Rect): boolean {
  if (Math.abs(from.y - to.y) < 0.01) {
    if (from.y <= rect.y || from.y >= rect.y + rect.height) {
      return false
    }
    const minX = Math.min(from.x, to.x)
    const maxX = Math.max(from.x, to.x)
    return maxX > rect.x && minX < rect.x + rect.width
  }
  if (Math.abs(from.x - to.x) < 0.01) {
    if (from.x <= rect.x || from.x >= rect.x + rect.width) {
      return false
    }
    const minY = Math.min(from.y, to.y)
    const maxY = Math.max(from.y, to.y)
    return maxY > rect.y && minY < rect.y + rect.height
  }
  throw new Error('测试只覆盖分道生成的轴对齐折线')
}

function expectPathOutsideNodes(points: readonly Point[], source: Rect, target: Rect): void {
  expect(points.length).toBeGreaterThan(1)
  for (let index = 1; index < points.length; index += 1) {
    expect(
      intersectsInterior(points[index - 1], points[index], source),
      `第 ${index} 段穿过了源节点`,
    ).toBe(false)
    expect(
      intersectsInterior(points[index - 1], points[index], target),
      `第 ${index} 段穿过了目标节点`,
    ).toBe(false)
  }
}

describe('assignEdgeLanes', () => {
  it('一对节点只有一条关系时不分道', () => {
    const lanes = assignEdgeLanes([{ id: 'e1', source: 'a', target: 'b' }])

    expect(lanes.get('e1')).toBe(0)
  })

  it('双向关系按 id 稳定分到上下两侧，与输入顺序无关', () => {
    const forward = assignEdgeLanes([
      { id: 'e-a-to-b', source: 'a', target: 'b' },
      { id: 'e-b-to-a', source: 'b', target: 'a' },
    ])
    const reversed = assignEdgeLanes([
      { id: 'e-b-to-a', source: 'b', target: 'a' },
      { id: 'e-a-to-b', source: 'a', target: 'b' },
    ])

    expect(forward.get('e-a-to-b')).toBe(1)
    expect(forward.get('e-b-to-a')).toBe(-1)
    expect(reversed).toEqual(forward)
  })

  it('四条平行关系分到不同的对称车道', () => {
    const lanes = assignEdgeLanes(
      ['e1', 'e2', 'e3', 'e4'].map((id) => ({ id, source: 'a', target: 'b' })),
    )

    expect(['e1', 'e2', 'e3', 'e4'].map((id) => lanes.get(id))).toEqual([1, -1, 2, -2])
  })

  it('不同节点对的车道互不影响', () => {
    const lanes = assignEdgeLanes([
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'a' },
      { id: 'e3', source: 'c', target: 'b' },
    ])

    expect(lanes.get('e1')).toBe(1)
    expect(lanes.get('e2')).toBe(-1)
    expect(lanes.get('e3')).toBe(0)
  })
})

describe('orderEdgesForVisualPriority', () => {
  const edges = [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }]

  it('选中关系排到最后，其余关系保持原有顺序', () => {
    const ordered = orderEdgesForVisualPriority(edges, 'e2')

    expect(ordered.map((edge) => edge.id)).toEqual(['e1', 'e3', 'e2'])
  })

  it('没有选中或选中 id 不在列表中时保持原顺序', () => {
    expect(orderEdgesForVisualPriority(edges, null).map((edge) => edge.id)).toEqual([
      'e1',
      'e2',
      'e3',
    ])
    expect(orderEdgesForVisualPriority(edges, 'missing').map((edge) => edge.id)).toEqual([
      'e1',
      'e2',
      'e3',
    ])
  })
})

describe('computeLanedEdgeGeometry', () => {
  it('唯一关系沿用 smoothstep：标签在路径中点，不生成自定义折点', () => {
    const geometry = edgeBetween(nodeAt(0, 0), nodeAt(400, 0), 0)

    expect(geometry.points).toEqual([])
    expect(geometry.labelX).toBe(305)
    expect(geometry.labelY).toBe(26)
    expect(geometry.path).toContain('M210 26')
  })

  it('双向关系的标签分别落在节点上方与下方，且连线不穿过节点', () => {
    const source = nodeAt(0, 0)
    const target = nodeAt(400, 0)
    const below = edgeBetween(source, target, 1)
    const above = edgeBetween(target, source, -1)

    expect(below.labelY).toBe(NODE_HEIGHT + EDGE_LANE_GAP)
    expect(above.labelY).toBe(-EDGE_LANE_GAP)
    // 上下两条车道分别从节点盒下沿/上沿再让出行距，标签锚点相距 124px，标签盒不会重叠
    expect(below.labelY - above.labelY).toBe(NODE_HEIGHT + EDGE_LANE_GAP * 2)
    expectPathOutsideNodes(below.points, source, target)
    expectPathOutsideNodes(above.points, target, source)
  })

  it('节点高度不同时仍绕到两者整体的外侧', () => {
    const upper = nodeAt(0, 0)
    const lower = nodeAt(400, 200)
    const below = edgeBetween(upper, lower, 1)
    const above = edgeBetween(lower, upper, -1)

    expect(below.labelY).toBe(200 + NODE_HEIGHT + EDGE_LANE_GAP)
    expect(above.labelY).toBe(-EDGE_LANE_GAP)
    expectPathOutsideNodes(below.points, upper, lower)
    expectPathOutsideNodes(above.points, lower, upper)
  })

  it('路径与标签坐标都是有限数值', () => {
    const geometry = edgeBetween(nodeAt(0, 0), nodeAt(400, 0), 2)

    expect(geometry.path).not.toMatch(/NaN|Infinity/)
    expect(Number.isFinite(geometry.labelX)).toBe(true)
    expect(Number.isFinite(geometry.labelY)).toBe(true)
  })
})
