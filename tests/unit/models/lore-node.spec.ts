import { describe, expect, it } from 'vitest'
import { LoreNodeSchema, positionSchema, propertiesSchema } from '@/models/node'
import { makeNode } from './fixtures'

function hasPath(issues: { path: PropertyKey[] }[], path: string): boolean {
  return issues.some((issue) => issue.path.join('.') === path)
}

describe('LoreNodeSchema 节点校验', () => {
  it('合法节点可以通过校验', () => {
    const result = LoreNodeSchema.safeParse(makeNode())
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('澜舟')
      expect(result.data.properties).toEqual({ age: 32, alive: true, title: null })
      expect(result.data.position).toEqual({ x: 10.5, y: -20 })
    }
  })

  it('缺省 description 与 properties 时补默认值', () => {
    const result = LoreNodeSchema.safeParse({
      ...makeNode(),
      description: undefined,
      properties: undefined,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.description).toBe('')
      expect(result.data.properties).toEqual({})
    }
  })

  it('空名称被拒绝', () => {
    const result = LoreNodeSchema.safeParse(makeNode({ name: '' }))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(hasPath(result.error.issues, 'name')).toBe(true)
    }
  })

  it('超长名称（121 字符）被拒绝', () => {
    expect(LoreNodeSchema.safeParse(makeNode({ name: '澜'.repeat(121) })).success).toBe(false)
    expect(LoreNodeSchema.safeParse(makeNode({ name: '澜'.repeat(120) })).success).toBe(true)
  })

  it('超长描述（20001 字符）被拒绝', () => {
    const result = LoreNodeSchema.safeParse(makeNode({ description: '潮'.repeat(20_001) }))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(hasPath(result.error.issues, 'description')).toBe(true)
    }
  })

  it('非法节点类型 key 被拒绝', () => {
    const result = LoreNodeSchema.safeParse(makeNode({ type: '角色' }))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(hasPath(result.error.issues, 'type')).toBe(true)
    }
  })

  it('非有限坐标被拒绝（NaN / Infinity / -Infinity）', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const result = LoreNodeSchema.safeParse(makeNode({ position: { x: value, y: 0 } }))
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(hasPath(result.error.issues, 'position.x')).toBe(true)
      }
    }
    const infinity = positionSchema.safeParse({ x: Number.POSITIVE_INFINITY, y: 0 })
    expect(infinity.success).toBe(false)
    if (!infinity.success) {
      expect(infinity.error.issues[0]?.path.join('.')).toBe('x')
    }
    expect(
      LoreNodeSchema.safeParse(makeNode({ position: { x: 0, y: Number.NEGATIVE_INFINITY } }))
        .success,
    ).toBe(false)
  })

  it('坐标必须是数字且两端都必填', () => {
    expect(positionSchema.safeParse({ x: 0, y: 0 }).success).toBe(true)
    expect(positionSchema.safeParse({ x: '0', y: 0 }).success).toBe(false)
    expect(positionSchema.safeParse({ x: 0 }).success).toBe(false)
    expect(positionSchema.safeParse({ y: 0 }).success).toBe(false)
  })

  it('自定义属性只接受字符串、数字、布尔与 null', () => {
    expect(propertiesSchema.safeParse({ age: 1, name: 'x', ok: false, none: null }).success).toBe(
      true,
    )
    expect(propertiesSchema.safeParse({ list: [1, 2] }).success).toBe(false)
    expect(propertiesSchema.safeParse({ nested: { a: 1 } }).success).toBe(false)
    expect(propertiesSchema.safeParse({ missing: undefined }).success).toBe(false)
    expect(propertiesSchema.safeParse(undefined).success).toBe(true)
  })

  it('空 id、空 universeId 与非整数时间戳被拒绝', () => {
    expect(LoreNodeSchema.safeParse(makeNode({ id: '' })).success).toBe(false)
    expect(LoreNodeSchema.safeParse(makeNode({ universeId: '' })).success).toBe(false)
    expect(LoreNodeSchema.safeParse(makeNode({ createdAt: -1 })).success).toBe(false)
    expect(LoreNodeSchema.safeParse(makeNode({ updatedAt: 1.5 })).success).toBe(false)
  })
})
