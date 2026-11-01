import { expect, test, type Page } from '@playwright/test'
import {
  connectNodes,
  createTwoSeparatedNodes,
  createUniverse,
  dragNodeBy,
  readTable,
  useEmptyLibrary,
  waitForViewportIdle,
} from './helpers'

/**
 * LG-206 自动布局 / LG-207 恢复布局的端到端用例。
 * 工具栏菜单项由工具栏任务定义（more-menu-btn / auto-layout-* / restore-layout-btn），
 * 这里只按 data-testid 取元素，不依赖菜单的具体结构。
 */

const DESCRIPTION = '守望潮汐的摆渡人，知晓旧港的每一条暗流。'

interface NodeRow {
  name: string
  description: string
  position: { x: number; y: number }
}

type Positions = Record<string, { x: number; y: number }>

/** 直接读 IndexedDB：坐标是否落库比屏幕位置更接近「刷新后仍保持」的语义。 */
async function storedNodes(page: Page): Promise<NodeRow[]> {
  return readTable<NodeRow>(page, 'nodes')
}

async function storedPositions(page: Page): Promise<Positions> {
  const nodes = await storedNodes(page)
  return Object.fromEntries(nodes.map((node) => [node.name, { ...node.position }]))
}

async function storedEdgeCount(page: Page): Promise<number> {
  return (await readTable<{ id: string }>(page, 'edges')).length
}

/**
 * 读取节点在画布坐标系中的位置：Vue Flow 把节点坐标写在节点外层容器的 transform 上，
 * 与当前视口平移/缩放无关。
 */
async function renderedPosition(page: Page, name: string): Promise<{ x: number; y: number }> {
  const node = page.getByTestId('lore-node').filter({ hasText: name })
  await expect(node).toBeVisible()
  const transform = await node.evaluate((element) => {
    const wrapper = element.parentElement
    return wrapper instanceof HTMLElement ? wrapper.style.transform : ''
  })
  const match = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(transform)
  if (match === null) {
    throw new Error(`节点「${name}」没有坐标 transform：${transform}`)
  }
  return { x: Number(match[1]), y: Number(match[2]) }
}

/** 坐标比较：允许 1px 误差（布局与恢复都经过取整，浮点换算可能带亚像素）。 */
function expectPositionsClose(actual: Positions, expected: Positions, tolerance = 1): void {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort())
  for (const [name, position] of Object.entries(expected)) {
    expect(
      Math.abs(actual[name].x - position.x),
      `节点「${name}」x 坐标偏差过大：${actual[name].x} vs ${position.x}`,
    ).toBeLessThanOrEqual(tolerance)
    expect(
      Math.abs(actual[name].y - position.y),
      `节点「${name}」y 坐标偏差过大：${actual[name].y} vs ${position.y}`,
    ).toBeLessThanOrEqual(tolerance)
  }
}

/** 打开工具栏「更多」菜单后点某个菜单项。 */
async function clickToolbarMenuItem(page: Page, testId: string): Promise<void> {
  const menu = page.getByTestId('more-menu')
  // 菜单项由 more-menu-btn 切换：已经展开时再点会把它关掉，先按可见状态判断。
  if (!(await menu.isVisible())) {
    await page.getByTestId('more-menu-btn').click()
  }
  await expect(menu).toBeVisible()
  const item = page.getByTestId(testId)
  // 恢复布局项在快照失效时会一直是 disabled，这里先断言可用，失败时能直接看到原因
  await expect(item).toBeEnabled()
  await item.click()
}

/** 触发一次自动布局，并等到「已自动布局」提示出现（此时布局已落库、视图已适应）。 */
async function runLayout(page: Page, testId: string): Promise<void> {
  await clickToolbarMenuItem(page, testId)
  // 首次布局要动态加载 ELK，慢机器 / 冷缓存时可能超过默认的 5s
  await expect(page.getByTestId('toast').filter({ hasText: '已自动布局' })).toBeVisible({
    timeout: 15_000,
  })
  await waitForViewportIdle(page)
}

/**
 * 关掉全部悬浮提示，避免它们盖住画布底部的节点导致点击 / 拖拽被拦截。
 * 一次建图会留下多条提示（节点、关系、布局各一条），布局提示还带「撤销」并停留 8s，
 * 只关掉第一条时其余提示仍会挡住画布。
 */
