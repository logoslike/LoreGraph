import type { LoreDatabase } from '@/db/schema'
import { LoreNodeSchema, type LoreNode } from '@/models/node'
import type { NodeRepository } from '@/repositories/types'
import { sortByCreatedAt } from './sort'

/** Dexie 版节点仓储：写入与读取都经过 Zod 校验，列表按创建时间稳定升序。 */
export class DexieNodeRepository implements NodeRepository {
  constructor(private readonly db: LoreDatabase) {}

  async getById(id: string): Promise<LoreNode | null> {
    const row = await this.db.nodes.get(id)
    return row ? LoreNodeSchema.parse(row) : null
  }

  async getByUniverse(universeId: string): Promise<LoreNode[]> {
    const rows = await this.db.nodes.where('universeId').equals(universeId).toArray()
    return sortByCreatedAt(rows).map((row) => LoreNodeSchema.parse(row))
  }

  async create(node: LoreNode): Promise<LoreNode> {
    const parsed = LoreNodeSchema.parse(node)
    await this.db.nodes.put(parsed)
    return parsed
  }

  async update(node: LoreNode): Promise<LoreNode> {
    const parsed = LoreNodeSchema.parse(node)
    await this.db.nodes.put(parsed)
    return parsed
  }

  async delete(id: string): Promise<void> {
    await this.db.nodes.delete(id)
  }

  async bulkPut(nodes: LoreNode[]): Promise<void> {
    const parsed = nodes.map((node) => LoreNodeSchema.parse(node))
    if (parsed.length === 0) {
      return
    }
    await this.db.nodes.bulkPut(parsed)
  }
}
