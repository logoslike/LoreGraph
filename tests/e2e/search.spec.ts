import { expect, test } from '@playwright/test'
import { createNodeViaToolbar, createUniverse, openUniverse, useEmptyLibrary } from './helpers'

/** LG-009 搜索：过滤节点列表并选中命中节点。 */
test.describe('LG-009 搜索与筛选', () => {
  test('按名称子串过滤节点列表，空查询恢复全部', async ({ page }) => {
    await openUniverse(page, '烬海纪元')
    await expect(page.getByTestId('lore-node')).toHaveCount(12)
    await expect(page.getByTestId('node-list-item')).toHaveCount(12)

    const search = page.getByTestId('search-input')
    await search.fill('澜舟')
    await expect(page.getByTestId('node-list-item')).toHaveCount(1)
    await expect(page.getByTestId('node-list-item')).toContainText('澜舟')

    await search.fill('墨')
    await expect(page.getByTestId('node-list-item')).toHaveCount(1)
    await expect(page.getByTestId('node-list-item')).toContainText('墨鸦')

    await search.fill('不存在的名字')
    await expect(page.getByTestId('node-list-item')).toHaveCount(0)
    await expect(page.getByTestId('sidebar').getByText('没有匹配的节点')).toBeVisible()

    await search.fill('')
    await expect(page.getByTestId('node-list-item')).toHaveCount(12)
  })

  test('点击搜索结果选中节点并在 Inspector 展示', async ({ page }) => {
    await openUniverse(page, '烬海纪元')

    await page.getByTestId('search-input').fill('潮汐教团')
    const hit = page.getByTestId('node-list-item').filter({ hasText: '潮汐教团' })
    await expect(hit).toHaveCount(1)
    await hit.click()

    await expect(page.getByTestId('inspector-name')).toHaveValue('潮汐教团')
    await expect(page.getByTestId('node-editor')).toBeVisible()
  })

  test('搜索不区分大小写', async ({ page }) => {
    await useEmptyLibrary(page)
    await createUniverse(page, '搜索测试')
    await createNodeViaToolbar(page, 'Ember')
    await createNodeViaToolbar(page, '澜舟')

    await page.getByTestId('search-input').fill('ember')
    await expect(page.getByTestId('node-list-item')).toHaveCount(1)
    await expect(page.getByTestId('node-list-item')).toContainText('Ember')
  })
})
