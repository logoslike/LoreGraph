import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { services } from '@/services'
import { useGraphStore } from '@/stores/graph'
import { useUiStore } from '@/stores/ui'

let sequence = 0

/** 造一个两节点一关系的世界并加载进 store。 */
async function seedWorld() {
  sequence += 1
  const universe = await services.universes.create({ name: `聚焦世界-${sequence}` })
  const first = await services.graph.createNode({
    universeId: universe.id,
    type: 'character',
    name: '澜舟',
    position: { x: 0, y: 0 },
  })
  const second = await services.graph.createNode({
    universeId: universe.id,
    type: 'location',
    name: '沉钟湾',
    position: { x: 200, y: 0 },
  })
  await services.graph.createEdge({
    universeId: universe.id,
    source: first.id,
    target: second.id,
    relationType: 'related-to',
  })
  const store = useGraphStore()
  await store.load(universe.id)
  return { universe, first, second, store }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('ui store 聚焦模式', () => {
  it('进入聚焦记录中心节点，退出后清空', async () => {
    const { first } = await seedWorld()
    const ui = useUiStore()

    ui.enterFocus(first.id)
    expect(ui.focusNodeId).toBe(first.id)

    ui.exitFocus()
    expect(ui.focusNodeId).toBeNull()
  })

  it('聚焦中心与选中状态分离：改选其他节点或取消选中都不影响', async () => {
    const { first, second, store } = await seedWorld()
    const ui = useUiStore()
    ui.enterFocus(first.id)

    store.selectNode(second.id)
    expect(ui.focusNodeId).toBe(first.id)

    store.selectNode(null)
    expect(ui.focusNodeId).toBe(first.id)

    // 选中边同样不影响聚焦
    store.selectEdge(store.edges[0].id)
    expect(ui.focusNodeId).toBe(first.id)
  })

  it('切换世界后清除聚焦', async () => {
    const { first, store } = await seedWorld()
    const ui = useUiStore()
    ui.enterFocus(first.id)

    const other = await services.universes.create({ name: '另一个世界' })
    await store.load(other.id)

    expect(ui.focusNodeId).toBeNull()
  })

  it('删除聚焦中心后自动退出聚焦', async () => {
    const { first, store } = await seedWorld()
    const ui = useUiStore()
    ui.enterFocus(first.id)

    await store.deleteNode(first.id)

    expect(ui.focusNodeId).toBeNull()
  })

  it('删除其他节点不影响聚焦中心', async () => {
    const { first, second, store } = await seedWorld()
    const ui = useUiStore()
    ui.enterFocus(first.id)

    await store.deleteNode(second.id)

    expect(ui.focusNodeId).toBe(first.id)
  })

  it('reset 清空图谱状态时同时清除聚焦', async () => {
    const { first, store } = await seedWorld()
    const ui = useUiStore()
    ui.enterFocus(first.id)

    store.reset()

    expect(ui.focusNodeId).toBeNull()
  })
})
