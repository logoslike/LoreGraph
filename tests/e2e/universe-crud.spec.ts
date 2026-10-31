import { expect, test } from '@playwright/test'
import {
  backToUniverses,
  createUniverse,
  gotoUniverses,
  openUniverse,
  useEmptyLibrary,
} from './helpers'

/** LG-001 世界 CRUD：创建、重命名、删除。 */
test.describe('LG-001 世界 CRUD', () => {
  test('新建世界后进入空工作区，返回列表可见卡片', async ({ page }) => {
    await useEmptyLibrary(page)
    await createUniverse(page, '余烬王朝')

    await expect(page.getByTestId('graph-empty')).toBeVisible()
    await expect(page.getByTestId('lore-node')).toHaveCount(0)

    await backToUniverses(page)
    const card = page.getByTestId('universe-card')
    await expect(card).toHaveCount(1)
    await expect(card).toContainText('余烬王朝')
    await expect(card).toContainText('0 节点')
    await expect(card).toContainText('12 类型')
  })

  test('名称为空时拒绝创建并提示', async ({ page }) => {
    await useEmptyLibrary(page)
    await gotoUniverses(page)
    await page.getByTestId('new-universe-btn').click()
    await expect(page.getByTestId('universe-name-input')).toBeVisible()

    await page.getByTestId('create-universe-btn').click()
    // 新建与重命名两个对话框共用该提示文案，作用域限定在已打开的对话框内
    await expect(page.locator('dialog[open]').getByText('名称不能为空')).toBeVisible()
    await expect(page.getByTestId('universe-name-input')).toBeVisible()
    await expect(page.getByTestId('universe-card')).toHaveCount(0)
  })

  test('可以重命名世界，刷新后仍然生效', async ({ page }) => {
    await useEmptyLibrary(page)
    await createUniverse(page, '余烬王朝')
    await backToUniverses(page)

    const card = page.getByTestId('universe-card').first()
    await card.getByTestId('rename-universe-btn').click()
    const input = page.getByTestId('rename-universe-input')
    await expect(input).toHaveValue('余烬王朝')
    await input.fill('余烬王朝·改')
    await page.getByRole('button', { name: '保存' }).click()

    await expect(page.getByTestId('universe-card').first()).toContainText('余烬王朝·改')

    await page.reload()
    await expect(page.getByTestId('universe-card').first()).toContainText('余烬王朝·改')
  })

  test('删除世界需要确认，确认后回到空状态', async ({ page }) => {
    await useEmptyLibrary(page)
    await createUniverse(page, '待删除世界')
    await backToUniverses(page)

    await page.getByTestId('delete-universe-btn').first().click()
    await expect(page.getByTestId('confirm-delete-btn')).toBeVisible()
    await page.getByTestId('confirm-delete-btn').click()

    await expect(page.getByTestId('universe-card')).toHaveCount(0)
    await expect(page.getByTestId('new-universe-empty-btn')).toBeVisible()
  })
})

/** LG-002 世界隔离与切换：不同世界数据互不影响，可用切换器切换。 */
test.describe('LG-002 世界隔离与切换', () => {
  test('世界数据互相隔离，并可用世界切换器切换', async ({ page }) => {
    // 本用例需要示例世界存在，不跳过首启种子
    await page.goto('/')
    await expect(page.getByTestId('universe-card').first()).toBeVisible()

    await createUniverse(page, '潮汐残卷')
    await expect(page.getByTestId('lore-node')).toHaveCount(0)

    await backToUniverses(page)
    const sampleCard = page.getByTestId('universe-card').filter({ hasText: '烬海纪元' })
    const newCard = page.getByTestId('universe-card').filter({ hasText: '潮汐残卷' })
    await expect(sampleCard).toContainText('12 节点')
    await expect(newCard).toContainText('0 节点')

    await openUniverse(page, '潮汐残卷')
    await expect(page.getByTestId('graph-empty')).toBeVisible()
    await expect(page.getByTestId('lore-node')).toHaveCount(0)

    // 世界切换器：切到示例世界显示其 12 个节点，切回空世界后恢复空画布
    const switcher = page.getByTestId('world-switcher')
    await switcher.selectOption({ label: '烬海纪元' })
    await expect(page.getByTestId('lore-node')).toHaveCount(12)

    await switcher.selectOption({ label: '潮汐残卷' })
    await expect(page.getByTestId('lore-node')).toHaveCount(0)
    await expect(page.getByTestId('graph-empty')).toBeVisible()
  })
})
