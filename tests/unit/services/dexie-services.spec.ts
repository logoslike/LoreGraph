import { describe, expect, it } from 'vitest'
import type { EntityType } from '@/models/type-def'
import { createServices } from '@/services'
import { GraphError } from '@/services/errors'
import type { Services } from '@/services/types'
import { captureError, createTestContext, idsOf } from '../repositories/test-db'

function setup(): Services {
  const { repos } = createTestContext()
  return createServices(repos)
}

/** 造一个包含两个节点、一条关系的基础世界。 */
async function seedWorld(services: Services) {
  const universe = await services.universes.create({ name: '穹顶之下' })
  const hero = await services.graph.createNode({
    universeId: universe.id,
    type: 'character',
    name: '林澈',
    description: '主角',
    properties: { age: 27 },
    position: { x: 10, y: 20 },
  })
  const city = await services.graph.createNode({
    universeId: universe.id,
    type: 'location',
    name: '浮空城',
    position: { x: 300, y: 160 },
  })
  const edge = await services.graph.createEdge({
    universeId: universe.id,
    source: hero.id,
    target: city.id,
    relationType: 'located-in',
    label: '常驻',
  })
  return { universe, hero, city, edge }
}

describe('Dexie 上的世界服务', () => {
  it('创建世界时在同一事务内写入 6 个节点类型与 6 个关系类型', async () => {
    const services = setup()
    const universe = await services.universes.create({ name: '烬海' })

    const types = await services.types.list(universe.id)
    expect(types).toHaveLength(12)

    const nodeTypes = types.filter((type) => type.scope === 'node')
    expect(nodeTypes.map((type) => type.key)).toEqual([
      'character',
      'organization',
      'location',
      'event',
      'item',
      'concept',
    ])
    expect(nodeTypes.map((type) => type.order)).toEqual([0, 1, 2, 3, 4, 5])
    expect(nodeTypes.every((type) => /^#[0-9a-f]{6}$/i.test(type.color))).toBe(true)

    const relationTypes = types.filter((type) => type.scope === 'relation')
    expect(relationTypes.map((type) => type.key)).toEqual([
      'member-of',
      'allies-with',
      'located-in',
      'participates-in',
      'causes',
      'related-to',
    ])
  })

  it('删除节点会在事务内级联删除关联关系，并可完整撤销', async () => {
    const services = setup()
    const { universe, hero, city, edge } = await seedWorld(services)

    const snapshot = await services.graph.deleteNode(hero.id)
    expect(snapshot.node.id).toBe(hero.id)
    expect(idsOf(snapshot.edges)).toEqual([edge.id])

    expect(idsOf(await services.graph.listNodes(universe.id))).toEqual([city.id])
    expect(await services.graph.listEdges(universe.id)).toEqual([])

    await services.graph.restoreNode(snapshot)
    expect(idsOf(await services.graph.listNodes(universe.id)).sort()).toEqual(
      [hero.id, city.id].sort(),
    )
    const restored = await services.graph.listEdges(universe.id)
    expect(restored).toHaveLength(1)
    expect(restored[0]).toEqual(edge)
  })

  it('删除世界会级联清理其下节点、关系与类型，其他世界不受影响', async () => {
    const services = setup()
    const worldA = await services.universes.create({ name: '甲界' })
    const worldB = await services.universes.create({ name: '乙界' })
    const a1 = await services.graph.createNode({
      universeId: worldA.id,
      type: 'character',
      name: '甲一',
      position: { x: 0, y: 0 },
    })
    const a2 = await services.graph.createNode({
      universeId: worldA.id,
      type: 'character',
      name: '甲二',
      position: { x: 1, y: 1 },
    })
    await services.graph.createEdge({
      universeId: worldA.id,
      source: a1.id,
      target: a2.id,
      relationType: 'related-to',
    })
    await services.graph.createNode({
      universeId: worldB.id,
      type: 'character',
      name: '乙一',
      position: { x: 2, y: 2 },
    })

    await services.universes.remove(worldA.id)
    expect(await services.universes.get(worldA.id)).toBeNull()
    expect(await services.types.list(worldA.id)).toEqual([])
    expect(await services.graph.listNodes(worldA.id)).toEqual([])
    expect(await services.graph.listEdges(worldA.id)).toEqual([])

    expect(await services.graph.listNodes(worldB.id)).toHaveLength(1)
    expect(await services.types.list(worldB.id)).toHaveLength(12)

    const missing = await captureError(() => services.universes.remove(worldA.id))
    expect(missing.name).toBe('LoreGraphError')
  })

  it('被节点引用的类型不可删除，删除节点后可删除', async () => {
    const services = setup()
    const universe = await services.universes.create({ name: '烬海' })
    const node = await services.graph.createNode({
      universeId: universe.id,
      type: 'character',
      name: '林澈',
      position: { x: 0, y: 0 },
    })
    const types = await services.types.list(universe.id, 'node')
    const character = types.find((type) => type.key === 'character')
    expect(character).toBeDefined()

    const blocked = await captureError(() => services.types.remove(character!.id))
    expect(blocked).toMatchObject({ name: 'TypeInUseError', count: 1 })

    await services.graph.deleteNode(node.id)
    await expect(services.types.remove(character!.id)).resolves.toBeUndefined()
  })

  it('导出 → 解析 → 导入的往返语义等价（忽略 id 与时间戳）', async () => {
    const services = setup()
    const { universe, hero, city, edge } = await seedWorld(services)

    const exported = await services.exporter.toExport(universe.id)
    expect(exported.format).toBe('loregraph')
    expect(exported.formatVersion).toBe(1)

    const parsed = services.importer.parse(JSON.stringify(exported))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }

    const imported = await services.importer.import(parsed.data)
    expect(imported.id).not.toBe(universe.id)
    expect(imported.name).toBe('穹顶之下（导入）')

    const signature = (types: EntityType[]) =>
      types.map((type) => `${type.scope}:${type.key}:${type.label}:${type.color}`).sort()
    expect(signature(await services.types.list(imported.id))).toEqual(
      signature(await services.types.list(universe.id)),
    )

    const importedNodes = await services.graph.listNodes(imported.id)
    expect(importedNodes).toHaveLength(2)
    const importedHero = importedNodes.find((node) => node.name === hero.name)
    const importedCity = importedNodes.find((node) => node.name === city.name)
    expect(importedHero?.id).not.toBe(hero.id)
    expect(importedHero?.description).toBe(hero.description)
    expect(importedHero?.properties).toEqual(hero.properties)
    expect(importedHero?.position).toEqual(hero.position)

    const importedEdges = await services.graph.listEdges(imported.id)
    expect(importedEdges).toHaveLength(1)
    expect(importedEdges[0].id).not.toBe(edge.id)
    expect(importedEdges[0].relationType).toBe(edge.relationType)
    expect(importedEdges[0].label).toBe(edge.label)
    expect(importedEdges[0].source).toBe(importedHero?.id)
    expect(importedEdges[0].target).toBe(importedCity?.id)

    // 原始世界的数据不受导入影响
    expect(await services.graph.listNodes(universe.id)).toHaveLength(2)
    expect(await services.graph.listEdges(universe.id)).toHaveLength(1)
  })

  it('非法 JSON 与引用缺失都会被拒绝，问题信息带字段路径', async () => {
    const services = setup()
    const { universe } = await seedWorld(services)
    const exported = await services.exporter.toExport(universe.id)

    const syntax = services.importer.parse('{ 这不是合法 JSON')
    expect(syntax.ok).toBe(false)
    if (!syntax.ok) {
      expect(syntax.issues[0]).toContain('JSON 解析失败')
    }

    const malformed = services.importer.parse(
      JSON.stringify({ ...exported, nodes: 'not-an-array' }),
    )
    expect(malformed.ok).toBe(false)
    if (!malformed.ok) {
      expect(malformed.issues.join('\n')).toContain('nodes')
    }

    const broken = JSON.parse(JSON.stringify(exported)) as typeof exported
    broken.edges[0].source = 'missing-node'
    const rejected = services.importer.parse(JSON.stringify(broken))
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) {
      expect(rejected.issues.join('\n')).toContain('edges.0.source')
      expect(await services.graph.listEdges(universe.id)).toHaveLength(1)
    }
  })

  it('重复关系、自连关系与端点缺失都会被拒绝', async () => {
    const services = setup()
    const { universe, hero, city } = await seedWorld(services)

    const duplicate = await captureError(() =>
      services.graph.createEdge({
        universeId: universe.id,
        source: hero.id,
        target: city.id,
        relationType: 'located-in',
      }),
    )
    expect(duplicate).toBeInstanceOf(GraphError)

    const selfLoop = await captureError(() =>
      services.graph.createEdge({
        universeId: universe.id,
        source: hero.id,
        target: hero.id,
        relationType: 'related-to',
      }),
    )
    expect(selfLoop).toBeInstanceOf(GraphError)

    const missingEndpoint = await captureError(() =>
      services.graph.createEdge({
        universeId: universe.id,
        source: hero.id,
        target: 'missing-node',
        relationType: 'related-to',
      }),
    )
    expect(missingEndpoint).toBeInstanceOf(GraphError)

    expect(await services.graph.listEdges(universe.id)).toHaveLength(1)
  })
})
