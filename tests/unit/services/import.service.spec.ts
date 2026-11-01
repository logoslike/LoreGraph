import { describe, expect, it } from 'vitest'
import type { LoreEdge } from '@/models/edge'
import type { EntityType } from '@/models/type-def'
import {
  LORE_FORMAT_VERSION,
  LORE_UNIVERSE_FORMAT,
  LoreUniverseFileSchema,
} from '@/models/export-format'
import { createServices } from '@/services'
import type { ImportOptions, Services } from '@/services/types'
import { captureError, createTestContext } from '../repositories/test-db'
import { clone, TS } from '../models/fixtures'

function setup() {
  const { repos, db } = createTestContext()
  return { services: createServices(repos), repos, db }
}

/** 忽略主键与世界归属，用于比较业务数据。 */
function stripIdentity<T extends { id: string; universeId: string }>(
  row: T,
): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...row }
  delete copy.id
  delete copy.universeId
  return copy
}

/** 关系形状：端点先映射为节点名，便于跨世界比较。 */
function edgeShape(edge: LoreEdge, names: Map<string, string>): Record<string, unknown> {
  return {
    source: names.get(edge.source),
    target: names.get(edge.target),
    relationType: edge.relationType,
    label: edge.label,
    properties: edge.properties,
    createdAt: edge.createdAt,
    updatedAt: edge.updatedAt,
  }
}

function typeSignature(types: readonly EntityType[]): string[] {
  return types
    .map(
      (type) =>
        `${type.scope}:${type.key}:${type.label}:${type.color}:${type.icon ?? ''}:${type.order}`,
    )
    .sort()
}

/** 造一个包含两个节点、一条关系的世界。 */
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

describe('世界文件以 new-universe 导入', () => {
  it('导出、删除后重新导入，业务数据一致、仅 id 不同', async () => {
    const { services } = setup()
    const universe = await services.universes.create({
      name: '烬海纪元',
      description: '潮汐文明',
    })
    const hero = await services.graph.createNode({
      universeId: universe.id,
      type: 'character',
      name: '澜舟',
      description: '潮汐教团的引路人。',
      properties: { age: 32, alive: true, title: null },
      position: { x: 120.5, y: -80 },
    })
    const city = await services.graph.createNode({
      universeId: universe.id,
      type: 'location',
      name: '沉钟湾',
      description: '守灯人驻守的海湾。',
      position: { x: 420, y: 60 },
    })
    await services.graph.createEdge({
      universeId: universe.id,
      source: hero.id,
      target: city.id,
      relationType: 'located-in',
      label: '驻守',
      properties: { since: 1024 },
    })

    const exported = await services.exporter.exportUniverse(universe.id)
    await services.universes.remove(universe.id)
    expect(await services.universes.list()).toEqual([])

    const preview = await services.importer.analyzeImport(JSON.stringify(exported), {
      mode: 'new-universe',
    })
    expect(preview.canImport).toBe(true)
    expect(preview.errors).toEqual([])
    expect(preview.universeName).toBe('烬海纪元')
    expect(preview.nodeCount).toBe(2)
    expect(preview.edgeCount).toBe(1)

    const result = await services.importer.commitImport(preview)
    expect(result).toMatchObject({
      createdUniverse: true,
      createdTypes: 12,
      reusedTypes: 0,
      createdNodes: 2,
      createdEdges: 1,
    })

    const importedUniverse = await services.universes.get(result.universeId)
    expect(importedUniverse?.name).toBe('烬海纪元（导入）')
    expect(importedUniverse?.description).toBe(universe.description)

    const importedTypes = await services.types.list(result.universeId)
    expect(typeSignature(importedTypes)).toEqual(typeSignature(exported.types))

    const importedNodes = await services.graph.listNodes(result.universeId)
    const importedEdges = await services.graph.listEdges(result.universeId)
    const originalIds = new Set(
      [...exported.types, ...exported.nodes, ...exported.edges].map((row) => row.id),
    )
    expect(
      [...importedTypes, ...importedNodes, ...importedEdges].some((row) => originalIds.has(row.id)),
    ).toBe(false)

    expect(importedNodes).toHaveLength(2)
    const nodesByName = new Map(importedNodes.map((node) => [node.name, node]))
    for (const source of exported.nodes) {
      const imported = nodesByName.get(source.name)
      expect(imported).toBeDefined()
      expect(stripIdentity(imported!)).toEqual(stripIdentity(source))
    }

    expect(importedEdges).toHaveLength(1)
    const sourceNames = new Map(exported.nodes.map((node) => [node.id, node.name]))
    const importedNames = new Map(importedNodes.map((node) => [node.id, node.name]))
    expect(edgeShape(importedEdges[0], importedNames)).toEqual(
      edgeShape(exported.edges[0], sourceNames),
    )
  })
})

