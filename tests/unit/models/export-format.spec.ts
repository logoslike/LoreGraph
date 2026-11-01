import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LORE_FORMAT_VERSION,
  LORE_GRAPH_FORMAT,
  LORE_UNIVERSE_FORMAT,
  LoreGraphFileSchema,
  LoreUniverseFileSchema,
} from '@/models/export-format'
import { clone, makeExport, makeGraphExport } from './fixtures'

function hasPath(issues: { path: PropertyKey[] }[], path: string): boolean {
  return issues.some((issue) => issue.path.join('.') === path)
}

/** 仓库内置示例世界文件，与运行时 seedSample 使用同一份数据。 */
const SAMPLE_PATH = resolve(process.cwd(), 'public/examples/emberfall.json')

describe('导出文件格式校验', () => {
  it('格式标识与版本号固定为 loregraph.universe / loregraph.graph / 1', () => {
    expect(LORE_UNIVERSE_FORMAT).toBe('loregraph.universe')
    expect(LORE_GRAPH_FORMAT).toBe('loregraph.graph')
    expect(LORE_FORMAT_VERSION).toBe(1)
  })

  it('合法世界文件可以通过校验', () => {
    const result = LoreUniverseFileSchema.safeParse(makeExport())
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.types).toHaveLength(2)
      expect(result.data.nodes).toHaveLength(2)
      expect(result.data.edges).toHaveLength(1)
    }
  })

  it('合法图谱片段可以通过校验，且不要求 universe 字段', () => {
    const result = LoreGraphFileSchema.safeParse(makeGraphExport())
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.format).toBe(LORE_GRAPH_FORMAT)
      expect(result.data.nodes).toHaveLength(2)
    }
  })

  it('世界文件不能用图谱片段 schema 校验，反之亦然', () => {
    expect(LoreGraphFileSchema.safeParse(makeExport()).success).toBe(false)
    expect(LoreUniverseFileSchema.safeParse(makeGraphExport()).success).toBe(false)
  })

  it('错误 format 被拒绝', () => {
    const result = LoreUniverseFileSchema.safeParse({ ...makeExport(), format: 'other' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(hasPath(result.error.issues, 'format')).toBe(true)
    }
  })

  it('错误 formatVersion（0 / 2 / "1"）被拒绝', () => {
    for (const formatVersion of [0, 2, '1']) {
      const result = LoreUniverseFileSchema.safeParse({ ...makeExport(), formatVersion })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(hasPath(result.error.issues, 'formatVersion')).toBe(true)
      }
    }
  })

  it('exportedAt 必须是非负整数', () => {
    expect(LoreUniverseFileSchema.safeParse({ ...makeExport(), exportedAt: -1 }).success).toBe(
      false,
    )
    expect(LoreUniverseFileSchema.safeParse({ ...makeExport(), exportedAt: 1.5 }).success).toBe(
      false,
    )
    expect(LoreUniverseFileSchema.safeParse({ ...makeExport(), exportedAt: 0 }).success).toBe(true)
  })

  it('缺少 types / nodes / edges 数组时被拒绝', () => {
    const missing = clone(makeExport()) as Record<string, unknown>
    delete missing.nodes
    const result = LoreUniverseFileSchema.safeParse(missing)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(hasPath(result.error.issues, 'nodes')).toBe(true)
    }
  })

  it('嵌套节点非法时路径指向 nodes.N.*', () => {
    const broken = clone(makeExport())
    broken.nodes[0]!.name = ''
    const result = LoreUniverseFileSchema.safeParse(broken)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(hasPath(result.error.issues, 'nodes.0.name')).toBe(true)
    }
  })

  it('嵌套世界非法时路径指向 universe.*', () => {
    const broken = clone(makeExport())
    broken.universe.name = ''
    const result = LoreUniverseFileSchema.safeParse(broken)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(hasPath(result.error.issues, 'universe.name')).toBe(true)
    }
  })

  it('未知顶层字段被剥离', () => {
    const result = LoreUniverseFileSchema.safeParse({ ...makeExport(), extra: true })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(Object.keys(result.data).sort()).toEqual([
        'edges',
        'exportedAt',
        'format',
        'formatVersion',
        'nodes',
        'types',
        'universe',
      ])
    }
  })

  it('内置示例世界 emberfall.json 符合世界文件格式', () => {
    const raw = readFileSync(SAMPLE_PATH, 'utf8')
    const result = LoreUniverseFileSchema.safeParse(JSON.parse(raw))
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.format).toBe(LORE_UNIVERSE_FORMAT)
      expect(result.data.formatVersion).toBe(LORE_FORMAT_VERSION)
      expect(result.data.universe.name).toBe('烬海纪元')
      expect(result.data.types.length).toBe(13)
      expect(result.data.nodes).toHaveLength(12)
      expect(result.data.edges).toHaveLength(14)
      expect(result.data.types.some((type) => type.scope === 'node')).toBe(true)
      expect(result.data.types.some((type) => type.scope === 'relation')).toBe(true)
    }
  })
})
