import type { Repositories } from '@/repositories/types'
import { MemoryEdgeRepository } from './edges'
import { MemoryNodeRepository } from './nodes'
import { MemoryTransactionRunner } from './tx'
import { MemoryEntityTypeRepository } from './types'
import { MemoryUniverseRepository } from './universes'

/** 组装一套互相独立的内存仓储，供测试与无数据库环境使用。 */
export function createMemoryRepositories(): Repositories {
  return {
    universes: new MemoryUniverseRepository(),
    nodes: new MemoryNodeRepository(),
    edges: new MemoryEdgeRepository(),
    types: new MemoryEntityTypeRepository(),
    tx: new MemoryTransactionRunner(),
  }
}
