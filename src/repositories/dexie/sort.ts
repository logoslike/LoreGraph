import type { EntityType } from '@/models/type-def'

/** 按创建时间升序、同一时间按 id 升序，保证读取顺序稳定。 */
export function sortByCreatedAt<T extends { id: string; createdAt: number }>(
  items: readonly T[],
): T[] {
  return [...items].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  )
}

/** 类型按 order 升序，其次创建时间与 id。 */
export function sortEntityTypes(items: readonly EntityType[]): EntityType[] {
  return [...items].sort(
    (a, b) => a.order - b.order || a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  )
}
