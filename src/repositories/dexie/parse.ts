import type { z } from 'zod'
import type { TableName } from '@/repositories/types'

/**
 * 逐行解析列表数据：单行校验失败时跳过并告警，其余行照常返回。
 *
 * 历史数据或异常写入可能留下不合规的记录；列表读取不应因一行坏数据整体失败。
 * 这里只跳过，不删除也不改写原始记录，单条按 id 读取的方法仍走严格校验。
 */
export function parseRows<T>(
  table: TableName,
  rows: readonly { id?: unknown }[],
  schema: z.ZodType<T>,
): T[] {
  const items: T[] = []
  for (const row of rows) {
    const result = schema.safeParse(row)
    if (result.success) {
      items.push(result.data)
      continue
    }
    console.warn(
      `[LoreGraph] 跳过 ${table} 表中校验失败的行（id=${String(row.id)}）：${result.error.message}`,
    )
  }
  return items
}
