import { expect, test, type Page } from '@playwright/test'
import {
  addProperty,
  connectNodes,
  createNodeViaToolbar,
  createTwoSeparatedNodes,
  createUniverse,
  dragNodeBy,
  useEmptyLibrary,
  waitForPersistedNode,
  waitForViewportIdle,
} from './helpers'

/** 空世界工作区（跳过首启示例世界）。 */
async function emptyWorkspace(page: Page): Promise<void> {
  await useEmptyLibrary(page)
  await createUniverse(page, '拓扑测试')
}

/** 在空世界里建两个节点并拉开距离 + 适应视图，避免节点被面板遮挡或相互重叠。 */
async function buildTwoNodes(page: Page): Promise<void> {
  await emptyWorkspace(page)
  await createTwoSeparatedNodes(page, '澜舟', '墨鸦')
}

/**
 * 把节点拖到画布上的指定屏幕位置。
 * 节点落点带 ±70 随机抖动、拖动后还会吸附到 16px 网格，只做相对偏移的拖拽无法保证
 * 两个节点最终的距离；这里按目标点反复校正（拖拽本身也可能丢失），误差收敛到一个网格内。
 */
async function moveNodeToScreenPoint(
  page: Page,
  name: string,
  target: { x: number; y: number },
): Promise<void> {
  const node = page.getByTestId('lore-node').filter({ hasText: name })
  await expect(node).toBeVisible()
  // 等画布就绪（节点已注册拖拽、视口动画结束）再按坐标拖拽，避免拖动被丢弃
  await waitForViewportIdle(page)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const box = await node.boundingBox()
    if (box === null) {
      throw new Error(`画布上找不到节点「${name}」`)
    }
    const dx = target.x - (box.x + box.width / 2)
    const dy = target.y - (box.y + box.height / 2)
    if (Math.abs(dx) <= 20 && Math.abs(dy) <= 20) {
      return
    }
    await dragNodeBy(page, name, dx, dy)
  }
  throw new Error(`节点「${name}」没有移动到预期位置`)
}

/**
 * 在空世界里建两个节点，分别固定到画布中心左上 / 右下的确定位置，再适应视图。
 * 两个节点相距足够远，包围盒不会重叠——一旦重叠，点击与悬停会命中压在上面的另一个节点，
 * 表现为随机的误选中或「元素拦截指针事件」超时。
 */
async function buildSeparatedNodes(
  page: Page,
  firstName: string,
  secondName: string,
): Promise<void> {
  await emptyWorkspace(page)
  const canvasBox = await page.getByTestId('graph-canvas').boundingBox()
  if (canvasBox === null) {
    throw new Error('画布不可见，无法放置节点')
  }
  const centerX = canvasBox.x + canvasBox.width / 2
  const centerY = canvasBox.y + canvasBox.height / 2

  await createNodeViaToolbar(page, firstName)
  await moveNodeToScreenPoint(page, firstName, { x: centerX - 230, y: centerY - 130 })
  await createNodeViaToolbar(page, secondName)
  await moveNodeToScreenPoint(page, secondName, { x: centerX + 230, y: centerY + 130 })

  await page.getByTestId('fit-view-btn').click()
  await waitForViewportIdle(page)
}

/** 两个节点 + 一条已确认的关系（节点落点确定且互不遮挡，便于按坐标点击）。 */
async function buildConnectedNodes(page: Page): Promise<void> {
  await buildSeparatedNodes(page, '澜舟', '墨鸦')
  await connectNodes(page, '澜舟', '墨鸦')
  await page.getByTestId('relation-type-select').selectOption({ index: 1 })
  await page.getByTestId('relation-label-input').fill('亦师亦友')
  await page.getByTestId('submit-relation-btn').click()
  await expect(page.getByTestId('relation-type-select')).toBeHidden()
  await expect(page.locator('.vue-flow__edge')).toHaveCount(1)
}

test.describe('LG-003 创建节点', () => {
  test('工具栏新建节点后出现在画布与节点列表', async ({ page }) => {
    await emptyWorkspace(page)

    await createNodeViaToolbar(page, '灰烬王座')

    await expect(page.getByTestId('lore-node')).toHaveCount(1)
    await expect(page.getByTestId('lore-node').first()).toContainText('灰烬王座')
    await expect(page.getByTestId('node-list-item')).toHaveCount(1)
    await expect(page.getByTestId('node-list-item')).toContainText('灰烬王座')
    await expect(page.getByTestId('node-editor')).toBeVisible()
    await expect(page.getByTestId('inspector-name')).toHaveValue('灰烬王座')
  })

  test('空名称节点无法创建', async ({ page }) => {
    await emptyWorkspace(page)

    await page.getByTestId('create-node-btn').click()
    await expect(page.getByTestId('name-input')).toBeVisible()
    await page.getByTestId('submit-node-btn').click()
    await expect(page.locator('dialog[open]').getByText('名称不能为空')).toBeVisible()
    await expect(page.getByTestId('lore-node')).toHaveCount(0)
  })
})

