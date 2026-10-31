import type { Universe } from '@/models/universe'
import type { EntityScope, EntityType } from '@/models/type-def'
import type { LoreNode } from '@/models/node'
import type { LoreEdge } from '@/models/edge'

/** 世界仓储。 */
export interface UniverseRepository {
  list(): Promise<Universe[]>
  getById(id: string): Promise<Universe | null>
  create(universe: Universe): Promise<Universe>
  update(universe: Universe): Promise<Universe>
  delete(id: string): Promise<void>
}

/** 节点仓储。 */
export interface NodeRepository {
  getById(id: string): Promise<LoreNode | null>
  getByUniverse(universeId: string): Promise<LoreNode[]>
  create(node: LoreNode): Promise<LoreNode>
  update(node: LoreNode): Promise<LoreNode>
  delete(id: string): Promise<void>
  bulkPut(nodes: LoreNode[]): Promise<void>
}

/** 关系仓储。 */
export interface EdgeRepository {
  getById(id: string): Promise<LoreEdge | null>
  getByUniverse(universeId: string): Promise<LoreEdge[]>
  getByNodeId(nodeId: string): Promise<LoreEdge[]>
  create(edge: LoreEdge): Promise<LoreEdge>
  update(edge: LoreEdge): Promise<LoreEdge>
  delete(id: string): Promise<void>
  bulkPut(edges: LoreEdge[]): Promise<void>
}

/** 实体类型仓储（节点类型与关系类型共用）。 */
export interface EntityTypeRepository {
  getById(id: string): Promise<EntityType | null>
  getByUniverse(universeId: string, scope?: EntityScope): Promise<EntityType[]>
  getByKey(universeId: string, scope: EntityScope, key: string): Promise<EntityType | null>
  create(type: EntityType): Promise<EntityType>
  update(type: EntityType): Promise<EntityType>
  delete(id: string): Promise<void>
  bulkPut(types: EntityType[]): Promise<void>
}

/** 数据表名，用于声明事务涉及的表。 */
export type TableName = 'universes' | 'nodes' | 'edges' | 'entityTypes'

/** 事务执行器：把一组读写包在同一个事务中。 */
export interface TransactionRunner {
  run<T>(tables: TableName[], fn: () => Promise<T>): Promise<T>
}

/** 服务层依赖的仓储集合。 */
export interface Repositories {
  universes: UniverseRepository
  nodes: NodeRepository
  edges: EdgeRepository
  types: EntityTypeRepository
  tx: TransactionRunner
}