describe('图谱片段以 merge 导入', () => {
  /** 造一个三节点、三条关系、包含片段外节点的世界。 */
  async function seedGraphSource(services: Services) {
    const source = await services.universes.create({ name: '源世界' })
    const hero = await services.graph.createNode({
      universeId: source.id,
      type: 'character',
      name: '澜舟',
      properties: { age: 32 },
      position: { x: 10.5, y: -20 },
    })
    const bay = await services.graph.createNode({
      universeId: source.id,
      type: 'location',
      name: '沉钟湾',
      position: { x: 220, y: 40 },
    })
    const tide = await services.graph.createNode({
      universeId: source.id,
      type: 'event',
      name: '长明潮',
      position: { x: -80, y: 180 },
    })
    const heroInBay = await services.graph.createEdge({
      universeId: source.id,
      source: hero.id,
      target: bay.id,
      relationType: 'located-in',
      label: '驻守',
      properties: { since: 1024 },
    })
    await services.graph.createEdge({
      universeId: source.id,
      source: tide.id,
      target: bay.id,
      relationType: 'located-in',
    })
    await services.graph.createEdge({
      universeId: source.id,
      source: tide.id,
      target: hero.id,
      relationType: 'causes',
    })
    return { source, hero, bay, tide, heroInBay }
  }

  it('写入节点与关系，端点映射、位置与类型复用都正确', async () => {
    const { services } = setup()
    const { source, hero, bay, heroInBay } = await seedGraphSource(services)
    const { data, omittedEdgeCount } = await services.exporter.exportGraph(source.id, [
      hero.id,
      bay.id,
    ])
    expect(data.nodes).toHaveLength(2)
    expect(data.edges).toHaveLength(1)
    expect(omittedEdgeCount).toBe(2)

    const target = await services.universes.create({ name: '目标世界' })
    const typesBefore = await services.types.list(target.id)
    const preview = await services.importer.analyzeImport(JSON.stringify(data), {
      mode: 'merge',
      targetUniverseId: target.id,
    })
    expect(preview.canImport).toBe(true)
    expect(preview.universeName).toBeNull()
    expect(preview.newTypes).toEqual([])
    expect(preview.reusedTypes.map((type) => `${type.scope}:${type.key}`).sort()).toEqual([
      'node:character',
      'node:location',
      'relation:located-in',
    ])

    const result = await services.importer.commitImport(preview)
    expect(result).toMatchObject({
      universeId: target.id,
      createdUniverse: false,
      createdTypes: 0,
      reusedTypes: 3,
      createdNodes: 2,
      createdEdges: 1,
    })

    const targetNodes = await services.graph.listNodes(target.id)
    expect(targetNodes).toHaveLength(2)
    const importedHero = targetNodes.find((node) => node.name === '澜舟')
    const importedBay = targetNodes.find((node) => node.name === '沉钟湾')
    expect(importedHero?.id).not.toBe(hero.id)
    expect(importedHero?.position).toEqual(hero.position)
    expect(importedHero?.properties).toEqual(hero.properties)

    const targetEdges = await services.graph.listEdges(target.id)
    expect(targetEdges).toHaveLength(1)
    expect(targetEdges[0].id).not.toBe(heroInBay.id)
    expect(targetEdges[0].source).toBe(importedHero?.id)
    expect(targetEdges[0].target).toBe(importedBay?.id)
    expect(targetEdges[0].relationType).toBe('located-in')
    expect(targetEdges[0].label).toBe('驻守')
    expect(targetEdges[0].properties).toEqual({ since: 1024 })

    expect(await services.types.list(target.id)).toHaveLength(typesBefore.length)
    expect((await services.universes.get(target.id))?.name).toBe('目标世界')
  })

  it('merge 时新建缺失类型并追加 order，忽略文件中的世界信息', async () => {
    const { services } = setup()
    const source = await services.universes.create({ name: '来源世界', description: '来源简介' })
    const shipType = await services.types.create({
      universeId: source.id,
      scope: 'node',
      key: 'ship',
      label: '舰船',
      color: '#0ea5e9',
    })
    const ship = await services.graph.createNode({
      universeId: source.id,
      type: 'ship',
      name: '破浪号',
      position: { x: 0, y: 0 },
    })
    const exported = await services.exporter.exportUniverse(source.id)

    const target = await services.universes.create({ name: '目标世界', description: '目标简介' })
    const targetNodeTypes = await services.types.list(target.id, 'node')
    const nextOrder = Math.max(...targetNodeTypes.map((type) => type.order)) + 1

    const preview = await services.importer.analyzeImport(JSON.stringify(exported), {
      mode: 'merge',
      targetUniverseId: target.id,
    })
    expect(preview.canImport).toBe(true)
    expect(preview.newTypes.map((type) => type.key)).toEqual(['ship'])
    expect(preview.reusedTypes).toHaveLength(12)

    const result = await services.importer.commitImport(preview)
    expect(result.createdTypes).toBe(1)
    expect(result.reusedTypes).toBe(12)

    const createdShip = (await services.types.list(target.id, 'node')).find(
      (type) => type.key === 'ship',
    )
    expect(createdShip).toBeDefined()
    expect(createdShip?.id).not.toBe(shipType.id)
    expect(createdShip?.label).toBe('舰船')
    expect(createdShip?.color).toBe('#0ea5e9')
    expect(createdShip?.order).toBe(nextOrder)

    const importedShip = (await services.graph.listNodes(target.id)).find(
      (node) => node.name === '破浪号',
    )
    expect(importedShip?.type).toBe('ship')
    expect(importedShip?.id).not.toBe(ship.id)

    const targetAfter = await services.universes.get(target.id)
    expect(targetAfter?.name).toBe('目标世界')
    expect(targetAfter?.description).toBe('目标简介')
  })

  it('同一片段重复导入到包含相同 id 的世界不冲突，节点翻倍', async () => {
    const { services } = setup()
    const universe = await services.universes.create({ name: '自导入' })
    const hero = await services.graph.createNode({
      universeId: universe.id,
      type: 'character',
      name: '林澈',
      position: { x: 10, y: 20 },
    })
    const city = await services.graph.createNode({
      universeId: universe.id,
      type: 'location',
      name: '浮空城',
      position: { x: 300, y: 160 },
    })
    await services.graph.createEdge({
      universeId: universe.id,
      source: hero.id,
      target: city.id,
      relationType: 'located-in',
    })
    const { data } = await services.exporter.exportGraph(universe.id, [hero.id, city.id])

    for (let round = 0; round < 2; round += 1) {
      const preview = await services.importer.analyzeImport(JSON.stringify(data), {
        mode: 'merge',
        targetUniverseId: universe.id,
      })
      expect(preview.canImport).toBe(true)
      expect(preview.errors).toEqual([])
      await services.importer.commitImport(preview)
    }

    const nodes = await services.graph.listNodes(universe.id)
    expect(nodes).toHaveLength(6)
    expect(nodes.filter((node) => node.name === '林澈')).toHaveLength(3)
    const edges = await services.graph.listEdges(universe.id)
    expect(edges).toHaveLength(3)
    const ids = new Set(nodes.map((node) => node.id))
    expect(edges.every((edge) => ids.has(edge.source) && ids.has(edge.target))).toBe(true)
  })
})

