import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import Inspector from '@/components/layout/Inspector.vue'
import type { LoreEdge } from '@/models/edge'
import type { LoreNode } from '@/models/node'
import { useGraphStore } from '@/stores/graph'

const now = 1_700_000_000_000

function buildNode(id: string, name: string): LoreNode {
  return {
    id,
    universeId: 'universe-1',
    type: 'character',
    name,
    description: '',
    properties: {},
    position: { x: 0, y: 0 },
    createdAt: now,
    updatedAt: now,
  }
}

function buildEdge(source: string, target: string): LoreEdge {
  return {
    id: 'edge-1',
    universeId: 'universe-1',
    source,
    target,
    relationType: 'related-to',
    properties: {},
    createdAt: now,
    updatedAt: now,
  }
}

function seedStore() {
  const graph = useGraphStore()
  graph.universeId = 'universe-1'
  graph.nodes = [buildNode('node-a', '澜舟'), buildNode('node-b', '沉钟湾')]
  graph.edges = [buildEdge('node-a', 'node-b')]
  graph.selectNode('node-a')
  return graph
}

describe('检查器从节点进入关系详情后的返回', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('从所属关系进入关系详情后展示箭头返回按钮，点击回到来源节点', async () => {
    const graph = seedStore()
    const wrapper = mount(Inspector)
    expect(wrapper.find('[data-testid="node-editor"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="inspector-back-to-node"]').exists()).toBe(false)

    await wrapper.get('[data-testid="incident-edge-row"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="edge-editor"]').exists()).toBe(true)

    const back = wrapper.get('[data-testid="inspector-back-to-node"]')
    expect(back.attributes('title')).toBe('返回节点检查器')
    expect(back.attributes('aria-label')).toBe('返回节点检查器')

    await back.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="node-editor"]').exists()).toBe(true)
    expect(graph.selectedNodeId).toBe('node-a')
    expect(wrapper.find('[data-testid="inspector-back-to-node"]').exists()).toBe(false)
  })

  it('直接选边不记录来源，不出现返回按钮', async () => {
    const graph = seedStore()
    const wrapper = mount(Inspector)

    graph.selectEdge('edge-1')
    await flushPromises()

    expect(wrapper.find('[data-testid="edge-editor"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="inspector-back-to-node"]').exists()).toBe(false)
  })

  it('先经节点进入详情，再直接选边时不会错误回到不相关节点', async () => {
    const graph = seedStore()
    const wrapper = mount(Inspector)

    await wrapper.get('[data-testid="incident-edge-row"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="inspector-back-to-node"]').exists()).toBe(true)

    graph.selectNode('node-b')
    graph.selectEdge('edge-1')
    await flushPromises()

    expect(wrapper.find('[data-testid="inspector-back-to-node"]').exists()).toBe(false)
  })
})
