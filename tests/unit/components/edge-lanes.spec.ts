import { describe, expect, it } from 'vitest'
import { Position } from '@vue-flow/core'
import {
  EDGE_LANE_GAP,
  assignEdgeLanes,
  choosePorts,
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

interface CubicSegment {
  from: Point
  c1: Point
  c2: Point
  to: Point
}

/** 解析几何函数输出的 M/C 路径：所有段都是三次贝塞尔，便于检查切向与采样。 */
function segmentsOf(path: string): CubicSegment[] {
  const tokens = path.match(/[MLC]|-?\d*\.?\d+/g) ?? []
  const segments: CubicSegment[] = []
  let index = 0
  let command = ''
  let current: Point = { x: 0, y: 0 }
  while (index < tokens.length) {
    const token = tokens[index]
    if (token === 'M' || token === 'C') {
      command = token
      index += 1
      continue
    }
    const size = command === 'C' ? 6 : 2
    const numbers = tokens.slice(index, index + size).map(Number)
    index += size
    if (command === 'M') {
      current = { x: numbers[0], y: numbers[1] }
      continue
    }
    segments.push({
      from: current,
      c1: { x: numbers[0], y: numbers[1] },
      c2: { x: numbers[2], y: numbers[3] },
      to: { x: numbers[4], y: numbers[5] },
    })
    current = { x: numbers[4], y: numbers[5] }
  }
  return segments
}

function pointAt(segment: CubicSegment, t: number): Point {
  const mt = 1 - t
  return {
    x:
      mt * mt * mt * segment.from.x +
      3 * mt * mt * t * segment.c1.x +
      3 * mt * t * t * segment.c2.x +
      t * t * t * segment.to.x,
    y:
      mt * mt * mt * segment.from.y +
      3 * mt * mt * t * segment.c1.y +
      3 * mt * t * t * segment.c2.y +
      t * t * t * segment.to.y,
  }
}

function sample(path: string, steps = 40): Point[] {
  const points: Point[] = []
  for (const segment of segmentsOf(path)) {
    for (let step = 0; step <= steps; step += 1) {
      points.push(pointAt(segment, step / steps))
    }
  }
  return points
}

function bboxOf(points: readonly Point[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  }
}

function unit(vector: Point): Point {
  const length = Math.hypot(vector.x, vector.y)
  return length < 1e-9 ? { x: 0, y: 0 } : { x: vector.x / length, y: vector.y / length }
}

/** 每段起止切向，用来验证 G1 连续（转角处方向不突变）。 */
function startTangent(segment: CubicSegment): Point {
  return unit({ x: segment.c1.x - segment.from.x, y: segment.c1.y - segment.from.y })
}

function endTangent(segment: CubicSegment): Point {
  return unit({ x: segment.to.x - segment.c2.x, y: segment.to.y - segment.c2.y })
}

function expectSmooth(path: string): void {
  const segments = segmentsOf(path)
  expect(segments.length).toBeGreaterThan(0)
  for (const [index, segment] of segments.entries()) {
    const length = Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y)
    expect(length).toBeGreaterThan(0)
    if (index > 0) {
      const previous = endTangent(segments[index - 1])
      const next = startTangent(segment)
      expect(previous.x * next.x + previous.y * next.y).toBeGreaterThan(0.999)
    }
  }
  expect(path).not.toContain('Q')
}

function expectNoSelfIntersection(path: string): void {
  const segments = segmentsOf(path).map((segment) => [
    segment.from,
    segment.c1,
    segment.c2,
    segment.to,
  ])
  const lines = segments.flatMap((curve) =>
    pointsAlong(curve, 20)
      .slice(1)
      .map((point, index) => [pointsAlong(curve, 20)[index], point]),
  )
  for (let first = 0; first < lines.length; first += 1) {
    for (let second = first + 2; second < lines.length; second += 1) {
      const [a, b] = lines[first]
      const [c, d] = lines[second]
      const rx = b.x - a.x
      const ry = b.y - a.y
      const sx = d.x - c.x
      const sy = d.y - c.y
      const denominator = rx * sy - ry * sx
      if (Math.abs(denominator) < 1e-9) continue
      const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denominator
      const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denominator
      expect(t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99).toBe(false)
    }
  }
}

function pointsAlong(curve: readonly Point[], steps: number): Point[] {
  const [from, c1, c2, to] = curve
  const result: Point[] = []
  for (let step = 0; step <= steps; step += 1) {
    result.push(pointAt({ from, c1, c2, to }, step / steps))
  }
  return result
}

