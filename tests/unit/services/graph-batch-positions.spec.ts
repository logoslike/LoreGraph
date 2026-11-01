import { describe, expect, it, vi } from 'vitest'
import type { Repositories, TableName } from '@/repositories/types'
import { createServices } from '@/services'
import { LoreGraphError } from '@/services/errors'
import type { Services } from '@/services/types'
import { captureError, createTestContext } from '../repositories/test-db'

interface Setup {
  services: Services
  repos: Repositories
  /** 记录每次事务涉及的表名，用于断言只开了一个事务。 */
  txRuns: TableName[][]
}

function setup(): Setup {
  const { repos } = createTestContext()
  const txRuns: TableName[][] = []
  const wrapped: Repositories = {
    ...repos,
    tx: {
      run: <T>(tables: TableName[], fn: () => Promise<T>): Promise<T> => {
        txRuns.push(tables)
        return repos.tx.run(tables, fn)
      },
    },
  }
  return { services: createServices(wrapped), repos, txRuns }
}

/** 造一个带 3 个节点的世界，坐标从 0 开始依次排开。 */
async function seedWorld(services: Services) {
  const universe = await services.universes.create({ name: '布局测试世界' })
  const nodes = await Promise.all(
    [0, 1, 2].map((index) =>
      services.graph.createNode({
        universeId: universe.id,
        type: 'character',
        name: `节点${index}`,
        position: { x: index * 100, y: index * 100 },
      }),
    ),
  )
  return { universe, nodes }
}

describe('updateNodePositions', () => {
  it('多个节点只用一次事务、一次 bulkPut，并真正写入数据库', async () => {
    const { services, repos, txRuns } = setup()
    const { universe, nodes } = await seedWorld(services)
    // 建世界本身也开事务，这里只统计坐标写入
    txRuns.length = 0
    const bulkPut = vi.spyOn(repos.nodes, 'bulkPut')
    const update = vi.spyOn(repos.nodes, 'update')

    const positions = {
      [nodes[0].id]: { x: 11, y: 22 },
      [nodes[1].id]: { x: 33, y: 44 },
      [nodes[2].id]: { x: 55, y: 66 },
    }
    const saved = await services.graph.updateNodePositions(universe.id, positions)

    expect(saved).toHaveLength(3)
    expect(txRuns).toEqual([['nodes']])
    expect(bulkPut).toHaveBeenCalledTimes(1)
    expect(bulkPut.mock.calls[0][0]).toHaveLength(3)
    expect(update).not.toHaveBeenCalled()

    const reloaded = await services.graph.listNodes(universe.id)
    for (const node of reloaded) {
      expect(node.position).toEqual(positions[node.id])
    }
    // 名称、类型、描述、属性都不受坐标写入影响
    expect(reloaded.map((node) => node.name).sort()).toEqual(nodes.map((node) => node.name).sort())
    expect(reloaded.every((node) => node.type === 'character')).toBe(true)
    expect(reloaded.every((node) => node.updatedAt >= node.createdAt)).toBe(true)
  })

  it('空映射直接返回空数组，不开启事务', async () => {
    const { services, txRuns } = setup()
    const { universe } = await seedWorld(services)
    txRuns.length = 0

    await expect(services.graph.updateNodePositions(universe.id, {})).resolves.toEqual([])
    expect(txRuns).toEqual([])
  })

  it('节点不存在时抛错且不写入任何坐标', async () => {
    const { services, repos, txRuns } = setup()
    const { universe, nodes } = await seedWorld(services)
    txRuns.length = 0

    const error = await captureError(() =>
      services.graph.updateNodePositions(universe.id, {
        [nodes[0].id]: { x: 1, y: 2 },
        'missing-node': { x: 3, y: 4 },
      }),
    )

    expect(error).toBeInstanceOf(LoreGraphError)
    expect(txRuns).toEqual([])
    expect((await repos.nodes.getById(nodes[0].id))?.position).toEqual(nodes[0].position)
  })

  it('坐标仍走 Zod 校验：非有限数被拒绝', async () => {
    const { services, txRuns } = setup()
    const { universe, nodes } = await seedWorld(services)
    txRuns.length = 0

    const error = await captureError(() =>
      services.graph.updateNodePositions(universe.id, {
        [nodes[0].id]: { x: Number.POSITIVE_INFINITY, y: 0 },
      }),
    )

    expect(error.message).toContain('position')
    expect(txRuns).toEqual([])
  })
})
