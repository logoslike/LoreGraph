import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { useShortcuts, type ShortcutHandlers } from '@/composables/useShortcuts'

let wrapper: VueWrapper | null = null

/** 挂一个只负责注册全局快捷键的宿主组件。 */
function mountShortcuts(handlers: ShortcutHandlers): void {
  const Harness = defineComponent({
    setup() {
      useShortcuts(handlers)
      return () => h('div')
    },
  })
  wrapper = mount(Harness, { attachTo: document.body })
}

function press(
  key: string,
  init: KeyboardEventInit = {},
  target: EventTarget = window,
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  })
  target.dispatchEvent(event)
  return event
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('useShortcuts F 键聚焦', () => {
  it('无悬停时在画布上按 F 触发聚焦处理并阻止默认行为', () => {
    const onToggleFocus = vi.fn()
    mountShortcuts({ onToggleFocus })

    const event = press('f')

    expect(onToggleFocus).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it.each(['input', 'textarea'])('在 %s 中打字不触发聚焦', (tag) => {
    const onToggleFocus = vi.fn()
    mountShortcuts({ onToggleFocus })
    const field = document.createElement(tag)
    document.body.append(field)

    press('f', {}, field)

    expect(onToggleFocus).not.toHaveBeenCalled()
  })

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Meta', { metaKey: true }],
    ['Alt', { altKey: true }],
  ])('%s + F 组合键不触发聚焦', (_name, init) => {
    const onToggleFocus = vi.fn()
    mountShortcuts({ onToggleFocus })

    press('f', init)

    expect(onToggleFocus).not.toHaveBeenCalled()
  })

  it('输入法组合输入期间不触发聚焦', () => {
    const onToggleFocus = vi.fn()
    mountShortcuts({ onToggleFocus })

    press('f', { isComposing: true })

    expect(onToggleFocus).not.toHaveBeenCalled()
  })

  it('对话框打开时不触发聚焦', () => {
    const onToggleFocus = vi.fn()
    mountShortcuts({ onToggleFocus })
    const dialog = document.createElement('dialog')
    dialog.setAttribute('open', '')
    document.body.append(dialog)

    press('f')

    expect(onToggleFocus).not.toHaveBeenCalled()
  })
})
