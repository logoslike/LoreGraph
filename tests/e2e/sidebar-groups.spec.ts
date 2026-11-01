import { expect, test, type Locator, type Page } from '@playwright/test'
import { createNodeViaToolbar, createUniverse, useEmptyLibrary } from './helpers'

/**
 * Phase 1 侧栏节点分组的浏览器回归：
 * 节点按类型分组（顺序与数量）、分区 / 分组的独立开合、搜索期间的临时展开与高亮，
 * 以及按世界隔离的折叠偏好持久化。
 * 断言只依赖用户可见状态与实际 data-testid，不修改生产实现。
 */

/** 按类型 key 定位节点分组容器（testid + data-type-key 双重限定）。 */
function groupOf(page: Page, typeKey: string): Locator {
  return page.locator(`[data-testid="node-group"][data-type-key="${typeKey}"]`)
}

/** 分组标题按钮：显示类型名与数量，并承载 aria-expanded。 */
function groupToggle(page: Page, typeKey: string): Locator {
  return groupOf(page, typeKey).getByTestId('node-group-toggle')
}

async function expectGroupExpanded(page: Page, typeKey: string, expanded: boolean): Promise<void> {
  await expect(groupToggle(page, typeKey)).toHaveAttribute('aria-expanded', String(expanded))
}

/** 建一个 4 节点 / 3 个类型分组的世界：角色 2、地点 1、物品 1。 */
async function seedGroupedWorld(page: Page, name: string): Promise<void> {
  await useEmptyLibrary(page)
  await createUniverse(page, name)
  await createNodeViaToolbar(page, '澜舟', '角色')
  await createNodeViaToolbar(page, '墨鸦', '角色')
  await createNodeViaToolbar(page, '沉钟湾', '地点')
  await createNodeViaToolbar(page, '潮生灯', '物品')
}

