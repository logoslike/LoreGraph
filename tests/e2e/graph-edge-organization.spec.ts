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

function buildReciprocalWorld(
  positions: readonly [{ x: number; y: number }, { x: number; y: number }] = [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
  ],
): Record<string, unknown> {
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

  const node = (
    id: string,
    typeKey: string,
    name: string,
    position: { x: number; y: number },
  ): Record<string, unknown> => ({
    id,
    universeId: UNIVERSE_ID,
    type: typeKey,
    name,
    description: '',
    properties: {},
    position,
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
      node('n-lanzhou', 'character', '澜舟', positions[0]),
      node('n-chenzhongwan', 'location', '沉钟湾', positions[1]),
    ],
    edges: [
      edge('e-lanzhou-guards', 'n-lanzhou', 'n-chenzhongwan', 'guard', '驻守'),
      edge('e-chenzhongwan-shelters', 'n-chenzhongwan', 'n-lanzhou', 'shelter', '庇护'),
    ],
  }
}

/** 在世界列表页导入固定坐标的双向关系世界并打开，停在视口稳定、无选中。 */
async function reciprocalWorld(
  page: Page,
  testInfo: TestInfo,
  positions?: readonly [{ x: number; y: number }, { x: number; y: number }],
): Promise<void> {
  const file = testInfo.outputPath('reciprocal-world.loregraph.json')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(buildReciprocalWorld(positions), null, 2), 'utf8')

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

/** 把 SVG path 采样成屏幕坐标点，用于检查连线是否进入节点盒内部。 */
async function pathSamples(page: Page, index: number): Promise<{ x: number; y: number }[]> {
  return page
    .locator('.vue-flow__edge-path')
    .nth(index)
    .evaluate((element, step) => {
      const path = element as SVGPathElement
      const matrix = path.getScreenCTM()
      if (matrix === null) {
        return []
      }
      const points: { x: number; y: number }[] = []
      for (let distance = 0; distance <= path.getTotalLength(); distance += step) {
        const point = path.getPointAtLength(distance)
        const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix)
        points.push({ x: screen.x, y: screen.y })
      }
      return points
    }, 2)
}

/** 屏幕坐标下某点是否在节点盒内部（缩进 1px，贴边不算）。 */
function insideBox(
  point: { x: number; y: number },
  box: { x: number; y: number; width: number; height: number },
): boolean {
  const inset = 1
  return (
    point.x > box.x + inset &&
    point.x < box.x + box.width - inset &&
    point.y > box.y + inset &&
    point.y < box.y + box.height - inset
  )
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

  test('纵向错位 96/128 时两条分道线都不进入节点盒内部', async ({ page }, testInfo) => {
    await reciprocalWorld(page, testInfo, [
      { x: 0, y: 0 },
      { x: 96, y: 128 },
    ])

    const sourceBox = await page.getByTestId('lore-node').filter({ hasText: '澜舟' }).boundingBox()
    const targetBox = await page
      .getByTestId('lore-node')
      .filter({ hasText: '沉钟湾' })
      .boundingBox()
    if (sourceBox === null || targetBox === null) {
      throw new Error('找不到节点包围盒')
    }

    for (let index = 0; index < 2; index += 1) {
      const samples = await pathSamples(page, index)
      expect(samples.length, '边路径没有采样点').toBeGreaterThan(0)
      for (const point of samples) {
        expect(insideBox(point, sourceBox), `第 ${index} 条分道线穿过了源节点`).toBe(false)
        expect(insideBox(point, targetBox), `第 ${index} 条分道线穿过了目标节点`).toBe(false)
      }
    }
  })

  test('标签锚点恰好为 0 时仍然渲染两个标签', async ({ page }, testInfo) => {
    await reciprocalWorld(page, testInfo, [
      { x: -300, y: 0 },
      { x: 90, y: 0 },
    ])

    await expect(page.locator('.vue-flow__edge-text')).toHaveCount(2)
    const guard = await labelBox(page, '驻守')
    const shelter = await labelBox(page, '庇护')
    const overlap =
      guard.x < shelter.x + shelter.width &&
      guard.x + guard.width > shelter.x &&
      guard.y < shelter.y + shelter.height &&
      guard.y + guard.height > shelter.y
    expect(overlap, '零值标签锚点导致标签消失或重叠').toBe(false)
  })

  test('选中的关系移动到最后一个绘制 SVG', async ({ page }, testInfo) => {
    await reciprocalWorld(page, testInfo)

    await page
      .locator('.vue-flow__edge')
      .first()
      .evaluate((element) => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      })
    await expect(page.locator('.vue-flow__edge.selected')).toHaveCount(1)

    await expect
      .poll(async () =>
        page.locator('.vue-flow__edges').evaluateAll((layers) => {
          const last = layers[layers.length - 1]
          return Boolean(last?.querySelector('.vue-flow__edge.selected'))
        }),
      )
      .toBe(true)
  })
})
