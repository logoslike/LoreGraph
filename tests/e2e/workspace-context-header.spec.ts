import { expect, test } from '@playwright/test'
import { backToUniverses, createUniverse, useEmptyLibrary } from './helpers'

test.describe('LG-305 Workspace 上下文标题', () => {
  test('标题随世界切换更新，刷新后保留当前世界', async ({ page }) => {
    await useEmptyLibrary(page)
    await createUniverse(page, '标题世界甲')

    const header = page.getByTestId('workspace-context-header')
    await expect(header).toContainText('标题世界甲')
    await expect(header).toContainText('Graph')

    await backToUniverses(page)
    await createUniverse(page, '标题世界乙')
    await expect(header).toContainText('标题世界乙')

    await page.getByTestId('world-switcher').selectOption({ label: '标题世界甲' })
    await expect(header).toContainText('标题世界甲')

    await page.reload()
    await expect(page.getByTestId('workspace-context-header')).toContainText('标题世界甲')
    await expect(page.getByTestId('workspace-context-header')).toContainText('Graph')
  })

  test('标题与画布在桌面主区纵向排列，画布占据余高', async ({ page }) => {
    await useEmptyLibrary(page)
    await createUniverse(page, '桌面标题布局')
    await page.setViewportSize({ width: 1440, height: 900 })

    const main = page.getByTestId('workspace-main')
    const header = page.getByTestId('workspace-context-header')
    const canvas = page.getByTestId('graph-canvas')
    await expect(header).toBeVisible()
    await expect(canvas).toBeVisible()

    const mainBox = await main.boundingBox()
    const headerBox = await header.boundingBox()
    const canvasBox = await canvas.boundingBox()
    expect(mainBox).not.toBeNull()
    expect(headerBox).not.toBeNull()
    expect(canvasBox).not.toBeNull()
    expect(headerBox!.height).toBe(48)
    expect(canvasBox!.y).toBe(headerBox!.y + headerBox!.height)
    expect(canvasBox!.height).toBe(mainBox!.height - headerBox!.height)
    expect(mainBox!.x).toBe(264)
    expect(mainBox!.width).toBe(1440 - 264 - 336)
    await expect(page.getByTestId('inspector')).toBeVisible()
  })

  test('窄屏保留全宽画布，标题不挤压抽屉布局', async ({ page }) => {
    await useEmptyLibrary(page)
    await createUniverse(page, '窄屏标题布局')
    await page.setViewportSize({ width: 800, height: 800 })

    const main = page.getByTestId('workspace-main')
    const header = page.getByTestId('workspace-context-header')
    const canvas = page.getByTestId('graph-canvas')
    await expect(header).toContainText('窄屏标题布局')
    await expect(header).toContainText('Graph')
    await expect(canvas).toBeVisible()

    const mainBox = await main.boundingBox()
    const headerBox = await header.boundingBox()
    const canvasBox = await canvas.boundingBox()
    expect(mainBox).not.toBeNull()
    expect(headerBox).not.toBeNull()
    expect(canvasBox).not.toBeNull()
    expect(mainBox!.x).toBe(0)
    expect(mainBox!.width).toBe(800)
    expect(headerBox!.height).toBe(48)
    expect(canvasBox!.y).toBe(headerBox!.y + headerBox!.height)
    expect(canvasBox!.height).toBe(mainBox!.height - headerBox!.height)
    await expect(page.getByTestId('toggle-sidebar')).toBeVisible()
  })
})