function insideRect(point: Point, rect: Rect): boolean {
  return (
    point.x > rect.x + 1 &&
    point.x < rect.x + rect.width - 1 &&
    point.y > rect.y + 1 &&
    point.y < rect.y + rect.height - 1
  )
}

function expectOutsideRect(path: string, rect: Rect): void {
  for (const point of sample(path, 30)) {
    expect(insideRect(point, rect), `点 (${point.x}, ${point.y}) 落在节点内部`).toBe(false)
  }
}

describe('computeLanedEdgeGeometry', () => {
  it('同轴节点平滑直连：路径是一条直线，标签落在两点中点', () => {
    const geometry = edgeBetween(nodeAt(0, 0), nodeAt(400, 0), 0)

    expect(geometry.labelX).toBe(305)
    expect(geometry.labelY).toBe(26)
    expect(segmentsOf(geometry.path).length).toBe(1)
    for (const point of sample(geometry.path, 8)) {
      expect(point.y).toBeCloseTo(26, 2)
    }
    expectSmooth(geometry.path)
  })

  it('纵向错位时用三次贝塞尔过渡，两端保持水平切向', () => {
    const source = nodeAt(0, 0)
    const target = nodeAt(400, 120)
    const geometry = edgeBetween(source, target, 0)
    const segments = segmentsOf(geometry.path)

    expect(geometry.path).not.toMatch(/NaN|Infinity/)
    expect(startTangent(segments[0]).y).toBeCloseTo(0, 3)
    expect(endTangent(segments[segments.length - 1]).y).toBeCloseTo(0, 3)
    expect(segments[0].from).toEqual({ x: 210, y: 26 })
    expect(segments[segments.length - 1].to).toEqual({ x: 400, y: 146 })
    expectSmooth(geometry.path)
    expectOutsideRect(geometry.path, source)
    expectOutsideRect(geometry.path, target)
  })

  it('双向关系的标签分别落在节点上方与下方，且连线不穿过节点', () => {
    const source = nodeAt(0, 0)
    const target = nodeAt(400, 0)
    const below = edgeBetween(source, target, 1)
    const above = edgeBetween(target, source, -1)

    expect(below.labelY).toBe(NODE_HEIGHT + EDGE_LANE_GAP)
    expect(above.labelY).toBe(-EDGE_LANE_GAP)
    expect(below.labelY - above.labelY).toBe(NODE_HEIGHT + EDGE_LANE_GAP * 2)
    // 平滑拱的极值就是拱顶；绕行版在转角处会有几像素圆角外扩，标签仍落在水平段上
    expect(bboxOf(sample(below.path, 30)).maxY).toBeCloseTo(below.labelY, 0)
    expect(Math.abs(bboxOf(sample(above.path, 30)).minY - above.labelY)).toBeLessThanOrEqual(8)
    expectOutsideRect(below.path, source)
    expectOutsideRect(below.path, target)
    expectOutsideRect(above.path, target)
    expectOutsideRect(above.path, source)
    expectSmooth(below.path)
    expectSmooth(above.path)
  })

  it('节点高度不同时仍绕到两者整体的外侧', () => {
    const upper = nodeAt(0, 0)
    const lower = nodeAt(400, 200)
    const below = edgeBetween(upper, lower, 1)
    const above = edgeBetween(lower, upper, -1)

    expect(below.labelY).toBe(200 + NODE_HEIGHT + EDGE_LANE_GAP)
    expect(above.labelY).toBe(-EDGE_LANE_GAP)
    expectSmooth(below.path)
    expectSmooth(above.path)
    expectOutsideRect(below.path, upper)
    expectOutsideRect(below.path, lower)
    expectOutsideRect(above.path, lower)
    expectOutsideRect(above.path, upper)
  })

  it('四条平行关系分到不同的对称车道，标签不重叠', () => {
    const source = nodeAt(0, 0)
    const target = nodeAt(400, 0)
    const points = [1, -1, 2, -2].map((lane) => {
      const geometry = edgeBetween(source, target, lane)
      expectSmooth(geometry.path)
      return { x: geometry.labelX, y: geometry.labelY }
    })

    expect(points.map((point) => point.y)).toEqual([
      NODE_HEIGHT + EDGE_LANE_GAP,
      -EDGE_LANE_GAP,
      NODE_HEIGHT + EDGE_LANE_GAP * 2,
      -EDGE_LANE_GAP * 2,
    ])
    expect(new Set(points.map((point) => `${point.x},${point.y}`)).size).toBe(4)
  })

  it('横向间隙很小时绕到并集外侧，不从节点内部穿过', () => {
    for (const gap of [14, 30]) {
      const source = nodeAt(0, 0)
      const target = nodeAt(NODE_WIDTH + gap, 0)
      for (const lane of [1, -1]) {
        const geometry = edgeBetween(source, target, lane)

        expect(geometry.path).not.toMatch(/NaN|Infinity/)
        expectSmooth(geometry.path)
        expectOutsideRect(geometry.path, source)
        expectOutsideRect(geometry.path, target)
        expect(geometry.labelY).toBe(lane > 0 ? NODE_HEIGHT + EDGE_LANE_GAP : -EDGE_LANE_GAP)
      }
    }
  })

  it('节点纵向错位时绕到两节点并集外侧，两个方向都不穿过节点', () => {
    const source = nodeAt(0, 0)
    const target = nodeAt(96, 128)

    for (const lane of [1, -1]) {
      const geometry = edgeBetween(source, target, lane)

      expect(geometry.labelY).toBe(
        lane > 0 ? target.y + NODE_HEIGHT + EDGE_LANE_GAP : -EDGE_LANE_GAP,
      )
      expectSmooth(geometry.path)
      expectOutsideRect(geometry.path, source)
      expectOutsideRect(geometry.path, target)
    }
  })

  it('反向关系（源在目标右侧）绕并集一圈，仍是连续曲线', () => {
    const source = nodeAt(400, 0)
    const target = nodeAt(0, 0)

    for (const lane of [1, -1]) {
      const geometry = edgeBetween(source, target, lane)

      expectSmooth(geometry.path)
      expectOutsideRect(geometry.path, source)
      expectOutsideRect(geometry.path, target)
      expect(geometry.path).not.toMatch(/NaN|Infinity/)
    }
  })

  it('负坐标场景同样不穿过节点', () => {
    const source = nodeAt(-500, -300)
    const target = nodeAt(-404, -172)

    for (const lane of [1, -1]) {
      const geometry = edgeBetween(source, target, lane)

      expectSmooth(geometry.path)
      expectOutsideRect(geometry.path, source)
      expectOutsideRect(geometry.path, target)
      expect(Number.isFinite(geometry.labelX)).toBe(true)
      expect(Number.isFinite(geometry.labelY)).toBe(true)
    }
  })

  it('两节点盒相交或贴边时绕到并集外侧，路径不为零长度', () => {
    const overlapping = edgeBetween(nodeAt(0, 0), nodeAt(100, 30), 1)
    const touching = edgeBetween(nodeAt(0, 0), nodeAt(NODE_WIDTH, 0), 1)

    for (const geometry of [overlapping, touching]) {
      expectSmooth(geometry.path)
      expect(geometry.path).not.toMatch(/NaN|Infinity/)
      expect(Number.isFinite(geometry.labelX)).toBe(true)
      expect(Number.isFinite(geometry.labelY)).toBe(true)
      expect(sample(geometry.path, 10).length).toBeGreaterThan(3)
    }
  })

  it('自环在节点上方成拱，水平收尾让箭头不被节点盖住', () => {
    const rect = nodeAt(0, 0)
    const loop = computeLanedEdgeGeometry({
      lane: 0,
      sourceX: rect.x + rect.width,
      sourceY: rect.y + rect.height / 2,
      targetX: rect.x,
      targetY: rect.y + rect.height / 2,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      sourceRect: rect,
      targetRect: rect,
    })
    const segments = segmentsOf(loop.path)
    const box = bboxOf(sample(loop.path, 40))

    expectSmooth(loop.path)
    expect(segments[0].from).toEqual({ x: 210, y: 26 })
    expect(segments[segments.length - 1].to).toEqual({ x: 0, y: 26 })
    // 目标端沿水平切向进入，箭头方向与节点边缘垂直，不会被节点盒截掉一半
    expect(endTangent(segments[segments.length - 1]).y).toBeCloseTo(0, 3)
    expect(endTangent(segments[segments.length - 1]).x).toBeGreaterThan(0.9)
    expect(box.minY).toBeLessThan(rect.y - 40)
    expect(box.minX).toBeGreaterThan(-30)
    expect(box.maxX).toBeLessThan(rect.x + rect.width + 30)
    expect(loop.labelY).toBeLessThan(box.minY)
    expect(loop.labelX).toBe(105)
    // 首段沿 Right handle 的外向水平离开，不在节点边缘竖直起步
    expect(startTangent(segments[0]).x).toBeGreaterThan(0.9)
    expectOutsideRect(loop.path, rect)
    expectNoSelfIntersection(loop.path)
  })

  it('极短关系不会因为控制柄过长而回绕', () => {
    const source = nodeAt(0, 0)
    const target = nodeAt(214, 2)
    const geometry = edgeBetween(source, target, 0)
    const points = sample(geometry.path, 60)

    expectSmooth(geometry.path)
    expectOutsideRect(geometry.path, source)
    expectOutsideRect(geometry.path, target)
    // 向前的短关系必须沿 x 单调前进，不能出现回折
    for (let index = 1; index < points.length; index += 1) {
      expect(points[index].x).toBeGreaterThanOrEqual(points[index - 1].x - 0.01)
    }
  })

  it('多条自环按车道分到上下两侧，标签不落在同一点', () => {
    const rect = nodeAt(0, 0)
    const loop = (lane: number) =>
      computeLanedEdgeGeometry({
        lane,
        sourceX: rect.x + rect.width,
        sourceY: rect.y + rect.height / 2,
        targetX: rect.x,
        targetY: rect.y + rect.height / 2,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        sourceRect: rect,
        targetRect: rect,
      })

    const above = loop(-1)
    const below = loop(1)
    expect(above.labelY).toBeLessThan(-EDGE_LANE_GAP)
    expect(below.labelY).toBeGreaterThan(rect.y + rect.height + EDGE_LANE_GAP)
    expect(Math.abs(above.labelY - below.labelY)).toBeGreaterThan(EDGE_LANE_GAP)
  })

  it('标签锚点恰好为 0 时退让为非零，避免 BaseEdge 以真值判断隐藏标签', () => {
    const zeroX = edgeBetween(nodeAt(-300, 0), nodeAt(90, 0), 1)
    const zeroY = edgeBetween(nodeAt(0, -88), nodeAt(224, -88), 1)
    const straightZeroX = edgeBetween(nodeAt(-300, 0), nodeAt(90, 0), 0)

    expect(zeroX.labelX).toBe(0.01)
    expect(zeroY.labelY).toBe(0.01)
    expect(straightZeroX.labelX).toBe(0.01)
    const nearZero = edgeBetween(nodeAt(-300.004, 0), nodeAt(90, 0), 1)
    expect(nearZero.labelX).toBeCloseTo(-0.002)
    expect(nearZero.labelX).not.toBe(0)
  })

  it('路径与标签坐标都是有限数值', () => {
    const geometry = edgeBetween(nodeAt(0, 0), nodeAt(400, 0), 2)

    expect(geometry.path).not.toMatch(/NaN|Infinity/)
    expect(Number.isFinite(geometry.labelX)).toBe(true)
    expect(Number.isFinite(geometry.labelY)).toBe(true)
  })
})

