import { expect, test, type Locator } from '@playwright/test'
import {
  createNodeViaToolbar,
  createUniverse,
  useEmptyLibrary,
  waitForViewportIdle,
} from './helpers'

/**
 * Phase 1 AppShell 栅格与侧栏 Rail 的端到端用例。
 * 断言以布局几何（列宽 / 包围盒）为准，不依赖面板内部的 DOM 细节：
 * 桌面固定三列 264px / minmax(0,1fr) / 336px；侧栏收起后仍占 56px 的 Rail 列，
 * 画布因此只释放 264 - 56 = 208px；窄屏保留抽屉，且不渲染桌面 Rail。
 */

const VIEWPORT_WIDTH = 1440
const SIDEBAR_WIDTH = 264
const SIDEBAR_RAIL_WIDTH = 56
const INSPECTOR_WIDTH = 336
const CANVAS_WIDTH_EXPANDED = VIEWPORT_WIDTH - SIDEBAR_WIDTH - INSPECTOR_WIDTH
const CANVAS_WIDTH_COLLAPSED = VIEWPORT_WIDTH - SIDEBAR_RAIL_WIDTH - INSPECTOR_WIDTH
/** 浏览器按整数像素布局，允许 1px 的取整误差。 */
const PX_TOLERANCE = 1
/** 节点定位容差：fitNode 会带留白并取整，允许 16px。 */
const FOCUS_TOLERANCE = 16

interface Box {
  x: number
  y: number
  width: number
  height: number
}

async function boxOf(locator: Locator, label: string): Promise<Box> {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  if (box === null) {
    throw new Error(`${label}没有可见包围盒`)
  }
  return box
}

function expectWidth(box: Box, expected: number, label: string): void {
  expect(
    Math.abs(box.width - expected),
    `${label}宽度应为 ${expected}px（实际 ${box.width}px）`,
  ).toBeLessThanOrEqual(PX_TOLERANCE)
}

function expectLeft(box: Box, expected: number, label: string): void {
  expect(
    Math.abs(box.x - expected),
    `${label}左边界应为 ${expected}px（实际 ${box.x}px）`,
  ).toBeLessThanOrEqual(PX_TOLERANCE)
}

