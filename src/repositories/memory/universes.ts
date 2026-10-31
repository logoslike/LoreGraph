import type { Universe } from '@/models/universe'
import type { UniverseRepository } from '@/repositories/types'
import { cloneValue } from './clone'

/** 内存版世界仓储，按插入顺序保存。 */
export class MemoryUniverseRepository implements UniverseRepository {
  private readonly items = new Map<string, Universe>()

  async list(): Promise<Universe[]> {
    return [...this.items.values()].map(cloneValue)
  }

  async getById(id: string): Promise<Universe | null> {
    const found = this.items.get(id)
    return found ? cloneValue(found) : null
  }

  async create(universe: Universe): Promise<Universe> {
    this.items.set(universe.id, cloneValue(universe))
    return cloneValue(universe)
  }

  async update(universe: Universe): Promise<Universe> {
    this.items.set(universe.id, cloneValue(universe))
    return cloneValue(universe)
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id)
  }
}
