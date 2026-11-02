import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  computeLayout,
  type LayoutEdgeInput,
  type LayoutPositions,
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

// 整图模式；clustered 由独立的 describe 覆盖，不进入这两条性能/几何断言
const MODES: Array<'force' | 'layered'> = ['force', 'layered']

describe('computeLayout', () => {
  it('空图返回空结果', async () => {
    await expect(computeLayout([], [], 'force')).resolves.toEqual({})
    await expect(computeLayout([], [], 'layered')).resolves.toEqual({})
    await expect(computeLayout([], [], 'clustered')).resolves.toEqual({})
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

    const timings: Record<'force' | 'layered', number> = { force: 0, layered: 0 }
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
/** 按 group 汇总真实包围盒（节点尺寸取默认值），用于断言簇之间不重叠。 */
function groupBounds(
  nodes: readonly { id: string; group?: string }[],
  positions: LayoutPositions,
): Map<string, { minX: number; minY: number; maxX: number; maxY: number }> {
  const bounds = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>()
  for (const node of nodes) {
    const position = positions[node.id]
    const key = node.group ?? ''
    const current = bounds.get(key)
    if (current) {
      current.minX = Math.min(current.minX, position.x)
      current.minY = Math.min(current.minY, position.y)
      current.maxX = Math.max(current.maxX, position.x + DEFAULT_NODE_WIDTH)
      current.maxY = Math.max(current.maxY, position.y + DEFAULT_NODE_HEIGHT)
    } else {
      bounds.set(key, {
        minX: position.x,
        minY: position.y,
        maxX: position.x + DEFAULT_NODE_WIDTH,
        maxY: position.y + DEFAULT_NODE_HEIGHT,
      })
    }
  }
  return bounds
}

/** 两个包围盒在任一轴上分离即视为不重叠。 */
function isDisjoint(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  return a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY
}

describe('computeLayout clustered（按节点类型聚集）', () => {
  const nodes = [
    { id: 'c1', group: 'character' },
    { id: 'c2', group: 'character' },
    { id: 'c3', group: 'character' },
    { id: 'l1', group: 'location' },
    { id: 'l2', group: 'location' },
    // 导入来的、当前世界没有定义的类型也要成簇，不能丢节点
    { id: 'x1', group: 'imported-type' },
  ]
  const edges: LayoutEdgeInput[] = [
    { source: 'c1', target: 'c2' },
    { source: 'c2', target: 'c3' },
    { source: 'l1', target: 'l2' },
    // 跨类型边：不参与簇内布局，但必须仍然存在
    { source: 'c1', target: 'l1' },
    { source: 'c3', target: 'x1' },
  ]

  it('覆盖全部节点、坐标为整数，且不同簇的包围盒互不重叠', async () => {
    const positions = await computeLayout(nodes, edges, 'clustered')

    expect(Object.keys(positions).sort()).toEqual(nodes.map((node) => node.id).sort())
    for (const position of Object.values(positions)) {
      expect(Number.isInteger(position.x)).toBe(true)
      expect(Number.isInteger(position.y)).toBe(true)
    }
    expect(countOverlaps(positions)).toBe(0)

    const bounds = [...groupBounds(nodes, positions).values()]
    expect(bounds).toHaveLength(3)
    for (let i = 0; i < bounds.length; i += 1) {
      for (let j = i + 1; j < bounds.length; j += 1) {
        expect(isDisjoint(bounds[i], bounds[j])).toBe(true)
      }
    }
  })

  it('跨类型边不影响坐标：只保留簇内边结果相同', async () => {
    const groupOf = new Map(nodes.map((node) => [node.id, node.group]))
    const innerOnly = edges.filter((edge) => groupOf.get(edge.source) === groupOf.get(edge.target))

    await expect(computeLayout(nodes, innerOnly, 'clustered')).resolves.toEqual(
      await computeLayout(nodes, edges, 'clustered'),
    )
  })

  it('单簇（只有一种类型）退化为 force，坐标完全一致', async () => {
    const single = nodes.filter((node) => node.group === 'character')
    const chain: LayoutEdgeInput[] = [
      { source: 'c1', target: 'c2' },
      { source: 'c2', target: 'c3' },
    ]

    await expect(computeLayout(single, chain, 'clustered')).resolves.toEqual(
      await computeLayout(single, chain, 'force'),
    )
  })

  it('没有任何 group 时退化为 force，不因缺字段丢节点', async () => {
    const plain = [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }]
    const chain: LayoutEdgeInput[] = [
      { source: 'n1', target: 'n2' },
      { source: 'n2', target: 'n3' },
    ]

    await expect(computeLayout(plain, chain, 'clustered')).resolves.toEqual(
      await computeLayout(plain, chain, 'force'),
    )
  })

  it('大簇与单节点簇按真实包围盒排布，不因固定格子重叠', async () => {
    const big = Array.from({ length: 8 }, (_, index) => ({
      id: `b${index}`,
      group: 'event',
    }))
    const all = [...big, { id: 'only', group: 'item' }]
    const chain: LayoutEdgeInput[] = big
      .slice(1)
      .map((node, index) => ({ source: big[index].id, target: node.id }))

    const positions = await computeLayout(all, chain, 'clustered')

    expect(Object.keys(positions).sort()).toEqual(all.map((node) => node.id).sort())
    expect(countOverlaps(positions)).toBe(0)
    const bounds = [...groupBounds(all, positions).values()]
    expect(bounds).toHaveLength(2)
    expect(isDisjoint(bounds[0], bounds[1])).toBe(true)
  })

  it('同一份数据连续计算得到相同坐标', async () => {
    const first = await computeLayout(nodes, edges, 'clustered')
    const second = await computeLayout(nodes, edges, 'clustered')

    expect(second).toEqual(first)
  })
})
