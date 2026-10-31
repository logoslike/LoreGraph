import { z } from 'zod'
import { entityTypeKeySchema } from './type-def'
import { propertiesSchema } from './node'

/** 关系（边）：连接两个节点，语义由关系类型 key 表达。 */
export const LoreEdgeSchema = z.object({
  id: z.string().min(1),
  universeId: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  relationType: entityTypeKeySchema,
  label: z.string().max(120).optional(),
  properties: propertiesSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export type LoreEdge = z.infer<typeof LoreEdgeSchema>
