/** 深拷贝，避免内存仓储与调用方共享可变对象引用。 */
export function cloneValue<T>(value: T): T {
  return structuredClone(value)
}
