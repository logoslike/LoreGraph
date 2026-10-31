import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LORE_EXPORT_FORMAT, LORE_FORMAT_VERSION, LoreExportSchema } from '@/models/export-format'
import { clone, makeExport } from './fixtures'

function hasPath(issues: { path: PropertyKey[] }[], path: string): boolean {
  return issues.some((issue) => issue.path.join('.') === path)
}

/** 仓库内置示例世界文件，与运行时 seedSample 使用同一份数据。 */
const SAMPLE_PATH = resolve(process.cwd(), 'public/examples/emberfall.json')

describe('LoreExportSchema 导出格式校验', () => {
  it('格式标识与版本号固定为 loregraph / 1', () => {
    expect(LORE_EXPORT_FORMAT).toBe('loregraph')
    expect(LORE_FORMAT_VERSION).toBe(1)
  })

  it('合法导出文件可以通过校验', () => {
    const result = LoreExportSchema.safeParse(makeExport())
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.types).toHaveLength(2)
      expect(result.data.nodes).toHaveLength(2)
      expect(result.data.edges).toHaveLength(1)
    }
  })

  it('错误 format 被拒绝', () => {
    const result = LoreExportSchema.safeParse({ ...makeExport(), format: 'other' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(hasPath(result.error.issues, 'format')).toBe(true)
    }
  })

  it('错误 formatVersion（0 / 2 / "1"）被拒绝', () => {
    for (const formatVersion of [0, 2, '1']) {
      const result = LoreExportSchema.safeParse({ ...makeExport(), formatVersion })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(hasPath(result.error.issues, 'formatVersion')).toBe(true)
      }
    }
  })

  it('exportedAt 必须是非负整数', () => {
    expect(LoreExportSchema.safeParse({ ...makeExport(), exportedAt: -1 }).success).toBe(false)
    expect(LoreExportSchema.safeParse({ ...makeExport(), exportedAt: 1.5 }).success).toBe(false)
    expect(LoreExportSchema.safeParse({ ...makeExport(), exportedAt: 0 }).success).toBe(true)
  })

  it('缺少 types / nodes / edges 数组时被拒绝', () => {
    const missing = clone(makeExport()) as Record<string, unknown>
    delete missing.nodes
    const result = LoreExportSchema.safeParse(missing)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(hasPath(result.error.issues, 'nodes')).toBe(true)
    }
  })

  it('嵌套节点非法时路径指向 nodes.N.*', () => {
    const broken = clone(makeExport())
    broken.nodes[0]!.name = ''
    const result = LoreExportSchema.safeParse(broken)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(hasPath(result.error.issues, 'nodes.0.name')).toBe(true)
    }
  })

  it('嵌套世界非法时路径指向 universe.*', () => {
    const broken = clone(makeExport())
    broken.universe.name = ''
    const result = LoreExportSchema.safeParse(broken)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(hasPath(result.error.issues, 'universe.name')).toBe(true)
    }
  })

  it('未知顶层字段被剥离', () => {
    const result = LoreExportSchema.safeParse({ ...makeExport(), extra: true })
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

  it('内置示例世界 emberfall.json 符合导出格式', () => {
    const raw = readFileSync(SAMPLE_PATH, 'utf8')
    const result = LoreExportSchema.safeParse(JSON.parse(raw))
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.format).toBe(LORE_EXPORT_FORMAT)
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
