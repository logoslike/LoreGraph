import { mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it } from 'vitest'
import BaseDialog from '@/components/common/BaseDialog.vue'

/**
 * jsdom 只实现了 dialog 的 open 属性反射，没有 showModal/close。
 * BaseDialog 会走 setAttribute 回退路径打开、并在收起或卸载时调用 close，
 * 这里补一个只维护 open 属性的最小实现，让打开/关闭路径都能测。
 */
beforeAll(() => {
  if (typeof HTMLDialogElement.prototype.close !== 'function') {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement): void {
      this.removeAttribute('open')
    }
  }
})

function mountDialog(open: boolean) {
  return mount(BaseDialog, {
    attachTo: document.body,
    props: { open, title: '对话框标题' },
    slots: { default: '正文内容' },
  })
}

/**
 * 会无条件改变 display 的工具类。出现在 dialog 自身上会盖掉 UA 的
 * dialog:not([open]) { display: none }，让未打开的对话框依然可见并拦截点击。
 */
const DISPLAY_UTILITIES = new Set([
  'block',
  'inline',
  'inline-block',
  'flex',
  'inline-flex',
  'grid',
  'inline-grid',
  'table',
  'inline-table',
  'flow-root',
  'contents',
  'list-item',
])

describe('BaseDialog', () => {
  it('open=false 时 dialog 没有 open 属性，保持关闭', () => {
    const wrapper = mountDialog(false)
    const dialog = wrapper.get('dialog')

    expect(dialog.attributes('open')).toBeUndefined()
    expect((dialog.element as HTMLDialogElement).open).toBe(false)
    wrapper.unmount()
  })

  it('open=true 时 dialog 带上 open 属性', () => {
    const wrapper = mountDialog(true)
    const dialog = wrapper.get('dialog')

    expect(dialog.attributes('open')).toBe('')
    expect((dialog.element as HTMLDialogElement).open).toBe(true)
    wrapper.unmount()
  })

  it('open 属性随 prop 切换同步增删', async () => {
    const wrapper = mountDialog(false)
    const dialog = wrapper.get('dialog')
    expect(dialog.attributes('open')).toBeUndefined()

    await wrapper.setProps({ open: true })
    expect(dialog.attributes('open')).toBe('')

    await wrapper.setProps({ open: false })
    expect(dialog.attributes('open')).toBeUndefined()
    wrapper.unmount()
  })

  it('dialog 自身不带无条件的 display 工具类，flex 只在 open 时生效', () => {
    const wrapper = mountDialog(false)
    const classes = wrapper.get('dialog').classes()

    // 无条件 flex 会让关闭的 dialog 重新可见（display: flex 覆盖 UA 的 display: none）
    expect(classes).not.toContain('flex')
    expect(classes.filter((name) => DISPLAY_UTILITIES.has(name))).toEqual([])
    expect(classes).toContain('open:flex')
    // 居中与高度上限不受影响
    expect(classes).toContain('m-auto')
    expect(classes).toContain('max-h-[calc(100dvh-2rem)]')
    wrapper.unmount()
  })
})