describe('choosePorts 端口选择', () => {
  it('按相向主轴选端口：右/左、左/右、下/上、上/下', () => {
    expect(choosePorts(nodeAt(0, 0), nodeAt(400, 0))).toEqual({
      sourceHandle: 'right',
      targetHandle: 'left',
    })
    expect(choosePorts(nodeAt(400, 0), nodeAt(0, 0))).toEqual({
      sourceHandle: 'source-left',
      targetHandle: 'target-right',
    })
    expect(choosePorts(nodeAt(0, 0), nodeAt(0, 300))).toEqual({
      sourceHandle: 'source-bottom',
      targetHandle: 'target-top',
    })
    expect(choosePorts(nodeAt(0, 300), nodeAt(0, 0))).toEqual({
      sourceHandle: 'source-top',
      targetHandle: 'target-bottom',
    })
  })

  it('主轴由中心距决定，重叠盒回退到原有 right/left', () => {
    expect(choosePorts(nodeAt(0, 0), nodeAt(400, 120)).sourceHandle).toBe('right')
    expect(choosePorts(nodeAt(0, 0), nodeAt(100, 30))).toEqual({
      sourceHandle: 'right',
      targetHandle: 'left',
    })
  })
})

describe('竖向端口几何', () => {
  const source = nodeAt(0, 0)
  const target = nodeAt(300, 300)
  const verticalEdge = (obstacles?: Rect[]) =>
    computeLanedEdgeGeometry({
      lane: 0,
      sourceX: source.x + source.width / 2,
      sourceY: source.y + source.height + 3,
      targetX: target.x + target.width / 2,
      targetY: target.y - 3,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      sourceRect: source,
      targetRect: target,
      obstacles,
    })

  it('Bottom → Top 是连续竖向 S，切线竖直、不穿过端点盒', () => {
    const geometry = verticalEdge()
    const segments = segmentsOf(geometry.path)

    expectSmooth(geometry.path)
    expect(Math.abs(startTangent(segments[0]).x)).toBeLessThan(0.01)
    expect(startTangent(segments[0]).y).toBeGreaterThan(0.9)
    expect(Math.abs(endTangent(segments[segments.length - 1]).x)).toBeLessThan(0.01)
    expect(endTangent(segments[segments.length - 1]).y).toBeGreaterThan(0.9)
    expectOutsideRect(geometry.path, source)
    expectOutsideRect(geometry.path, target)
    expect(geometry.labelX).toBe(255)
    expect(geometry.labelY).toBe(176)
  })

  it('竖向同样启用有界避障候选', () => {
    const obstacle: Rect = { x: 0, y: 140, width: 210, height: 52 }
    const direct = verticalEdge()
    const avoided = verticalEdge([obstacle])

    expect(avoided.path).not.toBe(direct.path)
    expectSmooth(avoided.path)
    for (const point of sample(avoided.path, 40)) {
      expect(insideRect(point, obstacle)).toBe(false)
    }
  })
})

