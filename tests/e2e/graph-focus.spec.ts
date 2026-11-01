import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import {
  confirmImportPreview,
  gotoUniverses,
  readViewportTransform,
  useEmptyLibrary,
  waitForViewportIdle,
} from './helpers'

/**
 * LG-209 相邻高亮、聚焦模式与边标签优化。
 * 三节点链：澜舟 - 墨鸦 - 沉钟湾，两条关系都带自定义标签。
 *
 * 场景用导入的世界文件搭建，不再新建节点再拖动：新建节点落在视口中心附近的随机位置，
 * 与已有节点重叠时拖动会抓到压在上面的节点（实测拖「墨鸦」实际移动了「澜舟」），
 * 之后连线也点不到连接点。文件里三个节点各差 400px，布局一次到位且互不遮挡。
 */

/** 导入后世界名会追加「（导入）」后缀，打开时按名称包含匹配。 */
const WORLD_NAME = '聚焦测试'
/** 文件里的固定时间戳（2026-01-01T00:00:00Z），只用于让导入结果可复现。 */
const TIMESTAMP = 1767225600000
const UNIVERSE_ID = 'u-focus-chain'

/** 三节点链世界文件（formatVersion 1）：坐标写死，节点水平间隔 400px。 */
function buildChainWorld(): Record<string, unknown> {
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

  const edge = (id: string, source: string, target: string, label: string) => ({
    id,
    universeId: UNIVERSE_ID,
    source,
    target,
    relationType: 'related-to',
    label,
    properties: {},
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
      description: 'LG-209 聚焦与相邻高亮的固定场景。',
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
    types: [
      type('t-character', 'node', 'character', '角色', '#6366f1', 0, 'user-round'),
      type('t-location', 'node', 'location', '地点', '#10b981', 1, 'map-pin'),
      type('t-related-to', 'relation', 'related-to', '相关', '#94a3b8', 0),
    ],
    nodes: [
      node('n-lanzhou', 'character', '澜舟', -400),
      node('n-moya', 'character', '墨鸦', 0),
      node('n-chenzhongwan', 'location', '沉钟湾', 400),
    ],
    edges: [
      edge('e-lanzhou-moya', 'n-lanzhou', 'n-moya', '亦师亦友'),
      edge('e-moya-chenzhongwan', 'n-moya', 'n-chenzhongwan', '旧识'),
    ],
  }
}

/** 点击画布右上角空白处取消选中（避开工具栏、提示条与小地图）。 */
async function clickBlank(page: Page): Promise<void> {
  const box = await page.getByTestId('graph-canvas').boundingBox()
  if (box === null) {
    throw new Error('画布不可见，无法点击空白区域')
  }
  await page.mouse.click(box.x + box.width - 60, box.y + 60)
}

function nodeByName(page: Page, name: string) {
  return page.getByTestId('lore-node').filter({ hasText: name })
}

/**
 * 在世界列表页导入固定坐标的三节点链世界并打开它，停在「三个节点可见、视口稳定、无选中」。
 * 导入的临时文件写在测试输出目录，用完随测试结果一起清理。
 */
async function chainWorld(page: Page, testInfo: TestInfo): Promise<void> {
  const file = testInfo.outputPath('chain-world.loregraph.json')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(buildChainWorld(), null, 2), 'utf8')

  await useEmptyLibrary(page)
  await gotoUniverses(page)
  await page.getByTestId('import-json-input').setInputFiles(file)
  await confirmImportPreview(page)

  const card = page.getByTestId('universe-card').filter({ hasText: WORLD_NAME })
  await expect(card).toHaveCount(1)
  await card.getByRole('link', { name: '打开' }).click()
  await expect(page.getByTestId('graph-canvas')).toBeVisible()

  await expect(page.getByTestId('lore-node')).toHaveCount(3)
  for (const name of ['澜舟', '墨鸦', '沉钟湾']) {
    await expect(nodeByName(page, name)).toBeVisible()
  }
  // 世界打开后会自动适应视图；再点一次让缩放基于已量到尺寸的节点，结果可复现
  await page.getByTestId('fit-view-btn').click()
  await waitForViewportIdle(page)
  // 从「无选中」开始：清掉可能残留的选中态
  await clickBlank(page)
}

