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
 * LG-306 关系视觉秩序：同一对节点之间的双向关系必须分道渲染。
 * 固定世界文件里两个节点横坐标相差 400px，两条关系方向相反、关系类型不同，
 * 用来断言两条连线和两个标签都可见，且标签分别落在节点上下两侧、互不重叠。
 */

const WORLD_NAME = '双向关系'
const TIMESTAMP = 1767225600000
const UNIVERSE_ID = 'u-reciprocal'

function buildReciprocalWorld(): Record<string, unknown> {
  const type = (
    id: string,
    scope: 'node' | 'relation',
    key: string,
    label: string,
    color: string,
    order: number,
  ): Record<string, unknown> => ({
    id,
    universeId: UNIVERSE_ID,
    scope,
    key,
    label,
    color,
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

  const edge = (
    id: string,
    source: string,
    target: string,
    relationType: string,
    label: string,
  ): Record<string, unknown> => ({
    id,
    universeId: UNIVERSE_ID,
    source,
    target,
    relationType,
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
      description: 'LG-306 双向关系分道渲染的固定场景。',
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
    types: [
      type('t-character', 'node', 'character', '角色', '#6366f1', 0),
      type('t-location', 'node', 'location', '地点', '#10b981', 1),
      type('t-guard', 'relation', 'guard', '驻守', '#94a3b8', 0),
      type('t-shelter', 'relation', 'shelter', '庇护', '#f59e0b', 1),
    ],
    nodes: [
      node('n-lanzhou', 'character', '澜舟', 0),
      node('n-chenzhongwan', 'location', '沉钟湾', 400),
    ],
    edges: [
      edge('e-lanzhou-guards', 'n-lanzhou', 'n-chenzhongwan', 'guard', '驻守'),
      edge('e-chenzhongwan-shelters', 'n-chenzhongwan', 'n-lanzhou', 'shelter', '庇护'),
    ],
  }
}

/** 在世界列表页导入固定坐标的双向关系世界并打开，停在视口稳定、无选中。 */
async function reciprocalWorld(page: Page, testInfo: TestInfo): Promise<void> {
  const file = testInfo.outputPath('reciprocal-world.loregraph.json')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(buildReciprocalWorld(), null, 2), 'utf8')

  await useEmptyLibrary(page)
  await gotoUniverses(page)
  await page.getByTestId('import-json-input').setInputFiles(file)
  await confirmImportPreview(page)

  const card = page.getByTestId('universe-card').filter({ hasText: WORLD_NAME })
  await expect(card).toHaveCount(1)
  await card.getByRole('link', { name: '打开' }).click()
  await expect(page.getByTestId('graph-canvas')).toBeVisible()

  await expect(page.getByTestId('lore-node')).toHaveCount(2)
  await expect(page.locator('.vue-flow__edge-path')).toHaveCount(2)
  await page.getByTestId('fit-view-btn').click()
  await waitForViewportIdle(page)

  // 从「无选中」开始：清掉可能残留的选中态，避免标签被相邻高亮隐藏
  const box = await page.getByTestId('graph-canvas').boundingBox()
  if (box === null) {
    throw new Error('画布不可见，无法取消选中')
  }
  await page.mouse.click(box.x + box.width - 60, box.y + 60)
}

/** 关系的标签盒（SVG text 的实际渲染包围盒）。 */
async function labelBox(page: Page, text: string) {
  const label = page.locator('.vue-flow__edge-text').filter({ hasText: text })
  await expect(label).toBeVisible()
  const box = await label.boundingBox()
  if (box === null) {
    throw new Error(`关系标签「${text}」没有可见包围盒`)
  }
  return box
}

test.describe('LG-306 双向关系分道', () => {
  test('两条反向关系都可见，标签分别落在节点上下两侧且不重叠', async ({ page }, testInfo) => {
    await reciprocalWorld(page, testInfo)

    // 两条关系（跨类型：角色 → 地点、地点 → 角色）都必须保留
    const paths = page.locator('.vue-flow__edge-path')
    await expect(paths).toHaveCount(2)
    for (let index = 0; index < 2; index += 1) {
      await expect(paths.nth(index)).toBeVisible()
    }

    const guard = await labelBox(page, '驻守')
    const shelter = await labelBox(page, '庇护')

    // 两个标签盒不能重叠
    const overlap =
      guard.x < shelter.x + shelter.width &&
      guard.x + guard.width > shelter.x &&
      guard.y < shelter.y + shelter.height &&
      guard.y + guard.height > shelter.y
    expect(overlap, '双向关系的标签仍然重叠').toBe(false)

    // 一个在节点整体上方、另一个在下方：证明按方向分到了两条车道
    const node = await page.getByTestId('lore-node').filter({ hasText: '澜舟' }).boundingBox()
    if (node === null) {
      throw new Error('找不到节点「澜舟」的包围盒')
    }
    const guardAbove = guard.y + guard.height <= node.y
    const guardBelow = guard.y >= node.y + node.height
    const shelterAbove = shelter.y + shelter.height <= node.y
    const shelterBelow = shelter.y >= node.y + node.height

    expect(
      (guardAbove && shelterBelow) || (guardBelow && shelterAbove),
      `标签没有落在节点两侧：guard=${JSON.stringify(guard)} shelter=${JSON.stringify(shelter)} node=${JSON.stringify(node)}`,
    ).toBe(true)
  })
})
