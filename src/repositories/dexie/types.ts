import type { LoreDatabase } from '@/db/schema'
import { EntityTypeSchema, type EntityScope, type EntityType } from '@/models/type-def'
import type { EntityTypeRepository } from '@/repositories/types'
import { sortEntityTypes } from './sort'

/** Dexie 版实体类型仓储：写入与读取都经过 Zod 校验，按 order 升序返回。 */
export class DexieEntityTypeRepository implements EntityTypeRepository {
  constructor(private readonly db: LoreDatabase) {}

  async getById(id: string): Promise<EntityType | null> {
    const row = await this.db.entityTypes.get(id)
    return row ? EntityTypeSchema.parse(row) : null
  }

  async getByUniverse(universeId: string, scope?: EntityScope): Promise<EntityType[]> {
    const rows =
      scope === undefined
        ? await this.db.entityTypes.where('universeId').equals(universeId).toArray()
        : await this.db.entityTypes
            .where('[universeId+scope]')
            .equals([universeId, scope])
            .toArray()
    return sortEntityTypes(rows).map((row) => EntityTypeSchema.parse(row))
  }

  async getByKey(universeId: string, scope: EntityScope, key: string): Promise<EntityType | null> {
    const row = await this.db.entityTypes
      .where('[universeId+scope+key]')
      .equals([universeId, scope, key])
      .first()
    return row ? EntityTypeSchema.parse(row) : null
  }

  async create(type: EntityType): Promise<EntityType> {
    const parsed = EntityTypeSchema.parse(type)
    await this.db.entityTypes.put(parsed)
    return parsed
  }

  async update(type: EntityType): Promise<EntityType> {
    const parsed = EntityTypeSchema.parse(type)
    await this.db.entityTypes.put(parsed)
    return parsed
  }

  async delete(id: string): Promise<void> {
    await this.db.entityTypes.delete(id)
  }

  async bulkPut(types: EntityType[]): Promise<void> {
    const parsed = types.map((type) => EntityTypeSchema.parse(type))
    if (parsed.length === 0) {
      return
    }
    await this.db.entityTypes.bulkPut(parsed)
  }
}