async function dismissToasts(page: Page): Promise<void> {
  const close = page.getByTestId('toast-dismiss-btn')
  // 提示会按 duration 自动消失，点击可能与自动消失竞争：点不到就交给下一轮重试，
  // 直到所有提示都从 DOM 中移除。
  await expect
    .poll(
      async () => {
        if ((await close.count()) === 0) {
          return 0
        }
        await close
          .first()
          .click({ timeout: 1_000 })
          .catch(() => undefined)
        return await close.count()
      },
      { timeout: 20_000, message: '关闭悬浮提示超时' },
    )
    .toBe(0)
}

/** 两个节点 + 一条关系，并给其中一个节点写上描述，用来验证布局不动内容。 */
async function buildLayoutWorld(page: Page): Promise<void> {
  await useEmptyLibrary(page)
  await createUniverse(page, '布局测试')
  await createTwoSeparatedNodes(page, '澜舟', '墨鸦')

  await connectNodes(page, '澜舟', '墨鸦')
  await page.getByTestId('relation-type-select').selectOption({ index: 1 })
  await page.getByTestId('relation-label-input').fill('亦师亦友')
  await page.getByTestId('submit-relation-btn').click()
  await expect(page.getByTestId('relation-type-select')).toBeHidden()

  await page.getByTestId('lore-node').filter({ hasText: '澜舟' }).click()
  await expect(page.getByTestId('inspector-name')).toHaveValue('澜舟')
  const description = page.getByTestId('inspector-description')
  await description.fill(DESCRIPTION)
  await description.blur()
  // 等自动保存（防抖 400ms）落库，避免布局的「先写完挂起保存」影响断言
  await expect
    .poll(async () => (await storedNodes(page)).find((node) => node.name === '澜舟')?.description, {
      timeout: 15_000,
      message: '等待节点描述写入 IndexedDB 超时',
    })
    .toBe(DESCRIPTION)
}

const LAYOUT_MODES = [
  { mode: '力导向', testId: 'auto-layout-force-btn' },
  { mode: '层级', testId: 'auto-layout-layered-btn' },
] as const

for (const { mode, testId } of LAYOUT_MODES) {
  test.describe(`LG-206 ${mode}自动布局`, () => {
    test(`${mode}布局只改坐标：节点与关系数、名称、描述不变，坐标变化并刷新后保持`, async ({
      page,
    }) => {
      await buildLayoutWorld(page)
      const before = await storedPositions(page)
      const edgeCountBefore = await storedEdgeCount(page)

      await runLayout(page, testId)
      await dismissToasts(page)

      await expect(page.getByTestId('lore-node')).toHaveCount(2)
      expect(await storedEdgeCount(page)).toBe(edgeCountBefore)
      expect(edgeCountBefore).toBe(1)

      const after = await storedPositions(page)
      expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort())
      expect(after).not.toEqual(before)

      // 内容不变：名称与描述仍是布局前的内容
      await page.getByTestId('lore-node').filter({ hasText: '澜舟' }).click()
      await expect(page.getByTestId('inspector-name')).toHaveValue('澜舟')
      await expect(page.getByTestId('inspector-description')).toHaveValue(DESCRIPTION)

      // 刷新后位置保持：数据库坐标不变，画布上仍按该坐标渲染
      await page.reload()
      await expect(page.getByTestId('graph-canvas')).toBeVisible()
      await expect(page.getByTestId('lore-node')).toHaveCount(2)
      expect(await storedPositions(page)).toEqual(after)
      for (const name of Object.keys(after)) {
        const rendered = await renderedPosition(page, name)
        // 节点挂载时 Vue Flow 会按 16px 网格对齐内部坐标，允许半个网格的偏差
        expect(Math.abs(rendered.x - after[name].x)).toBeLessThanOrEqual(8)
        expect(Math.abs(rendered.y - after[name].y)).toBeLessThanOrEqual(8)
      }
    })

    test(`${mode}布局后拖动节点，刷新后拖动结果保留`, async ({ page }) => {
      await buildLayoutWorld(page)
      await runLayout(page, testId)
      await dismissToasts(page)
      const layouted = await storedPositions(page)

      await dragNodeBy(page, '澜舟', 96, 64)
      await expect
        .poll(async () => (await storedPositions(page))['澜舟'], {
          timeout: 15_000,
          message: '等待拖动后的坐标写入 IndexedDB 超时',
        })
        .not.toEqual(layouted['澜舟'])
      const dragged = await storedPositions(page)

      await page.reload()
      await expect(page.getByTestId('graph-canvas')).toBeVisible()
      await expect(page.getByTestId('lore-node')).toHaveCount(2)
      expectPositionsClose(await storedPositions(page), dragged, 0)
      const rendered = await renderedPosition(page, '澜舟')
      expect(Math.abs(rendered.x - dragged['澜舟'].x)).toBeLessThanOrEqual(8)
      expect(Math.abs(rendered.y - dragged['澜舟'].y)).toBeLessThanOrEqual(8)
    })
  })
}

