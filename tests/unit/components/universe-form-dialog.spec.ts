import { mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it } from 'vitest'
import UniverseFormDialog from '@/components/universe/UniverseFormDialog.vue'

/**
 * jsdom 没有实现 dialog.close，而 BaseDialog 在收起或卸载时会调用它；
 * 这里补一个只更新 open 属性的最小实现，让组件卸载不报错。
 */
beforeAll(() => {
  if (typeof HTMLDialogElement.prototype.close !== 'function') {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement): void {
      this.removeAttribute('open')
    }
  }
})

const CREATE_TEST_IDS = {
  name: 'universe-name-input',
  description: 'universe-description-input',
  submit: 'create-universe-btn',
}

function mountCreateDialog() {
  return mount(UniverseFormDialog, {
    attachTo: document.body,
    props: {
      open: true,
      mode: 'create',
      testIds: CREATE_TEST_IDS,
    },
  })
}

/** 按文本找按钮，编辑模式的保存按钮没有 testid。 */
function findButton(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll('button').find((button) => button.text() === text)
}

describe('UniverseFormDialog 世界表单', () => {
  it('新建模式使用「新建世界」标题与创建按钮，并保留既有 testid 与长度上限', () => {
    const wrapper = mountCreateDialog()
    expect(wrapper.get('h2').text()).toBe('新建世界')

    const name = wrapper.get('[data-testid="universe-name-input"]')
    expect(name.attributes('maxlength')).toBe('120')
    const description = wrapper.get('[data-testid="universe-description-input"]')
    expect(description.attributes('maxlength')).toBe('20000')
    expect(wrapper.get('[data-testid="create-universe-btn"]').text()).toBe('创建并进入')
    wrapper.unmount()
  })

  it('名称为空时提示且不提交，输入后提示消失', async () => {
    const wrapper = mountCreateDialog()
    const name = wrapper.get('[data-testid="universe-name-input"]')
    await name.setValue('   ')
    await wrapper.get('[data-testid="create-universe-btn"]').trigger('click')
    expect(wrapper.text()).toContain('名称不能为空')
    expect(wrapper.emitted('submit')).toBeUndefined()

    await name.setValue('余烬王朝')
    expect(wrapper.text()).not.toContain('名称不能为空')
    wrapper.unmount()
  })

  it('提交时去掉名称与描述的首尾空白', async () => {
    const wrapper = mountCreateDialog()
    await wrapper.get('[data-testid="universe-name-input"]').setValue('  余烬王朝  ')
    await wrapper.get('[data-testid="universe-description-input"]').setValue('  三代君主的故事  ')
    await wrapper.get('[data-testid="create-universe-btn"]').trigger('click')

    expect(wrapper.emitted('submit')?.[0]).toEqual([
      { name: '余烬王朝', description: '三代君主的故事' },
    ])
    wrapper.unmount()
  })

  it('编辑模式预填传入值，使用「编辑世界」标题与保存按钮，可清空描述', async () => {
    const wrapper = mount(UniverseFormDialog, {
      attachTo: document.body,
      props: {
        open: true,
        mode: 'edit',
        initialName: '余烬王朝',
        initialDescription: '旧简介',
        testIds: {
          name: 'rename-universe-input',
          description: 'rename-universe-description-input',
        },
      },
    })

    expect(wrapper.get('h2').text()).toBe('编辑世界')
    const name = wrapper.get('[data-testid="rename-universe-input"]')
    expect((name.element as HTMLInputElement).value).toBe('余烬王朝')
    const description = wrapper.get('[data-testid="rename-universe-description-input"]')
    expect((description.element as HTMLTextAreaElement).value).toBe('旧简介')

    const save = findButton(wrapper, '保存')
    if (!save) {
      throw new Error('找不到保存按钮')
    }
    await description.setValue('')
    await save.trigger('click')
    expect(wrapper.emitted('submit')?.[0]).toEqual([{ name: '余烬王朝', description: '' }])
    wrapper.unmount()
  })

  it('取消只触发 close，不提交表单', async () => {
    const wrapper = mountCreateDialog()
    await wrapper.get('[data-testid="universe-name-input"]').setValue('余烬王朝')
    const cancel = findButton(wrapper, '取消')
    if (!cancel) {
      throw new Error('找不到取消按钮')
    }
    await cancel.trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('submit')).toBeUndefined()
    wrapper.unmount()
  })
})
