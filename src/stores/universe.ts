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
    async create(name: string): Promise<Universe> {
      const universe = await services.universes.create({ name })
      this.universes = [universe, ...this.universes]
      this.currentId = universe.id
      return universe
    },
    async rename(id: string, name: string): Promise<void> {
      const updated = await services.universes.update(id, { name })
      const index = this.universes.findIndex((universe) => universe.id === id)
      if (index >= 0) {
        this.universes[index] = updated
      }
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
