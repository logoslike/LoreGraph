import { describe, expect, it } from 'vitest'
import {
  EntityScopeSchema,
  EntityTypeSchema,
  colorSchema,
  entityTypeKeySchema,
} from '@/models/type-def'
import { makeNodeType, makeRelationType } from './fixtures'

function hasPath(issues: { path: PropertyKey[] }[], path: string): boolean {
  return issues.some((issue) => issue.path.join('.') === path)
}

describe('EntityTypeSchema 实体类型校验', () => {
  it('节点类型与关系类型都能通过校验', () => {
    expect(EntityTypeSchema.safeParse(makeNodeType()).success).toBe(true)
    expect(EntityTypeSchema.safeParse(makeRelationType()).success).toBe(true)
  })

  it('scope 只接受 node 与 relation', () => {
    expect(EntityScopeSchema.safeParse('node').success).toBe(true)
    expect(EntityScopeSchema.safeParse('relation').success).toBe(true)
    expect(EntityScopeSchema.safeParse('edge').success).toBe(false)
    expect(EntityScopeSchema.safeParse('NODE').success).toBe(false)
  })

  it('非法 scope 被拒绝并带字段路径', () => {
    const result = EntityTypeSchema.safeParse({ ...makeNodeType(), scope: 'unknown' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(hasPath(result.error.issues, 'scope')).toBe(true)
    }
  })

  it('key 必须由小写字母、数字与连字符组成', () => {
    expect(entityTypeKeySchema.safeParse('character').success).toBe(true)
    expect(entityTypeKeySchema.safeParse('allies-with').success).toBe(true)
    expect(entityTypeKeySchema.safeParse('type-2').success).toBe(true)
    expect(entityTypeKeySchema.safeParse('Character').success).toBe(false)
    expect(entityTypeKeySchema.safeParse('角色').success).toBe(false)
    expect(entityTypeKeySchema.safeParse('with_underscore').success).toBe(false)
    expect(entityTypeKeySchema.safeParse('a'.repeat(41)).success).toBe(false)
  })

  it('非法颜色被拒绝（必须是 6 位十六进制）', () => {
    expect(colorSchema.safeParse('#6366f1').success).toBe(true)
    expect(colorSchema.safeParse('#ABCDEF').success).toBe(true)
    expect(colorSchema.safeParse('6366f1').success).toBe(false)
    expect(colorSchema.safeParse('#12345').success).toBe(false)
    expect(colorSchema.safeParse('#1234567').success).toBe(false)
    expect(colorSchema.safeParse('#gggggg').success).toBe(false)

    const result = EntityTypeSchema.safeParse(makeNodeType({ color: 'indigo' }))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(hasPath(result.error.issues, 'color')).toBe(true)
    }
  })

  it('空 label 与超长 label（41 字符）被拒绝', () => {
    expect(EntityTypeSchema.safeParse(makeNodeType({ label: '' })).success).toBe(false)
    expect(EntityTypeSchema.safeParse(makeNodeType({ label: '类'.repeat(41) })).success).toBe(false)
    expect(EntityTypeSchema.safeParse(makeNodeType({ label: '类'.repeat(40) })).success).toBe(true)
  })

  it('order 必须是整数', () => {
    expect(EntityTypeSchema.safeParse(makeNodeType({ order: 1 })).success).toBe(true)
    expect(EntityTypeSchema.safeParse(makeNodeType({ order: 1.5 })).success).toBe(false)
  })

  it('icon 可选且不超过 40 字符', () => {
    const withoutIcon = { ...makeNodeType() } as Record<string, unknown>
    delete withoutIcon.icon
    expect(EntityTypeSchema.safeParse(withoutIcon).success).toBe(true)
    expect(EntityTypeSchema.safeParse(makeNodeType({ icon: 'i'.repeat(41) })).success).toBe(false)
  })

  it('空 id、空 universeId 与非法时间戳被拒绝', () => {
    expect(EntityTypeSchema.safeParse(makeNodeType({ id: '' })).success).toBe(false)
    expect(EntityTypeSchema.safeParse(makeNodeType({ universeId: '' })).success).toBe(false)
    expect(EntityTypeSchema.safeParse(makeNodeType({ createdAt: -1 })).success).toBe(false)
    expect(EntityTypeSchema.safeParse(makeNodeType({ updatedAt: 2.5 })).success).toBe(false)
  })
})