test.describe('Phase 1 侧栏节点分组', () => {
  test('节点按类型分组并显示数量，默认筛选区收起、节点库展开', async ({ page }) => {
    await seedGroupedWorld(page, '侧栏分组')

    // 默认：类型筛选收起（筛选行不渲染），节点库展开
    await expect(page.getByTestId('toggle-type-filter')).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByTestId('type-filter-character')).toBeHidden()
    await expect(page.getByTestId('toggle-node-library')).toHaveAttribute('aria-expanded', 'true')

    // 分组按类型定义的顺序排列：角色 → 地点 → 物品
    await expect(page.getByTestId('node-group')).toHaveCount(3)
    const groupKeys = await page
      .getByTestId('node-group')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-type-key')))
    expect(groupKeys).toEqual(['character', 'location', 'item'])

    // 分组标题显示类型名与该类型的节点数量
    await expect(groupToggle(page, 'character')).toHaveText(/角色\s*2/)
    await expect(groupToggle(page, 'location')).toHaveText(/地点\s*1/)
    await expect(groupToggle(page, 'item')).toHaveText(/物品\s*1/)

    // 每个分组只承载本类型节点，节点库条目总数等于节点总数
    await expect(groupOf(page, 'character').getByTestId('node-list-item')).toHaveCount(2)
    await expect(groupOf(page, 'character')).toContainText('澜舟')
    await expect(groupOf(page, 'character')).toContainText('墨鸦')
    await expect(groupOf(page, 'location').getByTestId('node-list-item')).toHaveCount(1)
    await expect(groupOf(page, 'location')).toContainText('沉钟湾')
    await expect(groupOf(page, 'item').getByTestId('node-list-item')).toHaveCount(1)
    await expect(groupOf(page, 'item')).toContainText('潮生灯')
    await expect(page.getByTestId('node-list-item')).toHaveCount(4)
  })

  test('单独展开 / 收起分组，并支持一键全部展开与全部收起', async ({ page }) => {
    await seedGroupedWorld(page, '分组开关')
    const allGroupsToggle = page.getByTestId('toggle-all-groups')
    await expect(allGroupsToggle).toHaveText('全部收起')

    // 单独收起「角色」：只影响该分组，其他分组保持展开
    await groupToggle(page, 'character').click()
    await expectGroupExpanded(page, 'character', false)
    await expect(groupOf(page, 'character').getByTestId('node-list-item')).toHaveCount(0)
    await expect(groupOf(page, 'location').getByTestId('node-list-item')).toHaveCount(1)
    await expect(groupOf(page, 'item').getByTestId('node-list-item')).toHaveCount(1)
    await expect(page.getByTestId('node-list-item')).toHaveCount(2)
    // 只有部分分组收起时，一键按钮仍是「全部收起」
    await expect(allGroupsToggle).toHaveText('全部收起')

    // 再点一次恢复该分组
    await groupToggle(page, 'character').click()
    await expectGroupExpanded(page, 'character', true)
    await expect(page.getByTestId('node-list-item')).toHaveCount(4)

    // 全部收起：三组一起折叠，列表清空，按钮改为「全部展开」
    await allGroupsToggle.click()
    for (const typeKey of ['character', 'location', 'item']) {
      await expectGroupExpanded(page, typeKey, false)
    }
    await expect(page.getByTestId('node-list-item')).toHaveCount(0)
    await expect(allGroupsToggle).toHaveText('全部展开')

    // 全部展开：恢复所有节点
    await allGroupsToggle.click()
    for (const typeKey of ['character', 'location', 'item']) {
      await expectGroupExpanded(page, typeKey, true)
    }
    await expect(page.getByTestId('node-list-item')).toHaveCount(4)
    await expect(allGroupsToggle).toHaveText('全部收起')
  })

  test('筛选区默认收起，展开或折叠筛选区都不影响节点库', async ({ page }) => {
    await seedGroupedWorld(page, '筛选独立性')
    const filterToggle = page.getByTestId('toggle-type-filter')
    const libraryToggle = page.getByTestId('toggle-node-library')

    await expect(filterToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(libraryToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('node-group')).toHaveCount(3)

    // 展开筛选区：筛选行出现，节点库保持展开、条目不变
    await filterToggle.click()
    await expect(filterToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('type-filter-character')).toBeVisible()
    await expect(page.getByTestId('type-filter-character')).toContainText('角色')
    await expect(libraryToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('node-list-item')).toHaveCount(4)

    // 再折叠筛选区：节点库依旧不受影响
    await filterToggle.click()
    await expect(filterToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByTestId('type-filter-character')).toBeHidden()
    await expect(libraryToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('node-list-item')).toHaveCount(4)

    // 反向：折叠节点库也不改变筛选区的开合状态
    await filterToggle.click()
    await libraryToggle.click()
    await expect(libraryToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByTestId('node-group')).toHaveCount(0)
    await expect(filterToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('type-filter-character')).toBeVisible()

    // 重新展开节点库，筛选区仍保持展开
    await libraryToggle.click()
    await expect(libraryToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('node-list-item')).toHaveCount(4)
    await expect(filterToggle).toHaveAttribute('aria-expanded', 'true')
  })

  test('搜索自动展开命中分组并高亮，清空后恢复手动折叠状态', async ({ page }) => {
    await seedGroupedWorld(page, '搜索分组')

    // 先手动收起「地点」分组
    await groupToggle(page, 'location').click()
    await expectGroupExpanded(page, 'location', false)
    await expect(page.getByTestId('node-list-item')).toHaveCount(3)

    const search = page.getByTestId('search-input')
    await search.fill('沉钟')

    // 只剩命中的分组，且即便用户先前收起了它也会临时展开
    await expect(page.getByTestId('node-group')).toHaveCount(1)
    await expectGroupExpanded(page, 'location', true)
    await expect(page.getByTestId('node-list-item')).toHaveCount(1)
    await expect(page.getByTestId('node-list-item')).toContainText('沉钟湾')
    const highlight = page.getByTestId('node-list-item').getByTestId('search-highlight')
    await expect(highlight).toHaveCount(1)
    await expect(highlight).toHaveText('沉钟')

    // 搜索期间点分组标题只改变临时状态，不写入用户偏好
    await groupToggle(page, 'location').click()
    await expect(page.getByTestId('node-list-item')).toHaveCount(0)
    await groupToggle(page, 'location').click()
    await expect(page.getByTestId('node-list-item')).toHaveCount(1)

    // 用清除按钮清空搜索：命中高亮消失，分组回到用户手动收起的偏好
    await page.getByRole('button', { name: '清除搜索', exact: true }).click()
    await expect(search).toHaveValue('')
    await expect(page.getByTestId('node-group')).toHaveCount(3)
    await expectGroupExpanded(page, 'location', false)
    await expect(groupOf(page, 'location').getByTestId('node-list-item')).toHaveCount(0)
    await expectGroupExpanded(page, 'character', true)
    await expect(page.getByTestId('node-list-item')).toHaveCount(3)
    await expect(page.getByTestId('search-highlight')).toHaveCount(0)
  })

  test('刷新后恢复当前世界的折叠偏好', async ({ page }) => {
    await seedGroupedWorld(page, '偏好持久化')

    // 收起「地点」分组，同时展开筛选区
    await groupToggle(page, 'location').click()
    await page.getByTestId('toggle-type-filter').click()
    await expectGroupExpanded(page, 'location', false)
    await expect(page.getByTestId('toggle-type-filter')).toHaveAttribute('aria-expanded', 'true')

    await page.reload()
    await expect(page.getByTestId('graph-canvas')).toBeVisible()
    await expect(page.getByTestId('node-group')).toHaveCount(3)
    await expect(page.getByTestId('toggle-type-filter')).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('type-filter-character')).toBeVisible()
    await expectGroupExpanded(page, 'location', false)
    await expect(groupOf(page, 'location').getByTestId('node-list-item')).toHaveCount(0)
    await expectGroupExpanded(page, 'character', true)
    await expect(page.getByTestId('node-list-item')).toHaveCount(3)

    // 节点库的收起状态同样持久化
    await page.getByTestId('toggle-node-library').click()
    await expect(page.getByTestId('node-group')).toHaveCount(0)
    await page.reload()
    await expect(page.getByTestId('graph-canvas')).toBeVisible()
    await expect(page.getByTestId('toggle-node-library')).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByTestId('node-group')).toHaveCount(0)
    await expect(page.getByTestId('toggle-type-filter')).toHaveAttribute('aria-expanded', 'true')
  })

  test('每个世界独立保存折叠偏好', async ({ page }) => {
    // 世界甲：收起「角色」
    await seedGroupedWorld(page, '世界甲')
    await groupToggle(page, 'character').click()
    await expectGroupExpanded(page, 'character', false)

    // 世界乙：新建后用默认偏好，分组全部展开
    await createUniverse(page, '世界乙')
    await createNodeViaToolbar(page, '乙角色', '角色')
    await createNodeViaToolbar(page, '乙地点', '地点')
    await expect(page.getByTestId('node-list-item')).toHaveCount(2)
    await expectGroupExpanded(page, 'character', true)
    await expectGroupExpanded(page, 'location', true)

    // 在世界乙收起「地点」
    await groupToggle(page, 'location').click()
    await expectGroupExpanded(page, 'location', false)
    await expect(page.getByTestId('node-list-item')).toHaveCount(1)

    // 切回世界甲：只有甲自己的「角色」保持收起（两个角色节点都隐藏，可见 2 个）
    await page.getByTestId('world-switcher').selectOption({ label: '世界甲' })
    await expect(page.getByTestId('node-list-item').filter({ hasText: '沉钟湾' })).toBeVisible()
    await expect(page.getByTestId('node-list-item')).toHaveCount(2)
    await expectGroupExpanded(page, 'character', false)
    await expect(groupOf(page, 'character').getByTestId('node-list-item')).toHaveCount(0)
    await expectGroupExpanded(page, 'location', true)
    await expect(groupOf(page, 'location').getByTestId('node-list-item')).toHaveCount(1)

    // 再切到世界乙：它的「地点」仍收起、「角色」展开
    await page.getByTestId('world-switcher').selectOption({ label: '世界乙' })
    await expect(page.getByTestId('node-list-item').filter({ hasText: '乙角色' })).toBeVisible()
    await expect(page.getByTestId('node-list-item')).toHaveCount(1)
    await expectGroupExpanded(page, 'location', false)
    await expectGroupExpanded(page, 'character', true)
  })
})
