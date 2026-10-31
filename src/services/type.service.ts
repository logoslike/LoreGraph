import { newId, now } from '@/models/ids'
import { EntityTypeSchema, type EntityScope, type EntityType } from '@/models/type-def'
import type { Repositories } from '@/repositories/types'
import { LoreGraphError, TypeInUseError } from './errors'
import type { TypeCreateInput, TypePatch, TypeService } from './types'
import { pickDefined } from './utils'

/** 类型服务实现：删除前检查引用，被引用时抛出 TypeInUseError。 */
export class TypeServiceImpl implements TypeService {
  constructor(private readonly repos: Repositories) {}

  async list(universeId: string, scope?: EntityScope): Promise<EntityType[]> {
    const types = await this.repos.types.getByUniverse(universeId, scope)
    return types.sort((a, b) => a.order - b.order)
  }

  async create(input: TypeCreateInput): Promise<EntityType> {
    const siblings = await this.repos.types.getByUniverse(input.universeId, input.scope)
    if (siblings.some((type) => type.key === input.key)) {
      throw new LoreGraphError(`类型 key「${input.key}」已存在`)
    }
    const order =
      input.order ??
      (siblings.length === 0 ? 0 : Math.max(...siblings.map((type) => type.order)) + 1)
    const timestamp = now()
    const type = EntityTypeSchema.parse({
      id: newId(),
      universeId: input.universeId,
      scope: input.scope,
      key: input.key,
      label: input.label,
      color: input.color,
      icon: input.icon,
      order,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    return await this.repos.types.create(type)
  }

  async update(id: string, patch: TypePatch): Promise<EntityType> {
    const existing = await this.repos.types.getById(id)
    if (!existing) {
      throw new LoreGraphError('类型不存在或已被删除')
    }
    const updated = EntityTypeSchema.parse({
      ...existing,
      ...pickDefined(patch),
      updatedAt: now(),
    })
    return await this.repos.types.update(updated)
  }

  async remove(id: string): Promise<void> {
    const existing = await this.repos.types.getById(id)
    if (!existing) {
      throw new LoreGraphError('类型不存在或已被删除')
    }
    const count =
      existing.scope === 'node'
        ? (await this.repos.nodes.getByUniverse(existing.universeId)).filter(
            (node) => node.type === existing.key,
          ).length
        : (await this.repos.edges.getByUniverse(existing.universeId)).filter(
            (edge) => edge.relationType === existing.key,
          ).length
    if (count > 0) {
      throw new TypeInUseError(existing.key, count)
    }
    await this.repos.types.delete(id)
  }
}
