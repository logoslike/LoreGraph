import { z } from 'zod'
import { entityTypeKeySchema } from './type-def'

/** 自定义属性值：字符串、数字、布尔或空。 */
export const propertyValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])

/** 节点/关系的自定义属性表。 */
export const propertiesSchema = z.record(z.string(), propertyValueSchema).default({})

/** 画布坐标，必须是有限数字。 */
export const positionSchema = z.object({
  x: z.number().refine(Number.isFinite, 'x 必须是有限数字'),
  y: z.number().refine(Number.isFinite, 'y 必须是有限数字'),
})

export const LoreNodeSchema = z.object({
  id: z.string().min(1),
  universeId: z.string().min(1),
  type: entityTypeKeySchema,
  name: z.string().min(1).max(120),
  description: z.string().max(20000).default(''),
  properties: propertiesSchema,
  position: positionSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export type LoreNode = z.infer<typeof LoreNodeSchema>
export type NodePosition = z.infer<typeof positionSchema>
export type NodeProperties = z.infer<typeof propertiesSchema>