test.describe('LG-207 恢复布局', () => {
  test('力导向后再层级，恢复布局回到最初位置', async ({ page }) => {
    await buildLayoutWorld(page)
    const before = await storedPositions(page)

    await runLayout(page, 'auto-layout-force-btn')
    const forcePositions = await storedPositions(page)
    // 第二次布局的提示与第一次同文案，不能靠 Toast 判断完成：等数据库坐标真正变化
    await clickToolbarMenuItem(page, 'auto-layout-layered-btn')
    await expect
      .poll(async () => await storedPositions(page), {
        timeout: 15_000,
        message: '等待层级布局写入 IndexedDB 超时',
      })
      .not.toEqual(forcePositions)
    await waitForViewportIdle(page)
    const layered = await storedPositions(page)
    expect(layered).not.toEqual(before)

    await dismissToasts(page)
    await clickToolbarMenuItem(page, 'restore-layout-btn')
    await expect
      .poll(async () => await storedPositions(page), {
        timeout: 15_000,
        message: '等待连续布局后的恢复写入 IndexedDB 超时',
      })
      .toEqual(before)
    await waitForViewportIdle(page)

    expectPositionsClose(await storedPositions(page), before)
    await expect(page.getByTestId('lore-node')).toHaveCount(2)
  })

  test('连续两次自动布局只保留一条「已自动布局」提示', async ({ page }) => {
    await buildLayoutWorld(page)
    const layoutToasts = page.getByTestId('toast').filter({ hasText: '已自动布局' })

    await runLayout(page, 'auto-layout-force-btn')
    await expect(layoutToasts).toHaveCount(1)
    const forcePositions = await storedPositions(page)

    // 等第二次布局真正完成（坐标变化且视口动画结束）后再数提示，避免在旧提示上误判
    await clickToolbarMenuItem(page, 'auto-layout-layered-btn')
    await expect
      .poll(async () => await storedPositions(page), {
        timeout: 15_000,
        message: '等待第二次布局写入 IndexedDB 超时',
      })
      .not.toEqual(forcePositions)
    await waitForViewportIdle(page)
    await expect(layoutToasts).toHaveCount(1)
  })

  test('恢复布局把节点坐标还原到布局前（允许 1px 误差）', async ({ page }) => {
    await buildLayoutWorld(page)
    const before = await storedPositions(page)

    await runLayout(page, 'auto-layout-force-btn')
    const layouted = await storedPositions(page)
    expect(layouted).not.toEqual(before)

    await dismissToasts(page)
    await clickToolbarMenuItem(page, 'restore-layout-btn')
    await expect
      .poll(async () => await storedPositions(page), {
        timeout: 15_000,
        message: '等待恢复布局写入 IndexedDB 超时',
      })
      .toEqual(before)
    await waitForViewportIdle(page)

    expectPositionsClose(await storedPositions(page), before)
    await expect(page.getByTestId('lore-node')).toHaveCount(2)
  })

  test('布局提示里的「撤销」把节点坐标还原到布局前', async ({ page }) => {
    await buildLayoutWorld(page)
    const before = await storedPositions(page)

    await runLayout(page, 'auto-layout-layered-btn')
    expect(await storedPositions(page)).not.toEqual(before)

    const toast = page.getByTestId('toast').filter({ hasText: '已自动布局' })
    await toast.getByTestId('toast-action-btn').click()
    await expect
      .poll(async () => await storedPositions(page), {
        timeout: 15_000,
        message: '等待撤销布局写入 IndexedDB 超时',
      })
      .toEqual(before)
    expectPositionsClose(await storedPositions(page), before)
  })
})
