import { z } from 'zod'

/** 实体类型作用域：节点类型或关系类型。 */
export const EntityScopeSchema = z.enum(['node', 'relation'])

/** 类型 key：小写字母、数字与连字符，1..40 个字符。 */
export const entityTypeKeySchema = z.string().regex(/^[a-z0-9-]{1,40}$/)

/** 颜色：6 位十六进制，例如 #6366f1。 */
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)

/** 实体类型定义：节点与关系共用一套定义结构。 */
export const EntityTypeSchema = z.object({
  id: z.string().min(1),
  universeId: z.string().min(1),
  scope: EntityScopeSchema,
  key: entityTypeKeySchema,
  label: z.string().min(1).max(40),
  color: colorSchema,
  icon: z.string().max(40).optional(),
  order: z.number().int(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export type EntityType = z.infer<typeof EntityTypeSchema>
export type EntityScope = z.infer<typeof EntityScopeSchema>
