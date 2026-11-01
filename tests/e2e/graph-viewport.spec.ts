import { expect, test, type Page } from '@playwright/test'
import {
  createTwoSeparatedNodes,
  createUniverse,
  useEmptyLibrary,
  waitForViewportIdle,
} from './helpers'

/**
 * LG-208 视图适配：窗口缩放或左右面板开合导致画布尺寸变化时，
 * 原来位于画布中心的内容应仍在中心（只平移、不缩放、不自动 fitView）。
 * 判定方式：节点中心相对画布中心的屏幕偏移在尺寸变化前后保持不变。
 */

interface Box {
  x: number
  y: number
  width: number
  height: number
}

async function canvasBox(page: Page): Promise<Box> {
  const box = await page.getByTestId('graph-canvas').boundingBox()
  if (box === null) {
    throw new Error('画布不可见')
  }
  return box
}

async function nodeBox(page: Page, name: string): Promise<Box> {
  const node = page.getByTestId('lore-node').filter({ hasText: name })
  await expect(node).toBeVisible()
  const box = await node.boundingBox()
  if (box === null) {
    throw new Error(`节点「${name}」不可见`)
  }
  return box
}

/** 节点中心相对画布中心的偏移（屏幕像素）。整体平移时该偏移保持不变。 */
async function centerOffset(page: Page, name: string): Promise<{ x: number; y: number }> {
  const canvas = await canvasBox(page)
  const node = await nodeBox(page, name)
  return {
    x: node.x + node.width / 2 - (canvas.x + canvas.width / 2),
    y: node.y + node.height / 2 - (canvas.y + canvas.height / 2),
  }
}

function maxDelta(actual: { x: number; y: number }, expected: { x: number; y: number }): number {
  return Math.max(Math.abs(actual.x - expected.x), Math.abs(actual.y - expected.y))
}

/** 建一个两节点的世界并适应视图，作为视图适配用例的起点。 */
async function twoNodeWorld(page: Page): Promise<void> {
  await useEmptyLibrary(page)
  await createUniverse(page, '视图测试')
  await createTwoSeparatedNodes(page, '澜舟', '墨鸦')
  await waitForViewportIdle(page)
}

test.describe('LG-208 面板开合后的视图适配', () => {
  test('收起侧栏后画布中心的内容仍在中心，展开后回到原位', async ({ page }) => {
    await twoNodeWorld(page)
    const before = {
      left: await centerOffset(page, '澜舟'),
      right: await centerOffset(page, '墨鸦'),
    }
    const widthBefore = (await canvasBox(page)).width

    await page.getByTestId('collapse-sidebar').click()
    // 先确认侧栏真的收起了，否则下面的宽度断言失败时分不清是没点中还是布局没变
    await expect(page.getByTestId('sidebar')).toBeHidden()
    await expect
      .poll(async () => (await canvasBox(page)).width, {
        timeout: 10_000,
        message: '收起侧栏后画布没有变宽',
      })
      .toBeGreaterThan(widthBefore + 200)

    await expect
      .poll(async () => maxDelta(await centerOffset(page, '澜舟'), before.left), {
        timeout: 10_000,
        message: '收起侧栏后画布中心的内容漂移了',
      })
      .toBeLessThanOrEqual(2)
    expect(maxDelta(await centerOffset(page, '墨鸦'), before.right)).toBeLessThanOrEqual(2)

    await page.getByTestId('toggle-sidebar').click()
    await expect(page.getByTestId('sidebar')).toBeVisible()
    await expect
      .poll(async () => (await canvasBox(page)).width, {
        timeout: 10_000,
        message: '展开侧栏后画布没有变窄',
      })
      .toBeLessThanOrEqual(widthBefore + 1)

    await expect
      .poll(async () => maxDelta(await centerOffset(page, '澜舟'), before.left), {
        timeout: 10_000,
        message: '展开侧栏后画布没有回到原位',
      })
      .toBeLessThanOrEqual(2)
  })

  test('收起检查器后画布中心的内容仍在中心', async ({ page }) => {
    await twoNodeWorld(page)
    const before = await centerOffset(page, '澜舟')
    const widthBefore = (await canvasBox(page)).width

    await page.getByTestId('collapse-inspector').click()
    await expect
      .poll(async () => (await canvasBox(page)).width, {
        timeout: 10_000,
        message: '收起检查器后画布没有变宽',
      })
      .toBeGreaterThan(widthBefore + 200)

    await expect
      .poll(async () => maxDelta(await centerOffset(page, '澜舟'), before), {
        timeout: 10_000,
        message: '收起检查器后画布中心的内容漂移了',
      })
      .toBeLessThanOrEqual(2)
  })

  test('窗口缩放后画布中心的内容仍在中心', async ({ page }) => {
    await twoNodeWorld(page)
    const before = await centerOffset(page, '澜舟')
    const boxBefore = await canvasBox(page)

    await page.setViewportSize({ width: 1200, height: 820 })
    await expect
      .poll(async () => (await canvasBox(page)).width, {
        timeout: 10_000,
        message: '窗口缩放后画布宽度没有变化',
      })
      .not.toBe(boxBefore.width)

    await expect
      .poll(async () => maxDelta(await centerOffset(page, '澜舟'), before), {
        timeout: 10_000,
        message: '窗口缩放后画布中心的内容漂移了',
      })
      .toBeLessThanOrEqual(2)
  })

  test('面板开合后点击适应视图，所有节点都落在画布内', async ({ page }) => {
    await twoNodeWorld(page)
    await page.getByTestId('collapse-sidebar').click()
    await page.getByTestId('collapse-inspector').click()
    // 两侧面板都收起后画布才占满窗口；先确认收起生效，再等视口稳定
    await expect(page.getByTestId('sidebar')).toBeHidden()
    await expect(page.getByTestId('inspector')).toBeHidden()
    await waitForViewportIdle(page)

    await page.getByTestId('fit-view-btn').click()
    await waitForViewportIdle(page)

    const canvas = await canvasBox(page)
    for (const name of ['澜舟', '墨鸦']) {
      const node = await nodeBox(page, name)
      expect(node.x, `节点「${name}」超出画布左边界`).toBeGreaterThanOrEqual(canvas.x)
      expect(node.y, `节点「${name}」超出画布上边界`).toBeGreaterThanOrEqual(canvas.y)
      expect(node.x + node.width, `节点「${name}」超出画布右边界`).toBeLessThanOrEqual(
        canvas.x + canvas.width,
      )
      expect(node.y + node.height, `节点「${name}」超出画布下边界`).toBeLessThanOrEqual(
        canvas.y + canvas.height,
      )
    }
  })
})
