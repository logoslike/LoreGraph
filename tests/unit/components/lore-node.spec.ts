import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import LoreNode from '@/components/graph/LoreNode.vue'
import type { LoreNodeData } from '@/components/graph/types'

vi.mock('@vue-flow/core', () => ({
  Handle: {
    name: 'Handle',
    props: ['id', 'type', 'position', 'connectable'],
    template:
      '<span class="vue-flow__handle" :data-handle-id="id" :data-handle-type="type" :data-position="position" :data-connectable="String(connectable)" />',
  },
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}))

function buildData(overrides: Partial<LoreNodeData> = {}): LoreNodeData {
  return {
    name: '澜舟',
    typeLabel: '角色',
    color: '#6366f1',
    isSelected: false,
    isNeighbor: false,
    isMatch: false,
    isDimmed: false,
    isCollapsed: false,
    hiddenCount: 0,
    hasChildren: true,
    onToggleCollapse: vi.fn(),
    relationsMode: false,
    isExpanded: false,
    relationCount: 0,
    onToggleRelations: vi.fn(),
    ...overrides,
  }
}

/** NodeProps 的大多数字段与渲染无关；补齐必填项以免 Vue 输出缺失 prop 警告。 */
function mountNode(data: LoreNodeData) {
  return mount(LoreNode, {
    // keydown 需要真正挂到 document 上才能冒泡到 window
    attachTo: document.body,
    props: {
      id: 'node-a',
      type: 'loreNode',
      selected: false,
      connectable: true,
      position: { x: 0, y: 0 },
      dimensions: { width: 210, height: 52 },
      dragging: false,
      resizing: false,
      zIndex: 0,
      data,
      events: {},
    } as never,
  })
}

describe('LoreNode 折叠/展开交互', () => {
  it('有出边的节点渲染折叠按钮，展开态 aria-expanded 为 true', () => {
    const wrapper = mountNode(buildData())
    const toggle = wrapper.get('[data-testid="node-collapse-toggle"]')

    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(toggle.attributes('aria-label')).toBe('收起「澜舟」的下级节点')
    expect(wrapper.get('[data-testid="lore-node"]').attributes('data-collapsed')).toBe('false')
    expect(wrapper.get('[data-testid="lore-node"]').classes()).toContain('has-toggle')
    wrapper.unmount()
  })

  it('点击折叠按钮只触发回调，不改变节点选中状态', async () => {
    const onToggleCollapse = vi.fn()
    const wrapper = mountNode(buildData({ onToggleCollapse }))

    await wrapper.get('[data-testid="node-collapse-toggle"]').trigger('click')

    expect(onToggleCollapse).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="lore-node"]').attributes('data-selected')).toBe('false')
    wrapper.unmount()
  })

  it('收起态显示隐藏数量、aria-expanded=false，并保留节点名称与类型', () => {
    const wrapper = mountNode(buildData({ isCollapsed: true, hiddenCount: 3 }))
    const node = wrapper.get('[data-testid="lore-node"]')
    const toggle = wrapper.get('[data-testid="node-collapse-toggle"]')

    expect(node.attributes('data-collapsed')).toBe('true')
    expect(node.classes()).toContain('is-collapsed')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(toggle.attributes('aria-label')).toBe('展开「澜舟」的下级节点')
    expect(toggle.attributes('title')).toContain('3')
    expect(toggle.text()).toContain('3')
    expect(node.text()).toContain('澜舟')
    expect(node.text()).toContain('角色')
    wrapper.unmount()
  })

  it('没有出边的叶节点不渲染折叠按钮', () => {
    const wrapper = mountNode(buildData({ hasChildren: false }))

    expect(wrapper.find('[data-testid="node-collapse-toggle"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="lore-node"]').classes()).not.toContain('has-toggle')
    wrapper.unmount()
  })

  it('折叠按钮不再拦截 keydown，window 快捷键仍能收到事件', async () => {
    const onWindowKeydown = vi.fn()
    window.addEventListener('keydown', onWindowKeydown)
    const wrapper = mountNode(buildData())

    await wrapper.get('[data-testid="node-collapse-toggle"]').trigger('keydown', { key: 'n' })

    expect(onWindowKeydown).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', onWindowKeydown)
    wrapper.unmount()
  })

  it('重复点击折叠按钮不会在组件内部切换状态，状态由 GraphCanvas 单向驱动', async () => {
    const onToggleCollapse = vi.fn()
    const wrapper = mountNode(buildData({ isCollapsed: true, hiddenCount: 1, onToggleCollapse }))
    const toggle = wrapper.get('[data-testid="node-collapse-toggle"]')

    await toggle.trigger('click')
    await toggle.trigger('click')

    expect(onToggleCollapse).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-testid="lore-node"]').attributes('data-collapsed')).toBe('true')
    wrapper.unmount()
  })
})

