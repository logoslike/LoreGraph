import { z } from 'zod'

/** 世界名称：1..120 个字符。 */
export const universeNameSchema = z.string().min(1).max(120)

export const UniverseSchema = z.object({
  id: z.string().min(1),
  name: universeNameSchema,
  description: z.string().max(20000).default(''),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

/** 世界（顶层的作品/设定集容器）。 */
export type Universe = z.infer<typeof UniverseSchema>
