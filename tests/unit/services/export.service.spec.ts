import { describe, expect, it } from 'vitest'
import type { LoreEdge } from '@/models/edge'
import { LORE_GRAPH_FORMAT, LORE_UNIVERSE_FORMAT } from '@/models/export-format'
import { createServices } from '@/services'
import { defaultExportFilename, expandWithNeighbors } from '@/services/export.service'
import type { Services } from '@/services/types'
import { captureError, createTestContext } from '../repositories/test-db'
import { makeExport, makeGraphExport } from '../models/fixtures'

function setup(): Services {
  const { repos } = createTestContext()
  return createServices(repos)
}

/** 造一个三节点、三条关系的小世界。 */
async function seedTriangle(services: Services) {
  const universe = await services.universes.create({ name: '烬海纪元' })
  const hero = await services.graph.createNode({
    universeId: universe.id,
    type: 'character',
    name: '澜舟',
    description: '潮汐教团的引路人。',
    properties: { age: 32, alive: true },
    position: { x: 10.5, y: -20 },
  })
  const bay = await services.graph.createNode({
    universeId: universe.id,
    type: 'location',
    name: '沉钟湾',
    description: '守灯人驻守的海湾。',
    position: { x: 220, y: 40 },
  })
  const tide = await services.graph.createNode({
    universeId: universe.id,
    type: 'event',
    name: '长明潮',
    position: { x: -80, y: 180 },
  })
  const heroInBay = await services.graph.createEdge({
    universeId: universe.id,
    source: hero.id,
    target: bay.id,
    relationType: 'located-in',
    label: '驻守',
  })
  const tideInBay = await services.graph.createEdge({
    universeId: universe.id,
    source: tide.id,
    target: bay.id,
    relationType: 'located-in',
  })
  const tideCauses = await services.graph.createEdge({
    universeId: universe.id,
    source: tide.id,
    target: hero.id,
    relationType: 'causes',
  })
  return { universe, hero, bay, tide, heroInBay, tideInBay, tideCauses }
}

describe('ExportService.exportUniverse', () => {
  it('输出新的世界文件格式标识与完整数据', async () => {
    const services = setup()
    const { universe } = await seedTriangle(services)

    const exported = await services.exporter.exportUniverse(universe.id)
    expect(exported.format).toBe(LORE_UNIVERSE_FORMAT)
    expect(exported.formatVersion).toBe(1)
    expect(exported.universe.id).toBe(universe.id)
    expect(exported.types).toHaveLength(12)
    expect(exported.nodes).toHaveLength(3)
    expect(exported.edges).toHaveLength(3)
  })

  it('世界不存在时给出领域错误', async () => {
    const services = setup()
    const error = await captureError(() => services.exporter.exportUniverse('missing-universe'))
    expect(error.message).toContain('世界不存在')
  })
})

describe('ExportService.exportGraph', () => {
  it('只包含选中节点、被引用的类型与两端都在集合内的关系', async () => {
    const services = setup()
    const { universe, hero, bay } = await seedTriangle(services)

    const { data, omittedEdgeCount } = await services.exporter.exportGraph(universe.id, [
      hero.id,
      bay.id,
    ])

    expect(data.format).toBe(LORE_GRAPH_FORMAT)
    expect(data.formatVersion).toBe(1)
    expect('universe' in data).toBe(false)
    expect(data.nodes.map((node) => node.name).sort()).toEqual(['澜舟', '沉钟湾'].sort())
    expect(data.edges).toHaveLength(1)
    expect(data.edges[0].relationType).toBe('located-in')
    // 「长明潮」在选中集合外，与它相关的两条关系被丢弃
    expect(omittedEdgeCount).toBe(2)
    expect(data.types.map((type) => `${type.scope}:${type.key}`).sort()).toEqual([
      'node:character',
      'node:location',
      'relation:located-in',
    ])
    expect(data.nodes.find((node) => node.id === hero.id)?.position).toEqual(hero.position)
  })

  it('完全在选中集合外的关系不计入 omittedEdgeCount', async () => {
    const services = setup()
    const { universe, hero, bay, tide } = await seedTriangle(services)

    const { data, omittedEdgeCount } = await services.exporter.exportGraph(universe.id, [hero.id])

    expect(data.nodes).toHaveLength(1)
    expect(data.edges).toHaveLength(0)
    // hero 与 bay、tide 各有一条关系被丢弃；tide-bay 完全在外，不计数
    expect(omittedEdgeCount).toBe(2)
    expect(data.nodes[0].id).toBe(hero.id)
    expect(tide.id).toBeTruthy()
    expect(bay.id).toBeTruthy()
  })

  it('选中未知节点 id 时只导出存在的节点', async () => {
    const services = setup()
    const { universe, hero } = await seedTriangle(services)

    const { data, omittedEdgeCount } = await services.exporter.exportGraph(universe.id, [
      hero.id,
      'missing-node',
    ])
    expect(data.nodes).toHaveLength(1)
    expect(omittedEdgeCount).toBe(2)
  })
})

describe('expandWithNeighbors', () => {
  function edge(source: string, target: string): LoreEdge {
    return { source, target } as LoreEdge
  }

  it('加入与选中节点直接相邻的节点', () => {
    const expanded = expandWithNeighbors([edge('a', 'b'), edge('c', 'b'), edge('d', 'e')], ['b'])
    expect([...expanded].sort()).toEqual(['a', 'b', 'c'])
  })

  it('只扩展一层，不沿关系链继续扩散', () => {
    const expanded = expandWithNeighbors([edge('a', 'b'), edge('b', 'c')], ['a'])
    expect([...expanded].sort()).toEqual(['a', 'b'])
  })
})

describe('defaultExportFilename', () => {
  it('世界文件用世界名，图谱片段用固定前缀', () => {
    const world = defaultExportFilename(makeExport())
    expect(world).toMatch(/^烬海纪元-\d{8}\.loregraph\.json$/)
    const graph = defaultExportFilename(makeGraphExport())
    expect(graph).toMatch(/^图谱片段-\d{8}\.loregraph\.json$/)
  })
})
