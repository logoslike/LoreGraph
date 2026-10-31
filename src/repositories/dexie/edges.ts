import type { LoreDatabase } from '@/db/schema'
import { LoreEdgeSchema, type LoreEdge } from '@/models/edge'
import type { EdgeRepository } from '@/repositories/types'
import { sortByCreatedAt } from './sort'

/** Dexie 版关系仓储：写入与读取都经过 Zod 校验。 */
export class DexieEdgeRepository implements EdgeRepository {
  constructor(private readonly db: LoreDatabase) {}

  async getById(id: string): Promise<LoreEdge | null> {
    const row = await this.db.edges.get(id)
    return row ? LoreEdgeSchema.parse(row) : null
  }

  async getByUniverse(universeId: string): Promise<LoreEdge[]> {
    const rows = await this.db.edges.where('universeId').equals(universeId).toArray()
    return sortByCreatedAt(rows).map((row) => LoreEdgeSchema.parse(row))
  }

  async getByNodeId(nodeId: string): Promise<LoreEdge[]> {
    const [asSource, asTarget] = await Promise.all([
      this.db.edges.where('source').equals(nodeId).toArray(),
      this.db.edges.where('target').equals(nodeId).toArray(),
    ])
    const unique = new Map<string, LoreEdge>()
    for (const edge of [...asSource, ...asTarget]) {
      unique.set(edge.id, edge)
    }
    return sortByCreatedAt([...unique.values()]).map((edge) => LoreEdgeSchema.parse(edge))
  }

  async create(edge: LoreEdge): Promise<LoreEdge> {
    const parsed = LoreEdgeSchema.parse(edge)
    await this.db.edges.put(parsed)
    return parsed
  }

  async update(edge: LoreEdge): Promise<LoreEdge> {
    const parsed = LoreEdgeSchema.parse(edge)
    await this.db.edges.put(parsed)
    return parsed
  }

  async delete(id: string): Promise<void> {
    await this.db.edges.delete(id)
  }

  async bulkPut(edges: LoreEdge[]): Promise<void> {
    const parsed = edges.map((edge) => LoreEdgeSchema.parse(edge))
    if (parsed.length === 0) {
      return
    }
    await this.db.edges.bulkPut(parsed)
  }
}
