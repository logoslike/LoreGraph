import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import {
  confirmImportPreview,
  gotoUniverses,
  useEmptyLibrary,
  waitForViewportIdle,
} from './helpers'

/**
 * Phase 1 导航边界：聚焦模式下从节点库导航到非邻域节点。
 *
 * 聚焦模式只渲染中心节点的邻域，节点库仍列出全体节点。点击一个被聚焦隐藏、
 * 且与中心不相连的节点时，必须先退出聚焦再定位，否则画布上根本没有该节点，
 * focusNode 找不到目标。场景用固定坐标的导入世界搭建：两个节点互不相连，
 * 聚焦任意一个都会把另一个挡在画布之外。
 */

const WORLD_NAME = '侧栏聚焦导航'
/** 固定时间戳（2026-01-01T00:00:00Z），只用于让导入结果可复现。 */
const TIMESTAMP = 1767225600000
const UNIVERSE_ID = 'u-sidebar-focus'
/** 节点定位容差：fitNode 会带留白并取整，允许 16px。 */
const FOCUS_TOLERANCE = 16

/** 两个互不相连节点的世界文件（formatVersion 1）：坐标写死，水平间隔 600px。 */
function buildIsolatedNodesWorld(): Record<string, unknown> {
  const type = (
    id: string,
    scope: 'node' | 'relation',
    key: string,
    label: string,
    color: string,
    order: number,
    icon?: string,
  ): Record<string, unknown> => ({
    id,
    universeId: UNIVERSE_ID,
    scope,
    key,
    label,
    color,
    ...(icon === undefined ? {} : { icon }),
    order,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  })

  const node = (id: string, typeKey: string, name: string, x: number): Record<string, unknown> => ({
    id,
    universeId: UNIVERSE_ID,
    type: typeKey,
    name,
    description: '',
    properties: {},
    position: { x, y: 0 },
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  })

  return {
    format: 'loregraph.universe',
    formatVersion: 1,
    exportedAt: TIMESTAMP,
    universe: {
      id: UNIVERSE_ID,
      name: WORLD_NAME,
      description: '侧栏聚焦导航的固定场景：两个互不相连的节点。',
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
    types: [
      type('t-character', 'node', 'character', '角色', '#6366f1', 0, 'user-round'),
      type('t-location', 'node', 'location', '地点', '#10b981', 1, 'map-pin'),
    ],
    nodes: [node('n-lanzhou', 'character', '澜舟', -300), node('n-moya', 'location', '墨鸦', 300)],
    edges: [],
  }
}

function nodeByName(page: Page, name: string) {
  return page.getByTestId('lore-node').filter({ hasText: name })
}

/** 点击画布右上角空白处取消选中（避开工具栏、提示条与小地图）。 */
async function clickBlank(page: Page): Promise<void> {
  const box = await page.getByTestId('graph-canvas').boundingBox()
  if (box === null) {
    throw new Error('画布不可见，无法点击空白区域')
  }
  await page.mouse.click(box.x + box.width - 60, box.y + 60)
}

/** 节点中心相对画布中心的最大屏幕偏移；定位完成后应接近 0。 */
async function centerOffset(page: Page, name: string): Promise<number> {
  const canvas = await page.getByTestId('graph-canvas').boundingBox()
  const target = await nodeByName(page, name).boundingBox()
  if (canvas === null || target === null) {
    return Number.POSITIVE_INFINITY
  }
  return Math.max(
    Math.abs(target.x + target.width / 2 - (canvas.x + canvas.width / 2)),
    Math.abs(target.y + target.height / 2 - (canvas.y + canvas.height / 2)),
  )
}

/**
 * 在世界列表页导入固定坐标的双节点世界并打开它，停在「两个节点可见、视口稳定、无选中」。
 * 导入的临时文件写在测试输出目录，用完随测试结果一起清理。
 */
async function isolatedNodesWorld(page: Page, testInfo: TestInfo): Promise<void> {
  const file = testInfo.outputPath('sidebar-focus-world.loregraph.json')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(buildIsolatedNodesWorld(), null, 2), 'utf8')

  await useEmptyLibrary(page)
  await gotoUniverses(page)
  await page.getByTestId('import-json-input').setInputFiles(file)
  await confirmImportPreview(page)

  const card = page.getByTestId('universe-card').filter({ hasText: WORLD_NAME })
  await expect(card).toHaveCount(1)
  await card.getByRole('link', { name: '打开' }).click()
  await expect(page.getByTestId('graph-canvas')).toBeVisible()

  await expect(page.getByTestId('lore-node')).toHaveCount(2)
  await expect(nodeByName(page, '澜舟')).toBeVisible()
  await expect(nodeByName(page, '墨鸦')).toBeVisible()
  // 世界打开后会自动适应视图；再点一次让缩放基于已量到尺寸的节点，结果可复现
  await page.getByTestId('fit-view-btn').click()
  await waitForViewportIdle(page)
  await clickBlank(page)
}

test.describe('Phase 1 侧栏聚焦导航', () => {
  test('聚焦中点击节点库里的非邻域节点：退出聚焦、恢复节点并居中选中', async ({
    page,
  }, testInfo) => {
    await isolatedNodesWorld(page, testInfo)

    await nodeByName(page, '澜舟').click()
    await page.keyboard.press('f')

    const banner = page.getByTestId('focus-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('澜舟')
    // 两个节点互不相连：聚焦澜舟后墨鸦被画布隐藏，但节点库仍然列出它
    await expect(nodeByName(page, '墨鸦')).toHaveCount(0)
    const row = page.getByTestId('node-list-item').filter({ hasText: '墨鸦' })
    await expect(row).toBeVisible()

    await row.click()

    // 导航到隐藏节点必须先退出聚焦，目标节点才会重新回到画布
    await expect(banner).toBeHidden()
    await expect(page.getByTestId('focus-mode-btn')).toHaveAttribute('aria-pressed', 'false')
    await expect(nodeByName(page, '墨鸦')).toBeVisible()
    await expect(page.getByTestId('inspector-name')).toHaveValue('墨鸦')

    // 定位是带动画的：等视口稳定后，目标节点中心应落在画布中心
    await waitForViewportIdle(page)
    await expect
      .poll(async () => await centerOffset(page, '墨鸦'), {
        timeout: 10_000,
        message: '退出聚焦后目标节点没有被定位到画布中心',
      })
      .toBeLessThanOrEqual(FOCUS_TOLERANCE)
    // 视口动画与聚焦退出都不应改掉选中项
    await expect(page.getByTestId('inspector-name')).toHaveValue('墨鸦')
  })
})