test.describe('Phase 1 AppShell 栅格与 Rail', () => {
  test('桌面固定三列：展开 264px，收起为 56px Rail 并把 208px 让给画布', async ({ page }) => {
    await useEmptyLibrary(page)
    await createUniverse(page, '栅格测试')
    await waitForViewportIdle(page)

    // 展开态：侧栏 264 + 画布 + 检查器 336 = 1440
    const sidebar = await boxOf(page.getByTestId('sidebar'), '侧栏')
    const inspector = await boxOf(page.getByTestId('inspector'), '检查器')
    const canvas = await boxOf(page.getByTestId('graph-canvas'), '画布')
    expectWidth(sidebar, SIDEBAR_WIDTH, '展开态侧栏')
    expectLeft(sidebar, 0, '展开态侧栏')
    expectLeft(canvas, SIDEBAR_WIDTH, '展开态画布')
    expectWidth(canvas, CANVAS_WIDTH_EXPANDED, '展开态画布')
    expectWidth(inspector, INSPECTOR_WIDTH, '检查器')
    expect(inspector.x + inspector.width).toBeLessThanOrEqual(VIEWPORT_WIDTH + PX_TOLERANCE)
    expect(canvas.x + canvas.width).toBeLessThanOrEqual(inspector.x + PX_TOLERANCE)

    await page.getByTestId('collapse-sidebar').click()

    // 收起态：Sidebar 仍占栅格第一列，宽度收窄为 Rail 的 56px
    const rail = page.getByTestId('sidebar-rail')
    await expect(rail).toBeVisible()
    await expect(page.getByTestId('sidebar')).toBeHidden()
    const railBox = await boxOf(rail, '侧栏 Rail')
    expectWidth(railBox, SIDEBAR_RAIL_WIDTH, '侧栏 Rail')
    expectLeft(railBox, 0, '侧栏 Rail')

    const collapsedCanvas = await boxOf(page.getByTestId('graph-canvas'), '收起态画布')
    expectLeft(collapsedCanvas, SIDEBAR_RAIL_WIDTH, '收起态画布')
    expectWidth(collapsedCanvas, CANVAS_WIDTH_COLLAPSED, '收起态画布')
    // 画布只让出侧栏收窄的部分，不因侧栏整块消失而抖动
    expect(CANVAS_WIDTH_COLLAPSED - CANVAS_WIDTH_EXPANDED).toBe(208)

    // 展开控件由 Sidebar 自己在 Rail 内渲染：不越出 Rail，也不压到画布
    const expand = rail.getByTestId('toggle-sidebar')
    const expandBox = await boxOf(expand, 'Rail 展开控件')
    expect(expandBox.x).toBeGreaterThanOrEqual(railBox.x - PX_TOLERANCE)
    expect(expandBox.x + expandBox.width).toBeLessThanOrEqual(
      railBox.x + railBox.width + PX_TOLERANCE,
    )
    expect(expandBox.x + expandBox.width).toBeLessThanOrEqual(collapsedCanvas.x + PX_TOLERANCE)
    expect(expandBox.y).toBeGreaterThanOrEqual(railBox.y - PX_TOLERANCE)
    expect(expandBox.y + expandBox.height).toBeLessThanOrEqual(
      railBox.y + railBox.height + PX_TOLERANCE,
    )

    // 桌面不再有覆盖在画布左上角的浮动展开按钮：唯一的展开入口就在 Rail 内
    await expect(rail.getByTestId('toggle-sidebar')).toHaveCount(1)
    await expect(page.getByTestId('toggle-sidebar')).toHaveCount(1)

    // 收起态 Rail 只保留展开入口：不再重复提供「新建节点」图标按钮
    await expect(rail.getByTestId('new-node-icon-btn')).toHaveCount(0)
    // 新建节点入口只由画布工具栏承载，收起侧栏不影响它
    const toolbar = page.getByTestId('graph-toolbar')
    await expect(toolbar).toBeVisible()
    await expect(toolbar.getByTestId('create-node-btn')).toBeVisible()

    await expand.click()
    await expect(page.getByTestId('sidebar')).toBeVisible()
    await expect(rail).toBeHidden()
    const restoredCanvas = await boxOf(page.getByTestId('graph-canvas'), '恢复后的画布')
    expectLeft(restoredCanvas, SIDEBAR_WIDTH, '恢复后的画布')
    expectWidth(restoredCanvas, CANVAS_WIDTH_EXPANDED, '恢复后的画布')
  })

  test('点击侧栏节点：清除会隐藏它的类型筛选，选中并在画布居中、Inspector 同步', async ({
    page,
  }) => {
    await useEmptyLibrary(page)
    await createUniverse(page, '节点定位')
    await createNodeViaToolbar(page, '澜舟', '角色')
    await createNodeViaToolbar(page, '墨鸦', '地点')
    await page.getByTestId('fit-view-btn').click()
    await waitForViewportIdle(page)

    // 类型筛选分区默认收起，先展开再勾选
    await page.getByTestId('toggle-type-filter').click()
    // 只保留「角色」：地点节点墨鸦从画布上消失
    const characterFilter = page
      .getByTestId('type-filter-character')
      .locator('input[type="checkbox"]')
    await expect(characterFilter).toBeVisible()
    await characterFilter.check()
    await expect(page.getByTestId('lore-node').filter({ hasText: '墨鸦' })).toBeHidden()

    // 侧栏仍要能选中被类型筛选藏起来的节点：清除筛选 → 选中 → 定位
    const row = page.getByTestId('node-list-item').filter({ hasText: '墨鸦' })
    await expect(row).toBeVisible()
    await row.click()

    await expect(characterFilter).not.toBeChecked()
    await expect(page.getByTestId('lore-node').filter({ hasText: '墨鸦' })).toBeVisible()
    await expect(page.getByTestId('inspector')).toBeVisible()
    await expect(page.getByTestId('inspector-name')).toHaveValue('墨鸦')

    // 视口定位是带动画的：轮询节点相对画布中心的偏移，等动画结束后应落在容差内
    await expect
      .poll(
        async () => {
          const canvas = await page.getByTestId('graph-canvas').boundingBox()
          const target = await page
            .getByTestId('lore-node')
            .filter({ hasText: '墨鸦' })
            .boundingBox()
          if (canvas === null || target === null) {
            return Number.POSITIVE_INFINITY
          }
          return Math.max(
            Math.abs(target.x + target.width / 2 - (canvas.x + canvas.width / 2)),
            Math.abs(target.y + target.height / 2 - (canvas.y + canvas.height / 2)),
          )
        },
        { timeout: 10_000, message: '目标节点没有被定位到画布中心' },
      )
      .toBeLessThanOrEqual(FOCUS_TOLERANCE)
    // 其他节点没有被选中，Inspector 展示的仍是目标节点
    await expect(page.getByTestId('inspector-name')).toHaveValue('墨鸦')
  })

  test('窄屏不渲染桌面 Rail：继续用抽屉覆盖画布，点击遮罩可关闭', async ({ page }) => {
    await useEmptyLibrary(page)
    await createUniverse(page, '窄屏抽屉')
    await page.setViewportSize({ width: 800, height: 800 })

    // 进入窄屏自动收起：没有桌面 Rail，只剩抽屉入口
    await expect(page.getByTestId('sidebar')).toBeHidden()
    await expect(page.getByTestId('sidebar-rail')).toBeHidden()
    const toggle = page.getByTestId('toggle-sidebar')
    await expect(toggle).toBeVisible()

    const canvasBefore = await boxOf(page.getByTestId('graph-canvas'), '窄屏画布')
    expectLeft(canvasBefore, 0, '窄屏画布')
    expectWidth(canvasBefore, 800, '窄屏画布')

    await toggle.click()
    const drawer = page.getByTestId('sidebar')
    await expect(drawer).toBeVisible()
    const drawerBox = await boxOf(drawer, '窄屏抽屉')
    expectLeft(drawerBox, 0, '窄屏抽屉')
    // 抽屉宽度受 min(86vw, 320px) 约束，浮在画布上方而不是挤压画布
    expect(drawerBox.width).toBeLessThanOrEqual(320 + PX_TOLERANCE)
    expect(drawerBox.width).toBeGreaterThan(240)
    expectWidth(await boxOf(page.getByTestId('graph-canvas'), '窄屏画布'), 800, '窄屏画布')

    await page.getByTestId('app-shell-backdrop').click()
    await expect(drawer).toBeHidden()
  })
})
