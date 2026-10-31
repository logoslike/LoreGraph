import type { LoreNode } from '@/models/node'
import type { NodeRepository } from '@/repositories/types'
import { cloneValue } from './clone'

/** 内存版节点仓储，按插入顺序保存。 */
export class MemoryNodeRepository implements NodeRepository {
  private readonly items = new Map<string, LoreNode>()

  async getById(id: string): Promise<LoreNode | null> {
    const found = this.items.get(id)
    return found ? cloneValue(found) : null
  }

  async getByUniverse(universeId: string): Promise<LoreNode[]> {
    return [...this.items.values()].filter((node) => node.universeId === universeId).map(cloneValue)
  }

  async create(node: LoreNode): Promise<LoreNode> {
    this.items.set(node.id, cloneValue(node))
    return cloneValue(node)
  }

  async update(node: LoreNode): Promise<LoreNode> {
    this.items.set(node.id, cloneValue(node))
    return cloneValue(node)
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id)
  }

  async bulkPut(nodes: LoreNode[]): Promise<void> {
    for (const node of nodes) {
      this.items.set(node.id, cloneValue(node))
    }
  }
}
