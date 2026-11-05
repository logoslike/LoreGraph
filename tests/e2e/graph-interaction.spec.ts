import { expect, test, type Page } from '@playwright/test'
import {
  createTwoSeparatedNodes,
  createUniverse,
  dragNodeBy,
  findStoredNode,
  readViewportTransform,
  useEmptyLibrary,
  waitForStoredNodePosition,
  waitForViewportIdle,
} from './helpers'

/** 建一个含两个节点的空世界（已适应视图）。 */
async function twoNodeWorld(page: Page): Promise<void> {
  await useEmptyLibrary(page)
  await createUniverse(page, '交互测试')
  await createTwoSeparatedNodes(page, '澜舟', '墨鸦')
}

test.describe('LG-007 图谱交互（拖动 / 缩放 / 选择）', () => {
  test('拖动节点后坐标落库，刷新后位置不变', async ({ page }) => {
    await twoNodeWorld(page)

    const initialPosition = await waitForStoredNodePosition(page, '澜舟')
    await dragNodeBy(page, '澜舟', -120, -80)

    // 拖拽结束才回写位置（自动保存防抖），轮询直到 IndexedDB 里的坐标发生变化
    await expect
      .poll(
        async () => {
          const node = await findStoredNode(page, '澜舟')
          return node?.position ?? initialPosition
        },
        { message: '等待拖动后的节点坐标写入 IndexedDB 超时' },
      )
      .not.toEqual(initialPosition)

    const draggedPosition = await waitForStoredNodePosition(page, '澜舟')
    expect(draggedPosition).not.toEqual(initialPosition)

    await page.reload()
    await expect(page.getByTestId('graph-canvas')).toBeVisible()
    await expect(page.getByTestId('lore-node').filter({ hasText: '澜舟' })).toBeVisible()

    const reloadedPosition = await waitForStoredNodePosition(page, '澜舟')
    expect(reloadedPosition).toEqual(draggedPosition)
  })

  test('Ctrl+Z 撤销拖动：渲染与落库坐标都回到拖动前', async ({ page }) => {
    await twoNodeWorld(page)

    const node = page.getByTestId('lore-node').filter({ hasText: '澜舟' })
    const initialPosition = await waitForStoredNodePosition(page, '澜舟')
    const beforeBox = await node.boundingBox()
    if (beforeBox === null) {
      throw new Error('拖动前找不到节点「澜舟」')
    }

    await dragNodeBy(page, '澜舟', -120, -80)
    await expect
      .poll(
        async () => {
          const stored = await findStoredNode(page, '澜舟')
          return stored?.position ?? initialPosition
        },
        { message: '等待拖动后的节点坐标写入 IndexedDB 超时' },
      )
      .not.toEqual(initialPosition)

    await page.keyboard.press('Control+z')

    // 撤销立即回写内存并重新落库（自动保存防抖），轮询直到 IndexedDB 恢复原坐标
    await expect
      .poll(
        async () => {
          const stored = await findStoredNode(page, '澜舟')
          return stored?.position ?? null
        },
        { timeout: 15_000, message: '等待 Ctrl+Z 撤销写入 IndexedDB 超时' },
      )
      .toEqual(initialPosition)

    // 画布坐标同样要回来：store 改动经 flowNodes 同步给 Vue Flow
    await expect
      .poll(
        async () => {
          const box = await node.boundingBox()
          return box === null
            ? Number.POSITIVE_INFINITY
            : Math.abs(box.x - beforeBox.x) + Math.abs(box.y - beforeBox.y)
        },
        { message: '等待撤销后的节点回到拖动前位置' },
      )
      .toBeLessThanOrEqual(8)
  })

  test('适应视图与滚轮缩放会改变画布视口变换', async ({ page }) => {
    await twoNodeWorld(page)

    const fitted = await readViewportTransform(page)

    // 拖动一个节点让内容 bounds 变大，再点「适应视图」应重新计算视口
    await dragNodeBy(page, '澜舟', 180, 120)
    await page.getByTestId('fit-view-btn').click()
    await waitForViewportIdle(page)
    const afterFit = await readViewportTransform(page)
    expect(afterFit).not.toBe(fitted)

    // 滚轮缩放：视口 transform 必须变化
    const canvas = page.getByTestId('graph-canvas')
    const box = await canvas.boundingBox()
    if (box === null) {
      throw new Error('画布不可见，无法执行滚轮缩放')
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, -240)
    await expect
      .poll(async () => (await readViewportTransform(page)) !== afterFit, {
        message: '等待滚轮缩放改变视口 transform 超时',
      })
      .toBe(true)
  })

  test('点击节点选中并在 Inspector 展示，点击空白画布取消选中', async ({ page }) => {
    await twoNodeWorld(page)

    await page.getByTestId('lore-node').filter({ hasText: '澜舟' }).click()
    await expect(page.getByTestId('inspector-name')).toHaveValue('澜舟')
    await expect(page.getByTestId('node-editor')).toBeVisible()

    // 点击画布右上角空白处（避开工具栏、节点与小地图）取消选中
    const canvas = page.getByTestId('graph-canvas')
    const box = await canvas.boundingBox()
    if (box === null) {
      throw new Error('画布不可见，无法点击空白区域')
    }
    await page.mouse.click(box.x + box.width - 60, box.y + 60)
    await expect(page.getByTestId('inspector-empty')).toBeVisible()
  })
})