describe('导入校验错误', () => {
  it('端点缺失、损坏 JSON、旧格式与错误版本都被拒绝且不写库', async () => {
    const { services, db } = setup()
    const target = await services.universes.create({ name: '目标世界' })
    const { universe, edge } = await seedWorld(services)
    const exported = await services.exporter.exportUniverse(universe.id)
    await services.universes.remove(universe.id)

    const before = {
      universes: await db.universes.count(),
      entityTypes: await db.entityTypes.count(),
      nodes: await db.nodes.count(),
      edges: await db.edges.count(),
    }
    expect(before).toEqual({ universes: 1, entityTypes: 12, nodes: 0, edges: 0 })

    const cases: { raw: string; options: ImportOptions; fragment: string }[] = [
      {
        raw: JSON.stringify({
          ...exported,
          edges: [{ ...edge, universeId: exported.universe.id, source: 'missing-node' }],
        }),
        options: { mode: 'merge', targetUniverseId: target.id },
        fragment: 'edges.0.source',
      },
      { raw: '{ not json', options: { mode: 'new-universe' }, fragment: 'JSON 解析失败' },
      {
        raw: JSON.stringify({ ...exported, format: 'loregraph' }),
        options: { mode: 'new-universe' },
        fragment: '不支持的文件格式：loregraph',
      },
      {
        raw: JSON.stringify({ ...exported, formatVersion: 2 }),
        options: { mode: 'new-universe' },
        fragment: '不支持的格式版本：2，当前支持 1',
      },
      {
        raw: JSON.stringify({ ...exported, nodes: 'not-an-array' }),
        options: { mode: 'new-universe' },
        fragment: 'nodes',
      },
    ]

    for (const item of cases) {
      const preview = await services.importer.analyzeImport(item.raw, item.options)
      expect(preview.canImport).toBe(false)
      expect(preview.plan).toBeNull()
      expect(preview.errors.join('\n')).toContain(item.fragment)
    }

    expect(await db.universes.count()).toBe(before.universes)
    expect(await db.entityTypes.count()).toBe(before.entityTypes)
    expect(await db.nodes.count()).toBe(before.nodes)
    expect(await db.edges.count()).toBe(before.edges)
  })

  it('图谱片段只能 merge，merge 必须指定存在的目标世界', async () => {
    const { services } = setup()
    const { universe, hero } = await seedWorld(services)
    const { data } = await services.exporter.exportGraph(universe.id, [hero.id])

    const wrongMode = await services.importer.analyzeImport(JSON.stringify(data), {
      mode: 'new-universe',
    })
    expect(wrongMode.canImport).toBe(false)
    expect(wrongMode.errors.join('\n')).toContain('图谱片段只能合并到已有世界')

    const missingTarget = await services.importer.analyzeImport(JSON.stringify(data), {
      mode: 'merge',
    })
    expect(missingTarget.canImport).toBe(false)
    expect(missingTarget.errors.join('\n')).toContain('合并导入必须指定目标世界')

    const unknownTarget = await services.importer.analyzeImport(JSON.stringify(data), {
      mode: 'merge',
      targetUniverseId: 'missing-universe',
    })
    expect(unknownTarget.canImport).toBe(false)
    expect(unknownTarget.errors.join('\n')).toContain('目标世界不存在或已被删除')
  })
})

