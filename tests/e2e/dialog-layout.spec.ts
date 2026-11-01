import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  createUniverse,
  gotoUniverses,
  openGraphMoreMenu,
  openUniverse,
  useEmptyLibrary,
} from './helpers'

/** 视口中心偏差容忍度（px）：浏览器按整数像素布局，留 4px 余量。 */
const CENTER_TOLERANCE = 4

/**
 * 断言对话框包围盒在视口内水平、垂直居中，且整体不超出视口。
 * 回归背景：Tailwind preflight 把全部元素 margin 归零后，原生模态 dialog
 * 失去 UA 的 margin: auto，会贴在视口左上角。
 */
async function expectDialogCentered(page: Page, dialog: Locator): Promise<void> {
  await expect(dialog).toBeVisible()
  const box = await dialog.boundingBox()
  if (box === null) {
    throw new Error('对话框没有可见包围盒')
  }
  const viewport = page.viewportSize()
  if (viewport === null) {
    throw new Error('当前页面没有设置视口尺寸')
  }
  expect(
    Math.abs(box.x + box.width / 2 - viewport.width / 2),
    `对话框水平方向偏离视口中心（x=${box.x}, width=${box.width}）`,
  ).toBeLessThanOrEqual(CENTER_TOLERANCE)
  expect(
    Math.abs(box.y + box.height / 2 - viewport.height / 2),
    `对话框垂直方向偏离视口中心（y=${box.y}, height=${box.height}）`,
  ).toBeLessThanOrEqual(CENTER_TOLERANCE)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
}

test.describe('对话框布局', () => {
  test('新建世界对话框在视口正中', async ({ page }) => {
    await useEmptyLibrary(page)
    await gotoUniverses(page)

    await page.getByTestId('new-universe-btn').click()
    const dialog = page.getByRole('dialog')
    await expect(page.getByTestId('universe-name-input')).toBeVisible()
    await expect(dialog).toHaveCount(1)

    await expectDialogCentered(page, dialog)

    // 关闭行为不受布局修复影响
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()
  })

  test('工作区导出图谱片段对话框在视口正中', async ({ page }) => {
    await useEmptyLibrary(page)
    await createUniverse(page, '对话框布局')
    await openGraphMoreMenu(page)

    await page.getByTestId('export-graph-btn').click()
    const dialog = page.getByTestId('graph-export-dialog')
    await expect(dialog).toBeVisible()

    await expectDialogCentered(page, dialog)

    await page.getByTestId('graph-export-cancel-btn').click()
    await expect(dialog).toBeHidden()
  })

  test('视口变矮时对话框仍居中并在内部滚动', async ({ page }) => {
    await openUniverse(page, '烬海纪元')
    await openGraphMoreMenu(page)
    await page.getByTestId('export-graph-btn').click()

    const dialog = page.getByTestId('graph-export-dialog')
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('graph-export-node-item').first()).toBeVisible()

    // 高度不足时对话框被高度上限截断，正文区滚动，页脚操作仍在视口内
    await page.setViewportSize({ width: 1440, height: 360 })
    await expectDialogCentered(page, dialog)
    await expect(page.getByTestId('graph-export-confirm-btn')).toBeInViewport()
    // dialog 自身没有把内容裁掉：超高部分由内部滚动区消化
    expect(
      await dialog.evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
    ).toBe(true)
  })
})
