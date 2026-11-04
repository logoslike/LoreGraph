import { computed, ref, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { isRelatedToExpanded, type ExpansionEdge } from '@/services/expansion'

const STORAGE_PREFIX = 'loregraph.node-expansion'

/** 某个世界的关系展开记录存储键：展开是视图状态，按世界隔离。 */
export function nodeExpansionKey(universeId: string): string {
  return `${STORAGE_PREFIX}.${universeId}`
}

/** 把读到的任意值收敛成去重后的节点 id 列表；坏数据一律当作没有展开。 */
export function sanitizeNodeExpansion(value: unknown): string[] {
  let source: unknown[] = []
  if (Array.isArray(value)) {
    source = value
  } else if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    if (Array.isArray(record.expandedNodeIds)) {
      source = record.expandedNodeIds
    }
  }
  const ids = source.filter((id): id is string => typeof id === 'string' && id !== '')
  return [...new Set(ids)]
}

/** 读取某个世界的展开记录；存储被禁用、内容损坏时一律当作空集合。 */
function readExpandedIds(universeId: string): string[] {
  if (universeId === '') {
    return []
  }
  try {
    if (typeof localStorage === 'undefined') {
      return []
    }
    const raw = localStorage.getItem(nodeExpansionKey(universeId))
    if (raw === null) {
      return []
    }
    return sanitizeNodeExpansion(JSON.parse(raw) as unknown)
  } catch {
    // 隐私模式禁用存储，或 localStorage 里不是合法 JSON
    return []
  }
}

/** 写入某个世界的展开记录；写入失败时只留在内存。 */
function writeExpandedIds(universeId: string, expandedIds: readonly string[]): void {
  if (universeId === '') {
    return
  }
  try {
    if (typeof localStorage === 'undefined') {
      return
    }
    localStorage.setItem(
      nodeExpansionKey(universeId),
      JSON.stringify({ expandedNodeIds: [...expandedIds] }),
    )
  } catch {
    // 存储不可用时静默降级：本次会话内的展开仍然有效
  }
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

/** 画布大图关系展开状态的读写接口。 */
export interface UseNodeExpansionReturn {
  /** 当前已展开直接关系的节点 id。 */
  expandedIds: ComputedRef<string[]>
  /** 当前使用的 localStorage 键；未加载世界时为 null。 */
  storageKey: ComputedRef<string | null>
  isExpanded: (nodeId: string) => boolean
  expand: (nodeId: string) => void
  /** 卡片点击语义：与已展开节点无直接关联时收起整组旧展开，只保留新节点。 */
  expandOnClick: (nodeId: string, edges: readonly ExpansionEdge[]) => void
  collapse: (nodeId: string) => void
  toggle: (nodeId: string) => void
  collapseAll: () => void
  /** 丢弃当前图中已不存在的 id（删除节点、切换/导入世界后调用）。 */
  retain: (existingNodeIds: ReadonlySet<string>) => void
}

/**
 * 大图关系展开组合式函数：按 universeId 持久化到 localStorage。
 * 展开只是画布视图状态，不写节点模型、不导出；存储不可用时退化为会话内状态。
 */
export function useNodeExpansion(universeId: MaybeRefOrGetter<string>): UseNodeExpansionReturn {
  const currentId = computed(() => toValue(universeId))
  const state = ref<string[]>(readExpandedIds(currentId.value))

  // 切换世界时换成新世界的展开记录，不把旧世界状态带过去
  watch(currentId, (id) => {
    state.value = readExpandedIds(id)
  })

  const storageKey = computed(() =>
    currentId.value === '' ? null : nodeExpansionKey(currentId.value),
  )

  function commit(next: readonly string[]): void {
    if (sameIds(state.value, next)) {
      return
    }
    state.value = [...next]
    writeExpandedIds(currentId.value, next)
  }

  function isExpanded(nodeId: string): boolean {
    return state.value.includes(nodeId)
  }

  function expand(nodeId: string): void {
    if (nodeId === '' || isExpanded(nodeId)) {
      return
    }
    commit([...state.value, nodeId])
  }

  /**
   * 大图点击节点：目标与已展开节点有直接关系（或重复点自己）时延用累加展开；
   * 完全无关联时说明用户换到了另一条关系链，整组旧展开收起，只保留新节点。
   * 重置只提交一次，避免先写空集合再写新节点的两次落盘。
   */
  function expandOnClick(nodeId: string, edges: readonly ExpansionEdge[]): void {
    if (nodeId === '') {
      return
    }
    if (isRelatedToExpanded(nodeId, state.value, edges)) {
      expand(nodeId)
      return
    }
    commit([nodeId])
  }

  function collapse(nodeId: string): void {
    if (!isExpanded(nodeId)) {
      return
    }
    commit(state.value.filter((id) => id !== nodeId))
  }

  function toggle(nodeId: string): void {
    if (isExpanded(nodeId)) {
      collapse(nodeId)
    } else {
      expand(nodeId)
    }
  }

  function collapseAll(): void {
    commit([])
  }

  function retain(existingNodeIds: ReadonlySet<string>): void {
    if (state.value.length === 0) {
      return
    }
    const next = state.value.filter((id) => existingNodeIds.has(id))
    if (next.length === state.value.length) {
      return
    }
    commit(next)
  }

  return {
    expandedIds: computed(() => state.value),
    storageKey,
    isExpanded,
    expand,
    expandOnClick,
    collapse,
    toggle,
    collapseAll,
    retain,
  }
}
