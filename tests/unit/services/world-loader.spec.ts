import { describe, expect, it, vi } from 'vitest'
import type { LoreUniverseFile } from '@/models/export-format'
import { createServices } from '@/services'
import {
  BUNDLED_WORLDS_MARKER_KEY,
  importWorldSources,
  type BundledWorldSource,
  type WorldLoaderStorage,
} from '@/services/world-loader'
import { createTestContext } from '../repositories/test-db'
import { clone, makeExport } from '../models/fixtures'

function makeWorld(id: string, name: string): LoreUniverseFile {
  const base = clone(makeExport())
  return {
    ...base,
    universe: { ...base.universe, id, name },
    types: base.types.map((type) => ({ ...type, universeId: id })),
    nodes: base.nodes.map((node) => ({ ...node, universeId: id })),
    edges: base.edges.map((edge) => ({ ...edge, universeId: id })),
  }
}

function createMemoryStorage(initial: Record<string, string> = {}): WorldLoaderStorage & {
  values: Map<string, string>
} {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem(key: string): string | null {
      return values.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      values.set(key, value)
    },
  }
}

function readMarker(storage: WorldLoaderStorage): string[] {
  const raw = storage.getItem(BUNDLED_WORLDS_MARKER_KEY)
  return raw === null ? [] : (JSON.parse(raw) as string[])
}

function fetchFrom(files: Record<string, LoreUniverseFile | string>) {
  return async (url: string): Promise<string> => {
    const value = files[url]
    if (value === undefined) {
      throw new Error(`未知测试 URL：${url}`)
    }
    return typeof value === 'string' ? value : JSON.stringify(value)
  }
}

function sources(...entries: [path: string, url: string][]): BundledWorldSource[] {
  return entries.map(([path, url]) => ({ path, url }))
}

