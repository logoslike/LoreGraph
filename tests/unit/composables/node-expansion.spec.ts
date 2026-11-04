import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import {
  nodeExpansionKey,
  sanitizeNodeExpansion,
  useNodeExpansion,
} from '@/composables/useNodeExpansion'

const UNIVERSE = 'universe-a'
const OTHER = 'universe-b'

function stored(universeId: string): unknown {
  const raw = localStorage.getItem(nodeExpansionKey(universeId))
  return raw === null ? null : (JSON.parse(raw) as unknown)
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('大图关系展开偏好默认值与持久化', () => {
  it('默认没有展开节点，也不写入存储', () => {
    const expansion = useNodeExpansion(UNIVERSE)
    expect(expansion.expandedIds.value).toEqual([])
    expect(expansion.isExpanded('a')).toBe(false)
    expect(localStorage.getItem(nodeExpansionKey(UNIVERSE))).toBeNull()
  })

  it('展开后写入 localStorage，新的组合式函数实例能恢复', () => {
    const expansion = useNodeExpansion(UNIVERSE)
    expansion.expand('a')

    expect(expansion.isExpanded('a')).toBe(true)
    expect(stored(UNIVERSE)).toEqual({ expandedNodeIds: ['a'] })

    const restored = useNodeExpansion(UNIVERSE)
    expect(restored.isExpanded('a')).toBe(true)
    expect(restored.isExpanded('b')).toBe(false)
  })

  it('重复展开同一节点是幂等的，不会累积重复 id', () => {
    const expansion = useNodeExpansion(UNIVERSE)
    expansion.expand('a')
    expansion.expand('a')

    expect(expansion.expandedIds.value).toEqual(['a'])
    expect(stored(UNIVERSE)).toEqual({ expandedNodeIds: ['a'] })
  })

  it('toggle 展开/收起往返，collapse 只移除目标', () => {
    const expansion = useNodeExpansion(UNIVERSE)
    expansion.toggle('a')
    expect(expansion.isExpanded('a')).toBe(true)

    expansion.toggle('a')
    expect(expansion.isExpanded('a')).toBe(false)

    expansion.expand('a')
    expansion.expand('b')
    expansion.collapse('a')
    expect(expansion.expandedIds.value).toEqual(['b'])
    expect(stored(UNIVERSE)).toEqual({ expandedNodeIds: ['b'] })
  })

  it('全部收起会清空记录', () => {
    const expansion = useNodeExpansion(UNIVERSE)
    expansion.expand('a')
    expansion.expand('b')
    expansion.collapseAll()

    expect(expansion.expandedIds.value).toEqual([])
    expect(stored(UNIVERSE)).toEqual({ expandedNodeIds: [] })
  })

  it('存储键按世界隔离，切换世界时读取对应记录', async () => {
    const first = useNodeExpansion(UNIVERSE)
    first.expand('a')

    const universeId = ref(UNIVERSE)
    const expansion = useNodeExpansion(universeId)
    expect(expansion.isExpanded('a')).toBe(true)

    const other = useNodeExpansion(OTHER)
    other.expand('x')
    expect(stored(OTHER)).toEqual({ expandedNodeIds: ['x'] })

    universeId.value = OTHER
    await nextTick()

    expect(expansion.storageKey.value).toBe(nodeExpansionKey(OTHER))
    expect(expansion.isExpanded('x')).toBe(true)
    expect(expansion.isExpanded('a')).toBe(false)
    expect(stored(UNIVERSE)).toEqual({ expandedNodeIds: ['a'] })
  })

  it('没有世界 id 时只保留会话内状态，不写存储', () => {
    const expansion = useNodeExpansion('')
    expansion.expand('a')

    expect(expansion.isExpanded('a')).toBe(true)
    expect(expansion.storageKey.value).toBeNull()
    expect(localStorage.length).toBe(0)
  })
})

describe('retain 清理已不存在的展开 id', () => {
  it('只保留当前图中仍存在的节点并落盘', () => {
    const expansion = useNodeExpansion(UNIVERSE)
    expansion.expand('a')
    expansion.expand('b')
    expansion.expand('gone')

    expansion.retain(new Set(['a', 'b', 'c']))

    expect(expansion.expandedIds.value).toEqual(['a', 'b'])
    expect(stored(UNIVERSE)).toEqual({ expandedNodeIds: ['a', 'b'] })
  })

  it('没有需要清理的 id 时不改动存储', () => {
    const expansion = useNodeExpansion(UNIVERSE)
    expansion.expand('a')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    expansion.retain(new Set(['a', 'b']))

    expect(setItem).not.toHaveBeenCalled()
    expect(expansion.isExpanded('a')).toBe(true)
  })

  it('空展开集合不会写入存储', () => {
    const expansion = useNodeExpansion(UNIVERSE)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    expansion.retain(new Set())

    expect(setItem).not.toHaveBeenCalled()
    expect(localStorage.getItem(nodeExpansionKey(UNIVERSE))).toBeNull()
  })
})

describe('expandOnClick：大图卡片点击的关联规则', () => {
  const EDGES = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'far', target: 'far-2' },
  ]

  it('点邻居时保留已有展开并继续累加', () => {
    const expansion = useNodeExpansion(UNIVERSE)
    expansion.expandOnClick('a', EDGES)
    expansion.expandOnClick('b', EDGES)

    expect(expansion.expandedIds.value).toEqual(['a', 'b'])
    expect(stored(UNIVERSE)).toEqual({ expandedNodeIds: ['a', 'b'] })
  })

  it('点无关节点时收起整组旧展开，只保留新节点', () => {
    const expansion = useNodeExpansion(UNIVERSE)
    expansion.expand('a')
    expansion.expand('b')
    expansion.expandOnClick('far', EDGES)

    expect(expansion.expandedIds.value).toEqual(['far'])
    expect(expansion.isExpanded('a')).toBe(false)
    expect(stored(UNIVERSE)).toEqual({ expandedNodeIds: ['far'] })
  })

  it('刷新后恢复的展开，点到无关节点同样被整组收起并落盘', () => {
    const before = useNodeExpansion(UNIVERSE)
    before.expand('a')
    before.expand('b')

    const restored = useNodeExpansion(UNIVERSE)
    expect(restored.expandedIds.value).toEqual(['a', 'b'])

    restored.expandOnClick('far', EDGES)

    expect(restored.expandedIds.value).toEqual(['far'])
    expect(useNodeExpansion(UNIVERSE).expandedIds.value).toEqual(['far'])
    expect(stored(UNIVERSE)).toEqual({ expandedNodeIds: ['far'] })
  })

  it('重复点同一节点保持幂等，不重写存储', () => {
    const expansion = useNodeExpansion(UNIVERSE)
    expansion.expand('a')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    expansion.expandOnClick('a', EDGES)

    expect(expansion.expandedIds.value).toEqual(['a'])
    expect(setItem).not.toHaveBeenCalled()
  })

  it('整组收起只提交一次，不会先写空集合', () => {
    const expansion = useNodeExpansion(UNIVERSE)
    expansion.expand('a')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    expansion.expandOnClick('far', EDGES)

    expect(setItem).toHaveBeenCalledTimes(1)
    expect(stored(UNIVERSE)).toEqual({ expandedNodeIds: ['far'] })
  })
})