describe('LoreNode 大图关系展开 chevron', () => {
  it('大图模式渲染关系按钮：展开态 aria-expanded=true、无徽标', () => {
    const wrapper = mountNode(
      buildData({ relationsMode: true, isExpanded: true, relationCount: 4 }),
    )
    const node = wrapper.get('[data-testid="lore-node"]')
    const toggle = wrapper.get('[data-testid="node-relations-toggle"]')

    expect(node.attributes('data-relations-mode')).toBe('true')
    expect(node.attributes('data-relations-expanded')).toBe('true')
    expect(node.classes()).toContain('is-expanded')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(toggle.attributes('aria-label')).toBe('收起「澜舟」的关系')
    expect(toggle.text()).toBe('')
    // 关系模式下不渲染旧的「折叠下级节点」按钮
    expect(wrapper.find('[data-testid="node-collapse-toggle"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('收起态显示直接关系数徽标与展开动作标签', () => {
    const wrapper = mountNode(buildData({ relationsMode: true, relationCount: 7 }))
    const toggle = wrapper.get('[data-testid="node-relations-toggle"]')

    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(toggle.attributes('aria-label')).toBe('展开「澜舟」的关系')
    expect(toggle.attributes('title')).toContain('7')
    expect(toggle.text()).toContain('7')
    expect(wrapper.get('[data-testid="lore-node"]').attributes('data-relations-expanded')).toBe(
      'false',
    )
    wrapper.unmount()
  })

  it('点击关系按钮只触发 onToggleRelations，不触发折叠回调、不改变选中态', async () => {
    const onToggleRelations = vi.fn()
    const onToggleCollapse = vi.fn()
    const wrapper = mountNode(
      buildData({ relationsMode: true, relationCount: 2, onToggleRelations, onToggleCollapse }),
    )

    await wrapper.get('[data-testid="node-relations-toggle"]').trigger('click')

    expect(onToggleRelations).toHaveBeenCalledTimes(1)
    expect(onToggleCollapse).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="lore-node"]').attributes('data-selected')).toBe('false')
    wrapper.unmount()
  })

  it('大图里没有直接关系的节点不渲染任何 chevron', () => {
    const wrapper = mountNode(buildData({ relationsMode: true, relationCount: 0 }))

    expect(wrapper.find('[data-testid="node-relations-toggle"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="node-collapse-toggle"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('关系按钮是原生 button，可用 Enter/Space 触发', () => {
    const wrapper = mountNode(buildData({ relationsMode: true, relationCount: 1 }))
    const toggle = wrapper.get('[data-testid="node-relations-toggle"]')
    const element = toggle.element as HTMLButtonElement

    expect(element.tagName).toBe('BUTTON')
    expect(element.type).toBe('button')
    expect(element.disabled).toBe(false)
    expect(element.tabIndex).not.toBe(-1)
    wrapper.unmount()
  })

  it('小图模式仍渲染旧的折叠按钮，不受关系字段影响', () => {
    const wrapper = mountNode(buildData({ relationsMode: false, relationCount: 5 }))

    expect(wrapper.find('[data-testid="node-collapse-toggle"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="node-relations-toggle"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('LoreNode 端口', () => {
  it('保留 right/left 可连接端口，并补 6 个不可交互显示端口', () => {
    const wrapper = mountNode(buildData())
    const handles = wrapper.findAll('.vue-flow__handle')
    const summary = handles.map((handle) => ({
      id: handle.attributes('data-handle-id'),
      type: handle.attributes('data-handle-type'),
      position: handle.attributes('data-position'),
      connectable: handle.attributes('data-connectable'),
    }))

    expect(summary).toHaveLength(8)
    expect(
      summary.filter((handle) => handle.connectable === 'true').map((handle) => handle.id),
    ).toEqual(['left', 'right'])
    expect(
      summary.filter((handle) => handle.connectable === 'false').map((handle) => handle.id),
    ).toEqual([
      'source-left',
      'source-top',
      'source-bottom',
      'target-right',
      'target-top',
      'target-bottom',
    ])
    expect(
      summary.filter((handle) => handle.type === 'source').map((handle) => handle.position),
    ).toEqual(['right', 'left', 'top', 'bottom'])
    expect(
      summary.filter((handle) => handle.type === 'target').map((handle) => handle.position),
    ).toEqual(['left', 'right', 'top', 'bottom'])
    wrapper.unmount()
  })
})

describe('LoreNode 触屏可见性样式', () => {
  // jsdom 不加载 scoped CSS（vitest 配置 css: false），只能对 SFC 样式源做回归断言
  const source = readFileSync(resolve(process.cwd(), 'src/components/graph/LoreNode.vue'), 'utf8')

  it('折叠按钮默认淡出，但仍可通过 hover/focus/选中/收起态显形', () => {
    expect(source).toMatch(/\.lore-node__collapse\s*\{[^}]*opacity:\s*0/s)
    expect(source).toContain('.lore-node:hover .lore-node__collapse')
    expect(source).toContain('.lore-node__collapse:focus-visible')
  })

  it('无 hover 的触屏设备上折叠按钮常显，避免不可发现', () => {
    const mediaIndex = source.indexOf('@media (hover: none)')
    expect(mediaIndex).toBeGreaterThan(-1)
    expect(source.slice(mediaIndex)).toMatch(/\.lore-node__collapse\s*\{[^}]*opacity:\s*1/s)
  })
})
