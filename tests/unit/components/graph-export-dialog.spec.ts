import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import GraphExportDialog from '@/components/graph/GraphExportDialog.vue'
import type { LoreEdge } from '@/models/edge'
import type { LoreNode } from '@/models/node'
import type { EntityType } from '@/models/type-def'
import { useGraphStore } from '@/stores/graph'
import { useTypesStore } from '@/stores/types'
import { useUniverseStore } from '@/stores/universe'

const { exportGraph, download } = vi.hoisted(() => ({ exportGraph: vi.fn(), download: vi.fn() }))

vi.mock('@/services', () => ({
  services: { exporter: { exportGraph, download } },
}))

beforeAll(() => {
  if (typeof HTMLDialogElement.prototype.close !== 'function') {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement): void {
      this.removeAttribute('open')
    }
  }
})

beforeEach(() => {
  setActivePinia(createPinia())
  exportGraph.mockReset()
  download.mockReset()
})

function buildNode(id: string, name: string, type: string): LoreNode {
  return {
    id,
    universeId: 'u1',
    type,
    name,
    description: '',
    properties: {},
    position: { x: 0, y: 0 },
    createdAt: 1,
    updatedAt: 1,
  }
}

function buildEdge(id: string, source: string, target: string): LoreEdge {
  return {
    id,
    universeId: 'u1',
    source,
    target,
    relationType: 'member-of',
    properties: {},
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

/** 三个节点、两条关系：n1-n2、n2-n3。 */
function seed() {
  const graph = useGraphStore()
  graph.universeId = 'u1'
  graph.nodes = [
    buildNode('n1', '澜舟', 'character'),
    buildNode('n2', '潮汐教团', 'organization'),
    buildNode('n3', '沉钟湾', 'location'),
  ]
  graph.edges = [buildEdge('e1', 'n1', 'n2'), buildEdge('e2', 'n2', 'n3')]
  graph.selectedNodeId = 'n1'

  const types = useTypesStore()
  types.universeId = 'u1'
  types.nodeTypes = [
    buildType('character', '角色', '#6366f1'),
    buildType('organization', '组织', '#f59e0b'),
    buildType('location', '地点', '#10b981'),
  ]

  const universe = useUniverseStore()
  universe.universes = [{ id: 'u1', name: '烬海纪元', description: '', createdAt: 1, updatedAt: 1 }]
  universe.currentId = 'u1'
}

function mountDialog() {
  return mount(GraphExportDialog, {
    attachTo: document.body,
    props: { open: true },
  })
}

function text(wrapper: ReturnType<typeof mount>, testId: string): string {
  return wrapper.get(`[data-testid="${testId}"]`).text()
}

function checkedIds(wrapper: ReturnType<typeof mount>): string[] {
  const boxes = wrapper.findAll<HTMLInputElement>('[data-testid="graph-export-node-checkbox"]')
  return boxes
    .filter((box) => box.element.checked)
    .map((box) => box.element.closest('label')?.dataset.nodeName ?? '')
}

describe('GraphExportDialog 图谱片段导出', () => {
  it('打开时预选当前选中节点，并统计将导出的关系与被丢弃的关系', () => {
    seed()
    const wrapper = mountDialog()

    expect(text(wrapper, 'graph-export-summary')).toContain('将导出 1 个节点、0 条关系')
    expect(text(wrapper, 'graph-export-omitted')).toContain('1 条关系因另一端未选中而不导出')
    expect(checkedIds(wrapper)).toEqual(['澜舟'])
    wrapper.unmount()
  })

  it('加入直接关联节点后纳入相邻节点与它们之间的关系', async () => {
    seed()
    const wrapper = mountDialog()

    await wrapper.get('[data-testid="graph-export-add-neighbors-btn"]').trigger('click')

    expect(text(wrapper, 'graph-export-summary')).toContain('将导出 2 个节点、1 条关系')
    expect(text(wrapper, 'graph-export-omitted')).toContain('1 条关系因另一端未选中而不导出')
    expect(checkedIds(wrapper)).toEqual(['澜舟', '潮汐教团'])
    wrapper.unmount()
  })

  it('按名称筛选后全选只选中筛选结果，全不选清空并禁用导出', async () => {
    seed()
    const wrapper = mountDialog()

    await wrapper.get('[data-testid="graph-export-search-input"]').setValue('沉钟')
    expect(wrapper.findAll('[data-testid="graph-export-node-item"]')).toHaveLength(1)

    await wrapper.get('[data-testid="graph-export-select-all-btn"]').trigger('click')
    // 当前筛选结果被加进已选集合，原有选中（澜舟）不受影响
    expect(checkedIds(wrapper)).toEqual(['沉钟湾'])
    expect(text(wrapper, 'graph-export-summary')).toContain('将导出 2 个节点、0 条关系')

    await wrapper.get('[data-testid="graph-export-select-none-btn"]').trigger('click')
    expect(checkedIds(wrapper)).toEqual([])
    expect(text(wrapper, 'graph-export-summary')).toContain('将导出 0 个节点、0 条关系')
    const confirm = wrapper.get('[data-testid="graph-export-confirm-btn"]')
    expect((confirm.element as HTMLButtonElement).disabled).toBe(true)
    wrapper.unmount()
  })

  it('确认导出时按选中节点调用 exporter，并以「世界名-图谱片段」为文件名', async () => {
    seed()
    exportGraph.mockResolvedValue({
      data: { format: 'loregraph.graph', nodes: [], edges: [] },
      omittedEdgeCount: 0,
    })
    const wrapper = mountDialog()

    await wrapper.get('[data-testid="graph-export-select-all-btn"]').trigger('click')
    await wrapper.get('[data-testid="graph-export-confirm-btn"]').trigger('click')
    await flushPromises()

    expect(exportGraph).toHaveBeenCalledTimes(1)
    const [universeId, ids] = exportGraph.mock.calls[0] as [string, string[]]
    expect(universeId).toBe('u1')
    expect([...ids].sort()).toEqual(['n1', 'n2', 'n3'])
    expect(download).toHaveBeenCalledTimes(1)
    expect(download.mock.calls[0]?.[1]).toBe('烬海纪元-图谱片段.loregraph.json')
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    wrapper.unmount()
  })

  it('没有节点时展示空状态并禁用导出', () => {
    seed()
    const graph = useGraphStore()
    graph.nodes = []
    graph.edges = []
    const wrapper = mountDialog()

    expect(wrapper.get('[data-testid="graph-export-empty"]').text()).toContain('还没有节点')
    const confirm = wrapper.get('[data-testid="graph-export-confirm-btn"]')
    expect((confirm.element as HTMLButtonElement).disabled).toBe(true)
    wrapper.unmount()
  })
})
