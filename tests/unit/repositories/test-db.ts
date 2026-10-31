import Dexie from 'dexie'
import { afterEach } from 'vitest'
import { createLoreDatabase, type LoreDatabase } from '@/db/schema'
import { LoreEdgeSchema, type LoreEdge } from '@/models/edge'
import { LoreNodeSchema, type LoreNode } from '@/models/node'
import { EntityTypeSchema, type EntityType } from '@/models/type-def'
import { UniverseSchema, type Universe } from '@/models/universe'
import { createDexieRepositories } from '@/repositories'
import type { Repositories } from '@/repositories/types'

const FIXTURE_BASE_TIME = 1_700_000_000_000

const openedDatabases: LoreDatabase[] = []
let fixtureSequence = 0
let databaseSequence = 0

function nextSequence(): number {
  fixtureSequence += 1
  return fixtureSequence
}

/** 每个用例一个独立数据库名，避免用例之间互相污染。 */
export function createTestDatabase(): LoreDatabase {
  databaseSequence += 1
  const suffix = Math.random().toString(36).slice(2, 8)
  const db = createLoreDatabase(`loregraph-test-${databaseSequence}-${Date.now()}-${suffix}`)
  openedDatabases.push(db)
  return db
}

export interface TestContext {
  db: LoreDatabase
  repos: Repositories
}

/** 创建一套跑在 Dexie 上的仓储。 */
export function createTestContext(): TestContext {
  const db = createTestDatabase()
  return { db, repos: createDexieRepositories(db) }
}

/** 用同一个数据库名重新打开数据库，用于验证数据已真正持久化。 */
export function reopenTestDatabase(db: LoreDatabase): LoreDatabase {
  const reopened = createLoreDatabase(db.name)
  openedDatabases.push(reopened)
  return reopened
}

/** 关闭并删除本文件创建的全部测试数据库。 */
export async function cleanupTestDatabases(): Promise<void> {
  const pending = openedDatabases.splice(0)
  for (const db of pending) {
    try {
      db.close()
    } catch {
      // 未打开的数据库关闭会抛错，忽略即可
    }
  }
  const names = new Set(pending.map((db) => db.name))
  for (const name of names) {
    try {
      await Dexie.delete(name)
    } catch {
      // 数据库可能从未创建成功，忽略删除失败
    }
  }
}

afterEach(async () => {
  await cleanupTestDatabases()
})

/** 造一个世界；默认值经 Zod 校验并补全。 */
export function buildUniverse(overrides: Partial<Universe> = {}): Universe {
  const seq = nextSequence()
  return UniverseSchema.parse({
    id: `universe-${seq}`,
    name: `世界${seq}`,
    createdAt: FIXTURE_BASE_TIME + seq,
    updatedAt: FIXTURE_BASE_TIME + seq,
    ...overrides,
  })
}

/** 造一个节点；默认值经 Zod 校验并补全。 */
export function buildNode(universeId: string, overrides: Partial<LoreNode> = {}): LoreNode {
  const seq = nextSequence()
  return LoreNodeSchema.parse({
    id: `node-${seq}`,
    universeId,
    type: 'character',
    name: `节点${seq}`,
    position: { x: seq, y: seq },
    createdAt: FIXTURE_BASE_TIME + seq,
    updatedAt: FIXTURE_BASE_TIME + seq,
    ...overrides,
  })
}

/** 造一条关系；默认值经 Zod 校验并补全。 */
export function buildEdge(universeId: string, overrides: Partial<LoreEdge> = {}): LoreEdge {
  const seq = nextSequence()
  return LoreEdgeSchema.parse({
    id: `edge-${seq}`,
    universeId,
    source: `node-source-${seq}`,
    target: `node-target-${seq}`,
    relationType: 'related-to',
    createdAt: FIXTURE_BASE_TIME + seq,
    updatedAt: FIXTURE_BASE_TIME + seq,
    ...overrides,
  })
}

/** 造一个实体类型；默认值经 Zod 校验并补全。 */
export function buildEntityType(
  universeId: string,
  overrides: Partial<EntityType> = {},
): EntityType {
  const seq = nextSequence()
  return EntityTypeSchema.parse({
    id: `type-${seq}`,
    universeId,
    scope: 'node',
    key: `type-${seq}`,
    label: `类型${seq}`,
    color: '#6366f1',
    order: seq,
    createdAt: FIXTURE_BASE_TIME + seq,
    updatedAt: FIXTURE_BASE_TIME + seq,
    ...overrides,
  })
}

/** 提取 id 列表，便于断言顺序。 */
export function idsOf(items: readonly { id: string }[]): string[] {
  return items.map((item) => item.id)
}

/** 断言调用一定抛出错误，并返回该错误。 */
export async function captureError(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run()
  } catch (error) {
    return error as Error
  }
  throw new Error('预期抛出错误，但调用成功了')
}
