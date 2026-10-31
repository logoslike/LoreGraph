import { z } from 'zod'
import { UniverseSchema } from './universe'
import { EntityTypeSchema } from './type-def'
import { LoreNodeSchema } from './node'
import { LoreEdgeSchema } from './edge'

/** 导出文件的格式标识。 */
export const LORE_EXPORT_FORMAT = 'loregraph' as const
/** 导出文件的格式版本，结构变更时递增。 */
export const LORE_FORMAT_VERSION = 1 as const

/** 世界导出文件结构：单个世界及其全部类型、节点与关系。 */
export const LoreExportSchema = z.object({
  format: z.literal(LORE_EXPORT_FORMAT),
  formatVersion: z.literal(LORE_FORMAT_VERSION),
  exportedAt: z.number().int().nonnegative(),
  universe: UniverseSchema,
  types: z.array(EntityTypeSchema),
  nodes: z.array(LoreNodeSchema),
  edges: z.array(LoreEdgeSchema),
})

export type LoreExport = z.infer<typeof LoreExportSchema>
