import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createMemoryRepositories } from '@/repositories/memory'
import { ImportServiceImpl } from '@/services/import.service'
import { clone, makeExport, makeNodeType, makeRelationType } from './fixtures'

const importer = new ImportServiceImpl(createMemoryRepositories())

/** 断言解析失败并返回可读问题列表。 */
function parseIssues(raw: string): string[] {
  const result = importer.parse(raw)
  expect(result.ok).toBe(false)
  return result.ok ? [] : result.issues
}

function expectIssue(issues: string[], fragment: string): void {
  expect(issues.join('\n')).toContain(fragment)
}

const SAMPLE_PATH = resolve(process.cwd(), 'public/examples/emberfall.json')

describe('ImportService.parse 结构与引用完整性校验', () => {
  it('合法导出文件解析成功并返回校验后的数据', () => {
    const result = importer.parse(JSON.stringify(makeExport()))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.universe.name).toBe('烬海纪元')
      expect(result.data.nodes).toHaveLength(2)
      expect(result.data.edges).toHaveLength(1)
    }
  })

  it('内置示例世界可以解析通过', () => {
    const result = importer.parse(readFileSync(SAMPLE_PATH, 'utf8'))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.nodes).toHaveLength(12)
      expect(result.data.edges).toHaveLength(14)
    }
  })

  it('非法 JSON 返回可读的「JSON 解析失败」问题', () => {
    const issues = parseIssues('{ not json ')
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('JSON 解析失败')
  })

  it('未知节点类型 key 给出带路径的问题', () => {
    const broken = clone(makeExport())
    broken.nodes[0]!.type = 'unknown-type'
    const issues = parseIssues(JSON.stringify(broken))
    expectIssue(issues, 'nodes.0.type')
    expectIssue(issues, '未定义')
    expectIssue(issues, 'unknown-type')
  })

  it('未知关系类型 key 给出带路径的问题', () => {
    const broken = clone(makeExport())
    broken.edges[0]!.relationType = 'unknown-relation'
    const issues = parseIssues(JSON.stringify(broken))
    expectIssue(issues, 'edges.0.relationType')
    expectIssue(issues, '未定义')
    expectIssue(issues, 'unknown-relation')
  })

  it('关系源端点缺失时报告 edges.N.source', () => {
    const broken = clone(makeExport())
    broken.edges[0]!.source = 'missing-node'
    const issues = parseIssues(JSON.stringify(broken))
    expectIssue(issues, 'edges.0.source')
    expectIssue(issues, '端点节点「missing-node」不存在')
  })

  it('关系目标端点缺失时报告 edges.N.target', () => {
    const broken = clone(makeExport())
    broken.edges[0]!.target = 'missing-node'
    const issues = parseIssues(JSON.stringify(broken))
    expectIssue(issues, 'edges.0.target')
    expectIssue(issues, '端点节点「missing-node」不存在')
  })

  it('重复节点 id 被拒绝并指出重复位置', () => {
    const broken = clone(makeExport())
    broken.nodes[1]!.id = broken.nodes[0]!.id
    const issues = parseIssues(JSON.stringify(broken))
    expectIssue(issues, 'nodes.1.id')
    expectIssue(issues, '重复')
  })

  it('重复类型 id 被拒绝', () => {
    const broken = clone(makeExport())
    broken.types[1]!.id = broken.types[0]!.id
    const issues = parseIssues(JSON.stringify(broken))
    expectIssue(issues, 'types.1.id')
    expectIssue(issues, '重复')
  })

  it('同一 scope 内重复 key 被拒绝，跨 scope 同名 key 允许', () => {
    const duplicated = clone(makeExport())
    duplicated.types.push(makeNodeType({ id: 'type-node-character-2', key: 'character' }))
    const issues = parseIssues(JSON.stringify(duplicated))
    expectIssue(issues, 'types.2.key')
    expectIssue(issues, '重复')

    const crossScope = clone(makeExport())
    crossScope.types.push(
      makeRelationType({ id: 'type-relation-character', key: 'character', label: '角色关系' }),
    )
    expect(importer.parse(JSON.stringify(crossScope)).ok).toBe(true)
  })

  it('类型、节点与关系的 universeId 必须与世界一致', () => {
    const broken = clone(makeExport())
    broken.types[0]!.universeId = 'other-universe'
    broken.nodes[0]!.universeId = 'other-universe'
    broken.edges[0]!.universeId = 'other-universe'
    const issues = parseIssues(JSON.stringify(broken))
    expectIssue(issues, 'types.0.universeId')
    expectIssue(issues, 'nodes.0.universeId')
    expectIssue(issues, 'edges.0.universeId')
    expectIssue(issues, '与世界 id 不一致')
  })

  it('一次报告全部引用问题，而不是只报第一条', () => {
    const broken = clone(makeExport())
    broken.nodes[0]!.type = 'unknown-type'
    broken.nodes[1]!.universeId = 'other-universe'
    broken.edges[0]!.source = 'missing-node'
    broken.edges[0]!.relationType = 'unknown-relation'
    const issues = parseIssues(JSON.stringify(broken))
    expect(issues.length).toBeGreaterThanOrEqual(4)
    expect(issues.every((issue) => issue.includes('：'))).toBe(true)
  })

  it('schema 层级错误同样给出字段路径（错误 formatVersion）', () => {
    const broken = { ...clone(makeExport()), formatVersion: 2 }
    const issues = parseIssues(JSON.stringify(broken))
    expectIssue(issues, 'formatVersion')
  })

  it('schema 层级错误定位到嵌套字段（空节点名）', () => {
    const broken = clone(makeExport())
    broken.nodes[0]!.name = ''
    const issues = parseIssues(JSON.stringify(broken))
    expectIssue(issues, 'nodes.0.name')
  })

  it('schema 层级错误定位到根对象缺失字段', () => {
    const issues = parseIssues(JSON.stringify({ universe: clone(makeExport().universe) }))
    expectIssue(issues, 'format')
    expectIssue(issues, 'formatVersion')
    expectIssue(issues, 'nodes')
  })
})
