import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createMemoryRepositories } from '@/repositories/memory'
import { ImportServiceImpl } from '@/services/import.service'
import { clone, makeExport, makeNodeType, makeRelationType } from './fixtures'

const importer = new ImportServiceImpl(createMemoryRepositories())

/** 断言分析失败并返回可读问题列表。 */
async function analyzeErrors(raw: string): Promise<string[]> {
  const preview = await importer.analyzeImport(raw, { mode: 'new-universe' })
  expect(preview.canImport).toBe(false)
  return preview.errors
}

function expectIssue(issues: string[], fragment: string): void {
  expect(issues.join('\n')).toContain(fragment)
}

const SAMPLE_PATH = resolve(process.cwd(), 'public/examples/emberfall.json')

describe('ImportService.analyzeImport 结构与引用完整性校验', () => {
  it('合法导出文件分析成功并给出世界信息', async () => {
    const preview = await importer.analyzeImport(JSON.stringify(makeExport()), {
      mode: 'new-universe',
    })
    expect(preview.canImport).toBe(true)
    expect(preview.format).toBe('loregraph.universe')
    expect(preview.universeName).toBe('烬海纪元')
    expect(preview.nodeCount).toBe(2)
    expect(preview.edgeCount).toBe(1)
    expect(preview.errors).toEqual([])
    expect(preview.plan).not.toBeNull()
  })

  it('内置示例世界可以分析通过', async () => {
    const preview = await importer.analyzeImport(readFileSync(SAMPLE_PATH, 'utf8'), {
      mode: 'new-universe',
    })
    expect(preview.canImport).toBe(true)
    expect(preview.nodeCount).toBe(12)
    expect(preview.edgeCount).toBe(14)
  })

  it('非法 JSON 返回可读的「JSON 解析失败」问题', async () => {
    const issues = await analyzeErrors('{ not json ')
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('JSON 解析失败')
  })

  it('未知节点类型 key 给出带路径的问题', async () => {
    const broken = clone(makeExport())
    broken.nodes[0]!.type = 'unknown-type'
    const issues = await analyzeErrors(JSON.stringify(broken))
    expectIssue(issues, 'nodes.0.type')
    expectIssue(issues, '未定义')
    expectIssue(issues, 'unknown-type')
  })

  it('未知关系类型 key 给出带路径的问题', async () => {
    const broken = clone(makeExport())
    broken.edges[0]!.relationType = 'unknown-relation'
    const issues = await analyzeErrors(JSON.stringify(broken))
    expectIssue(issues, 'edges.0.relationType')
    expectIssue(issues, '未定义')
    expectIssue(issues, 'unknown-relation')
  })

  it('关系源端点缺失时报告 edges.N.source', async () => {
    const broken = clone(makeExport())
    broken.edges[0]!.source = 'missing-node'
    const issues = await analyzeErrors(JSON.stringify(broken))
    expectIssue(issues, 'edges.0.source')
    expectIssue(issues, '端点节点「missing-node」不存在')
  })

  it('关系目标端点缺失时报告 edges.N.target', async () => {
    const broken = clone(makeExport())
    broken.edges[0]!.target = 'missing-node'
    const issues = await analyzeErrors(JSON.stringify(broken))
    expectIssue(issues, 'edges.0.target')
    expectIssue(issues, '端点节点「missing-node」不存在')
  })

  it('重复节点 id 被拒绝并指出重复位置', async () => {
    const broken = clone(makeExport())
    broken.nodes[1]!.id = broken.nodes[0]!.id
    const issues = await analyzeErrors(JSON.stringify(broken))
    expectIssue(issues, 'nodes.1.id')
    expectIssue(issues, '重复')
  })

  it('重复类型 id 被拒绝', async () => {
    const broken = clone(makeExport())
    broken.types[1]!.id = broken.types[0]!.id
    const issues = await analyzeErrors(JSON.stringify(broken))
    expectIssue(issues, 'types.1.id')
    expectIssue(issues, '重复')
  })

  it('同一 scope 内重复 key 被拒绝，跨 scope 同名 key 允许', async () => {
    const duplicated = clone(makeExport())
    duplicated.types.push(makeNodeType({ id: 'type-node-character-2', key: 'character' }))
    const issues = await analyzeErrors(JSON.stringify(duplicated))
    expectIssue(issues, 'types.2.key')
    expectIssue(issues, '重复')

    const crossScope = clone(makeExport())
    crossScope.types.push(
      makeRelationType({ id: 'type-relation-character', key: 'character', label: '角色关系' }),
    )
    const preview = await importer.analyzeImport(JSON.stringify(crossScope), {
      mode: 'new-universe',
    })
    expect(preview.canImport).toBe(true)
  })

  it('类型、节点与关系的 universeId 必须与世界一致', async () => {
    const broken = clone(makeExport())
    broken.types[0]!.universeId = 'other-universe'
    broken.nodes[0]!.universeId = 'other-universe'
    broken.edges[0]!.universeId = 'other-universe'
    const issues = await analyzeErrors(JSON.stringify(broken))
    expectIssue(issues, 'types.0.universeId')
    expectIssue(issues, 'nodes.0.universeId')
    expectIssue(issues, 'edges.0.universeId')
    expectIssue(issues, '与世界 id 不一致')
  })

  it('一次报告全部引用问题，而不是只报第一条', async () => {
    const broken = clone(makeExport())
    broken.nodes[0]!.type = 'unknown-type'
    broken.nodes[1]!.universeId = 'other-universe'
    broken.edges[0]!.source = 'missing-node'
    broken.edges[0]!.relationType = 'unknown-relation'
    const issues = await analyzeErrors(JSON.stringify(broken))
    expect(issues.length).toBeGreaterThanOrEqual(4)
    expect(issues.every((issue) => issue.includes('：'))).toBe(true)
  })

  it('schema 层级错误定位到嵌套字段（空节点名）', async () => {
    const broken = clone(makeExport())
    broken.nodes[0]!.name = ''
    const issues = await analyzeErrors(JSON.stringify(broken))
    expectIssue(issues, 'nodes.0.name')
  })

  it('缺少 format 与 formatVersion 时给出明确中文错误', async () => {
    const issues = await analyzeErrors(JSON.stringify({ universe: clone(makeExport().universe) }))
    expectIssue(issues, '缺少 format 字段')
    expectIssue(issues, '缺少 formatVersion 字段')
  })
})
