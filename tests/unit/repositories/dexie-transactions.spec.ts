import { describe, expect, it } from 'vitest'
import { createDexieRepositories, DexieTransactionRunner } from '@/repositories'
import { buildEntityType, buildNode, buildUniverse, createTestContext } from './test-db'

describe('Dexie 事务执行器', () => {
  it('createDexieRepositories 装配的是 DexieTransactionRunner', () => {
    const { db } = createTestContext()
    const repos = createDexieRepositories(db)
    expect(repos.tx).toBeInstanceOf(DexieTransactionRunner)
  })

  it('事务内出现异常时所有写入整体回滚', async () => {
    const { repos } = createTestContext()
    const universe = buildUniverse()
    await repos.universes.create(universe)
    const node = buildNode(universe.id)
    await repos.nodes.create(node)

    await expect(
      repos.tx.run(['universes', 'nodes'], async () => {
        await repos.nodes.delete(node.id)
        await repos.universes.delete(universe.id)
        throw new Error('模拟事务失败')
      }),
    ).rejects.toThrow('模拟事务失败')

    expect(await repos.nodes.getById(node.id)).not.toBeNull()
    expect(await repos.universes.getById(universe.id)).not.toBeNull()
  })

  it('事务内多表写入成功后一起提交', async () => {
    const { repos } = createTestContext()
    const universe = buildUniverse()
    const node = buildNode(universe.id)
    const type = buildEntityType(universe.id, { key: 'character' })

    await repos.tx.run(['universes', 'nodes', 'entityTypes'], async () => {
      await repos.universes.create(universe)
      await repos.nodes.create(node)
      await repos.types.create(type)
    })

    expect(await repos.universes.getById(universe.id)).toEqual(universe)
    expect(await repos.nodes.getById(node.id)).toEqual(node)
    expect(await repos.types.getByKey(universe.id, 'node', 'character')).toEqual(type)
  })
})
