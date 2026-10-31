import type { LoreDatabase } from '@/db/schema'
import type { Repositories } from '@/repositories/types'
import { DexieEdgeRepository } from './edges'
import { DexieNodeRepository } from './nodes'
import { DexieTransactionRunner } from './tx'
import { DexieEntityTypeRepository } from './types'
import { DexieUniverseRepository } from './universes'

/** 用同一个 Dexie 数据库装配四个仓储与事务执行器。 */
export function createDexieRepositories(db: LoreDatabase): Repositories {
  return {
    universes: new DexieUniverseRepository(db),
    nodes: new DexieNodeRepository(db),
    edges: new DexieEdgeRepository(db),
    types: new DexieEntityTypeRepository(db),
    tx: new DexieTransactionRunner(db),
  }
}

export { DexieTransactionRunner }
