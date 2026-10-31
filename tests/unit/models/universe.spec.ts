import { describe, expect, it } from 'vitest'
import { UniverseSchema, universeNameSchema } from '@/models/universe'
import { makeUniverse } from './fixtures'

/** 某条校验错误的路径是否命中。 */
function hasPath(issues: { path: PropertyKey[] }[], path: string): boolean {
  return issues.some((issue) => issue.path.join('.') === path)
}

describe('UniverseSchema 世界校验', () => {
  it('合法世界可以通过校验', () => {
    const result = UniverseSchema.safeParse(makeUniverse())
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('烬海纪元')
      expect(result.data.description).toContain('潮汐')
    }
  })

  it('缺省 description 时补为空字符串', () => {
    const result = UniverseSchema.safeParse({ ...makeUniverse(), description: undefined })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.description).toBe('')
    }
  })

  it('空名称被拒绝', () => {
    const result = UniverseSchema.safeParse(makeUniverse({ name: '' }))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(hasPath(result.error.issues, 'name')).toBe(true)
    }
  })

  it('超长名称（121 字符）被拒绝，120 字符通过', () => {
    expect(universeNameSchema.safeParse('世'.repeat(120)).success).toBe(true)
    const result = UniverseSchema.safeParse(makeUniverse({ name: '世'.repeat(121) }))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(hasPath(result.error.issues, 'name')).toBe(true)
    }
  })

  it('超长描述（20001 字符）被拒绝', () => {
    const result = UniverseSchema.safeParse(makeUniverse({ description: '潮'.repeat(20_001) }))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(hasPath(result.error.issues, 'description')).toBe(true)
    }
  })

  it('空 id 与负数时间戳被拒绝', () => {
    expect(UniverseSchema.safeParse(makeUniverse({ id: '' })).success).toBe(false)
    expect(UniverseSchema.safeParse(makeUniverse({ createdAt: -1 })).success).toBe(false)
    expect(UniverseSchema.safeParse(makeUniverse({ updatedAt: -1 })).success).toBe(false)
  })

  it('非整数时间戳被拒绝', () => {
    expect(UniverseSchema.safeParse(makeUniverse({ createdAt: 1.5 })).success).toBe(false)
    expect(UniverseSchema.safeParse(makeUniverse({ updatedAt: 1.5 })).success).toBe(false)
  })

  it('未知字段被剥离，不进入解析结果', () => {
    const result = UniverseSchema.safeParse({ ...makeUniverse(), unknown: 'x' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(Object.keys(result.data).sort()).toEqual([
        'createdAt',
        'description',
        'id',
        'name',
        'updatedAt',
      ])
    }
  })
})
