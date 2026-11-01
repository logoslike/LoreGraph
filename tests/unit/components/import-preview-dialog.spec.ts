import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import ImportPreviewDialog from '@/components/common/ImportPreviewDialog.vue'
import type { ImportPreview, ImportResult } from '@/services/types'
import { useUiStore } from '@/stores/ui'

const { commitImport } = vi.hoisted(() => ({ commitImport: vi.fn() }))

vi.mock('@/services', () => ({
  services: { importer: { commitImport } },
}))

/** jsdom 没有实现 dialog.close，BaseDialog 收起或卸载时会调用它。 */
beforeAll(() => {
  if (typeof HTMLDialogElement.prototype.close !== 'function') {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement): void {
      this.removeAttribute('open')
    }
  }
})

beforeEach(() => {
  setActivePinia(createPinia())
  commitImport.mockReset()
})

function buildPreview(overrides: Partial<ImportPreview> = {}): ImportPreview {
  return {
    format: 'loregraph.universe',
    mode: 'new-universe',
    targetUniverseId: null,
    universeName: '烬海纪元',
    nodeCount: 12,
    edgeCount: 14,
    newTypes: [{ scope: 'node', key: 'character', label: '角色', color: '#6366f1' }],
    reusedTypes: [],
    typeConflicts: [],
    duplicateNodeNames: [],
    warnings: [],
    errors: [],
    canImport: true,
    plan: null,
    ...overrides,
  }
}

function mountDialog(preview: ImportPreview | null, extraProps: Record<string, unknown> = {}) {
  return mount(ImportPreviewDialog, {
    attachTo: document.body,
    props: { open: true, preview, ...extraProps },
  })
}

function text(wrapper: ReturnType<typeof mount>, testId: string): string {
  return wrapper.get(`[data-testid="${testId}"]`).text()
}

