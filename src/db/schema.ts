import Dexie, { type Table } from 'dexie'
import type { LoreEdge } from '@/models/edge'
import type { LoreNode } from '@/models/node'
import type { EntityType } from '@/models/type-def'
import type { Universe } from '@/models/universe'

/** 默认数据库名。 */
export const DEFAULT_DB_NAME = 'loregraph'

/**
 * LoreGraph 的 IndexedDB 数据库。
 *
 * 表名与仓储契约中的 \`TableName\` 一一对应，索引覆盖仓储需要的查询：
 * - universes：按更新时间、名称
 * - nodes：按世界、[世界+类型]、更新时间、名称
 * - edges：按世界、源/目标、[世界+源]、[世界+目标]
 * - entityTypes：[世界+作用域] 查询与 [世界+作用域+key] 唯一约束
 */
export class LoreDatabase extends Dexie {
  universes!: Table<Universe, string>
  nodes!: Table<LoreNode, string>
  edges!: Table<LoreEdge, string>
  entityTypes!: Table<EntityType, string>

  constructor(name: string = DEFAULT_DB_NAME) {
    super(name)
    this.version(1).stores({
      universes: 'id, updatedAt, name',
      nodes: 'id, universeId, [universeId+type], updatedAt, name',
      edges: 'id, universeId, source, target, [universeId+source], [universeId+target]',
      entityTypes: 'id, universeId, [universeId+scope], &[universeId+scope+key]',
    })
    this.universes = this.table<Universe, string>('universes')
    this.nodes = this.table<LoreNode, string>('nodes')
    this.edges = this.table<LoreEdge, string>('edges')
    this.entityTypes = this.table<EntityType, string>('entityTypes')
  }
}

/** 创建数据库实例；测试可传入独立名字以隔离数据。 */
export function createLoreDatabase(name?: string): LoreDatabase {
  return new LoreDatabase(name)
}