describe('导入预览', () => {
  it('列出类型复用、类型冲突、重名节点与自连/重复关系警告', async () => {
    const { services } = setup()
    const source = await services.universes.create({ name: '来源世界' })
    await services.types.create({
      universeId: source.id,
      scope: 'node',
      key: 'ship',
      label: '舰船',
      color: '#0ea5e9',
    })
    const hero = await services.graph.createNode({
      universeId: source.id,
      type: 'character',
      name: '林澈',
      position: { x: 10, y: 20 },
    })
    const ship = await services.graph.createNode({
      universeId: source.id,
      type: 'ship',
      name: '破浪号',
      position: { x: 200, y: 60 },
    })
    await services.graph.createEdge({
      universeId: source.id,
      source: hero.id,
      target: ship.id,
      relationType: 'related-to',
    })
    const exported = await services.exporter.exportUniverse(source.id)

    const file = clone(exported)
    const character = file.types.find((type) => type.scope === 'node' && type.key === 'character')
    expect(character).toBeDefined()
    character!.label = '主角'
    character!.color = '#ff0000'
    // 与目标世界重名的节点
    file.nodes.push({
      ...clone(file.nodes[0]!),
      id: 'node-duplicate',
      name: '林澈',
      createdAt: TS + 10,
      updatedAt: TS + 10,
    })
    // 自连关系与重复关系
    file.edges.push({
      ...clone(file.edges[0]!),
      id: 'edge-self',
      target: hero.id,
      createdAt: TS + 11,
      updatedAt: TS + 11,
    })
    file.edges.push({
      ...clone(file.edges[0]!),
      id: 'edge-duplicate',
      createdAt: TS + 12,
      updatedAt: TS + 12,
    })

    const target = await services.universes.create({ name: '目标世界' })
    await services.graph.createNode({
      universeId: target.id,
      type: 'character',
      name: '林澈',
      position: { x: 0, y: 0 },
    })

    const preview = await services.importer.analyzeImport(JSON.stringify(file), {
      mode: 'merge',
      targetUniverseId: target.id,
    })
    expect(preview.canImport).toBe(true)
    expect(preview.typeConflicts).toEqual([
      {
        scope: 'node',
        key: 'character',
        incoming: { label: '主角', color: '#ff0000' },
        existing: { label: '角色', color: '#6366f1' },
      },
    ])
    expect(preview.reusedTypes.map((type) => type.key)).toContain('character')
    expect(preview.newTypes.map((type) => type.key)).toEqual(['ship'])
    expect(preview.duplicateNodeNames).toContain('林澈')
    expect(preview.warnings.join('\n')).toContain('自连关系')
    expect(preview.warnings.join('\n')).toContain('重复关系')

    const result = await services.importer.commitImport(preview)
    expect(result.createdTypes).toBe(1)
    // 冲突时以现有类型为准
    const characterType = (await services.types.list(target.id, 'node')).find(
      (type) => type.key === 'character',
    )
    expect(characterType?.label).toBe('角色')
    expect(characterType?.color).toBe('#6366f1')
    const importedShip = (await services.graph.listNodes(target.id)).find(
      (node) => node.name === '破浪号',
    )
    expect(importedShip?.type).toBe('ship')
  })
})

