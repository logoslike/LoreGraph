import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { LoreNode, NodePosition } from '@/models/node'
import { services } from '@/services'
import * as layoutService from '@/services/layout.service'
import { useGraphStore } from '@/stores/graph'

type GraphStore = ReturnType<typeof useGraphStore>

let sequence = 0

/** 造一个带节点与链式关系的世界，并加载进 store。 */
async function seedWorld(nodeCount = 4) {
  sequence += 1
  const universe = await services.universes.create({ name: `布局世界-${sequence}` })
  const nodes: LoreNode[] = []
  for (let index = 0; index < nodeCount; index += 1) {
    nodes.push(
      await services.graph.createNode({
        universeId: universe.id,
        type: index % 2 === 0 ? 'character' : 'location',
        name: `节点${index}`,
        description: `描述${index}`,
        properties: { order: index, tag: `t${index}` },
        position: { x: index * 120, y: index * 60 },
      }),
    )
  }
  for (let index = 0; index + 1 < nodeCount; index += 1) {
    await services.graph.createEdge({
      universeId: universe.id,
      source: nodes[index].id,
      target: nodes[index + 1].id,
      relationType: 'related-to',
      label: `关系${index}`,
    })
  }
  const store = useGraphStore()
  await store.load(universe.id)
  return { universe, nodes, store }
}

/** 只取与布局无关的字段，用来断言布局没有改动节点内容。 */
function stableNodes(nodes: readonly LoreNode[]) {
  return nodes.map((node) => ({
    id: node.id,
    universeId: node.universeId,
    type: node.type,
    name: node.name,
    description: node.description,
    properties: node.properties,
    createdAt: node.createdAt,
  }))
}

/** 内存坐标。 */
function positions(store: GraphStore): Record<string, NodePosition> {
  return Object.fromEntries(store.nodes.map((node) => [node.id, { ...node.position }]))
}

/** 重新从 Dexie 读取坐标，验证是否真正落库。 */
async function persistedPositions(universeId: string): Promise<Record<string, NodePosition>> {
  const nodes = await services.graph.listNodes(universeId)
  return Object.fromEntries(nodes.map((node) => [node.id, { ...node.position }]))
}

