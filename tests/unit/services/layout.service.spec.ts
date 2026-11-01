import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  computeLayout,
  type LayoutEdgeInput,
  type LayoutPositions,
  type LayoutMode,
} from '@/services/layout.service'

/** 用线性同余生成确定性的随机图，避免测试结果随 Math.random 变化。 */
function buildGraph(nodeCount: number, edgeCount: number, seed = 7) {
  let state = seed
  const random = () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({ id: `n${index}` }))
  const seen = new Set<string>()
  const edges: LayoutEdgeInput[] = []
  for (let index = 0; index < edgeCount; index += 1) {
    const source = Math.floor(random() * nodeCount)
    const target = Math.floor(random() * nodeCount)
    const key = `${source}-${target}`
    if (source === target || seen.has(key)) {
      continue
    }
    seen.add(key)
    edges.push({ source: `n${source}`, target: `n${target}` })
  }
  return { nodes, edges }
}

/** 用默认节点尺寸数一数包围盒重叠的对数。 */
function countOverlaps(positions: LayoutPositions): number {
  const boxes = Object.values(positions)
  let overlaps = 0
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]
      const b = boxes[j]
      if (
        a.x < b.x + DEFAULT_NODE_WIDTH &&
        a.x + DEFAULT_NODE_WIDTH > b.x &&
        a.y < b.y + DEFAULT_NODE_HEIGHT &&
        a.y + DEFAULT_NODE_HEIGHT > b.y
      ) {
        overlaps += 1
      }
    }
  }
  return overlaps
}

const MODES: LayoutMode[] = ['force', 'layered']

describe('computeLayout', () => {
  it('空图返回空结果', async () => {
    await expect(computeLayout([], [], 'force')).resolves.toEqual({})
    await expect(computeLayout([], [], 'layered')).resolves.toEqual({})
  })

  it.each(MODES)('%s 模式覆盖全部节点、坐标为整数且包围盒互不重叠', async (mode) => {
    const { nodes, edges } = buildGraph(12, 18)
    const positions = await computeLayout(nodes, edges, mode)

    expect(Object.keys(positions).sort()).toEqual(nodes.map((node) => node.id).sort())
    for (const position of Object.values(positions)) {
      expect(Number.isInteger(position.x)).toBe(true)
      expect(Number.isInteger(position.y)).toBe(true)
      expect(Number.isFinite(position.x)).toBe(true)
      expect(Number.isFinite(position.y)).toBe(true)
    }
    expect(countOverlaps(positions)).toBe(0)
  })

  it('layered 模式在 A→B→C 链上 y 坐标递增', async () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ]
    const positions = await computeLayout(nodes, edges, 'layered')

    expect(positions.a.y).toBeLessThan(positions.b.y)
    expect(positions.b.y).toBeLessThan(positions.c.y)
    // 分层方向是从上到下，同列节点横向错开
    expect(positions.a.x).toBe(positions.b.x)
    expect(positions.b.x).toBe(positions.c.x)
  })

  it('忽略端点缺失与自连的脏边', async () => {
    const positions = await computeLayout(
      [{ id: 'a' }, { id: 'b' }],
      [
        { source: 'a', target: 'ghost' },
        { source: 'a', target: 'a' },
      ],
      'layered',
    )
    expect(Object.keys(positions).sort()).toEqual(['a', 'b'])
  })

  it('100 节点 / 300 关系：两种模式都不重叠且耗时低于 1 秒', async () => {
    const { nodes, edges } = buildGraph(100, 300)
    // 首次调用包含 elkjs 动态加载，单独计时后从布局耗时中排除
    const loadStart = performance.now()
    await computeLayout([{ id: 'warmup' }], [], 'force')
    const loadMs = performance.now() - loadStart

    const timings: Record<LayoutMode, number> = { force: 0, layered: 0 }
    for (const mode of MODES) {
      const start = performance.now()
      const positions = await computeLayout(nodes, edges, mode)
      timings[mode] = performance.now() - start
      expect(Object.keys(positions)).toHaveLength(100)
      expect(countOverlaps(positions)).toBe(0)
    }
    console.log(
      `[layout] elkjs 首次加载 ${loadMs.toFixed(0)}ms；100 节点/300 关系 force ${timings.force.toFixed(0)}ms、layered ${timings.layered.toFixed(0)}ms`,
    )
    expect(timings.force).toBeLessThan(1000)
    expect(timings.layered).toBeLessThan(1000)
  }, 30000)
})
