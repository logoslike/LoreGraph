import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GraphSearchPanel from '@/components/graph/GraphSearchPanel.vue'
import type { LoreNode } from '@/models/node'
import type { EntityType } from '@/models/type-def'
import { useGraphStore } from '@/stores/graph'
import { useTypesStore } from '@/stores/types'
import { useUiStore } from '@/stores/ui'

function buildNode(id: string, name: string, type = 'character', description = ''): LoreNode {
  return {
    id,
    universeId: 'u1',
    type,
    name,
    description,
    properties: {},
    position: { x: 0, y: 0 },
    createdAt: 1,
    updatedAt: 1,
  }
}

function buildType(key: string, label: string, color: string): EntityType {
  return {
    id: `t-${key}`,
    universeId: 'u1',
    scope: 'node',
    key,
    label,
    color,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

function seed(nodes: LoreNode[]): void {
  const graph = useGraphStore()
  graph.universeId = 'u1'
  graph.nodes = nodes

  const types = useTypesStore()
  types.universeId = 'u1'
  types.nodeTypes = [
    buildType('character', '角色', '#6366f1'),
    buildType('location', '地点', '#10b981'),
  ]
}

const wrappers: VueWrapper[] = []

function mountPanel() {
  const wrapper = mount(GraphSearchPanel, { attachTo: document.body })
  wrappers.push(wrapper)
  return wrapper
}

function input(wrapper: VueWrapper) {
  return wrapper.get('[data-testid="graph-search-input"]')
}

function resultNames(wrapper: VueWrapper): string[] {
  return wrapper.findAll('[data-testid="graph-search-result"]').map((item) => item.text())
}

beforeEach(() => {
  setActivePinia(createPinia())
  for (const wrapper of wrappers.splice(0)) {
    wrapper.unmount()
  }
  localStorage.clear()
})

describe('GraphSearchPanel 节点查找', () => {
  it('打开后自动聚焦输入框，空查询时展示引导而不是结果', async () => {
    seed([buildNode('n1', '澜舟')])
    const wrapper = mountPanel()
    await wrapper.vm.$nextTick()

    expect(document.activeElement).toBe(input(wrapper).element)
    expect(wrapper.get('[data-testid="graph-search-hint"]').text()).toContain(
      '输入名称或描述查找节点',
    )
    expect(wrapper.findAll('[data-testid="graph-search-result"]')).toHaveLength(0)
  })

  it('输入名称后展示匹配结果与类型，并同步到共享搜索词', async () => {
    seed([buildNode('n1', '澜舟'), buildNode('n2', '沉钟湾', 'location'), buildNode('n3', '墨鸦')])
    const wrapper = mountPanel()
    const ui = useUiStore()

    await input(wrapper).setValue('澜')

    expect(ui.searchQuery).toBe('澜')
    expect(resultNames(wrapper)).toEqual(['澜舟角色'])
    expect(wrapper.get('[data-testid="graph-search-count"]').text()).toContain('1 个匹配')
    wrapper.unmount()
  })

  it('有结果时提供完整的 combobox/listbox/option 语义与有效活动项 ID', async () => {
    seed([buildNode('n1', '澜舟'), buildNode('n2', '澜心')])
    const wrapper = mountPanel()
    const field = input(wrapper)

    expect(field.attributes('role')).toBe('combobox')
    expect(field.attributes('aria-autocomplete')).toBe('list')
    expect(field.attributes('aria-haspopup')).toBe('listbox')

    await field.setValue('澜')

    expect(field.attributes('aria-expanded')).toBe('true')
    expect(field.attributes('aria-controls')).toBe('graph-search-results')
    expect(field.attributes('aria-activedescendant')).toBe('graph-search-option-0')

    const list = wrapper.get('[role="listbox"]')
    expect(list.attributes('id')).toBe('graph-search-results')
    expect(list.attributes('aria-label')).toBe('查找结果')

    const options = wrapper.findAll('[role="option"]')
    expect(options).toHaveLength(2)
    expect(options[0].attributes('id')).toBe('graph-search-option-0')
    expect(options[1].attributes('id')).toBe('graph-search-option-1')
    expect(options[0].attributes('aria-selected')).toBe('true')
    expect(options[1].attributes('aria-selected')).toBe('false')
    expect(options[0].attributes('data-active')).toBe('true')
    wrapper.unmount()
  })

  it('上下键移动后 aria-activedescendant 指向新的活动 option', async () => {
    seed([buildNode('n1', '澜舟'), buildNode('n2', '澜心')])
    const wrapper = mountPanel()

    await input(wrapper).setValue('澜')
    await input(wrapper).trigger('keydown', { key: 'ArrowDown' })

    expect(input(wrapper).attributes('aria-activedescendant')).toBe('graph-search-option-1')
    const options = wrapper.findAll('[role="option"]')
    expect(options[0].attributes('aria-selected')).toBe('false')
    expect(options[1].attributes('aria-selected')).toBe('true')
    expect(options[1].attributes('data-active')).toBe('true')
    wrapper.unmount()
  })

  it('无结果与空查询时 listbox 不存在，combobox 不指向任何 option', async () => {
    seed([buildNode('n1', '澜舟')])
    const wrapper = mountPanel()

    expect(input(wrapper).attributes('aria-expanded')).toBe('false')
    expect(input(wrapper).attributes('aria-controls')).toBeUndefined()
    expect(input(wrapper).attributes('aria-activedescendant')).toBeUndefined()

    await input(wrapper).setValue('不存在')

    expect(input(wrapper).attributes('aria-expanded')).toBe('false')
    expect(input(wrapper).attributes('aria-controls')).toBeUndefined()
    expect(input(wrapper).attributes('aria-activedescendant')).toBeUndefined()
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)

    await wrapper.get('[data-testid="graph-search-clear"]').trigger('click')

    expect(input(wrapper).attributes('aria-expanded')).toBe('false')
    expect(input(wrapper).attributes('aria-activedescendant')).toBeUndefined()
    wrapper.unmount()
  })

  it('名称未命中但描述命中时仍展示结果，与画布高亮语义一致', async () => {
    seed([buildNode('n1', '澜舟', 'character', '潮汐教团的引路人。'), buildNode('n2', '墨鸦')])
    const wrapper = mountPanel()

    await input(wrapper).setValue('潮汐')

    expect(resultNames(wrapper)).toEqual(['澜舟角色'])
    expect(wrapper.get('[data-testid="graph-search-count"]').text()).toContain('1 个匹配')
    wrapper.unmount()
  })

  it('侧栏先输入搜索词时，打开面板直接展示同一批结果', async () => {
    seed([buildNode('n1', '澜舟'), buildNode('n2', '墨鸦')])
    const ui = useUiStore()
    ui.setSearch('墨')

    const wrapper = mountPanel()
    await wrapper.vm.$nextTick()

    expect((input(wrapper).element as HTMLInputElement).value).toBe('墨')
    expect(resultNames(wrapper)).toEqual(['墨鸦角色'])
    wrapper.unmount()
  })

  it('点击结果发出 locate 事件，不关闭面板', async () => {
    seed([buildNode('n1', '澜舟'), buildNode('n2', '墨鸦')])
    const wrapper = mountPanel()

    await input(wrapper).setValue('墨')
    await wrapper.get('[data-testid="graph-search-result"]').trigger('click')

    expect(wrapper.emitted('locate')).toEqual([['n2']])
    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })

  it('聚焦按钮发出 focus 事件，与纯定位区分', async () => {
    seed([buildNode('n1', '澜舟')])
    const wrapper = mountPanel()

    await input(wrapper).setValue('澜')
    await wrapper.get('[data-testid="graph-search-focus-btn"]').trigger('click')

    expect(wrapper.emitted('focus')).toEqual([['n1']])
    expect(wrapper.emitted('locate')).toBeUndefined()
    wrapper.unmount()
  })

  it('option 自身是单一可访问控件：内部无交互后代，Focus 按钮在 listbox 外且可 Tab', async () => {
    seed([buildNode('n1', '澜舟'), buildNode('n2', '澜心')])
    const wrapper = mountPanel()

    await input(wrapper).setValue('澜')

    const options = wrapper.findAll('[role="option"]')
    expect(options).toHaveLength(2)
    for (const option of options) {
      // option 内部不能再嵌套 button/link/input 或可聚焦节点
      const interactive = Array.from(
        option.element.querySelectorAll('button, a, input, select, textarea, [tabindex]'),
      )
      expect(interactive).toHaveLength(0)
    }
    expect(
      Array.from(
        wrapper
          .get('[role="listbox"]')
          .element.querySelectorAll('button, a, input, select, textarea, [tabindex]'),
      ),
    ).toHaveLength(0)

    const focusButton = wrapper.get('[data-testid="graph-search-focus-btn"]')
    const focusElement = focusButton.element as HTMLElement
    expect(focusElement.closest('[role="listbox"]')).toBeNull()
    expect(focusButton.attributes('aria-label')).toBe('聚焦「澜舟」')
    expect(focusElement.tabIndex).toBe(0)
    focusElement.focus()
    expect(document.activeElement).toBe(focusElement)

    await input(wrapper).trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.get('[data-testid="graph-search-focus-btn"]').attributes('aria-label')).toBe(
      '聚焦「澜心」',
    )
    wrapper.unmount()
  })

  it('无结果时展示空状态，清空后回到引导并可继续输入', async () => {
    seed([buildNode('n1', '澜舟')])
    const wrapper = mountPanel()
    const ui = useUiStore()

    await input(wrapper).setValue('不存在')
    expect(wrapper.get('[data-testid="graph-search-empty"]').text()).toContain('没有匹配的节点')

    await wrapper.get('[data-testid="graph-search-clear"]').trigger('click')

    expect(ui.searchQuery).toBe('')
    expect(wrapper.find('[data-testid="graph-search-empty"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="graph-search-hint"]').text()).toContain(
      '输入名称或描述查找节点',
    )
    await wrapper.vm.$nextTick()
    expect(document.activeElement).toBe(input(wrapper).element)
    wrapper.unmount()
  })

  it('空世界与无匹配结果使用不同的状态文案', async () => {
    seed([])
    const wrapper = mountPanel()

    await input(wrapper).setValue('澜')

    expect(wrapper.get('[data-testid="graph-search-empty-world"]').text()).toContain('还没有节点')
    expect(wrapper.find('[data-testid="graph-search-empty"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('上下键循环移动高亮，Enter 定位当前结果', async () => {
    seed([buildNode('n1', '澜舟'), buildNode('n2', '澜心')])
    const wrapper = mountPanel()

    await input(wrapper).setValue('澜')
    expect(resultNames(wrapper)).toEqual(['澜舟角色', '澜心角色'])

    await input(wrapper).trigger('keydown', { key: 'ArrowDown' })
    await input(wrapper).trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('locate')).toEqual([['n2']])
    wrapper.unmount()
  })

  it('Esc 关闭面板并阻止事件冒泡到全局快捷键', async () => {
    seed([buildNode('n1', '澜舟')])
    const wrapper = mountPanel()
    const onWindowKeydown = vi.fn()
    window.addEventListener('keydown', onWindowKeydown)

    await input(wrapper).trigger('keydown', { key: 'Escape' })

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(onWindowKeydown).not.toHaveBeenCalled()
    window.removeEventListener('keydown', onWindowKeydown)
    wrapper.unmount()
  })

  it('关闭按钮只发出 close，不主动清空搜索词', async () => {
    seed([buildNode('n1', '澜舟')])
    const wrapper = mountPanel()
    const ui = useUiStore()

    await input(wrapper).setValue('澜')
    await wrapper.get('[data-testid="graph-search-close"]').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(ui.searchQuery).toBe('澜')
    wrapper.unmount()
  })
})
