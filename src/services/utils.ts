/** 去掉值为 undefined 的字段，避免用 undefined 覆盖已有数据。 */
export function pickDefined<T extends object>(source: T): Partial<T> {
  const entries = Object.entries(source).filter(([, value]) => value !== undefined)
  return Object.fromEntries(entries) as Partial<T>
}

/** 按创建时间稳定升序排序（Array.prototype.sort 在 ES2019+ 稳定）。 */
export function sortByCreatedAt<T extends { createdAt: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.createdAt - b.createdAt)
}
