import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUiStore } from '@/stores/ui'

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ui store 通知替换', () => {
  it('同 key 的新通知替换旧通知，未带相同 key 的通知保留', () => {
    vi.useFakeTimers()
    const ui = useUiStore()

    const first = ui.notify('已自动布局', { key: 'auto-layout', duration: 1000 })
    const other = ui.notify('其他提示', { duration: 1000 })
    const second = ui.notify('已自动布局', {
      key: 'auto-layout',
      actionLabel: '撤销',
      duration: 5000,
    })

    expect(ui.toasts.map((toast) => toast.id)).toEqual([other, second])
    expect(ui.toasts[1]).toMatchObject({ key: 'auto-layout', actionLabel: '撤销' })
    expect(second).not.toBe(first)

    // 旧通知的定时器不应影响替换后的通知
    vi.advanceTimersByTime(1000)
    expect(ui.toasts.map((toast) => toast.id)).toEqual([second])
    vi.advanceTimersByTime(4000)
    expect(ui.toasts).toHaveLength(0)
  })

  it('没有 key 的同文案通知仍然并存，现有调用行为不变', () => {
    const ui = useUiStore()

    const first = ui.notify('已创建节点')
    const second = ui.notify('已创建节点')

    expect(ui.toasts.map((toast) => toast.id)).toEqual([first, second])
    expect(ui.toasts.every((toast) => toast.key === undefined)).toBe(true)
  })
})