describe('提交原子性', () => {
  it('new-universe 写入中途失败时全部回滚', async () => {
    const { services, repos, db } = setup()
    const { universe } = await seedWorld(services)
    const exported = await services.exporter.exportUniverse(universe.id)
    await services.universes.remove(universe.id)
    const preview = await services.importer.analyzeImport(JSON.stringify(exported), {
      mode: 'new-universe',
    })
    expect(preview.canImport).toBe(true)

    repos.nodes.bulkPut = async () => {
      throw new Error('模拟节点写入失败')
    }
    const error = await captureError(() => services.importer.commitImport(preview))
    expect(error.message).toContain('模拟节点写入失败')

    expect(await db.universes.count()).toBe(0)
    expect(await db.entityTypes.count()).toBe(0)
    expect(await db.nodes.count()).toBe(0)
    expect(await db.edges.count()).toBe(0)
  })

  it('merge 写入中途失败时全部回滚，目标世界保持原样', async () => {
    const { services, repos, db } = setup()
    const { universe } = await seedWorld(services)
    const exported = await services.exporter.exportUniverse(universe.id)
    await services.universes.remove(universe.id)
    const target = await services.universes.create({ name: '目标世界' })
    const preview = await services.importer.analyzeImport(JSON.stringify(exported), {
      mode: 'merge',
      targetUniverseId: target.id,
    })
    expect(preview.canImport).toBe(true)

    repos.edges.bulkPut = async () => {
      throw new Error('模拟关系写入失败')
    }
    const error = await captureError(() => services.importer.commitImport(preview))
    expect(error.message).toContain('模拟关系写入失败')

    expect(await db.nodes.count()).toBe(0)
    expect(await db.edges.count()).toBe(0)
    expect(await db.entityTypes.count()).toBe(12)
    expect(await db.universes.count()).toBe(1)
    expect((await services.universes.get(target.id))?.name).toBe('目标世界')
  })

  it('分析后目标世界的类型发生变化时拒绝提交', async () => {
    const { services, db } = setup()
    const { universe, hero } = await seedWorld(services)
    const { data } = await services.exporter.exportGraph(universe.id, [hero.id])
    await services.universes.remove(universe.id)
    const target = await services.universes.create({ name: '目标世界' })
    const preview = await services.importer.analyzeImport(JSON.stringify(data), {
      mode: 'merge',
      targetUniverseId: target.id,
    })
    expect(preview.canImport).toBe(true)

    await services.types.create({
      universeId: target.id,
      scope: 'relation',
      key: 'betrays',
      label: '背叛',
      color: '#b91c1c',
    })

    const error = await captureError(() => services.importer.commitImport(preview))
    expect(error.message).toContain('目标世界在分析后已发生变化')
    expect(await db.nodes.count()).toBe(0)
    expect(await db.edges.count()).toBe(0)
    expect(await db.entityTypes.count()).toBe(13)
  })
})

