import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { LoreNode, NodePosition } from '@/models/node'
import { services } from '@/services'
import { useGraphStore } from '@/stores/graph'

type GraphStore = ReturnType<typeof useGraphStore>

let sequence = 0

/** 造一个带若干节点的小世界，节点坐标互不相同。 */
async function seedWorld(nodeCount = 2) {
  sequence += 1
  const universe = await services.universes.create({ name: `拖动撤销世界-${sequence}` })
  const nodes: LoreNode[] = []
  for (let index = 0; index < nodeCount; index += 1) {
    nodes.push(
      await services.graph.createNode({
        universeId: universe.id,
        type: index % 2 === 0 ? 'character' : 'location',
        name: `节点${index}`,
        description: `描述${index}`,
        properties: { order: index },
        position: { x: index * 120, y: index * 60 },
      }),
    )
  }
  const store = useGraphStore()
  await store.load(universe.id)
  return { universe, nodes, store }
}

/** 内存坐标。 */
function positions(store: GraphStore): Record<string, NodePosition> {
  return Object.fromEntries(store.nodes.map((node) => [node.id, { ...node.position }]))
}

/** 重新读取数据库里的坐标，验证撤销是否真正落库。 */
async function persistedPositions(universeId: string): Promise<Record<string, NodePosition>> {
  const nodes = await services.graph.listNodes(universeId)
  return Object.fromEntries(nodes.map((node) => [node.id, { ...node.position }]))
}

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(async () => {
  // 防抖保存是模块级单例：用例结束前落盘，避免定时器跨用例写入已删除或已切换的数据。
  await useGraphStore().flush()
})

describe('graph store 拖动撤销', () => {
  it('撤销把节点坐标恢复到拖动前，并在防抖后落库', async () => {
    const { universe, store } = await seedWorld()
    const target = store.nodes[0]
    const original = { ...target.position }

    await store.moveNode(target.id, { x: 777, y: 888 })
    expect(positions(store)[target.id]).toEqual({ x: 777, y: 888 })

    await expect(store.undoMove()).resolves.toBe(true)
    expect(positions(store)[target.id]).toEqual(original)

    await store.flush()
    expect((await persistedPositions(universe.id))[target.id]).toEqual(original)
  })

  it('多步拖动按后进先出逐次撤销，撤销本身不再入栈', async () => {
    const { store } = await seedWorld()
    const target = store.nodes[0]
    const original = { ...target.position }

    await store.moveNode(target.id, { x: 200, y: 200 })
    await store.moveNode(target.id, { x: 300, y: 300 })
    await store.moveNode(target.id, { x: 400, y: 400 })

    await expect(store.undoMove()).resolves.toBe(true)
    expect(positions(store)[target.id]).toEqual({ x: 300, y: 300 })
    await expect(store.undoMove()).resolves.toBe(true)
    expect(positions(store)[target.id]).toEqual({ x: 200, y: 200 })
    await expect(store.undoMove()).resolves.toBe(true)
    expect(positions(store)[target.id]).toEqual(original)
    await expect(store.undoMove()).resolves.toBe(false)
  })

  it('落点与当前坐标相同不算一步，Ctrl+Z 不空转', async () => {
    const { store } = await seedWorld()
    const target = store.nodes[0]

    await store.moveNode(target.id, { ...target.position })

    await expect(store.undoMove()).resolves.toBe(false)
  })

  it('撤销栈上限 50 步，最早的一步被丢弃', async () => {
    const { store } = await seedWorld()
    const target = store.nodes[0]
    const original = { ...target.position }

    for (let step = 1; step <= 55; step += 1) {
      await store.moveNode(target.id, { x: 1000 + step, y: 1000 + step })
    }

    for (let step = 0; step < 50; step += 1) {
      await expect(store.undoMove()).resolves.toBe(true)
    }
    // 50 条记录撤销完后回到第 5 次拖动的起点，最初坐标已不在栈里
    expect(positions(store)[target.id]).toEqual({ x: 1005, y: 1005 })
    await expect(store.undoMove()).resolves.toBe(false)
    expect(positions(store)[target.id]).not.toEqual(original)
  })

  it('已删除节点的记录被跳过，继续撤销更早的拖动', async () => {
    const { store } = await seedWorld(2)
    const [first, second] = store.nodes
    const firstOriginal = { ...first.position }

    await store.moveNode(first.id, { x: 500, y: 500 })
    await store.moveNode(second.id, { x: 600, y: 600 })
    // 删除前先落盘：该节点已排队的防抖保存不能在删除之后触发「节点不存在」。
    await store.flush()
    await store.deleteNode(second.id)

    await expect(store.undoMove()).resolves.toBe(true)
    expect(positions(store)[first.id]).toEqual(firstOriginal)
  })

  it('自动布局成功后清空撤销记录', async () => {
    const { store } = await seedWorld()
    const target = store.nodes[0]

    await store.moveNode(target.id, { x: 888, y: 999 })
    await store.applyLayout('force')

    await expect(store.undoMove()).resolves.toBe(false)
  })

  it('切换世界（load）与 reset 都会清空撤销记录', async () => {
    const { universe, store } = await seedWorld()
    await store.moveNode(store.nodes[0].id, { x: 321, y: 654 })

    await store.load(universe.id)
    await expect(store.undoMove()).resolves.toBe(false)

    await store.moveNode(store.nodes[0].id, { x: 432, y: 765 })
    expect(store.moveHistory).toHaveLength(1)
    await store.flush()
    store.reset()
    expect(store.moveHistory).toHaveLength(0)
    await expect(store.undoMove()).resolves.toBe(false)
  })

  it('布局进行中不接受撤销，避免覆盖进行中的坐标写入', async () => {
    const { store } = await seedWorld()
    await store.moveNode(store.nodes[0].id, { x: 111, y: 222 })

    store.isLayouting = true
    await expect(store.undoMove()).resolves.toBe(false)
  })
})
