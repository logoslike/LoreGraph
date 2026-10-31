import { expect, test } from '@playwright/test'
import { gotoUniverses, useEmptyLibrary } from './helpers'

/**
 * ONB 首启引导：没有任何世界时自动载入内置示例世界（烬海纪元）。
 * 说明：首启引导属于仓库自建能力，不在 PRD §6 的 LG-001~LG-012 验收编号内。
 */
test.describe('ONB 首启引导', () => {
  test('首次访问自动载入示例世界并展示统计', async ({ page }) => {
    await gotoUniverses(page)

    const card = page.getByTestId('universe-card')
    await expect(card).toHaveCount(1)
    await expect(card).toContainText('烬海纪元')
    // 示例世界：12 个节点、14 条关系、13 个类型
    await expect(card).toContainText('12 节点')
    await expect(card).toContainText('14 关系')
    await expect(card).toContainText('13 类型')

    // 标记已首启，避免下次访问重复创建示例世界
    const seeded = await page.evaluate(() =>
      window.localStorage.getItem('loregraph.firstRunSeeded'),
    )
    expect(seeded).toBe('1')
    // 首启不自动跳转，用户停留在世界列表
    await expect(page).toHaveURL(/\/$/)
  })

  test('已标记首启时展示空状态而不是示例世界', async ({ page }) => {
    await useEmptyLibrary(page)
    await gotoUniverses(page)

    await expect(page.getByTestId('universe-card')).toHaveCount(0)
    await expect(page.getByTestId('new-universe-empty-btn')).toBeVisible()
    await expect(page.getByTestId('sample-universe-btn')).toBeVisible()
  })

  test('空状态可手动加载示例世界并进入工作区', async ({ page }) => {
    await useEmptyLibrary(page)
    await gotoUniverses(page)

    await page.getByTestId('sample-universe-btn').click()
    await expect(page.getByTestId('graph-canvas')).toBeVisible()
    await expect(page.getByTestId('lore-node')).toHaveCount(12)
    await expect(page.getByTestId('graph-empty')).toHaveCount(0)
    await expect(page).toHaveURL(/\/u\/[A-Za-z0-9]+$/)
  })
})
