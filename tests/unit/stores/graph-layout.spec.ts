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
  it.each(['force', 'layered'] as const)(
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

  it('快照只保留一级：再次布局会覆盖上一次的快照', async () => {
    const { store } = await seedWorld()
    const original = positions(store)

    await store.applyLayout('force')
    const firstLayout = positions(store)
    await store.applyLayout('layered')
    const secondLayout = positions(store)
    expect(secondLayout).not.toEqual(firstLayout)

    await store.restoreLayout()

    expect(positions(store)).toEqual(firstLayout)
    expect(positions(store)).not.toEqual(original)
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
})
