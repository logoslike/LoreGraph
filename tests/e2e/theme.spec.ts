import { expect, test } from '@playwright/test'
import { openUniverse } from './helpers'

/** LG-011 / LG-012 主题持久化与面板折叠。 */
test.describe('LG-011 主题切换与持久化', () => {
  test('切换深色主题后刷新仍然生效', async ({ page }) => {
    await openUniverse(page, '烬海纪元')

    const html = page.locator('html')
    await expect(html).not.toHaveClass(/dark/)

    await page.getByTestId('theme-toggle').click()
    await expect(html).toHaveClass(/dark/)
    await expect(page.getByTestId('theme-toggle')).toContainText('切换到浅色主题')
    expect(await page.evaluate(() => window.localStorage.getItem('loregraph.theme'))).toBe('dark')

    await page.reload()
    await expect(page.getByTestId('graph-canvas')).toBeVisible()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.getByTestId('theme-toggle')).toContainText('切换到浅色主题')
  })

  test('再次切换回浅色主题并写入本地偏好', async ({ page }) => {
    await openUniverse(page, '烬海纪元')

    await page.getByTestId('theme-toggle').click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.getByTestId('theme-toggle').click()
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    expect(await page.evaluate(() => window.localStorage.getItem('loregraph.theme'))).toBe('light')
  })
})

test.describe('LG-012 面板折叠', () => {
  test('侧边栏可收起并用悬浮按钮展开', async ({ page }) => {
    await openUniverse(page, '烬海纪元')
    await expect(page.getByTestId('sidebar')).toBeVisible()

    await page.getByTestId('collapse-sidebar').click()
    await expect(page.getByTestId('sidebar')).toBeHidden()
    const toggle = page.getByTestId('toggle-sidebar')
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(page.getByTestId('sidebar')).toBeVisible()
    await expect(page.getByTestId('search-input')).toBeVisible()
  })

  test('检查器可收起并用悬浮按钮展开', async ({ page }) => {
    await openUniverse(page, '烬海纪元')
    await expect(page.getByTestId('inspector')).toBeVisible()

    await page.getByTestId('collapse-inspector').click()
    await expect(page.getByTestId('inspector')).toBeHidden()
    const toggle = page.getByTestId('toggle-inspector')
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(page.getByTestId('inspector')).toBeVisible()
    await expect(page.getByTestId('inspector-empty')).toBeVisible()
  })
})