describe('存储损坏或不可用时的容错', () => {
  it('不是合法 JSON 时退回空集合', () => {
    localStorage.setItem(nodeExpansionKey(UNIVERSE), '{not json')
    expect(useNodeExpansion(UNIVERSE).expandedIds.value).toEqual([])
  })

  it('sanitizeNodeExpansion 兼容数组与对象，去重并丢掉非字符串', () => {
    expect(sanitizeNodeExpansion(['a', 'a', 42, null, '', 'b'])).toEqual(['a', 'b'])
    expect(sanitizeNodeExpansion({ expandedNodeIds: ['x', 'x', ''] })).toEqual(['x'])
    expect(sanitizeNodeExpansion({ expandedNodeIds: 'nope' })).toEqual([])
    expect(sanitizeNodeExpansion(null)).toEqual([])
  })

  it('读取抛错（隐私模式）时以空集合启动', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    expect(useNodeExpansion(UNIVERSE).expandedIds.value).toEqual([])
  })

  it('写入抛错时展开仍在本次会话内生效', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    const expansion = useNodeExpansion(UNIVERSE)
    expect(() => expansion.expand('a')).not.toThrow()
    expect(expansion.isExpanded('a')).toBe(true)
    expect(localStorage.getItem(nodeExpansionKey(UNIVERSE))).toBeNull()
  })
})
