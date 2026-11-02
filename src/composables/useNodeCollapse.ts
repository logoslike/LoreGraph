import { computed, ref, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import type { CollapseEdge } from '@/services/collapse'
import { revealedCollapsedIds } from '@/services/collapse'

/** 按世界保存的画布节点折叠偏好；只存节点 id，不进入节点模型与导出文件。 */
export interface NodeCollapsePreference {
  collapsedIds: string[]
}

/** 首次使用（无本地记录）时没有折叠节点。 */
export const NODE_COLLAPSE_DEFAULTS: Readonly<NodeCollapsePreference> = {
  collapsedIds: [],
}

const STORAGE_PREFIX = 'loregraph.node-collapse'

/** 某个世界的折叠偏好存储键：折叠是视图状态，按世界隔离。 */
export function nodeCollapseKey(universeId: string): string {
  return `${STORAGE_PREFIX}.${universeId}`
}

/** 把读到的任意值收敛成去重后的节点 id 列表；坏数据一律当作没有折叠。 */
export function sanitizeNodeCollapse(value: unknown): string[] {
  let source: unknown[] = []
  if (Array.isArray(value)) {
    source = value
  } else if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    if (Array.isArray(record.collapsedIds)) {
      source = record.collapsedIds
    }
  }
  const ids = source.filter((id): id is string => typeof id === 'string' && id !== '')
  return [...new Set(ids)]
}

/** 读取某个世界的折叠记录；存储被禁用、内容损坏时一律当作空集合。 */
function readCollapsedIds(universeId: string): string[] {
  if (universeId === '') {
    return []
  }
  try {
    if (typeof localStorage === 'undefined') {
      return []
    }
    const raw = localStorage.getItem(nodeCollapseKey(universeId))
    if (raw === null) {
      return []
    }
    return sanitizeNodeCollapse(JSON.parse(raw) as unknown)
  } catch {
    // 隐私模式禁用存储，或 localStorage 里不是合法 JSON
    return []
  }
}

/** 写入某个世界的折叠记录；写入失败时只留在内存。 */
function writeCollapsedIds(universeId: string, collapsedIds: readonly string[]): void {
  if (universeId === '') {
    return
  }
  try {
    if (typeof localStorage === 'undefined') {
      return
    }
    localStorage.setItem(
      nodeCollapseKey(universeId),
      JSON.stringify({ collapsedIds: [...collapsedIds] }),
    )
  } catch {
    // 存储不可用时静默降级：本次会话内的折叠仍然有效
  }
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

/** 画布节点折叠偏好的读写接口。 */
export interface UseNodeCollapseReturn {
  /** 当前所有处于折叠态的节点 id。 */
  collapsedIds: ComputedRef<string[]>
  /** 当前使用的 localStorage 键；未加载世界时为 null。 */
  storageKey: ComputedRef<string | null>
  isCollapsed: (nodeId: string) => boolean
  toggle: (nodeId: string) => void
  expandAll: () => void
  /** 定位节点前展开把它藏起来的祖先；无关的折叠分支保持不变。 */
  revealNode: (nodeId: string, edges: readonly CollapseEdge[]) => void
}

/**
 * 节点折叠组合式函数：按 universeId 持久化到 localStorage。
 * 折叠只是画布视图状态，不写节点模型、不导出；存储不可用时退化为会话内状态。
 */
export function useNodeCollapse(universeId: MaybeRefOrGetter<string>): UseNodeCollapseReturn {
  const currentId = computed(() => toValue(universeId))
  const state = ref<string[]>(readCollapsedIds(currentId.value))

  // 切换世界时换成新世界的折叠记录，不把旧世界状态带过去
  watch(currentId, (id) => {
    state.value = readCollapsedIds(id)
  })

  const storageKey = computed(() =>
    currentId.value === '' ? null : nodeCollapseKey(currentId.value),
  )

  function commit(next: readonly string[]): void {
    if (sameIds(state.value, next)) {
      return
    }
    state.value = [...next]
    writeCollapsedIds(currentId.value, next)
  }

  function isCollapsed(nodeId: string): boolean {
    return state.value.includes(nodeId)
  }

  function toggle(nodeId: string): void {
    if (nodeId === '') {
      return
    }
    commit(
      isCollapsed(nodeId) ? state.value.filter((id) => id !== nodeId) : [...state.value, nodeId],
    )
  }

  function expandAll(): void {
    commit([])
  }

  function revealNode(nodeId: string, edges: readonly CollapseEdge[]): void {
    if (state.value.length === 0) {
      return
    }
    const revealed = revealedCollapsedIds(state.value, nodeId, edges)
    if (revealed.size === state.value.length) {
      return
    }
    commit(state.value.filter((id) => revealed.has(id)))
  }

  return {
    collapsedIds: computed(() => state.value),
    storageKey,
    isCollapsed,
    toggle,
    expandAll,
    revealNode,
  }
}
