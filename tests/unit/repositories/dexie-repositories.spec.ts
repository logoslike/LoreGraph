import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Universe } from '@/models/universe'
import { createDexieRepositories } from '@/repositories'
import {
  buildEdge,
  buildEntityType,
  buildNode,
  buildUniverse,
  createTestContext,
  idsOf,
  putRawRecord,
  reopenTestDatabase,
} from './test-db'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Dexie 世界仓储', () => {
  it('支持创建、读取、更新与删除', async () => {
    const { repos } = createTestContext()
    const first = buildUniverse({ name: '奥瑞亚' })
    const second = buildUniverse({ name: '蔚蓝' })

    expect(await repos.universes.create(first)).toEqual(first)
    expect(await repos.universes.create(second)).toEqual(second)
    expect(await repos.universes.getById(first.id)).toEqual(first)
    expect(idsOf(await repos.universes.list())).toEqual([first.id, second.id])

    const updated = {
      ...second,
      name: '蔚蓝·改',
      description: '深海城邦',
      updatedAt: second.updatedAt + 10,
    }
    expect(await repos.universes.update(updated)).toEqual(updated)
    expect((await repos.universes.getById(second.id))?.name).toBe('蔚蓝·改')

    await repos.universes.delete(first.id)
    expect(await repos.universes.getById(first.id)).toBeNull()
    expect(idsOf(await repos.universes.list())).toEqual([second.id])
  })
})

describe('Dexie 节点 / 关系 / 类型仓储', () => {
  it('按世界隔离数据，且更新会持久化', async () => {
    const { repos } = createTestContext()
    const worldA = buildUniverse({ name: '甲界' })
    const worldB = buildUniverse({ name: '乙界' })
    await repos.universes.create(worldA)
    await repos.universes.create(worldB)

    const nodeA = buildNode(worldA.id, { name: '甲节点' })
    const nodeB = buildNode(worldB.id, { name: '乙节点' })
    await repos.nodes.bulkPut([nodeA, nodeB])
    expect(idsOf(await repos.nodes.getByUniverse(worldA.id))).toEqual([nodeA.id])
    expect(idsOf(await repos.nodes.getByUniverse(worldB.id))).toEqual([nodeB.id])

    const moved = { ...nodeA, position: { x: 128, y: 256 }, updatedAt: nodeA.updatedAt + 1 }
    expect(await repos.nodes.update(moved)).toEqual(moved)
    expect((await repos.nodes.getById(nodeA.id))?.position).toEqual({ x: 128, y: 256 })

    const nodeA2 = buildNode(worldA.id, { name: '甲节点二' })
    await repos.nodes.create(nodeA2)
    const edgeA = buildEdge(worldA.id, { source: nodeA.id, target: nodeA2.id })
    await repos.edges.create(edgeA)
    expect(idsOf(await repos.edges.getByUniverse(worldA.id))).toEqual([edgeA.id])
    expect(await repos.edges.getByUniverse(worldB.id)).toEqual([])

    const typeA = buildEntityType(worldA.id, { key: 'character', label: '角色' })
    const typeB = buildEntityType(worldB.id, { key: 'character', label: '角色' })
    await repos.types.bulkPut([typeA, typeB])
    expect(idsOf(await repos.types.getByUniverse(worldA.id))).toEqual([typeA.id])
    expect(await repos.types.getByKey(worldA.id, 'node', 'character')).toEqual(typeA)
    expect(await repos.types.getByKey(worldB.id, 'node', 'character')).toEqual(typeB)
  })

  it('按作用域过滤类型', async () => {
    const { repos } = createTestContext()
    const world = buildUniverse()
    await repos.universes.create(world)
    const nodeType = buildEntityType(world.id, { scope: 'node', key: 'character' })
    const relationType = buildEntityType(world.id, {
      scope: 'relation',
      key: 'related-to',
      order: 0,
    })
    await repos.types.bulkPut([nodeType, relationType])

    expect(idsOf(await repos.types.getByUniverse(world.id, 'node'))).toEqual([nodeType.id])
    expect(idsOf(await repos.types.getByUniverse(world.id, 'relation'))).toEqual([relationType.id])
    expect(await repos.types.getByUniverse(world.id)).toHaveLength(2)
  })

  it('同一世界同一作用域内类型 key 唯一，跨世界与跨作用域可复用', async () => {
    const { repos } = createTestContext()
    const worldA = buildUniverse()
    const worldB = buildUniverse()
    await repos.universes.create(worldA)
    await repos.universes.create(worldB)

    await repos.types.create(buildEntityType(worldA.id, { key: 'character', scope: 'node' }))
    const duplicate = buildEntityType(worldA.id, { key: 'character', scope: 'node' })
    await expect(repos.types.create(duplicate)).rejects.toMatchObject({
      name: 'ConstraintError',
    })
    await expect(
      repos.types.create(buildEntityType(worldB.id, { key: 'character', scope: 'node' })),
    ).resolves.toBeDefined()
    await expect(
      repos.types.create(buildEntityType(worldA.id, { key: 'character', scope: 'relation' })),
    ).resolves.toBeDefined()
  })

  it('写入前经过 Zod 校验，非法实体不会落库', async () => {
    const { db, repos } = createTestContext()
    const world = buildUniverse()
    await repos.universes.create(world)

    await expect(
      repos.universes.create({ ...world, id: 'invalid-universe', name: '' }),
    ).rejects.toThrow()
    await expect(repos.nodes.create({ ...buildNode(world.id), name: '' })).rejects.toThrow()
    await expect(
      repos.nodes.create({ ...buildNode(world.id), position: { x: Number.NaN, y: 0 } }),
    ).rejects.toThrow()
    await expect(
      repos.edges.create({ ...buildEdge(world.id), relationType: 'Bad Key' }),
    ).rejects.toThrow()
    await expect(
      repos.types.create({ ...buildEntityType(world.id), key: '非法 key' }),
    ).rejects.toThrow()

    expect(await db.nodes.count()).toBe(0)
    expect(await db.edges.count()).toBe(0)
    expect(await db.entityTypes.count()).toBe(0)
  })

  it('关闭并重新打开数据库后数据仍然存在', async () => {
    const { db, repos } = createTestContext()
    const universe = buildUniverse({ name: '持久世界' })
    const node = buildNode(universe.id, { name: '持久节点' })
    await repos.universes.create(universe)
    await repos.nodes.create(node)
    db.close()

    const reopenedRepos = createDexieRepositories(reopenTestDatabase(db))
    expect(await reopenedRepos.universes.getById(universe.id)).toEqual(universe)
    expect(await reopenedRepos.nodes.getById(node.id)).toEqual(node)
  })

  it('getByNodeId 同时返回以该节点为源或目标的边，bulkPut 空数组安全', async () => {
    const { repos } = createTestContext()
    const world = buildUniverse()
    await repos.universes.create(world)
    const a = buildNode(world.id)
    const b = buildNode(world.id)
    const c = buildNode(world.id)
    await repos.nodes.bulkPut([a, b, c])
    await expect(repos.nodes.bulkPut([])).resolves.toBeUndefined()
    await expect(repos.edges.bulkPut([])).resolves.toBeUndefined()
    await expect(repos.types.bulkPut([])).resolves.toBeUndefined()

    const ab = buildEdge(world.id, { source: a.id, target: b.id })
    const ca = buildEdge(world.id, { source: c.id, target: a.id })
    await repos.edges.bulkPut([ab, ca])

    expect(idsOf(await repos.edges.getByNodeId(a.id)).sort()).toEqual([ab.id, ca.id].sort())
    expect(idsOf(await repos.edges.getByNodeId(b.id))).toEqual([ab.id])
    expect(await repos.edges.getByNodeId('missing-node')).toEqual([])
  })
})
describe('Dexie 旧数据兼容', () => {
  it('缺少 description 字段的旧世界记录读取后描述为空字符串', async () => {
    const { db, repos } = createTestContext()
    const legacy: Omit<Universe, 'description'> = {
      id: 'legacy-universe',
      name: '旧版世界',
      createdAt: 1_600_000_000_000,
      updatedAt: 1_600_000_000_000,
    }
    await db.universes.put(legacy as Universe)

    expect((await repos.universes.getById(legacy.id))?.description).toBe('')
    const [listed] = await repos.universes.list()
    expect(listed.description).toBe('')
  })
})

