import { computed, ref, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from 'vue'

/** 侧栏偏好：两个分区的开合，以及用户手动收起的类型分组。 */
export interface SidebarPreferences {
  /** 类型筛选分区是否展开；默认收起，把纵向空间让给节点库。 */
  filterOpen: boolean
  /** 节点库分区是否展开；默认展开。 */
  libraryOpen: boolean
  /** 用户手动收起的类型分组 key；为空表示全部展开。 */
  collapsedGroups: string[]
}

/** 首次使用（无本地记录）时的偏好。 */
export const SIDEBAR_PREFERENCES_DEFAULTS: Readonly<SidebarPreferences> = {
  filterOpen: false,
  libraryOpen: true,
  collapsedGroups: [],
}

const STORAGE_PREFIX = 'loregraph.sidebar-preferences'

/** 某个世界的侧栏偏好存储键：偏好按世界隔离，避免切换世界后串味。 */
export function sidebarPreferencesKey(universeId: string): string {
  return `${STORAGE_PREFIX}.${universeId}`
}

function defaultPreferences(): SidebarPreferences {
  return {
    filterOpen: SIDEBAR_PREFERENCES_DEFAULTS.filterOpen,
    libraryOpen: SIDEBAR_PREFERENCES_DEFAULTS.libraryOpen,
    collapsedGroups: [],
  }
}

/**
 * 把读到的任意值收敛成合法偏好：整块数据坏掉时整体退回默认值，
 * 单个字段类型不对时只退回该字段，尽量保住用户还能用的部分。
 */
export function sanitizeSidebarPreferences(value: unknown): SidebarPreferences {
  const result = defaultPreferences()
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return result
  }
  const record = value as Record<string, unknown>
  if (typeof record.filterOpen === 'boolean') {
    result.filterOpen = record.filterOpen
  }
  if (typeof record.libraryOpen === 'boolean') {
    result.libraryOpen = record.libraryOpen
  }
  if (Array.isArray(record.collapsedGroups)) {
    const keys = record.collapsedGroups.filter((key): key is string => typeof key === 'string')
    result.collapsedGroups = [...new Set(keys)]
  }
  return result
}

/** 读取某个世界的偏好；存储被禁用、内容损坏时一律退回默认值，不抛错。 */
function readPreferences(universeId: string): SidebarPreferences {
  try {
    if (typeof localStorage === 'undefined') {
      return defaultPreferences()
    }
    const raw = localStorage.getItem(sidebarPreferencesKey(universeId))
    if (raw === null) {
      return defaultPreferences()
    }
    return sanitizeSidebarPreferences(JSON.parse(raw) as unknown)
  } catch {
    // 隐私模式禁用存储、或 localStorage 里不是合法 JSON
    return defaultPreferences()
  }
}

/** 写入某个世界的偏好；写入失败（隐私模式、配额不足）时只留在内存。 */
function writePreferences(universeId: string, preferences: SidebarPreferences): void {
  try {
    if (typeof localStorage === 'undefined') {
      return
    }
    localStorage.setItem(sidebarPreferencesKey(universeId), JSON.stringify(preferences))
  } catch {
    // 存储不可用时静默降级：本次会话内的开合状态仍然有效
  }
}

/** 侧栏偏好的读写接口。 */
export interface UseSidebarPreferencesReturn {
  /** 当前世界的完整偏好。 */
  preferences: ComputedRef<SidebarPreferences>
  /** 当前使用的 localStorage 键，便于调试与测试断言。 */
  storageKey: ComputedRef<string>
  filterOpen: ComputedRef<boolean>
  libraryOpen: ComputedRef<boolean>
  collapsedGroups: ComputedRef<string[]>
  /** 分组是否展开；未手动收起过的分组默认展开。 */
  isGroupExpanded: (key: string) => boolean
  setFilterOpen: (open: boolean) => void
  setLibraryOpen: (open: boolean) => void
  toggleFilter: () => void
  toggleLibrary: () => void
  setGroupCollapsed: (key: string, collapsed: boolean) => void
  toggleGroup: (key: string) => void
  /** 全部展开：清空手动收起记录。 */
  expandAllGroups: () => void
  /** 全部收起：记下给定的分组 key（只收当前存在的分组）。 */
  collapseAllGroups: (keys: readonly string[]) => void
  /** 恢复默认偏好：筛选收起、节点库展开、全部分组展开。 */
  resetPreferences: () => void
}

/**
 * 侧栏偏好组合式函数：按 universeId 持久化到 localStorage。
 * 存储不可用或数据损坏时以内存状态继续工作，不阻断侧栏渲染。
 */
export function useSidebarPreferences(
  universeId: MaybeRefOrGetter<string>,
): UseSidebarPreferencesReturn {
  const currentId = computed(() => toValue(universeId))
  const state = ref<SidebarPreferences>(readPreferences(currentId.value))

  // 切换世界时换成新世界的偏好；这里只读不写，避免把旧世界状态带到新世界
  watch(currentId, (id) => {
    state.value = readPreferences(id)
  })

  const storageKey = computed(() => sidebarPreferencesKey(currentId.value))

  function commit(next: SidebarPreferences): void {
    state.value = next
    writePreferences(currentId.value, next)
  }

  function setFilterOpen(open: boolean): void {
    if (state.value.filterOpen === open) {
      return
    }
    commit({ ...state.value, filterOpen: open })
  }

  function setLibraryOpen(open: boolean): void {
    if (state.value.libraryOpen === open) {
      return
    }
    commit({ ...state.value, libraryOpen: open })
  }

  function isGroupExpanded(key: string): boolean {
    return !state.value.collapsedGroups.includes(key)
  }

  function setGroupCollapsed(key: string, collapsed: boolean): void {
    const collapsedKeys = state.value.collapsedGroups
    if (collapsed === collapsedKeys.includes(key)) {
      return
    }
    commit({
      ...state.value,
      collapsedGroups: collapsed
        ? [...collapsedKeys, key]
        : collapsedKeys.filter((item) => item !== key),
    })
  }

  function collapseAllGroups(keys: readonly string[]): void {
    const collapsedKeys = [...new Set(keys)]
    if (
      collapsedKeys.length === state.value.collapsedGroups.length &&
      collapsedKeys.every((key) => state.value.collapsedGroups.includes(key))
    ) {
      return
    }
    commit({ ...state.value, collapsedGroups: collapsedKeys })
  }

  return {
    preferences: computed(() => state.value),
    storageKey,
    filterOpen: computed(() => state.value.filterOpen),
    libraryOpen: computed(() => state.value.libraryOpen),
    collapsedGroups: computed(() => state.value.collapsedGroups),
    isGroupExpanded,
    setFilterOpen,
    setLibraryOpen,
    toggleFilter: () => setFilterOpen(!state.value.filterOpen),
    toggleLibrary: () => setLibraryOpen(!state.value.libraryOpen),
    setGroupCollapsed,
    toggleGroup: (key) => setGroupCollapsed(key, isGroupExpanded(key)),
    expandAllGroups: () => collapseAllGroups([]),
    collapseAllGroups,
    resetPreferences: () => commit(defaultPreferences()),
  }
}
