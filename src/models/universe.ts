import { z } from 'zod'

/** 世界名称的最大长度，供表单与校验共用。 */
export const UNIVERSE_NAME_MAX_LENGTH = 120

/** 世界简介的最大长度，供表单与校验共用。 */
export const UNIVERSE_DESCRIPTION_MAX_LENGTH = 20000

/** 世界名称：1..120 个字符。 */
export const universeNameSchema = z.string().min(1).max(UNIVERSE_NAME_MAX_LENGTH)

export const UniverseSchema = z.object({
  id: z.string().min(1),
  name: universeNameSchema,
  description: z.string().max(UNIVERSE_DESCRIPTION_MAX_LENGTH).default(''),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

/** 世界（顶层的作品/设定集容器）。 */
export type Universe = z.infer<typeof UniverseSchema>