describe('ImportPreviewDialog 导入预览', () => {
  it('展示文件类型、导入目标、节点与关系数量', () => {
    const wrapper = mountDialog(buildPreview())

    expect(text(wrapper, 'import-preview-format')).toBe('完整世界')
    expect(text(wrapper, 'import-preview-target')).toContain('新世界')
    expect(text(wrapper, 'import-preview-node-count')).toBe('12')
    expect(text(wrapper, 'import-preview-edge-count')).toBe('14')
    expect(text(wrapper, 'import-preview-universe-name')).toContain('烬海纪元')
    wrapper.unmount()
  })

  it('图谱片段显示为图谱片段并给出合并目标', () => {
    const wrapper = mountDialog(
      buildPreview({ format: 'loregraph.graph', mode: 'merge', universeName: null }),
      { targetName: '烬海纪元' },
    )

    expect(text(wrapper, 'import-preview-format')).toBe('图谱片段')
    expect(text(wrapper, 'import-preview-target')).toContain('合并到「烬海纪元」')
    expect(wrapper.find('[data-testid="import-preview-universe-name"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('列出新建类型、类型冲突与重名节点，并说明取舍', () => {
    const wrapper = mountDialog(
      buildPreview({
        mode: 'merge',
        targetUniverseId: 'u1',
        newTypes: [{ scope: 'relation', key: 'owns', label: '拥有', color: '#10b981' }],
        reusedTypes: [{ scope: 'node', key: 'character', label: '角色', color: '#6366f1' }],
        typeConflicts: [
          {
            scope: 'node',
            key: 'character',
            incoming: { label: '人物', color: '#111111' },
            existing: { label: '角色', color: '#6366f1' },
          },
        ],
        duplicateNodeNames: ['澜舟', '赤铜'],
      }),
      { targetName: '烬海纪元' },
    )

    expect(text(wrapper, 'import-preview-new-types')).toContain('拥有')
    expect(text(wrapper, 'import-preview-reused-types')).toContain('角色')
    expect(text(wrapper, 'import-preview-conflicts')).toContain('以现有类型为准')
    expect(text(wrapper, 'import-preview-conflicts')).toContain('人物')
    expect(text(wrapper, 'import-preview-conflicts')).toContain('角色')
    expect(text(wrapper, 'import-preview-duplicate-names')).toContain('不会自动合并')
    expect(text(wrapper, 'import-preview-duplicate-names')).toContain('澜舟')
    wrapper.unmount()
  })

  it('显示警告列表', () => {
    const wrapper = mountDialog(
      buildPreview({ warnings: ['检测到 1 条自连关系（起点与终点为同一节点），导入后将保留'] }),
    )

    expect(text(wrapper, 'import-preview-warnings')).toContain('自连关系')
    wrapper.unmount()
  })

  it('canImport=false 时展示全部错误并禁用确认', () => {
    const wrapper = mountDialog(
      buildPreview({
        format: null,
        canImport: false,
        errors: ['JSON 解析失败：Unexpected token', '不支持的文件格式：缺少 format 字段'],
      }),
    )

    const errors = wrapper.get('[data-testid="import-preview-errors"]')
    expect(errors.text()).toContain('JSON 解析失败')
    expect(errors.text()).toContain('不支持的文件格式')
    expect(errors.findAll('li')).toHaveLength(2)
    const confirm = wrapper.get('[data-testid="import-preview-confirm-btn"]')
    expect((confirm.element as HTMLButtonElement).disabled).toBe(true)
    wrapper.unmount()
  })

  it('selectableMode 下可切换导入方式，图谱片段禁用新建世界', async () => {
    const wrapper = mountDialog(buildPreview({ format: 'loregraph.graph', mode: 'merge' }), {
      targetName: '烬海纪元',
      selectableMode: true,
    })

    const newRadio = wrapper.get('[data-testid="import-mode-new"]')
    const mergeRadio = wrapper.get('[data-testid="import-mode-merge"]')
    expect((newRadio.element as HTMLInputElement).disabled).toBe(true)
    expect((newRadio.element as HTMLInputElement).checked).toBe(false)
    expect((mergeRadio.element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.text()).toContain('图谱片段只能合并到已有世界')
    wrapper.unmount()
  })

  it('切换导入方式时抛出 mode-change，不直接提交', async () => {
    const wrapper = mountDialog(buildPreview(), {
      targetName: '烬海纪元',
      selectableMode: true,
    })

    await wrapper.get('[data-testid="import-mode-merge"]').trigger('change')
    expect(wrapper.emitted('mode-change')?.[0]).toEqual(['merge'])
    expect(commitImport).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('确认后提交计划，成功后提示结果并关闭对话框', async () => {
    const preview = buildPreview()
    const result: ImportResult = {
      universeId: 'u2',
      universeName: '烬海纪元（导入）',
      createdUniverse: true,
      createdTypes: 13,
      reusedTypes: 0,
      createdNodes: 12,
      createdEdges: 14,
    }
    commitImport.mockResolvedValue(result)
    const wrapper = mountDialog(preview)

    await wrapper.get('[data-testid="import-preview-confirm-btn"]').trigger('click')
    await flushPromises()

    expect(commitImport).toHaveBeenCalledWith(preview)
    expect(wrapper.emitted('imported')?.[0]).toEqual([result])
    expect(wrapper.emitted('close')).toHaveLength(1)
    // 结果 Toast 交给全局 ToastHost 渲染
    const ui = useUiStore()
    expect(ui.toasts.map((toast) => toast.message).join()).toContain(
      '已导入世界「烬海纪元（导入）」',
    )
    wrapper.unmount()
  })

  it('提交失败时保留对话框并展示失败原因', async () => {
    commitImport.mockRejectedValue(new Error('目标世界在分析后已发生变化，请重新分析后再导入'))
    const wrapper = mountDialog(buildPreview({ mode: 'merge', targetUniverseId: 'u1' }))

    await wrapper.get('[data-testid="import-preview-confirm-btn"]').trigger('click')
    await flushPromises()

    expect(text(wrapper, 'import-preview-failure')).toContain('目标世界在分析后已发生变化')
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.emitted('imported')).toBeUndefined()
    wrapper.unmount()
  })
})
