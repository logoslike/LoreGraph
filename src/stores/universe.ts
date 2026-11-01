import { defineStore } from 'pinia'
import type { Universe } from '@/models/universe'
import { services } from '@/services'

interface UniverseState {
  universes: Universe[]
  currentId: string | null
  loading: boolean
}

/** 世界列表与当前世界。 */
export const useUniverseStore = defineStore('universe', {
  state: (): UniverseState => ({
    universes: [],
    currentId: null,
    loading: false,
  }),
  getters: {
    current(state): Universe | null {
      return state.universes.find((universe) => universe.id === state.currentId) ?? null
    },
  },
  actions: {
    async loadAll(): Promise<void> {
      this.loading = true
      try {
        this.universes = await services.universes.list()
      } finally {
        this.loading = false
      }
    },
    async create(name: string, description = ''): Promise<Universe> {
      const universe = await services.universes.create({ name, description })
      this.universes = [universe, ...this.universes]
      this.currentId = universe.id
      return universe
    },
    /** 更新世界的名称与简介。 */
    async updateInfo(id: string, patch: { name?: string; description?: string }): Promise<void> {
      const updated = await services.universes.update(id, patch)
      const index = this.universes.findIndex((universe) => universe.id === id)
      if (index >= 0) {
        this.universes[index] = updated
      }
    },
    /** 导入内置示例世界并切到该世界；返回新世界。 */
    async seedSample(): Promise<Universe> {
      const universe = await services.universes.seedSample()
      this.universes = [universe, ...this.universes]
      this.currentId = universe.id
      return universe
    },
    async remove(id: string): Promise<void> {
      await services.universes.remove(id)
      this.universes = this.universes.filter((universe) => universe.id !== id)
      if (this.currentId === id) {
        this.currentId = null
      }
    },
    setCurrent(id: string | null): void {
      this.currentId = id
    },
  },
})
