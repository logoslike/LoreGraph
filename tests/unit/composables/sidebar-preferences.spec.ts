import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import {
  SIDEBAR_PREFERENCES_DEFAULTS,
  sanitizeSidebarPreferences,
  sidebarPreferencesKey,
  useSidebarPreferences,
} from '@/composables/useSidebarPreferences'

const UNIVERSE = 'universe-a'
const OTHER_UNIVERSE = 'universe-b'

/** 读取某个世界实际写进 localStorage 的偏好内容。 */
function stored(universeId: string): unknown {
  const raw = localStorage.getItem(sidebarPreferencesKey(universeId))
  return raw === null ? null : (JSON.parse(raw) as unknown)
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('侧栏偏好默认值', () => {
  it('筛选默认收起、节点库默认展开、分组默认全部展开', () => {
    const prefs = useSidebarPreferences(UNIVERSE)
    expect(prefs.filterOpen.value).toBe(false)
    expect(prefs.libraryOpen.value).toBe(true)
    expect(prefs.collapsedGroups.value).toEqual([])
    expect(prefs.isGroupExpanded('character')).toBe(true)
  })

  it('没有本地记录时不写入任何存储', () => {
    useSidebarPreferences(UNIVERSE)
    expect(localStorage.getItem(sidebarPreferencesKey(UNIVERSE))).toBeNull()
  })

  it('存储键按世界隔离，且包含世界 id', () => {
    const prefs = useSidebarPreferences(UNIVERSE)
    expect(prefs.storageKey.value).toBe(sidebarPreferencesKey(UNIVERSE))
    expect(sidebarPreferencesKey(UNIVERSE)).toContain(UNIVERSE)
    expect(sidebarPreferencesKey(UNIVERSE)).not.toBe(sidebarPreferencesKey(OTHER_UNIVERSE))
  })
})

describe('偏好持久化', () => {
  it('收起分组后写入 localStorage，重新创建组合式函数时恢复', () => {
    const first = useSidebarPreferences(UNIVERSE)
    first.toggleGroup('character')

    expect(first.isGroupExpanded('character')).toBe(false)
    expect(stored(UNIVERSE)).toMatchObject({ collapsedGroups: ['character'] })

    const second = useSidebarPreferences(UNIVERSE)
    expect(second.isGroupExpanded('character')).toBe(false)
    expect(second.isGroupExpanded('location')).toBe(true)
  })

  it('再次点击分组header会把 key 从收起记录中移除', () => {
    const prefs = useSidebarPreferences(UNIVERSE)
    prefs.toggleGroup('character')
    prefs.toggleGroup('character')

    expect(prefs.collapsedGroups.value).toEqual([])
    expect(stored(UNIVERSE)).toMatchObject({ collapsedGroups: [] })
  })

  it('筛选与节点库的开合状态分别持久化', () => {
    const prefs = useSidebarPreferences(UNIVERSE)
    prefs.toggleFilter()
    prefs.toggleLibrary()

    expect(stored(UNIVERSE)).toEqual({ filterOpen: true, libraryOpen: false, collapsedGroups: [] })
    const reloaded = useSidebarPreferences(UNIVERSE)
    expect(reloaded.filterOpen.value).toBe(true)
    expect(reloaded.libraryOpen.value).toBe(false)
  })

  it('不同世界的偏好互不影响', () => {
    const first = useSidebarPreferences(UNIVERSE)
    first.toggleGroup('character')

    const other = useSidebarPreferences(OTHER_UNIVERSE)
    expect(other.isGroupExpanded('character')).toBe(true)
    expect(stored(OTHER_UNIVERSE)).toBeNull()
  })

  it('切换世界时重新读取新世界的偏好，且不回写旧世界', async () => {
    const other = useSidebarPreferences(OTHER_UNIVERSE)
    other.toggleGroup('location')

    const universeId = ref(UNIVERSE)
    const prefs = useSidebarPreferences(universeId)
    prefs.toggleGroup('character')
    expect(prefs.isGroupExpanded('character')).toBe(false)

    universeId.value = OTHER_UNIVERSE
    await nextTick()

    expect(prefs.storageKey.value).toBe(sidebarPreferencesKey(OTHER_UNIVERSE))
    expect(prefs.isGroupExpanded('location')).toBe(false)
    // 旧世界的收起记录仍在，新世界没有多出 character
    expect(prefs.isGroupExpanded('character')).toBe(true)
    expect(stored(UNIVERSE)).toMatchObject({ collapsedGroups: ['character'] })
    expect(stored(OTHER_UNIVERSE)).toMatchObject({ collapsedGroups: ['location'] })
  })

  it('恢复默认偏好会写回默认值', () => {
    const prefs = useSidebarPreferences(UNIVERSE)
    prefs.toggleFilter()
    prefs.toggleLibrary()
    prefs.collapseAllGroups(['character'])

    prefs.resetPreferences()

    expect(prefs.preferences.value).toEqual(SIDEBAR_PREFERENCES_DEFAULTS)
    expect(stored(UNIVERSE)).toEqual({
      filterOpen: false,
      libraryOpen: true,
      collapsedGroups: [],
    })
  })
})

describe('分组的整体展开与收起', () => {
  it('全部收起后传入的分组都收起并写入存储', () => {
    const prefs = useSidebarPreferences(UNIVERSE)
    prefs.collapseAllGroups(['character', 'location'])

    expect(prefs.isGroupExpanded('character')).toBe(false)
    expect(prefs.isGroupExpanded('location')).toBe(false)
    expect(prefs.isGroupExpanded('event')).toBe(true)
    expect(stored(UNIVERSE)).toMatchObject({ collapsedGroups: ['character', 'location'] })
  })

  it('全部展开会清空收起记录', () => {
    const prefs = useSidebarPreferences(UNIVERSE)
    prefs.collapseAllGroups(['character', 'location'])

    prefs.expandAllGroups()

    expect(prefs.collapsedGroups.value).toEqual([])
    expect(prefs.isGroupExpanded('character')).toBe(true)
    expect(stored(UNIVERSE)).toMatchObject({ collapsedGroups: [] })
  })

  it('重复的分组 key 只记一次', () => {
    const prefs = useSidebarPreferences(UNIVERSE)
    prefs.collapseAllGroups(['character', 'character', 'location'])

    expect(prefs.collapsedGroups.value).toEqual(['character', 'location'])
  })

  it('新增分组默认展开，不受既有收起记录影响', () => {
    const prefs = useSidebarPreferences(UNIVERSE)
    prefs.collapseAllGroups(['character'])

    // 新类型首次出现时不在收起记录里，因此默认展开
    expect(prefs.isGroupExpanded('brand-new-type')).toBe(true)
  })
})

describe('存储损坏或不可用时的容错', () => {
  it('内容不是合法 JSON 时退回默认偏好', () => {
    localStorage.setItem(sidebarPreferencesKey(UNIVERSE), '{not json')

    const prefs = useSidebarPreferences(UNIVERSE)
    expect(prefs.filterOpen.value).toBe(false)
    expect(prefs.libraryOpen.value).toBe(true)
    expect(prefs.collapsedGroups.value).toEqual([])
  })

  it('JSON 是数组、数字、字符串或 null 时退回默认偏好', () => {
    for (const raw of ['[]', '42', '"sidebar"', 'null']) {
      localStorage.setItem(sidebarPreferencesKey(UNIVERSE), raw)
      const prefs = useSidebarPreferences(UNIVERSE)
      expect(prefs.filterOpen.value).toBe(false)
      expect(prefs.libraryOpen.value).toBe(true)
      expect(prefs.isGroupExpanded('character')).toBe(true)
    }
  })

  it('单个字段类型不对时只退回该字段，其余字段保留', () => {
    localStorage.setItem(
      sidebarPreferencesKey(UNIVERSE),
      JSON.stringify({ filterOpen: 'yes', libraryOpen: false, collapsedGroups: ['character'] }),
    )

    const prefs = useSidebarPreferences(UNIVERSE)
    expect(prefs.filterOpen.value).toBe(false)
    expect(prefs.libraryOpen.value).toBe(false)
    expect(prefs.isGroupExpanded('character')).toBe(false)
  })

  it('collapsedGroups 里的非字符串与重复项会被清理', () => {
    localStorage.setItem(
      sidebarPreferencesKey(UNIVERSE),
      JSON.stringify({ collapsedGroups: ['character', 42, null, 'character', 'location'] }),
    )

    const prefs = useSidebarPreferences(UNIVERSE)
    expect(prefs.collapsedGroups.value).toEqual(['character', 'location'])
  })

  it('读取存储抛错（隐私模式禁用存储）时用默认偏好启动', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    const prefs = useSidebarPreferences(UNIVERSE)
    expect(prefs.filterOpen.value).toBe(false)
    expect(prefs.libraryOpen.value).toBe(true)
    expect(prefs.isGroupExpanded('character')).toBe(true)
  })

  it('写入存储抛错时偏好仍在本次会话内生效', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    const prefs = useSidebarPreferences(UNIVERSE)
    expect(() => prefs.collapseAllGroups(['character'])).not.toThrow()

    expect(prefs.isGroupExpanded('character')).toBe(false)
    expect(localStorage.getItem(sidebarPreferencesKey(UNIVERSE))).toBeNull()
  })
})

describe('sanitizeSidebarPreferences', () => {
  it('合法数据原样返回', () => {
    const value = { filterOpen: true, libraryOpen: false, collapsedGroups: ['character'] }
    expect(sanitizeSidebarPreferences(value)).toEqual(value)
  })

  it('忽略多余字段，缺失字段用默认值补齐', () => {
    expect(sanitizeSidebarPreferences({ extra: 1, libraryOpen: false })).toEqual({
      filterOpen: false,
      libraryOpen: false,
      collapsedGroups: [],
    })
  })

  it('非对象输入一律返回默认值', () => {
    for (const value of [null, undefined, 0, 'text', [], true]) {
      expect(sanitizeSidebarPreferences(value)).toEqual({
        filterOpen: false,
        libraryOpen: true,
        collapsedGroups: [],
      })
    }
  })
})
