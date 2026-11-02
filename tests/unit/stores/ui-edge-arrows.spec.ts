import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUiStore } from '@/stores/ui'

const STORAGE_KEY = 'loregraph.show-edge-arrows'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('ui store 全局箭头开关', () => {
  it('首次使用默认显示箭头', () => {
    const ui = useUiStore()
    expect(ui.showEdgeArrows).toBe(true)
  })

  it('切换后写入本地偏好，重建 store 仍保持关闭', () => {
    const first = useUiStore()
    first.toggleEdgeArrows()
    expect(first.showEdgeArrows).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false')

    setActivePinia(createPinia())
    const second = useUiStore()
    expect(second.showEdgeArrows).toBe(false)

    second.toggleEdgeArrows()
    expect(second.showEdgeArrows).toBe(true)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true')
  })

  it('显式的 true 与损坏值都回到默认开启', () => {
    localStorage.setItem(STORAGE_KEY, 'true')
    expect(useUiStore().showEdgeArrows).toBe(true)

    localStorage.setItem(STORAGE_KEY, 'not-a-boolean')
    setActivePinia(createPinia())
    expect(useUiStore().showEdgeArrows).toBe(true)
  })
})