test.describe('LG-004 编辑自动保存', () => {
  test('Inspector 改名后画布与列表同步，并自动落库', async ({ page }) => {
    await emptyWorkspace(page)
    await createNodeViaToolbar(page, '灰烬王座')

    const nameInput = page.getByTestId('inspector-name')
    await expect(nameInput).toHaveValue('灰烬王座')
    await nameInput.fill('灰烬王座·改')
    await nameInput.blur()

    await expect(page.getByTestId('lore-node').filter({ hasText: '灰烬王座·改' })).toBeVisible()
    await expect(page.getByTestId('node-list-item')).toContainText('灰烬王座·改')
    // 自动保存（防抖 400ms）最终写入 IndexedDB，用轮询而非固定等待
    await waitForPersistedNode(page, (node) => node.name === '灰烬王座·改')
  })
})

test.describe('LG-005 删除节点与级联关系', () => {
  test('删除节点同时删除关联关系，撤销后完整恢复', async ({ page }) => {
    await buildConnectedNodes(page)

    await page.getByTestId('lore-node').filter({ hasText: '澜舟' }).click()
    await expect(page.getByTestId('inspector-name')).toHaveValue('澜舟')
    await page.getByTestId('delete-node-btn').click()

    await expect(page.getByTestId('lore-node').filter({ hasText: '澜舟' })).toHaveCount(0)
    await expect(page.locator('.vue-flow__edge')).toHaveCount(0)
    await expect(page.getByTestId('node-list-item')).toHaveCount(1)

    const undo = page.getByRole('button', { name: '撤销' })
    await expect(undo).toBeVisible()
    await undo.click()

    await expect(page.getByTestId('lore-node').filter({ hasText: '澜舟' })).toBeVisible()
    await expect(page.locator('.vue-flow__edge')).toHaveCount(1)
    await expect(page.getByTestId('node-list-item')).toHaveCount(2)
  })

  test('Delete 快捷键删除选中节点同样级联关系', async ({ page }) => {
    await buildConnectedNodes(page)

    const target = page.getByTestId('lore-node').filter({ hasText: '墨鸦' })
    await target.click()
    // 先确认选中的确实是目标节点，Delete 才会作用在它身上而不是另一个节点
    await expect(target).toHaveAttribute('data-selected', 'true')
    await expect(page.getByTestId('lore-node').filter({ hasText: '澜舟' })).toHaveAttribute(
      'data-selected',
      'false',
    )
    await expect(page.getByTestId('inspector-name')).toHaveValue('墨鸦')

    await page.keyboard.press('Delete')

    await expect(page.getByTestId('lore-node').filter({ hasText: '墨鸦' })).toHaveCount(0)
    // 只删掉目标节点：另一个节点仍在画布上，关联关系随节点一起级联删除
    await expect(page.getByTestId('lore-node').filter({ hasText: '澜舟' })).toBeVisible()
    await expect(page.locator('.vue-flow__edge')).toHaveCount(0)
  })
})

test.describe('LG-006 创建关系', () => {
  test('拖拽连接两个节点弹出关系对话框，确认后生成关系', async ({ page }) => {
    await buildTwoNodes(page)

    await connectNodes(page, '澜舟', '墨鸦')
    // 对话框展示连线两端节点名
    await expect(page.locator('dialog[open]')).toContainText('澜舟')
    await expect(page.locator('dialog[open]')).toContainText('墨鸦')

    await page.getByTestId('relation-type-select').selectOption({ index: 1 })
    await page.getByTestId('relation-label-input').fill('亦师亦友')
    await page.getByTestId('submit-relation-btn').click()

    await expect(page.getByTestId('relation-type-select')).toBeHidden()
    await expect(page.locator('.vue-flow__edge')).toHaveCount(1)
    await expect(page.getByTestId('edge-editor')).toBeVisible()
    await expect(page.getByTestId('edge-label-input')).toHaveValue('亦师亦友')
  })

  test('取消关系对话框不会创建关系', async ({ page }) => {
    await buildTwoNodes(page)

    await connectNodes(page, '澜舟', '墨鸦')
    await page.getByRole('button', { name: '取消' }).click()
    await expect(page.getByTestId('relation-type-select')).toBeHidden()
    await expect(page.locator('.vue-flow__edge')).toHaveCount(0)
  })
})

test.describe('LG-008 属性面板', () => {
  test('新增自定义属性并在属性面板展示', async ({ page }) => {
    await emptyWorkspace(page)
    await createNodeViaToolbar(page, '潮汐之母')

    await addProperty(page, '纪元', '第三纪')

    await expect(page.getByTestId('property-row')).toHaveCount(1)
    await expect(page.getByTestId('property-key-input')).toHaveValue('纪元')
    await expect(page.getByTestId('property-value-input')).toHaveValue('第三纪')
    // 属性经自动保存进入节点数据
    await waitForPersistedNode(page, (node) => node.properties['纪元'] === '第三纪')
  })
})
