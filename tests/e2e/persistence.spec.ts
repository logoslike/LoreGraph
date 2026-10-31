import { expect, test, type Page } from '@playwright/test'
import {
  addProperty,
  connectNodes,
  createNodeViaToolbar,
  createTwoSeparatedNodes,
  createUniverse,
  useEmptyLibrary,
  waitForPersistedNode,
} from './helpers'

/** 建一个空世界并写入待验证的节点编辑（改名 + 自定义属性）。 */
async function editNodeForPersistence(page: Page): Promise<void> {
  await useEmptyLibrary(page)
  await createUniverse(page, '存续测试')
  await createNodeViaToolbar(page, '潮生灯')
  const nameInput = page.getByTestId('inspector-name')
  await nameInput.fill('潮生灯·记')
  await nameInput.blur()
  await addProperty(page, '年份', '第三纪')
}

test.describe('LG-004 编辑自动保存', () => {
  test('节点改名与自定义属性自动写入 IndexedDB', async ({ page }) => {
    await editNodeForPersistence(page)

    // 自动保存防抖结束后落库；用轮询读取 IndexedDB，不使用固定等待
    await waitForPersistedNode(
      page,
      (node) => node.name === '潮生灯·记' && node.properties['年份'] === '第三纪',
    )
  })
})

test.describe('LG-010 刷新持久化', () => {
  test('刷新后节点改名与自定义属性仍在', async ({ page }) => {
    await editNodeForPersistence(page)
    await waitForPersistedNode(
      page,
      (node) => node.name === '潮生灯·记' && node.properties['年份'] === '第三纪',
    )

    await page.reload()
    await expect(page.getByTestId('graph-canvas')).toBeVisible()
    await expect(page.getByTestId('lore-node').filter({ hasText: '潮生灯·记' })).toBeVisible()
    await expect(page.getByTestId('lore-node')).toHaveCount(1)

    await page.getByTestId('node-list-item').filter({ hasText: '潮生灯·记' }).click()
    await expect(page.getByTestId('inspector-name')).toHaveValue('潮生灯·记')
    await expect(page.getByTestId('property-key-input')).toHaveValue('年份')
    await expect(page.getByTestId('property-value-input')).toHaveValue('第三纪')
  })

  test('关系两端与标签刷新后仍在', async ({ page }) => {
    await useEmptyLibrary(page)
    await createUniverse(page, '存续测试')
    await createTwoSeparatedNodes(page, '澜舟', '墨鸦')

    await connectNodes(page, '澜舟', '墨鸦')
    await page.getByTestId('relation-type-select').selectOption({ index: 1 })
    await page.getByTestId('relation-label-input').fill('亦师亦友')
    await page.getByTestId('submit-relation-btn').click()
    await expect(page.locator('.vue-flow__edge')).toHaveCount(1)

    await page.reload()
    await expect(page.getByTestId('graph-canvas')).toBeVisible()
    await expect(page.getByTestId('lore-node')).toHaveCount(2)
    await expect(page.locator('.vue-flow__edge')).toHaveCount(1)
    await expect(page.locator('.vue-flow__edge-text')).toHaveCount(1)
    await expect(page.locator('.vue-flow__edge-text')).toContainText('亦师亦友')
  })
})