describe('大数据量导入', () => {
  it('500 节点 / 1500 关系导入成功并记录耗时', async () => {
    const { services } = setup()
    const universeId = 'universe-large'
    const nodeCount = 500
    const edgeCount = 1500
    const file = LoreUniverseFileSchema.parse({
      format: LORE_UNIVERSE_FORMAT,
      formatVersion: LORE_FORMAT_VERSION,
      exportedAt: TS,
      universe: {
        id: universeId,
        name: '大规模世界',
        description: '',
        createdAt: TS,
        updatedAt: TS,
      },
      types: [
        {
          id: 'type-node-character',
          universeId,
          scope: 'node',
          key: 'character',
          label: '角色',
          color: '#6366f1',
          order: 0,
          createdAt: TS,
          updatedAt: TS,
        },
        {
          id: 'type-relation-related',
          universeId,
          scope: 'relation',
          key: 'related-to',
          label: '相关',
          color: '#94a3b8',
          order: 0,
          createdAt: TS,
          updatedAt: TS,
        },
      ],
      nodes: Array.from({ length: nodeCount }, (_, index) => ({
        id: `node-${index}`,
        universeId,
        type: 'character',
        name: `节点${index}`,
        description: '',
        properties: {},
        position: { x: index, y: -index },
        createdAt: TS + index,
        updatedAt: TS + index,
      })),
      edges: Array.from({ length: edgeCount }, (_, index) => ({
        id: `edge-${index}`,
        universeId,
        source: `node-${index % nodeCount}`,
        target: `node-${(index * 7 + 1) % nodeCount}`,
        relationType: 'related-to',
        properties: {},
        createdAt: TS + index,
        updatedAt: TS + index,
      })),
    })

    const startedAt = performance.now()
    const preview = await services.importer.analyzeImport(JSON.stringify(file), {
      mode: 'new-universe',
    })
    expect(preview.canImport).toBe(true)
    const result = await services.importer.commitImport(preview)
    const elapsed = performance.now() - startedAt

    expect(result.createdNodes).toBe(nodeCount)
    expect(result.createdEdges).toBe(edgeCount)
    expect(await services.graph.listNodes(result.universeId)).toHaveLength(nodeCount)
    expect(await services.graph.listEdges(result.universeId)).toHaveLength(edgeCount)
    // 不设严格阈值，只记录耗时供性能观察
    console.log(`[import] ${nodeCount} 节点 / ${edgeCount} 关系导入耗时 ${elapsed.toFixed(0)} ms`)
  })
})
