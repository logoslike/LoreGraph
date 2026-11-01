import type { LoreDatabase } from '@/db/schema'
import { UniverseSchema, type Universe } from '@/models/universe'
import type { UniverseRepository } from '@/repositories/types'
import { parseRows } from './parse'
import { sortByCreatedAt } from './sort'

/** Dexie 版世界仓储：写入与按 id 读取都经过 Zod 校验，列表逐行容错。 */
export class DexieUniverseRepository implements UniverseRepository {
  constructor(private readonly db: LoreDatabase) {}

  async list(): Promise<Universe[]> {
    const rows = await this.db.universes.toArray()
    return sortByCreatedAt(parseRows('universes', rows, UniverseSchema))
  }

  async getById(id: string): Promise<Universe | null> {
    const row = await this.db.universes.get(id)
    return row ? UniverseSchema.parse(row) : null
  }

  async create(universe: Universe): Promise<Universe> {
    const parsed = UniverseSchema.parse(universe)
    await this.db.universes.put(parsed)
    return parsed
  }

  async update(universe: Universe): Promise<Universe> {
    const parsed = UniverseSchema.parse(universe)
    await this.db.universes.put(parsed)
    return parsed
  }

  async delete(id: string): Promise<void> {
    await this.db.universes.delete(id)
  }
}
