import { z } from 'zod'
import { UniverseSchema } from './universe'
import { EntityTypeSchema } from './type-def'
import { LoreNodeSchema } from './node'
import { LoreEdgeSchema } from './edge'

/** 世界导出文件的格式标识。 */
export const LORE_UNIVERSE_FORMAT = 'loregraph.universe' as const
/** 图谱片段导出文件的格式标识。 */
export const LORE_GRAPH_FORMAT = 'loregraph.graph' as const
/** 导出文件的格式版本，结构变更时递增。 */
export const LORE_FORMAT_VERSION = 1 as const

/** 两种文件共有的头部与数据字段。 */
const fileHeaderShape = {
  formatVersion: z.literal(LORE_FORMAT_VERSION),
  exportedAt: z.number().int().nonnegative(),
  types: z.array(EntityTypeSchema),
  nodes: z.array(LoreNodeSchema),
  edges: z.array(LoreEdgeSchema),
}

/** 世界导出文件：单个世界及其全部类型、节点与关系。 */
export const LoreUniverseFileSchema = z.object({
  format: z.literal(LORE_UNIVERSE_FORMAT),
  ...fileHeaderShape,
  universe: UniverseSchema,
})

/** 图谱片段导出文件：被选中的节点、它们引用的类型，以及两端都在片段内的关系。 */
export const LoreGraphFileSchema = z.object({
  format: z.literal(LORE_GRAPH_FORMAT),
  ...fileHeaderShape,
})

export type LoreUniverseFile = z.infer<typeof LoreUniverseFileSchema>
export type LoreGraphFile = z.infer<typeof LoreGraphFileSchema>
/** 导入文件：世界文件或图谱片段。 */
export type LoreImportFile = LoreUniverseFile | LoreGraphFile
/** 文件的格式标识。 */
export type LoreFileFormat = LoreImportFile['format']