describe('根目录 worlds 自动导入', () => {
  it('导入有效世界、恢复源世界名并记录源 id', async () => {
    const { repos } = createTestContext()
    const services = createServices(repos)
    const storage = createMemoryStorage()
    const first = makeWorld('source-alpha', '阿尔法世界')
    const second = makeWorld('source-beta', '贝塔世界')

    const result = await importWorldSources(
      sources(['worlds/zeta.json', 'memory://zeta'], ['worlds/alpha.json', 'memory://alpha']),
      {
        importer: services.importer,
        universes: services.universes,
        fetchText: fetchFrom({ 'memory://alpha': first, 'memory://zeta': second }),
        storage,
      },
    )

    expect(result.failures).toEqual([])
    expect(result.imported.map((item) => item.path)).toEqual([
      'worlds/alpha.json',
      'worlds/zeta.json',
    ])
    expect(result.imported.map((item) => item.name)).toEqual(['阿尔法世界', '贝塔世界'])
    expect(result.imported[0]!.universeId).not.toBe('source-alpha')
    expect((await services.universes.list()).map((universe) => universe.name).sort()).toEqual(
      ['阿尔法世界', '贝塔世界'].sort(),
    )
    const imported = await services.universes.list()
    const alpha = imported.find((universe) => universe.name === '阿尔法世界')
    expect(alpha).toBeDefined()
    expect(await services.graph.listNodes(alpha!.id)).toHaveLength(2)
    expect(readMarker(storage)).toEqual(['source-alpha', 'source-beta'])
  })

  it('非法文件只跳过自身，不阻塞后续有效文件', async () => {
    const { repos } = createTestContext()
    const services = createServices(repos)
    const storage = createMemoryStorage()
    const valid = makeWorld('source-valid', '有效世界')

    const result = await importWorldSources(
      sources(
        ['worlds/a-broken.json', 'memory://broken'],
        ['worlds/b-valid.json', 'memory://valid'],
      ),
      {
        importer: services.importer,
        universes: services.universes,
        fetchText: fetchFrom({ 'memory://broken': '{ not json', 'memory://valid': valid }),
        storage,
      },
    )

    expect(result.imported).toHaveLength(1)
    expect(result.imported[0]!.name).toBe('有效世界')
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]!.path).toBe('worlds/a-broken.json')
    expect(result.failures[0]!.message).toContain('JSON 解析失败')
    expect(await services.universes.list()).toHaveLength(1)
    expect(readMarker(storage)).toEqual(['source-valid'])
  })

  it('同源 universe.id 的重复文件只处理一次', async () => {
    const { repos } = createTestContext()
    const services = createServices(repos)
    const storage = createMemoryStorage()
    const world = makeWorld('source-duplicate', '重复来源世界')
    const analyzeSpy = vi.spyOn(services.importer, 'analyzeImport')
    const commitSpy = vi.spyOn(services.importer, 'commitImport')

    const result = await importWorldSources(
      sources(['worlds/a.json', 'memory://a'], ['worlds/b.json', 'memory://b']),
      {
        importer: services.importer,
        universes: services.universes,
        fetchText: fetchFrom({ 'memory://a': world, 'memory://b': world }),
        storage,
      },
    )

    expect(result.imported).toHaveLength(1)
    expect(result.imported[0]!.path).toBe('worlds/a.json')
    expect(result.skipped).toBe(1)
    expect(analyzeSpy).toHaveBeenCalledTimes(1)
    expect(commitSpy).toHaveBeenCalledTimes(1)
    expect(await services.universes.list()).toHaveLength(1)
    expect(readMarker(storage)).toEqual(['source-duplicate'])
  })

  it('刷新幂等，且用户删除后不会复活', async () => {
    const { repos } = createTestContext()
    const services = createServices(repos)
    const storage = createMemoryStorage()
    const world = makeWorld('source-refresh', '刷新世界')
    const context = {
      importer: services.importer,
      universes: services.universes,
      fetchText: fetchFrom({ 'memory://world': world }),
      storage,
    }
    const worldSources = sources(['worlds/world.json', 'memory://world'])

    const first = await importWorldSources(worldSources, context)
    expect(first.imported).toHaveLength(1)
    expect(await services.universes.list()).toHaveLength(1)

    const second = await importWorldSources(worldSources, context)
    expect(second.imported).toHaveLength(0)
    expect(second.skipped).toBe(1)
    expect(await services.universes.list()).toHaveLength(1)

    const created = (await services.universes.list())[0]!
    await services.universes.remove(created.id)
    expect(await services.universes.list()).toHaveLength(0)

    const afterDelete = await importWorldSources(worldSources, context)
    expect(afterDelete.imported).toHaveLength(0)
    expect(afterDelete.skipped).toBe(1)
    expect(await services.universes.list()).toHaveLength(0)
  })

  it('提交失败不写来源标记，后续重试可以成功', async () => {
    const { repos } = createTestContext()
    const services = createServices(repos)
    const storage = createMemoryStorage()
    const world = makeWorld('source-retry', '重试世界')
    const context = {
      importer: services.importer,
      universes: services.universes,
      fetchText: fetchFrom({ 'memory://world': world }),
      storage,
    }
    const worldSources = sources(['worlds/world.json', 'memory://world'])
    const originalBulkPut = repos.nodes.bulkPut
    repos.nodes.bulkPut = async () => {
      throw new Error('模拟节点写入失败')
    }

    const failed = await importWorldSources(worldSources, context)
    expect(failed.imported).toHaveLength(0)
    expect(failed.failures).toHaveLength(1)
    expect(failed.failures[0]!.message).toContain('模拟节点写入失败')
    expect(storage.getItem(BUNDLED_WORLDS_MARKER_KEY)).toBeNull()
    expect(await services.universes.list()).toHaveLength(0)

    repos.nodes.bulkPut = originalBulkPut
    const retried = await importWorldSources(worldSources, context)
    expect(retried.imported).toHaveLength(1)
    expect(retried.failures).toEqual([])
    expect(await services.universes.list()).toHaveLength(1)
    expect(readMarker(storage)).toEqual(['source-retry'])
  })
})