describe('密图固定坐标交叉', () => {
  /** 与 fixtures/dense-world.loregraph.json 一致：16 节点 24 边，节点 210×52。 */
  const COLUMNS = [0, 416, 848, 1264]
  const ROWS = [0, 208, 416, 624]
  const denseNodes = ['a', 'b', 'c', 'd'].flatMap((column, columnIndex) =>
    ['1', '2', '3', '4'].map((row, rowIndex) => ({
      id: 'n-' + column + row,
      rect: nodeAt(COLUMNS[columnIndex], ROWS[rowIndex]),
    })),
  )
  const denseEdges: Array<[string, string]> = [
    ['a1', 'b4'],
    ['a2', 'b3'],
    ['a3', 'b2'],
    ['a4', 'b1'],
    ['b1', 'c4'],
    ['b2', 'c3'],
    ['b3', 'c2'],
    ['b4', 'c1'],
    ['c1', 'd4'],
    ['c2', 'd3'],
    ['c3', 'd2'],
    ['c4', 'd1'],
    ['a1', 'c4'],
    ['a2', 'c3'],
    ['a3', 'c2'],
    ['a4', 'c1'],
    ['b1', 'd4'],
    ['b2', 'd3'],
    ['b3', 'd2'],
    ['b4', 'd1'],
    ['a1', 'd4'],
    ['a2', 'd3'],
    ['a3', 'd2'],
    ['a4', 'd1'],
  ]
  const rectOf = new Map(denseNodes.map((node) => [node.id, node.rect]))

  /** 按 3px 弧长采样，和验收脚本的 path.getPointAtLength(l) 口径一致。 */
  function sampleByLength(path: string, step = 3): Point[] {
    const raw: Point[] = []
    for (const segment of segmentsOf(path)) {
      for (let index = 0; index <= 400; index += 1) {
        raw.push(pointAt(segment, index / 400))
      }
    }
    const points: Point[] = [raw[0]]
    let travelled = 0
    let last = raw[0]
    for (const point of raw.slice(1)) {
      travelled += Math.hypot(point.x - last.x, point.y - last.y)
      last = point
      if (travelled >= step) {
        points.push(point)
        travelled = 0
      }
    }
    return points
  }

  function crossingBetween(first: readonly Point[], second: readonly Point[]): Point | null {
    for (let a = 0; a + 1 < first.length; a += 1) {
      for (let b = 0; b + 1 < second.length; b += 1) {
        const [ax, ay] = [first[a].x, first[a].y]
        const [bx, by] = [first[a + 1].x, first[a + 1].y]
        const [cx, cy] = [second[b].x, second[b].y]
        const [dx, dy] = [second[b + 1].x, second[b + 1].y]
        const rx = bx - ax
        const ry = by - ay
        const sx = dx - cx
        const sy = dy - cy
        const denominator = rx * sy - ry * sx
        if (Math.abs(denominator) < 1e-9) {
          continue
        }
        const t = ((cx - ax) * sy - (cy - ay) * sx) / denominator
        const u = ((cx - ax) * ry - (cy - ay) * rx) / denominator
        if (t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99) {
          return { x: ax + t * rx, y: ay + t * ry }
        }
      }
    }
    return null
  }

  it('密图固定坐标：全部是 G1 贝塞尔、没有轴对齐为主的直角段、不穿中间节点', () => {
    const geometries = denseEdges.map(([source, target], index) => {
      const sourceRect = rectOf.get('n-' + source) as Rect
      const targetRect = rectOf.get('n-' + target) as Rect
      const geometry = computeLanedEdgeGeometry({
        lane: 0,
        sourceX: sourceRect.x + sourceRect.width + 3,
        sourceY: sourceRect.y + sourceRect.height / 2,
        targetX: targetRect.x - 3,
        targetY: targetRect.y + targetRect.height / 2,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        sourceRect,
        targetRect,
      })
      expectSmooth(geometry.path)
      return { id: index, source, target, points: sampleByLength(geometry.path) }
    })

    const raw: Point[] = []
    for (let first = 0; first < geometries.length; first += 1) {
      for (let second = first + 1; second < geometries.length; second += 1) {
        const a = geometries[first]
        const b = geometries[second]
        if (a.source === b.source || a.target === b.target) continue
        if (a.source === b.target || a.target === b.source) continue
        const hit = crossingBetween(a.points, b.points)
        if (hit) raw.push(hit)
      }
    }
    const seen = new Set<string>()
    for (const point of raw) {
      seen.add(`${Math.round(point.x / 6)}:${Math.round(point.y / 6)}`)
    }

    // 固定坐标交叉数只是辅助回归线：真正交付的是连续曲线形状与避障。
    // 本模型实测 65 唯一 / 69 原始，留出余量防止后续改动把交叉再推高。
    expect(raw.length).toBeLessThanOrEqual(76)
    expect(seen.size).toBeLessThanOrEqual(72)

    // 中间列节点不穿插：S 形斜穿比直角走廊更少碰到其它节点（本模型实测 12 处采样）
    let nodeHits = 0
    for (const line of geometries) {
      for (const node of denseNodes) {
        if (node.id === 'n-' + line.source || node.id === 'n-' + line.target) continue
        if (line.points.some((point) => insideRect(point, node.rect))) {
          nodeHits += 1
        }
      }
    }
    expect(nodeHits).toBeLessThanOrEqual(16)

    // 轴对齐占比：旧走廊路由 83%–92% 的采样长度是水平/竖直段，S 形应低于 25%
    const axisAligned = geometries.map((line) => {
      let total = 0
      let axis = 0
      for (let index = 1; index < line.points.length; index += 1) {
        const from = line.points[index - 1]
        const to = line.points[index]
        const length = Math.hypot(to.x - from.x, to.y - from.y)
        total += length
        if (
          length > 0 &&
          (Math.abs(to.x - from.x) < 0.12 * length || Math.abs(to.y - from.y) < 0.12 * length)
        ) {
          axis += length
        }
      }
      return total > 0 ? axis / total : 0
    })
    const average = axisAligned.reduce((sum, value) => sum + value, 0) / axisAligned.length
    expect(average).toBeLessThan(0.25)
  })

  it('传入障碍盒时改选不穿节点的平滑候选，未传时保持直连曲线', () => {
    const sourceRect = rectOf.get('n-a1') as Rect
    const targetRect = rectOf.get('n-c4') as Rect
    const base = {
      lane: 0,
      sourceX: sourceRect.x + sourceRect.width + 3,
      sourceY: sourceRect.y + sourceRect.height / 2,
      targetX: targetRect.x - 3,
      targetY: targetRect.y + targetRect.height / 2,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      sourceRect,
      targetRect,
    }
    const obstacles = denseNodes
      .filter((node) => node.id.startsWith('n-b'))
      .map((node) => node.rect)
    const direct = computeLanedEdgeGeometry(base)
    const avoided = computeLanedEdgeGeometry({ ...base, obstacles })

    expect(avoided.path).not.toBe(direct.path)
    expectSmooth(avoided.path)
    for (const point of sample(avoided.path, 40)) {
      for (const rect of obstacles) {
        expect(insideRect(point, rect)).toBe(false)
      }
    }
    // 同样输入但不传障碍时仍走原直连曲线
    expect(computeLanedEdgeGeometry({ ...base, obstacles: [] }).path).toBe(direct.path)
  })
})