describe('Dexie 列表逐行容错', () => {
  it('跳过校验失败的行，其余记录照常返回，坏数据保留原样', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { db, repos } = createTestContext()
    const world = buildUniverse()
    await repos.universes.create(world)
    const node = buildNode(world.id)
    await repos.nodes.create(node)
    const edge = buildEdge(world.id, { source: node.id, target: 'node-missing' })
    await repos.edges.create(edge)
    const type = buildEntityType(world.id, { key: 'character' })
    await repos.types.create(type)

    const brokenUniverse: Record<string, unknown> = {
      ...buildUniverse(),
      id: 'broken-universe',
      name: '',
    }
    const brokenNode: Record<string, unknown> = { ...node, id: 'broken-node', type: 'Bad Key' }
    const brokenEdge: Record<string, unknown> = {
      ...edge,
      id: 'broken-edge',
      source: 'node-other',
      relationType: 'Bad Key',
    }
    const brokenType: Record<string, unknown> = {
      ...type,
      id: 'broken-type',
      key: 'broken-key',
      color: 'red',
    }
    await putRawRecord(db, 'universes', brokenUniverse)
    await putRawRecord(db, 'nodes', brokenNode)
    await putRawRecord(db, 'edges', brokenEdge)
    await putRawRecord(db, 'entityTypes', brokenType)

    expect(idsOf(await repos.universes.list())).toEqual([world.id])
    expect(idsOf(await repos.nodes.getByUniverse(world.id))).toEqual([node.id])
    expect(idsOf(await repos.edges.getByUniverse(world.id))).toEqual([edge.id])
    expect(idsOf(await repos.edges.getByNodeId(node.id))).toEqual([edge.id])
    expect(idsOf(await repos.types.getByUniverse(world.id))).toEqual([type.id])

    // 告警信息带表名与 id
    const warnings = warn.mock.calls.map((call) => String(call[0]))
    expect(warnings).toHaveLength(4)
    const mentioned = (table: string, id: string): boolean =>
      warnings.some((text) => text.includes(table) && text.includes(id))
    expect(mentioned('universes', 'broken-universe')).toBe(true)
    expect(mentioned('nodes', 'broken-node')).toBe(true)
    expect(mentioned('edges', 'broken-edge')).toBe(true)
    expect(mentioned('entityTypes', 'broken-type')).toBe(true)

    // 坏数据仍保留在原表中，未被删除或改写
    expect(await db.universes.get('broken-universe')).toEqual(brokenUniverse)
    expect(await db.nodes.get('broken-node')).toEqual(brokenNode)
    expect(await db.edges.get('broken-edge')).toEqual(brokenEdge)
    expect(await db.entityTypes.get('broken-type')).toEqual(brokenType)
  })

  it('按 id 读取单条记录仍严格校验并报错，不静默跳过', async () => {
    const { db, repos } = createTestContext()
    await putRawRecord(db, 'universes', {
      id: 'broken-universe',
      name: '',
      createdAt: 1,
      updatedAt: 1,
    })

    await expect(repos.universes.getById('broken-universe')).rejects.toThrow()
  })
})
