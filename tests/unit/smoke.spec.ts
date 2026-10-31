import { describe, expect, it, vi } from 'vitest'
import { createMemoryRepositories } from '@/repositories/memory'
import { createServices } from '@/services'
import { GraphError } from '@/services/errors'
import type { Services } from '@/services/types'

function createTestServices(): Services {
  return createServices(createMemoryRepositories())
}

/** 造一个包含两个节点、一条关系的基础世界。 */
async function seedWorld(services: Services) {
  const universe = await services.universes.create({ name: '穹顶之下' })
  const hero = await services.graph.createNode({
    universeId: universe.id,
    type: 'character',
    name: '林澈',
    description: '主角',
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

describe('LoreGraph Phase 0 冒烟测试', () => {
  it('创建世界时在同一事务内写入 6 个节点类型与 6 个关系类型', async () => {
    const services = createTestServices()
    const universe = await services.universes.create({ name: '测试世界' })

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
    expect(relationTypes.map((type) => type.order)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('节点支持创建、更新与移动，且默认值生效', async () => {
    const services = createTestServices()
    const universe = await services.universes.create({ name: '测试世界' })
    const node = await services.graph.createNode({
      universeId: universe.id,
      type: 'character',
      name: '林澈',
      position: { x: 1, y: 2 },
    })

    expect(node.description).toBe('')
    expect(node.properties).toEqual({})
    expect(node.type).toBe('character')

    const updated = await services.graph.updateNode(node.id, {
      name: '林澈·改',
      properties: { age: 42, alive: true, title: null },
    })
    expect(updated.name).toBe('林澈·改')
    expect(updated.properties).toEqual({ age: 42, alive: true, title: null })

    const moved = await services.graph.moveNode(node.id, { x: 88.5, y: 99.25 })
    expect(moved.position).toEqual({ x: 88.5, y: 99.25 })

    const listed = await services.graph.listNodes(universe.id)
    expect(listed).toHaveLength(1)
    expect(listed[0].position).toEqual({ x: 88.5, y: 99.25 })
  })

  it('删除节点会级联删除关联边，并可完整撤销', async () => {
    const services = createTestServices()
    const { universe, hero, city, edge } = await seedWorld(services)

    const snapshot = await services.graph.deleteNode(hero.id)
    expect(snapshot.node.id).toBe(hero.id)
    expect(snapshot.edges.map((item) => item.id)).toEqual([edge.id])

    expect((await services.graph.listNodes(universe.id)).map((item) => item.id)).toEqual([city.id])
    expect(await services.graph.listEdges(universe.id)).toHaveLength(0)

    await services.graph.restoreNode(snapshot)
    expect(await services.graph.listNodes(universe.id)).toHaveLength(2)
    const restoredEdges = await services.graph.listEdges(universe.id)
    expect(restoredEdges).toHaveLength(1)
    expect(restoredEdges[0].source).toBe(hero.id)
    expect(restoredEdges[0].target).toBe(city.id)
  })

  it('自连与重复关系都会被 GraphError 拒绝', async () => {
    const services = createTestServices()
    const { universe, hero, city } = await seedWorld(services)

    await expect(
      services.graph.createEdge({
        universeId: universe.id,
        source: hero.id,
        target: city.id,
        relationType: 'located-in',
      }),
    ).rejects.toBeInstanceOf(GraphError)

    await expect(
      services.graph.createEdge({
        universeId: universe.id,
        source: hero.id,
        target: hero.id,
        relationType: 'related-to',
      }),
    ).rejects.toBeInstanceOf(GraphError)
  })

  it('被节点引用的类型不可删除，并返回引用数量', async () => {
    const services = createTestServices()
    const { universe, hero } = await seedWorld(services)
    const types = await services.types.list(universe.id, 'node')
    const character = types.find((type) => type.key === 'character')
    expect(character).toBeDefined()

    await expect(services.types.remove(character!.id)).rejects.toMatchObject({
      name: 'TypeInUseError',
      count: 1,
    })

    await services.graph.deleteNode(hero.id)
    await expect(services.types.remove(character!.id)).resolves.toBeUndefined()
  })

  it('导出 → 解析 → 导入的往返语义等价（忽略 id 与时间戳）', async () => {
    const services = createTestServices()
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

    const [sourceTypes, importedTypes] = await Promise.all([
      services.types.list(universe.id),
      services.types.list(imported.id),
    ])
    const signature = (list: typeof sourceTypes) =>
      list.map((type) => `${type.scope}:${type.key}:${type.label}:${type.color}`).sort()
    expect(signature(importedTypes)).toEqual(signature(sourceTypes))

    const importedNodes = await services.graph.listNodes(imported.id)
    expect(importedNodes).toHaveLength(2)
    expect(importedNodes.map((item) => item.id)).not.toContain(hero.id)
    expect(importedNodes.map((item) => item.name).sort()).toEqual([hero.name, city.name].sort())
    const importedHero = importedNodes.find((item) => item.name === hero.name)
    const importedCity = importedNodes.find((item) => item.name === city.name)
    expect(importedHero?.description).toBe(hero.description)
    expect(importedHero?.position).toEqual(hero.position)

    const importedEdges = await services.graph.listEdges(imported.id)
    expect(importedEdges).toHaveLength(1)
    expect(importedEdges[0].id).not.toBe(edge.id)
    expect(importedEdges[0].relationType).toBe(edge.relationType)
    expect(importedEdges[0].label).toBe(edge.label)
    expect(importedEdges[0].source).toBe(importedHero?.id)
    expect(importedEdges[0].target).toBe(importedCity?.id)

    // 引用完整性错误要带字段路径
    const broken = JSON.parse(JSON.stringify(exported)) as typeof exported
    broken.edges[0].source = 'missing-node'
    const rejected = services.importer.parse(JSON.stringify(broken))
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) {
      expect(rejected.issues.join('\n')).toContain('edges.0.source')
    }
  })

  it('autosave 在 400ms 后触发，并可用 flushKey 立即落库', async () => {
    vi.useFakeTimers()
    try {
      const services = createTestServices()
      const task = vi.fn(async () => Promise.resolve())
      services.autosave.schedule('node:1', task)
      services.autosave.schedule('node:1', task)

      await vi.advanceTimersByTimeAsync(399)
      expect(task).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(task).toHaveBeenCalledTimes(1)

      const flushed = vi.fn(async () => Promise.resolve())
      services.autosave.schedule('node:2', flushed)
      await services.autosave.flushKey('node:2')
      expect(flushed).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(400)
      expect(flushed).toHaveBeenCalledTimes(1)

      const failed = vi.fn(async () => {
        throw new Error('写入失败')
      })
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      services.autosave.schedule('node:3', failed)
      await vi.advanceTimersByTimeAsync(400)
      await vi.advanceTimersByTimeAsync(0)
      expect(errorSpy).toHaveBeenCalled()
      errorSpy.mockRestore()
    } finally {
      vi.useRealTimers()
    }
  })
})
