import { defineStore } from 'pinia'
import type { EntityScope, EntityType } from '@/models/type-def'
import { services } from '@/services'
import { LoreGraphError } from '@/services/errors'
import type { TypePatch } from '@/services/types'

/** 创建类型时由 UI 提供的字段（世界与作用域由 store 补全）。 */
export interface TypeDraft {
  key: string
  label: string
  color: string
  icon?: string
  order?: number
}

interface TypesState {
  universeId: string | null
  nodeTypes: EntityType[]
  relationTypes: EntityType[]
  loading: boolean
}

/** 当前世界的节点类型与关系类型。 */
export const useTypesStore = defineStore('types', {
  state: (): TypesState => ({
    universeId: null,
    nodeTypes: [],
    relationTypes: [],
    loading: false,
  }),
  getters: {
    nodeTypeByKey:
      (state) =>
      (key: string): EntityType | null =>
        state.nodeTypes.find((type) => type.key === key) ?? null,
    relationTypeByKey:
      (state) =>
      (key: string): EntityType | null =>
        state.relationTypes.find((type) => type.key === key) ?? null,
  },
  actions: {
    async load(universeId: string): Promise<void> {
      this.universeId = universeId
      this.loading = true
      try {
        const types = await services.types.list(universeId)
        this.nodeTypes = types.filter((type) => type.scope === 'node')
        this.relationTypes = types.filter((type) => type.scope === 'relation')
      } finally {
        this.loading = false
      }
    },
    async create(scope: EntityScope, input: TypeDraft): Promise<EntityType> {
      const universeId = this.requireUniverseId()
      const created = await services.types.create({ ...input, universeId, scope })
      await this.load(universeId)
      return created
    },
    async update(id: string, patch: TypePatch): Promise<EntityType> {
      const universeId = this.requireUniverseId()
      const updated = await services.types.update(id, patch)
      await this.load(universeId)
      return updated
    },
    async remove(id: string): Promise<void> {
      const universeId = this.requireUniverseId()
      await services.types.remove(id)
      await this.load(universeId)
    },
    requireUniverseId(): string {
      if (!this.universeId) {
        throw new LoreGraphError('尚未加载世界类型')
      }
      return this.universeId
    },
  },
})
