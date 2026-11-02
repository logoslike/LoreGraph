import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import {
  NODE_COLLAPSE_DEFAULTS,
  nodeCollapseKey,
  sanitizeNodeCollapse,
  useNodeCollapse,
} from '@/composables/useNodeCollapse'
import type { CollapseEdge } from '@/services/collapse'

const UNIVERSE = 'universe-a'
const OTHER = 'universe-b'

function stored(universeId: string): unknown {
  const raw = localStorage.getItem(nodeCollapseKey(universeId))
  return raw === null ? null : (JSON.parse(raw) as unknown)
}

const chain: CollapseEdge[] = [
  { source: 'a', target: 'b' },
  { source: 'b', target: 'c' },
  { source: 'x', target: 'y' },
]

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('节点折叠偏好默认值与持久化', () => {
  it('默认没有折叠节点，也不写入存储', () => {
    const collapse = useNodeCollapse(UNIVERSE)
    expect(NODE_COLLAPSE_DEFAULTS.collapsedIds).toEqual([])
    expect(collapse.collapsedIds.value).toEqual([])
    expect(collapse.isCollapsed('a')).toBe(false)
    expect(localStorage.getItem(nodeCollapseKey(UNIVERSE))).toBeNull()
  })

  it('收起后写入 localStorage，新的组合式函数实例能恢复', () => {
    const collapse = useNodeCollapse(UNIVERSE)
    collapse.toggle('a')

    expect(collapse.isCollapsed('a')).toBe(true)
    expect(stored(UNIVERSE)).toEqual({ collapsedIds: ['a'] })

    const restored = useNodeCollapse(UNIVERSE)
    expect(restored.isCollapsed('a')).toBe(true)
    expect(restored.isCollapsed('b')).toBe(false)
  })

  it('再次切换同一节点是幂等回退，不会累积重复 id', () => {
    const collapse = useNodeCollapse(UNIVERSE)
    collapse.toggle('a')
    collapse.toggle('a')

    expect(collapse.isCollapsed('a')).toBe(false)
    expect(stored(UNIVERSE)).toEqual({ collapsedIds: [] })
  })

  it('多个节点分别折叠，展开全部会清空记录', () => {
    const collapse = useNodeCollapse(UNIVERSE)
    collapse.toggle('a')
    collapse.toggle('b')
    expect(stored(UNIVERSE)).toEqual({ collapsedIds: ['a', 'b'] })

    collapse.expandAll()
    expect(collapse.collapsedIds.value).toEqual([])
    expect(stored(UNIVERSE)).toEqual({ collapsedIds: [] })
  })

  it('存储键按世界隔离，切换世界时读取对应记录', async () => {
    const first = useNodeCollapse(UNIVERSE)
    first.toggle('a')

    const universeId = ref(UNIVERSE)
    const collapse = useNodeCollapse(universeId)
    expect(collapse.isCollapsed('a')).toBe(true)

    const other = useNodeCollapse(OTHER)
    other.toggle('x')
    expect(stored(OTHER)).toEqual({ collapsedIds: ['x'] })

    universeId.value = OTHER
    await nextTick()

    expect(collapse.storageKey.value).toBe(nodeCollapseKey(OTHER))
    expect(collapse.isCollapsed('x')).toBe(true)
    expect(collapse.isCollapsed('a')).toBe(false)
    // 旧世界的记录没有被新世界覆盖
    expect(stored(UNIVERSE)).toEqual({ collapsedIds: ['a'] })
  })

  it('没有世界 id 时只保留会话内状态，不写存储', () => {
    const collapse = useNodeCollapse('')
    collapse.toggle('a')

    expect(collapse.isCollapsed('a')).toBe(true)
    expect(collapse.storageKey.value).toBeNull()
    expect(localStorage.length).toBe(0)
  })
})

describe('定位节点前展开折叠祖先', () => {
  it('只展开藏起目标的祖先，无关折叠分支保留', () => {
    const collapse = useNodeCollapse(UNIVERSE)
    collapse.toggle('a')
    collapse.toggle('b')
    collapse.toggle('x')

    collapse.revealNode('c', chain)

    expect(collapse.isCollapsed('a')).toBe(false)
    expect(collapse.isCollapsed('b')).toBe(false)
    expect(collapse.isCollapsed('x')).toBe(true)
    expect(stored(UNIVERSE)).toEqual({ collapsedIds: ['x'] })
  })

  it('目标未被折叠祖先隐藏时保持原状', () => {
    const collapse = useNodeCollapse(UNIVERSE)
    collapse.toggle('x')

    collapse.revealNode('c', chain)

    expect(collapse.isCollapsed('x')).toBe(true)
    expect(stored(UNIVERSE)).toEqual({ collapsedIds: ['x'] })
  })
})

describe('存储损坏或不可用时的容错', () => {
  it('不是合法 JSON 时退回空集合', () => {
    localStorage.setItem(nodeCollapseKey(UNIVERSE), '{not json')
    expect(useNodeCollapse(UNIVERSE).collapsedIds.value).toEqual([])
  })

  it('sanitizeNodeCollapse 兼容数组与对象，去重并丢掉非字符串', () => {
    expect(sanitizeNodeCollapse(['a', 'a', 42, null, '', 'b'])).toEqual(['a', 'b'])
    expect(sanitizeNodeCollapse({ collapsedIds: ['x', 'x', ''] })).toEqual(['x'])
    expect(sanitizeNodeCollapse({ collapsedIds: 'nope' })).toEqual([])
    expect(sanitizeNodeCollapse(null)).toEqual([])
  })

  it('读取抛错（隐私模式）时以空集合启动', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    expect(useNodeCollapse(UNIVERSE).collapsedIds.value).toEqual([])
  })

  it('写入抛错时折叠仍在本次会话内生效', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    const collapse = useNodeCollapse(UNIVERSE)
    expect(() => collapse.toggle('a')).not.toThrow()
    expect(collapse.isCollapsed('a')).toBe(true)
    expect(localStorage.getItem(nodeCollapseKey(UNIVERSE))).toBeNull()
  })
})