function edgeSignature(store: GraphStore) {
  return store.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    relationType: edge.relationType,
    label: edge.label,
    properties: edge.properties,
  }))
}

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('graph store 自动布局', () => {
  it.each(['force', 'layered', 'clustered'] as const)(
    '%s 模式只改坐标：名称、描述、属性、类型与关系都不变，并落库',
    async (mode) => {
      const { universe, store } = await seedWorld()
      const originalNodes = stableNodes(store.nodes)
      const originalEdges = edgeSignature(store)
      const originalPositions = positions(store)

      await store.applyLayout(mode)

      expect(stableNodes(store.nodes)).toEqual(originalNodes)
      expect(edgeSignature(store)).toEqual(originalEdges)

      const current = positions(store)
      expect(Object.keys(current).sort()).toEqual(Object.keys(originalPositions).sort())
      expect(current).not.toEqual(originalPositions)
      for (const position of Object.values(current)) {
        expect(Number.isInteger(position.x)).toBe(true)
        expect(Number.isInteger(position.y)).toBe(true)
      }
      expect(await persistedPositions(universe.id)).toEqual(current)
      expect(store.canRestoreLayout).toBe(true)
    },
  )

  it('restoreLayout 把内存与数据库都恢复到布局前的坐标，并清空快照', async () => {
    const { universe, store } = await seedWorld()
    const original = positions(store)

    await store.applyLayout('force')
    expect(positions(store)).not.toEqual(original)

    await store.restoreLayout()

    expect(positions(store)).toEqual(original)
    expect(await persistedPositions(universe.id)).toEqual(original)
    expect(store.canRestoreLayout).toBe(false)
  })

  it('连续布局不覆盖首次快照：力导向后再层级，恢复仍回到最初坐标', async () => {
    const { universe, store } = await seedWorld()
    const original = positions(store)

    await store.applyLayout('force')
    const firstLayout = positions(store)
    await store.applyLayout('layered')
    const secondLayout = positions(store)
    expect(secondLayout).not.toEqual(firstLayout)
    expect(secondLayout).not.toEqual(original)
    expect(store.canRestoreLayout).toBe(true)

    await store.restoreLayout()

    expect(positions(store)).toEqual(original)
    expect(await persistedPositions(universe.id)).toEqual(original)
    expect(store.canRestoreLayout).toBe(false)
  })

  it('布局后手动移动节点会清除快照，restoreLayout 变成空操作', async () => {
    const { universe, store } = await seedWorld()
    await store.applyLayout('force')
    const target = store.nodes[0]

    await store.moveNode(target.id, { x: 11, y: 22 })

    expect(store.canRestoreLayout).toBe(false)
    await expect(store.restoreLayout()).resolves.toBeUndefined()
    expect(positions(store)[target.id]).toEqual({ x: 11, y: 22 })

    await store.flush()
    expect((await persistedPositions(universe.id))[target.id]).toEqual({ x: 11, y: 22 })
  })

  it('恢复时跳过已删除节点，保留快照之后新建节点的位置', async () => {
    const { universe, store } = await seedWorld()
    const original = positions(store)
    await store.applyLayout('force')

    const removed = store.nodes[0]
    await store.deleteNode(removed.id)
    const added = await store.createNode({
      name: '布局后新增',
      type: 'concept',
      position: { x: 901, y: 902 },
    })

    await expect(store.restoreLayout()).resolves.toBeUndefined()

    const restored = positions(store)
    expect(restored[removed.id]).toBeUndefined()
    expect(restored[added.id]).toEqual({ x: 901, y: 902 })
    for (const node of store.nodes) {
      if (node.id !== added.id) {
        expect(restored[node.id]).toEqual(original[node.id])
      }
    }

    const persisted = await persistedPositions(universe.id)
    expect(persisted[removed.id]).toBeUndefined()
    expect(persisted[added.id]).toEqual({ x: 901, y: 902 })
    expect(store.canRestoreLayout).toBe(false)
  })

  it('切换世界后快照失效，restoreLayout 变成空操作', async () => {
    const { store } = await seedWorld()
    await store.applyLayout('force')
    expect(store.canRestoreLayout).toBe(true)

    const other = await services.universes.create({ name: '另一个世界' })
    await store.load(other.id)

    expect(store.canRestoreLayout).toBe(false)
    await expect(store.restoreLayout()).resolves.toBeUndefined()
  })

  it('落库只走一次批量接口，不触发逐节点自动保存', async () => {
    const { universe, store } = await seedWorld()
    const batch = vi.spyOn(services.graph, 'updateNodePositions')
    const updateNode = vi.spyOn(services.graph, 'updateNode')
    const moveNode = vi.spyOn(services.graph, 'moveNode')
    const schedule = vi.spyOn(services.autosave, 'schedule')

    await store.applyLayout('force')

    expect(batch).toHaveBeenCalledTimes(1)
    expect(batch.mock.calls[0][0]).toBe(universe.id)
    expect(batch.mock.calls[0][1]).toEqual(positions(store))
    expect(updateNode).not.toHaveBeenCalled()
    expect(moveNode).not.toHaveBeenCalled()
    expect(schedule).not.toHaveBeenCalled()
  })

  it('落库失败时回滚内存坐标并抛出，数据库保持原样', async () => {
    const { universe, store } = await seedWorld()
    const original = positions(store)
    const failure = new Error('磁盘写入失败')
    vi.spyOn(services.graph, 'updateNodePositions').mockRejectedValueOnce(failure)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(store.applyLayout('force')).rejects.toBe(failure)

    expect(positions(store)).toEqual(original)
    expect(store.canRestoreLayout).toBe(false)
    expect(await persistedPositions(universe.id)).toEqual(original)
    expect(store.isLayouting).toBe(false)
  })

  it('isLayouting 防止重复触发：并发的第二次调用直接返回', async () => {
    const { store } = await seedWorld()
    const compute = vi.spyOn(layoutService, 'computeLayout')

    const first = store.applyLayout('force')
    expect(store.isLayouting).toBe(true)
    const second = store.applyLayout('layered')
    await Promise.all([first, second])

    expect(compute).toHaveBeenCalledTimes(1)
    expect(store.isLayouting).toBe(false)
  })

  it('布局前先写完拖拽产生的挂起保存，旧坐标不会晚到覆盖布局', async () => {
    const { universe, store } = await seedWorld(2)
    const target = store.nodes[0]
    await store.moveNode(target.id, { x: 777, y: 888 })

    // 400ms 防抖还没到，布局必须先把它落库再写新坐标
    await store.applyLayout('force')
    const layouted = positions(store)
    expect(layouted[target.id]).not.toEqual({ x: 777, y: 888 })
    expect(await persistedPositions(universe.id)).toEqual(layouted)

    // 等过防抖窗口，确认没有旧坐标晚到
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(await persistedPositions(universe.id)).toEqual(layouted)

    // 快照记的是布局前的坐标，也就是刚拖到的位置
    await store.restoreLayout()
    expect(positions(store)[target.id]).toEqual({ x: 777, y: 888 })
  })

  it('空世界执行布局不报错也不产生快照', async () => {
    sequence += 1
    const universe = await services.universes.create({ name: `空世界-${sequence}` })
    const store = useGraphStore()
    await store.load(universe.id)

    await expect(store.applyLayout('force')).resolves.toBeUndefined()
    expect(store.canRestoreLayout).toBe(false)
    expect(store.isLayouting).toBe(false)
  })

  it('clustered 也只走一次批量接口，不触发逐节点自动保存', async () => {
    const { universe, store } = await seedWorld()
    const batch = vi.spyOn(services.graph, 'updateNodePositions')
    const updateNode = vi.spyOn(services.graph, 'updateNode')
    const schedule = vi.spyOn(services.autosave, 'schedule')

    await store.applyLayout('clustered')

    expect(batch).toHaveBeenCalledTimes(1)
    expect(batch.mock.calls[0][0]).toBe(universe.id)
    expect(updateNode).not.toHaveBeenCalled()
    expect(schedule).not.toHaveBeenCalled()
    expect(await persistedPositions(universe.id)).toEqual(positions(store))
  })

  it('clustered 把同类型节点聚成一簇：不同类型包围盒不重叠', async () => {
    const { store } = await seedWorld(6)
    await store.applyLayout('clustered')

    const bounds = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>()
    for (const node of store.nodes) {
      const next = {
        minX: node.position.x,
        minY: node.position.y,
        maxX: node.position.x + layoutService.DEFAULT_NODE_WIDTH,
        maxY: node.position.y + layoutService.DEFAULT_NODE_HEIGHT,
      }
      const current = bounds.get(node.type)
      if (!current) {
        bounds.set(node.type, next)
        continue
      }
      current.minX = Math.min(current.minX, next.minX)
      current.minY = Math.min(current.minY, next.minY)
      current.maxX = Math.max(current.maxX, next.maxX)
      current.maxY = Math.max(current.maxY, next.maxY)
    }

    expect([...bounds.keys()].sort()).toEqual(['character', 'location'])
    const [first, second] = [...bounds.values()]
    const disjoint =
      first.maxX <= second.minX ||
      second.maxX <= first.minX ||
      first.maxY <= second.minY ||
      second.maxY <= first.minY
    expect(disjoint).toBe(true)
  })

  it('clustered 恢复布局前坐标时，快照、关系与节点内容都不变', async () => {
    const { universe, store } = await seedWorld(6)
    const originalPositions = positions(store)
    const originalEdges = edgeSignature(store)

    await store.applyLayout('clustered')
    expect(positions(store)).not.toEqual(originalPositions)
    expect(edgeSignature(store)).toEqual(originalEdges)

    await store.restoreLayout()

    // 坐标回到聚集布局前（与 force/layered 共用同一份首快照）
    expect(positions(store)).toEqual(originalPositions)
    expect(await persistedPositions(universe.id)).toEqual(originalPositions)
    expect(store.canRestoreLayout).toBe(false)
    // 关系（包括跨类型关系）没有被布局改动或丢弃
    expect(edgeSignature(store)).toEqual(originalEdges)
  })
})
