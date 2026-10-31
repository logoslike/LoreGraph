import type { LoreEdge } from '@/models/edge'
import type { EdgeRepository } from '@/repositories/types'
import { cloneValue } from './clone'

/** 内存版关系仓储，按插入顺序保存。 */
export class MemoryEdgeRepository implements EdgeRepository {
  private readonly items = new Map<string, LoreEdge>()

  async getById(id: string): Promise<LoreEdge | null> {
    const found = this.items.get(id)
    return found ? cloneValue(found) : null
  }

  async getByUniverse(universeId: string): Promise<LoreEdge[]> {
    return [...this.items.values()]
      .filter((edge) => edge.universeId === universeId)
      .map(cloneValue)
  }

  async getByNodeId(nodeId: string): Promise<LoreEdge[]> {
    return [...this.items.values()]
      .filter((edge) => edge.source === nodeId || edge.target === nodeId)
      .map(cloneValue)
  }

  async create(edge: LoreEdge): Promise<LoreEdge> {
    this.items.set(edge.id, cloneValue(edge))
    return cloneValue(edge)
  }

  async update(edge: LoreEdge): Promise<LoreEdge> {
    this.items.set(edge.id, cloneValue(edge))
    return cloneValue(edge)
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id)
  }

  async bulkPut(edges: LoreEdge[]): Promise<void> {
    for (const edge of edges) {
      this.items.set(edge.id, cloneValue(edge))
    }
  }
}
