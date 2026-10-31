import { describe, expect, it } from 'vitest'
import { LoreEdgeSchema } from '@/models/edge'
import { makeEdge } from './fixtures'

function hasPath(issues: { path: PropertyKey[] }[], path: string): boolean {
  return issues.some((issue) => issue.path.join('.') === path)
}

describe('LoreEdgeSchema 关系校验', () => {
  it('合法关系可以通过校验，并保留可选 label', () => {
    const result = LoreEdgeSchema.safeParse(makeEdge())
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.label).toBe('亦师亦友')
      expect(result.data.relationType).toBe('allies-with')
      expect(result.data.source).toBe('node-1')
      expect(result.data.target).toBe('node-2')
    }
  })

  it('label 缺省时解析结果不含该字段', () => {
    const result = LoreEdgeSchema.safeParse({ ...makeEdge(), label: undefined })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.label).toBeUndefined()
    }
  })

  it('超长 label（121 字符）被拒绝，空字符串允许', () => {
    expect(LoreEdgeSchema.safeParse(makeEdge({ label: '关'.repeat(121) })).success).toBe(false)
    expect(LoreEdgeSchema.safeParse(makeEdge({ label: '' })).success).toBe(true)
  })

  it('非法关系类型 key 被拒绝', () => {
    const result = LoreEdgeSchema.safeParse(makeEdge({ relationType: 'Allies_With' }))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(hasPath(result.error.issues, 'relationType')).toBe(true)
    }
  })

  it('空端点、空 id 与空 universeId 被拒绝', () => {
    expect(LoreEdgeSchema.safeParse(makeEdge({ source: '' })).success).toBe(false)
    expect(LoreEdgeSchema.safeParse(makeEdge({ target: '' })).success).toBe(false)
    expect(LoreEdgeSchema.safeParse(makeEdge({ id: '' })).success).toBe(false)
    expect(LoreEdgeSchema.safeParse(makeEdge({ universeId: '' })).success).toBe(false)
  })

  it('properties 缺省为 {}，非法属性值被拒绝', () => {
    const result = LoreEdgeSchema.safeParse({ ...makeEdge(), properties: undefined })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.properties).toEqual({})
    }
    expect(LoreEdgeSchema.safeParse({ ...makeEdge(), properties: { bad: [1] } }).success).toBe(
      false,
    )
  })

  it('缺失必填字段时给出对应字段路径', () => {
    const result = LoreEdgeSchema.safeParse({ id: 'edge-1' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'))
      expect(paths).toEqual(
        expect.arrayContaining(['universeId', 'source', 'target', 'relationType']),
      )
    }
  })

  it('非整数时间戳被拒绝', () => {
    expect(LoreEdgeSchema.safeParse(makeEdge({ createdAt: -5 })).success).toBe(false)
    expect(LoreEdgeSchema.safeParse(makeEdge({ updatedAt: 1.5 })).success).toBe(false)
  })
})