/** 从视口 transform 中读出当前缩放值（格式为 translate(...) scale(z)）。 */
async function readZoom(page: Page): Promise<number> {
  const style = await readViewportTransform(page)
  const matched = /scale\(([\d.]+)\)/.exec(style)
  return matched === null ? 1 : Number(matched[1])
}

test.describe('LG-209 相邻高亮', () => {
  test('选中节点后非相邻节点变淡，点击空白恢复', async ({ page }, testInfo) => {
    await chainWorld(page, testInfo)

    // 无选中时都不变淡
    for (const name of ['澜舟', '墨鸦', '沉钟湾']) {
      await expect(nodeByName(page, name)).toHaveAttribute('data-dimmed', 'false')
    }

    await nodeByName(page, '澜舟').click()
    await expect(nodeByName(page, '澜舟')).toHaveAttribute('data-dimmed', 'false')
    await expect(nodeByName(page, '墨鸦')).toHaveAttribute('data-dimmed', 'false')
    await expect(nodeByName(page, '沉钟湾')).toHaveAttribute('data-dimmed', 'true')

    await clickBlank(page)
    for (const name of ['澜舟', '墨鸦', '沉钟湾']) {
      await expect(nodeByName(page, name)).toHaveAttribute('data-dimmed', 'false')
    }
  })
})

test.describe('LG-209 聚焦模式', () => {
  test('F 键进入聚焦后只显示邻域节点，Esc 恢复全部', async ({ page }, testInfo) => {
    await chainWorld(page, testInfo)

    await nodeByName(page, '澜舟').click()
    await page.keyboard.press('f')

    const banner = page.getByTestId('focus-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('澜舟')
    await expect(nodeByName(page, '墨鸦')).toBeVisible()
    await expect(nodeByName(page, '沉钟湾')).toHaveCount(0)

    await page.keyboard.press('Escape')
    await expect(banner).toBeHidden()
    await expect(nodeByName(page, '沉钟湾')).toBeVisible()
  })

  test('工具栏按钮进入聚焦，聚焦中心不随选中变化，退出按钮恢复全部', async ({ page }, testInfo) => {
    await chainWorld(page, testInfo)
    const focusButton = page.getByTestId('focus-mode-btn')

    // 未选中节点时按钮禁用，F 键无操作
    await expect(focusButton).toBeDisabled()
    await page.keyboard.press('f')
    await expect(page.getByTestId('focus-banner')).toBeHidden()

    await nodeByName(page, '澜舟').click()
    await expect(focusButton).toBeEnabled()
    await focusButton.click()

    const banner = page.getByTestId('focus-banner')
    await expect(banner).toContainText('澜舟')
    await expect(focusButton).toHaveAttribute('aria-pressed', 'true')
    await expect(nodeByName(page, '沉钟湾')).toHaveCount(0)

    // 聚焦中改选邻域内的节点，聚焦中心不变
    await nodeByName(page, '墨鸦').click()
    await expect(banner).toContainText('澜舟')

    await page.getByTestId('focus-exit-btn').click()
    await expect(banner).toBeHidden()
    await expect(focusButton).toHaveAttribute('aria-pressed', 'false')
    await expect(nodeByName(page, '沉钟湾')).toBeVisible()
  })
})

test.describe('LG-209 边标签', () => {
  test('选中时变淡的边不显示标签', async ({ page }, testInfo) => {
    await chainWorld(page, testInfo)
    const labels = page.locator('.vue-flow__edge-text')

    // 无选中时两条关系的标签都在
    await expect(labels).toHaveCount(2)

    await nodeByName(page, '澜舟').click()
    await expect(labels).toHaveCount(1)
    await expect(labels.first()).toHaveText('亦师亦友')
  })

  test('视口缩小到 0.6 以下隐藏全部边标签', async ({ page }, testInfo) => {
    await chainWorld(page, testInfo)
    const labels = page.locator('.vue-flow__edge-text')
    await expect(labels).toHaveCount(2)

    const box = await page.getByTestId('graph-canvas').boundingBox()
    if (box === null) {
      throw new Error('画布不可见，无法缩放')
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    // 滚轮每格缩小约三分之一，滚到阈值以下就停，不依赖固定次数
    for (let index = 0; index < 6; index += 1) {
      await page.mouse.wheel(0, 300)
      await waitForViewportIdle(page)
      if ((await readZoom(page)) < 0.6) {
        break
      }
    }

    expect(await readZoom(page)).toBeLessThan(0.6)
    await expect(labels).toHaveCount(0)
  })
})
