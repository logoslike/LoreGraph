import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import PropertyRows from '@/components/editor/PropertyRows.vue'
import Inspector from '@/components/layout/Inspector.vue'
import type { LoreEdge } from '@/models/edge'
import type { LoreNode } from '@/models/node'
import type { PropertyValue } from '@/services/types'
import { useGraphStore } from '@/stores/graph'

const now = 1_700_000_000_000

function buildNode(
  id: string,
  name: string,
  properties: Record<string, PropertyValue> = {},
): LoreNode {
  return {
    id,
    universeId: 'universe-1',
    type: 'character',
    name,
    description: '',
    properties,
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

function inputValue(wrapper: VueWrapper, selector: string, index = 0): string {
  return (wrapper.findAll(selector)[index].element as HTMLInputElement).value
}

describe('检查器分区折叠', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('自定义属性默认收起，展开后可编辑、添加，收起再展开保留输入', async () => {
    const wrapper = mount(PropertyRows, { props: { modelValue: { 纪元: '第三纪' } } })
    const toggle = wrapper.get('[data-testid="toggle-properties"]')

    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(toggle.attributes('aria-label')).toBe('展开自定义属性')
    expect(wrapper.find('[data-testid="property-content"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="add-property-btn"]').exists()).toBe(false)

    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(toggle.attributes('aria-label')).toBe('收起自定义属性')
    expect(inputValue(wrapper, '[data-testid="property-key-input"]')).toBe('纪元')
    expect(inputValue(wrapper, '[data-testid="property-value-input"]')).toBe('第三纪')

    await wrapper.get('[data-testid="property-key-input"]').setValue('纪元改')
    await wrapper.get('[data-testid="add-property-btn"]').trigger('click')
    expect(wrapper.findAll('[data-testid="property-row"]')).toHaveLength(2)

    await toggle.trigger('click')
    expect(wrapper.find('[data-testid="property-content"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="add-property-btn"]').exists()).toBe(false)

    await toggle.trigger('click')
    expect(wrapper.findAll('[data-testid="property-row"]')).toHaveLength(2)
    expect(inputValue(wrapper, '[data-testid="property-key-input"]')).toBe('纪元改')
    expect(inputValue(wrapper, '[data-testid="property-value-input"]')).toBe('第三纪')
  })

  it('所属关系默认展开，收起只隐藏列表，展开后选边入口恢复', async () => {
    const graph = useGraphStore()
    graph.universeId = 'universe-1'
    graph.nodes = [buildNode('node-a', '澜舟', { 纪元: '第三纪' }), buildNode('node-b', '沉钟湾')]
    graph.edges = [buildEdge('node-a', 'node-b')]
    graph.selectNode('node-a')

    const wrapper = mount(Inspector)
    const propertiesToggle = wrapper.get('[data-testid="toggle-properties"]')
    const relationsToggle = wrapper.get('[data-testid="toggle-incident-relations"]')

    expect(propertiesToggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[data-testid="property-row"]').exists()).toBe(false)

    expect(relationsToggle.attributes('aria-expanded')).toBe('true')
    expect(relationsToggle.attributes('aria-label')).toBe('收起所属关系')
    expect(relationsToggle.text()).toContain('所属关系（1）')
    expect(wrapper.findAll('[data-testid="incident-edge-row"]')).toHaveLength(1)

    await relationsToggle.trigger('click')
    expect(relationsToggle.attributes('aria-expanded')).toBe('false')
    expect(relationsToggle.attributes('aria-label')).toBe('展开所属关系')
    expect(wrapper.find('[data-testid="incident-edge-row"]').exists()).toBe(false)
    expect(relationsToggle.text()).toContain('所属关系（1）')

    await relationsToggle.trigger('click')
    expect(wrapper.findAll('[data-testid="incident-edge-row"]')).toHaveLength(1)

    await propertiesToggle.trigger('click')
    expect(wrapper.findAll('[data-testid="property-row"]')).toHaveLength(1)
    expect(wrapper.find('[data-testid="add-property-btn"]').exists()).toBe(true)
  })
})
