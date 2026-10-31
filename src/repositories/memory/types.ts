import type { EntityScope, EntityType } from '@/models/type-def'
import type { EntityTypeRepository } from '@/repositories/types'
import { cloneValue } from './clone'

/** 内存版实体类型仓储，按插入顺序保存。 */
export class MemoryEntityTypeRepository implements EntityTypeRepository {
  private readonly items = new Map<string, EntityType>()

  async getById(id: string): Promise<EntityType | null> {
    const found = this.items.get(id)
    return found ? cloneValue(found) : null
  }

  async getByUniverse(universeId: string, scope?: EntityScope): Promise<EntityType[]> {
    return [...this.items.values()]
      .filter(
        (type) => type.universeId === universeId && (scope === undefined || type.scope === scope),
      )
      .map(cloneValue)
  }

  async getByKey(universeId: string, scope: EntityScope, key: string): Promise<EntityType | null> {
    const found = [...this.items.values()].find(
      (type) => type.universeId === universeId && type.scope === scope && type.key === key,
    )
    return found ? cloneValue(found) : null
  }

  async create(type: EntityType): Promise<EntityType> {
    this.items.set(type.id, cloneValue(type))
    return cloneValue(type)
  }

  async update(type: EntityType): Promise<EntityType> {
    this.items.set(type.id, cloneValue(type))
    return cloneValue(type)
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id)
  }

  async bulkPut(types: EntityType[]): Promise<void> {
    for (const type of types) {
      this.items.set(type.id, cloneValue(type))
    }
  }
}
