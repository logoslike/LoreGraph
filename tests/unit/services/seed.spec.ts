import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LORE_FORMAT_VERSION,
  LORE_UNIVERSE_FORMAT,
  type LoreUniverseFile,
} from '@/models/export-format'
import { createServices } from '@/services'
import { LoreGraphError } from '@/services/errors'
import type { Services } from '@/services/types'
import { SAMPLE_UNIVERSE_PATH } from '@/services/universe.service'
import { captureError, createTestContext, idsOf } from '../repositories/test-db'

const SAMPLE_TIMESTAMP = 1_700_000_000_000

/** public/examples/emberfall.json 尚未生成时的内联最小样本（结构与真实文件一致）。 */
function buildInlineSample(): LoreUniverseFile {
  return {
    format: LORE_UNIVERSE_FORMAT,
    formatVersion: LORE_FORMAT_VERSION,
    exportedAt: SAMPLE_TIMESTAMP,
    universe: {
      id: 'sample-universe',
      name: '余烬之环',
      description: '示例世界',
      createdAt: SAMPLE_TIMESTAMP,
      updatedAt: SAMPLE_TIMESTAMP,
    },
    types: [
      {
        id: 'sample-type-node',
        universeId: 'sample-universe',
        scope: 'node',
        key: 'character',
        label: '角色',
        color: '#6366f1',
        icon: 'user-round',
        order: 0,
        createdAt: SAMPLE_TIMESTAMP,
        updatedAt: SAMPLE_TIMESTAMP,
      },
      {
        id: 'sample-type-relation',
        universeId: 'sample-universe',
        scope: 'relation',
        key: 'related-to',
        label: '相关',
        color: '#94a3b8',
        order: 0,
        createdAt: SAMPLE_TIMESTAMP,
        updatedAt: SAMPLE_TIMESTAMP,
      },
    ],
    nodes: [
      {
        id: 'sample-node-1',
        universeId: 'sample-universe',
        type: 'character',
        name: '林澈',
        description: '守灯人',
        properties: { age: 27 },
        position: { x: 0, y: 0 },
        createdAt: SAMPLE_TIMESTAMP,
        updatedAt: SAMPLE_TIMESTAMP,
      },
      {
        id: 'sample-node-2',
        universeId: 'sample-universe',
        type: 'character',
        name: '苏晚',
        description: '引路人',
        properties: {},
        position: { x: 240, y: 120 },
        createdAt: SAMPLE_TIMESTAMP + 1,
        updatedAt: SAMPLE_TIMESTAMP + 1,
      },
    ],
    edges: [
      {
        id: 'sample-edge-1',
        universeId: 'sample-universe',
        source: 'sample-node-1',
        target: 'sample-node-2',
        relationType: 'related-to',
        label: '同门',
        properties: {},
        createdAt: SAMPLE_TIMESTAMP + 2,
        updatedAt: SAMPLE_TIMESTAMP + 2,
      },
    ],
  }
}

type FetchLike = (input: string) => Promise<{
  ok: boolean
  status: number
  text: () => Promise<string>
}>

function stubFetchJson(payload: unknown) {
  const mock = vi.fn<FetchLike>(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
  }))
  vi.stubGlobal('fetch', mock)
  return mock
}

function setup(): Services {
  const { repos } = createTestContext()
  return createServices(repos)
}

describe('seedSample 内置示例世界', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('从 BASE_URL 下的示例文件导入新世界', async () => {
    const services = setup()
    const sample = buildInlineSample()
    const fetchMock = stubFetchJson(sample)

    const universe = await services.universes.seedSample()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(`${import.meta.env.BASE_URL}${SAMPLE_UNIVERSE_PATH}`)
    // 示例世界不是用户导入，保留原始名称（用户导入才会追加「（导入）」）
    expect(universe.name).toBe('余烬之环')
    expect(universe.id).not.toBe(sample.universe.id)

    const nodes = await services.graph.listNodes(universe.id)
    expect(nodes.map((node) => node.name).sort()).toEqual(['林澈', '苏晚'].sort())
    expect(idsOf(nodes)).not.toContain('sample-node-1')

    const edges = await services.graph.listEdges(universe.id)
    expect(edges).toHaveLength(1)
    expect(edges[0].relationType).toBe('related-to')
    expect(edges[0].source).toBe(nodes.find((node) => node.name === '林澈')?.id)
    expect(await services.types.list(universe.id, 'node')).toHaveLength(1)
  })

  it('HTTP 错误转换为可读的领域错误', async () => {
    const services = setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, text: async () => '' })),
    )

    const error = await captureError(() => services.universes.seedSample())
    expect(error).toBeInstanceOf(LoreGraphError)
    expect(error.message).toContain('404')
    expect(await services.universes.list()).toEqual([])
  })

  it('网络异常转换为领域错误', async () => {
    const services = setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('网络断开')
      }),
    )

    const error = await captureError(() => services.universes.seedSample())
    expect(error).toBeInstanceOf(LoreGraphError)
    expect(error.message).toContain('示例世界加载失败')
  })

  it('示例数据校验失败时拒绝导入并给出字段路径', async () => {
    const services = setup()
    stubFetchJson({ ...buildInlineSample(), nodes: 'not-an-array' })

    const error = await captureError(() => services.universes.seedSample())
    expect(error).toBeInstanceOf(LoreGraphError)
    expect(error.message).toContain('示例世界数据无效')
    expect(error.message).toContain('nodes')
    expect(await services.universes.list()).toEqual([])
  })
})
