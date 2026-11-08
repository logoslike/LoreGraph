import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  confirmImportPreview,
  gotoUniverses,
  readViewportTransform,
  useEmptyLibrary,
  waitForViewportIdle,
} from './helpers'

/**
 * 屏外节点方向标注：只有「大图 + 聚焦」时，完全落在画布外的可见节点
 * 才在画布边缘出现方向箭头 + 名称；部分可见的不出，退出聚焦后消失。
 */

const TIMESTAMP = 1767225600000
const WORLD_NAME = '屏外标注测试'
const UNIVERSE_ID = 'u-offscreen-indicators'
const HUB_NAME = '枢纽'
const FILLER_COUNT = 95

interface SceneNode {
  id: string
  name: string
  x: number
  y: number
}

interface SceneEdge {
  id: string
  source: string
  target: string
}

/** 与 large-world-fixture 同构的世界文件，字段齐全才能过导入校验。 */
function buildWorld(nodes: SceneNode[], edges: SceneEdge[]): Record<string, unknown> {
  const stamp = TIMESTAMP
  return {
    format: 'loregraph.universe',
    formatVersion: 1,
    exportedAt: stamp,
    universe: {
      id: UNIVERSE_ID,
      name: WORLD_NAME,
      description: '屏外节点方向标注的固定场景。',
      createdAt: stamp,
      updatedAt: stamp,
    },
    types: [
      {
        id: 't-character',
        universeId: UNIVERSE_ID,
        scope: 'node',
        key: 'character',
        label: '角色',
        color: '#6366f1',
        order: 0,
        createdAt: stamp,
        updatedAt: stamp,
      },
      {
        id: 't-related-to',
        universeId: UNIVERSE_ID,
        scope: 'relation',
        key: 'related-to',
        label: '相关',
        color: '#94a3b8',
        order: 0,
        createdAt: stamp,
        updatedAt: stamp,
      },
    ],
    nodes: nodes.map((node) => ({
      id: node.id,
      universeId: UNIVERSE_ID,
      type: 'character',
      name: node.name,
      description: '',
      properties: {},
      position: { x: node.x, y: node.y },
      createdAt: stamp,
      updatedAt: stamp,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      universeId: UNIVERSE_ID,
      source: edge.source,
      target: edge.target,
      relationType: 'related-to',
      label: '',
      properties: {},
      createdAt: stamp,
      updatedAt: stamp,
    })),
  }
}

/**
 * 100 节点：枢纽居中，四个方向各一个远邻（2000/1600 画布像素），
 * 其余 95 个孤立节点只为把节点数推过大图阈值（nodes>=100）。
 */
function buildWideWorld(): Record<string, unknown> {
  const neighbors: SceneNode[] = [
    { id: 'n-east', name: '东邻', x: 2000, y: 0 },
    { id: 'n-west', name: '西邻', x: -2000, y: 0 },
    { id: 'n-south', name: '南邻', x: 0, y: 1600 },
    { id: 'n-north', name: '北邻', x: 0, y: -1600 },
  ]
  const fillers: SceneNode[] = Array.from({ length: FILLER_COUNT }, (_, index) => ({
    id: `n-fill-${index}`,
    name: `填充-${index}`,
    x: (index % 10) * 260,
    y: 3200 + Math.floor(index / 10) * 200,
  }))
  return buildWorld(
    [{ id: 'n-hub', name: HUB_NAME, x: 0, y: 0 }, ...neighbors, ...fillers],
    neighbors.map((neighbor) => ({
      id: `e-hub-${neighbor.id}`,
      source: 'n-hub',
      target: neighbor.id,
    })),
  )
}

/** 小图对照：三个节点等距排成一条链，节点数远低于大图阈值。 */
function buildChainWorld(): Record<string, unknown> {
  return buildWorld(
    [
      { id: 'n-left', name: '链左', x: 0, y: 0 },
      { id: 'n-mid', name: '链中', x: 1000, y: 0 },
      { id: 'n-right', name: '链右', x: 2000, y: 0 },
    ],
    [
      { id: 'e-left-mid', source: 'n-left', target: 'n-mid' },
      { id: 'e-mid-right', source: 'n-mid', target: 'n-right' },
    ],
  )
}

/**
 * 追加验收场景的基础世界：枢纽 + 指定方向的邻节点，其余补到 100 个孤立填充节点。
 * 填充节点排得足够远，不参与聚焦邻域，只负责把节点数推过大图阈值。
 */
function buildSceneWorld(neighbors: SceneNode[]): Record<string, unknown> {
  const fillers: SceneNode[] = Array.from({ length: 100 - 1 - neighbors.length }, (_, index) => ({
    id: `n-fill-${index}`,
    name: `填充-${index}`,
    x: (index % 10) * 260,
    y: 3200 + Math.floor(index / 10) * 200,
  }))
  return buildWorld(
    [{ id: 'n-hub', name: HUB_NAME, x: 0, y: 0 }, ...neighbors, ...fillers],
    neighbors.map((neighbor) => ({
      id: `e-hub-${neighbor.id}`,
      source: 'n-hub',
      target: neighbor.id,
    })),
  )
}

/** 近邻：max-zoom 后两个邻节点刚好整块出界，平移 140px 可把它们压成部分可见。 */
function buildNearEdgeWorld(): Record<string, unknown> {
  return buildSceneWorld([
    { id: 'n-east', name: '近东', x: 400, y: 0 },
    { id: 'n-west', name: '近西', x: -400, y: 0 },
  ])
}

/** 同侧：三个正上方邻节点，射线都落在上边，横向原始间距只有 ~26px。 */
function buildSameSideWorld(): Record<string, unknown> {
  return buildSceneWorld([
    { id: 'n-north-left', name: '北左', x: -120, y: -2000 },
    { id: 'n-north', name: '北中', x: 0, y: -2000 },
    { id: 'n-north-right', name: '北右', x: 120, y: -2000 },
  ])
}

/** 遮挡：左上/正上/左下三个方向，标注分别贴近工具栏、提示条与缩放控件。 */
function buildOcclusionWorld(): Record<string, unknown> {
  return buildSceneWorld([
    { id: 'n-nw', name: '西北', x: -2000, y: -1200 },
    { id: 'n-n', name: '正北', x: 0, y: -1600 },
    { id: 'n-sw', name: '西南', x: -1400, y: 1700 },
  ])
}

async function openWorld(
  page: Page,
  testInfo: TestInfo,
  world: Record<string, unknown>,
  fileName: string,
): Promise<void> {
  const file = testInfo.outputPath(fileName)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(world, null, 2), 'utf8')

  await useEmptyLibrary(page)
  await gotoUniverses(page)
  await page.getByTestId('import-json-input').setInputFiles(file)
  await confirmImportPreview(page)

  const card = page.getByTestId('universe-card').filter({ hasText: WORLD_NAME })
  await expect(card).toHaveCount(1)
  await card.getByRole('link', { name: '打开' }).click()
  await expect(page.getByTestId('graph-canvas')).toBeVisible()
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

/** 从视口 transform 中读出当前缩放值（格式为 translate(...) scale(z)）。 */
async function readZoom(page: Page): Promise<number> {
  const style = await readViewportTransform(page)
  const matched = /scale\(([\d.]+)\)/.exec(style)
  return matched === null ? 1 : Number(matched[1])
}

/** 选中节点后按 F 进入聚焦，等视口把聚焦中心放稳。 */
async function focusNode(page: Page, name: string): Promise<void> {
  await nodeByName(page, name).click()
  await page.keyboard.press('f')
  await expect(page.getByTestId('focus-banner')).toContainText(name)
  await waitForViewportIdle(page)
}

/**
 * 放大到 max-zoom（1.8）：视口以画布中心为锚，聚焦中心保持不动。
 * 每点一次都等动画停稳再判断，避免连点被进行中的缩放动画吞掉。
 */
async function zoomToMax(page: Page): Promise<void> {
  const zoomIn = page.getByTestId('zoom-in-btn')
  for (let index = 0; index < 24; index += 1) {
    if ((await readZoom(page)) >= 1.79) {
      break
    }
    await zoomIn.click()
    await waitForViewportIdle(page)
  }
  expect(await readZoom(page)).toBeGreaterThan(1.7)
}

interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

interface IndicatorOnScreen extends ScreenRect {
  id: string
  side: string
  text: string
}

async function canvasRect(page: Page): Promise<ScreenRect> {
  const box = await page.getByTestId('graph-canvas').boundingBox()
  if (box === null) {
    throw new Error('画布不可见')
  }
  return box
}

/** 读出当前所有屏外标注的屏幕矩形与语义属性（data-node-id / data-side）。 */
async function readIndicators(page: Page): Promise<IndicatorOnScreen[]> {
  return page.getByTestId('offscreen-indicator').evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return {
        id: element.getAttribute('data-node-id') ?? '',
        side: element.getAttribute('data-side') ?? '',
        text: (element as HTMLElement).innerText.trim(),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      }
    }),
  )
}

function intersects(left: ScreenRect, right: ScreenRect): boolean {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  )
}

/** 画布上方的交互浮层：工具栏、聚焦提示条、缩放控件、小地图。标注不得与它们相交。 */
async function panelRects(page: Page): Promise<Array<{ name: string; rect: ScreenRect }>> {
  const entries: Array<[string, Locator]> = [
    ['工具栏', page.locator('.vue-flow__panel.top.left').first()],
    ['聚焦提示条', page.getByTestId('focus-banner')],
    ['缩放控件', page.locator('.vue-flow__controls').first()],
    ['小地图', page.locator('.vue-flow__minimap').first()],
  ]
  const result: Array<{ name: string; rect: ScreenRect }> = []
  for (const [name, locator] of entries) {
    const box = await locator.boundingBox()
    if (box !== null) {
      result.push({ name, rect: box })
    }
  }
  return result
}

/**
 * 标注必须整体落在画布内，且与任何浮层面板都不相交。
 * 组件是 pointer-events:none，elementFromPoint 命不中它，所以遮挡只能按矩形判定。
 */
async function expectIndicatorsClear(page: Page): Promise<void> {
  const canvas = await canvasRect(page)
  const indicators = await readIndicators(page)
  const panels = await panelRects(page)
  for (const indicator of indicators) {
    expect(indicator.x, `${indicator.text} 左越界`).toBeGreaterThanOrEqual(canvas.x - 1)
    expect(indicator.y, `${indicator.text} 上越界`).toBeGreaterThanOrEqual(canvas.y - 1)
    expect(indicator.x + indicator.width, `${indicator.text} 右越界`).toBeLessThanOrEqual(
      canvas.x + canvas.width + 1,
    )
    expect(indicator.y + indicator.height, `${indicator.text} 下越界`).toBeLessThanOrEqual(
      canvas.y + canvas.height + 1,
    )
    for (const panel of panels) {
      expect(intersects(indicator, panel.rect), `${indicator.text} 与${panel.name}重叠`).toBe(false)
    }
  }
}

/**
 * 在画布空白处水平拖拽平移视口。起点选在既不会压到节点也不会压到浮层的位置，
 * 大位移拆成多段，避免鼠标被拖出视口后 d3 停止跟踪。
 */
async function panCanvas(page: Page, deltaX: number): Promise<void> {
  const canvas = await canvasRect(page)
  const y = canvas.y + Math.round(canvas.height * 0.78)
  const startX = deltaX >= 0 ? canvas.x + 100 : canvas.x + canvas.width - 100
  let remaining = deltaX
  while (Math.abs(remaining) > 0.5) {
    const step = Math.sign(remaining) * Math.min(120, Math.abs(remaining))
    await page.mouse.move(startX, y)
    await page.mouse.down()
    await page.mouse.move(startX + step, y, { steps: 8 })
    await page.mouse.up()
    await waitForViewportIdle(page)
    remaining -= step
  }
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = '.local/offscreen-acceptance'
  await mkdir(dir, { recursive: true })
  await page.screenshot({ path: `${dir}/${name}.png` })
}

interface NodeOnScreen {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
}

/** 读出当前所有可见节点卡片的屏幕矩形，用于独立复算「谁完全在画布外」。 */
async function readVisibleNodes(page: Page): Promise<NodeOnScreen[]> {
  const nodes = page.getByTestId('lore-node')
  const total = await nodes.count()
  const result: NodeOnScreen[] = []
  for (let index = 0; index < total; index += 1) {
    const node = nodes.nth(index)
    const box = await node.boundingBox()
    if (box === null) {
      continue
    }
    result.push({
      id: (await node.getAttribute('data-node-id')) ?? '',
      name: (await node.locator('.lore-node__name').innerText()).trim(),
      ...box,
    })
  }
  return result
}

/**
 * 完全在画布外：与画布矩形没有任何交集。
 * 判定与 src/services/offscreen-indicators.ts 一致，但这里用真实 DOM 矩形独立复算，
 * 避免「实现和断言用同一份几何代码」而互相掩盖错误。
 */
function isFullyOutside(
  node: NodeOnScreen,
  canvas: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    node.x + node.width <= canvas.x ||
    node.x >= canvas.x + canvas.width ||
    node.y + node.height <= canvas.y ||
    node.y >= canvas.y + canvas.height
  )
}

test.describe('屏外节点方向标注', () => {
  test('大图聚焦放大后，四个方向上的屏外邻节点各出现一个标注', async ({ page }, testInfo) => {
    await openWorld(page, testInfo, buildWideWorld(), 'wide-world.loregraph.json')
    await expect(page.getByTestId('lore-node')).toHaveCount(100, { timeout: 60_000 })
    await page.getByTestId('fit-view-btn').click()
    await waitForViewportIdle(page)
    await resetView(page)

    // 大图聚焦只保留 1 跳邻域：枢纽 + 四个方向的邻节点
    await focusNode(page, HUB_NAME)
    await expect(page.getByTestId('lore-node')).toHaveCount(5)

    await zoomToMax(page)
    const canvas = await page.getByTestId('graph-canvas').boundingBox()
    if (canvas === null) {
      throw new Error('画布不可见')
    }
    const visible = await readVisibleNodes(page)
    expect(visible).toHaveLength(5)
    const outside = visible.filter((node) => isFullyOutside(node, canvas))
    // 放大到 1.8 后四个远邻必然整块出界，枢纽仍留在画布中心
    expect(outside.map((node) => node.name).sort()).toEqual(['东邻', '北邻', '南邻', '西邻'].sort())

    const indicators = page.getByTestId('offscreen-indicator')
    await expect(indicators).toHaveCount(4)

    // 标注与出界节点一一对应：id、名称、所在边都对得上
    const expectedSides: Record<string, string> = {
      东邻: 'right',
      西邻: 'left',
      南邻: 'bottom',
      北邻: 'top',
    }
    for (const node of outside) {
      const indicator = indicators.filter({ hasText: node.name })
      await expect(indicator).toHaveCount(1)
      await expect(indicator).toHaveAttribute('data-node-id', node.id)
      await expect(indicator).toHaveAttribute('data-side', expectedSides[node.name])
    }
    // 聚焦中心与部分可见的节点不出标注
    await expect(indicators.filter({ hasText: HUB_NAME })).toHaveCount(0)

    // 胶囊整体落在画布内（12px 内缩），且彼此不重合
    const pills = await indicators.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }),
    )
    for (const pill of pills) {
      expect(pill.x).toBeGreaterThanOrEqual(canvas.x)
      expect(pill.y).toBeGreaterThanOrEqual(canvas.y)
      expect(pill.x + pill.width).toBeLessThanOrEqual(canvas.x + canvas.width)
      expect(pill.y + pill.height).toBeLessThanOrEqual(canvas.y + canvas.height)
    }
    const keys = new Set(pills.map((pill) => `${Math.round(pill.x)}:${Math.round(pill.y)}`))
    expect(keys.size).toBe(pills.length)

    // 退出聚焦：不再有屏外标注
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('focus-banner')).toBeHidden()
    await expect(indicators).toHaveCount(0)
  })

  test('小图聚焦即使节点被放到画布外也不出标注', async ({ page }, testInfo) => {
    await openWorld(page, testInfo, buildChainWorld(), 'chain-world.loregraph.json')
    await expect(page.getByTestId('lore-node')).toHaveCount(3)
    await waitForViewportIdle(page)
    await resetView(page)

    await focusNode(page, '链中')
    await expect(page.getByTestId('lore-node')).toHaveCount(3)
    await zoomToMax(page)

    const canvas = await page.getByTestId('graph-canvas').boundingBox()
    if (canvas === null) {
      throw new Error('画布不可见')
    }
    const outside = (await readVisibleNodes(page)).filter((node) => isFullyOutside(node, canvas))
    // 先证明场景有效：放大后两端节点确实整块出界，只是小图不显示标注
    expect(outside.map((node) => node.name).sort()).toEqual(['链右', '链左'].sort())
    await expect(page.getByTestId('offscreen-indicator')).toHaveCount(0)
  })
})

test.describe('点击屏外节点标注定位', () => {
  async function expectIndicatorClickToCenter(
    page: Page,
    name: string,
    clickTarget: '.offscreen-indicator__arrow' | '.offscreen-indicator__name',
  ): Promise<void> {
    const indicator = page.getByTestId('offscreen-indicator').filter({ hasText: name })
    await expect(indicator).toHaveCount(1)
    await indicator.locator(clickTarget).click()
    await waitForViewportIdle(page)

    const target = nodeByName(page, name)
    await expect(target).toHaveAttribute('data-selected', 'true')
    await expect(page.getByTestId('focus-banner')).toContainText(HUB_NAME)
    await expect(page.getByTestId('focus-banner')).not.toContainText(name)
    await expect(
      page.getByTestId('offscreen-indicator').filter({ hasText: name }),
    ).toHaveCount(0)

    const canvas = await canvasRect(page)
    await expect
      .poll(async () => {
        const box = await target.boundingBox()
        if (box === null) {
          return Number.POSITIVE_INFINITY
        }
        const nodeCenterX = box.x + box.width / 2
        const nodeCenterY = box.y + box.height / 2
        const canvasCenterX = canvas.x + canvas.width / 2
        const canvasCenterY = canvas.y + canvas.height / 2
        return Math.max(Math.abs(nodeCenterX - canvasCenterX), Math.abs(nodeCenterY - canvasCenterY))
      })
      .toBeLessThanOrEqual(2)
  }

  test('点击屏外节点名称后居中并保留聚焦状态与缩放', async ({ page }, testInfo) => {
    await openWorld(page, testInfo, buildWideWorld(), 'indicator-name-click-world.loregraph.json')
    await expect(page.getByTestId('lore-node')).toHaveCount(100, { timeout: 60_000 })
    await resetView(page)
    await focusNode(page, HUB_NAME)
    await zoomToMax(page)

    const zoomBefore = await readZoom(page)
    await expectIndicatorClickToCenter(page, '东邻', '.offscreen-indicator__name')
    expect(await readZoom(page)).toBeCloseTo(zoomBefore, 2)
  })

  test('点击屏外节点箭头后居中并保留聚焦状态与缩放', async ({ page }, testInfo) => {
    await openWorld(page, testInfo, buildWideWorld(), 'indicator-arrow-click-world.loregraph.json')
    await expect(page.getByTestId('lore-node')).toHaveCount(100, { timeout: 60_000 })
    await resetView(page)
    await focusNode(page, HUB_NAME)
    await zoomToMax(page)

    const zoomBefore = await readZoom(page)
    await expectIndicatorClickToCenter(page, '西邻', '.offscreen-indicator__arrow')
    expect(await readZoom(page)).toBeCloseTo(zoomBefore, 2)
  })
})

/** 打开世界后等自动适应视图停稳，再显式适应全部并取消选中，保证起始视口确定。 */
async function resetView(page: Page): Promise<void> {
  await waitForViewportIdle(page)
  await page.getByTestId('fit-view-btn').click()
  await waitForViewportIdle(page)
  await clickBlank(page)
}

/**
 * 追加验收：边界、更新、遮挡与同侧重排。
 * 断言只用 DOM 矩形与 data-* 语义属性，不复用实现内部的几何函数。
 */
test.describe('屏外标注边界与更新', () => {
  test('节点被拖成部分可见时不出标注，整块出界后重新出现', async ({ page }, testInfo) => {
    await openWorld(page, testInfo, buildNearEdgeWorld(), 'near-edge-world.loregraph.json')
    await expect(page.getByTestId('lore-node')).toHaveCount(100)
    await waitForViewportIdle(page)
    await resetView(page)

    await focusNode(page, HUB_NAME)
    await expect(page.getByTestId('lore-node')).toHaveCount(3)
    await zoomToMax(page)

    const pills = await readIndicators(page)
    expect(pills.map((pill) => pill.side).sort()).toEqual(['left', 'right'])
    await expectIndicatorsClear(page)

    const eastPill = page.getByTestId('offscreen-indicator').filter({ hasText: '近东' })
    const westPill = page.getByTestId('offscreen-indicator').filter({ hasText: '近西' })

    // 东邻中心 1000、左缘约 811，压住画布右缘 840：部分可见，不应出标注
    await panCanvas(page, -140)
    const eastPartial = (await readVisibleNodes(page)).find((node) => node.name === '近东')
    expect(eastPartial).toBeDefined()
    const canvasPartial = await canvasRect(page)
    expect(isFullyOutside(eastPartial!, canvasPartial)).toBe(false)
    expect(eastPartial!.x).toBeLessThan(canvasPartial.x + canvasPartial.width)
    await expect(eastPill).toHaveCount(0)
    await expect(westPill).toHaveCount(1)

    // 拖回原位：重新整块出界，方向仍是 right
    await panCanvas(page, 140)
    await expect(eastPill).toHaveCount(1)
    await expect(eastPill).toHaveAttribute('data-side', 'right')

    // 继续往左拖：东邻整块回到画布内，标注再次消失
    await panCanvas(page, -520)
    const eastInside = (await readVisibleNodes(page)).find((node) => node.name === '近东')
    expect(eastInside).toBeDefined()
    const canvasInside = await canvasRect(page)
    expect(isFullyOutside(eastInside!, canvasInside)).toBe(false)
    expect(eastInside!.x).toBeGreaterThanOrEqual(canvasInside.x)
    expect(eastInside!.x + eastInside!.width).toBeLessThanOrEqual(
      canvasInside.x + canvasInside.width,
    )
    await expect(eastPill).toHaveCount(0)
    await expectIndicatorsClear(page)
  })

  test('视口平移与侧栏开合后标注跟随更新且不越界', async ({ page }, testInfo) => {
    await openWorld(page, testInfo, buildWideWorld(), 'offscreen-pan-world.loregraph.json')
    await expect(page.getByTestId('lore-node')).toHaveCount(100)
    await waitForViewportIdle(page)
    await resetView(page)

    await focusNode(page, HUB_NAME)
    await expect(page.getByTestId('lore-node')).toHaveCount(5)
    await zoomToMax(page)

    const initial = await readIndicators(page)
    expect(initial).toHaveLength(4)
    await expectIndicatorsClear(page)
    const northBefore = initial.find((pill) => pill.side === 'top')!
    const eastBefore = initial.find((pill) => pill.side === 'right')!
    const westBefore = initial.find((pill) => pill.side === 'left')!
    expect(northBefore && eastBefore && westBefore).toBeTruthy()

    // 横向平移 300：上排标注跟着横向移动，右列标注的纵向位置不变
    await panCanvas(page, 300)
    const afterPan = await readIndicators(page)
    expect(afterPan).toHaveLength(4)
    const northAfter = afterPan.find((pill) => pill.side === 'top')!
    const eastAfter = afterPan.find((pill) => pill.side === 'right')!
    expect(northAfter.x - northBefore.x).toBeGreaterThan(20)
    expect(Math.abs(eastAfter.y - eastBefore.y)).toBeLessThanOrEqual(2)
    await expectIndicatorsClear(page)

    // 收起左侧栏：画布变宽并左移，标注必须重锚到新画布内
    const canvasBefore = await canvasRect(page)
    await page.getByTestId('collapse-sidebar').click()
    await page.waitForTimeout(800)
    const canvasAfter = await canvasRect(page)
    expect(canvasAfter.width).toBeGreaterThan(canvasBefore.width + 100)
    const afterResize = await readIndicators(page)
    expect(afterResize).toHaveLength(4)
    const westAfter = afterResize.find((pill) => pill.side === 'left')!
    expect(Math.abs(westAfter.x - (canvasAfter.x + 72))).toBeLessThanOrEqual(2)
    await expectIndicatorsClear(page)

    // 还原侧栏后仍然有效
    await page.getByTestId('toggle-sidebar').click()
    await page.waitForTimeout(800)
    await expect(page.getByTestId('offscreen-indicator')).toHaveCount(4)
    await expectIndicatorsClear(page)
  })

  test('同侧多个标注沿边排开、互不重叠', async ({ page }, testInfo) => {
    await openWorld(
      page,
      testInfo,
      buildSameSideWorld(),
      'offscreen-same-side-world.loregraph.json',
    )
    await expect(page.getByTestId('lore-node')).toHaveCount(100)
    await waitForViewportIdle(page)
    await resetView(page)

    await focusNode(page, HUB_NAME)
    await expect(page.getByTestId('lore-node')).toHaveCount(4)
    await zoomToMax(page)

    const pills = await readIndicators(page)
    expect(pills).toHaveLength(3)
    expect(pills.map((pill) => pill.side)).toEqual(['top', 'top', 'top'])
    for (let left = 0; left < pills.length; left += 1) {
      for (let right = left + 1; right < pills.length; right += 1) {
        expect(
          intersects(pills[left]!, pills[right]!),
          `${pills[left]!.text} 与 ${pills[right]!.text} 重叠`,
        ).toBe(false)
      }
    }
    await expectIndicatorsClear(page)
    await shot(page, 'same-side-top')
  })

  test('左上、正上、左下方向标注避开工具栏、提示条与画布控件', async ({ page }, testInfo) => {
    await openWorld(
      page,
      testInfo,
      buildOcclusionWorld(),
      'offscreen-occlusion-world.loregraph.json',
    )
    await expect(page.getByTestId('lore-node')).toHaveCount(100)
    await waitForViewportIdle(page)
    await resetView(page)

    await focusNode(page, HUB_NAME)
    await expect(page.getByTestId('lore-node')).toHaveCount(4)
    await zoomToMax(page)

    const pills = await readIndicators(page)
    expect(pills).toHaveLength(3)
    expect(Object.fromEntries(pills.map((pill) => [pill.text, pill.side]))).toEqual({
      西北: 'left',
      正北: 'top',
      西南: 'bottom',
    })

    // 工具栏是左上竖条（画布局部 x15–61、y15–299），提示条在顶部居中
    const toolbar = await page.locator('.vue-flow__panel.top.left').first().boundingBox()
    const banner = await page.getByTestId('focus-banner').boundingBox()
    expect(toolbar).not.toBeNull()
    expect(banner).not.toBeNull()
    for (const pill of pills) {
      expect(intersects(pill, toolbar!), `${pill.text} 压住工具栏`).toBe(false)
      expect(intersects(pill, banner!), `${pill.text} 压住聚焦提示条`).toBe(false)
    }
    await expectIndicatorsClear(page)
    await shot(page, 'occlusion-corners')
  })

  test('大图非聚焦态放大后即使节点出界也不出标注', async ({ page }, testInfo) => {
    await openWorld(page, testInfo, buildWideWorld(), 'offscreen-unfocused-world.loregraph.json')
    await expect(page.getByTestId('lore-node')).toHaveCount(100)
    await waitForViewportIdle(page)
    await resetView(page)

    await zoomToMax(page)
    const canvas = await canvasRect(page)
    const outside = (await readVisibleNodes(page)).filter((node) => isFullyOutside(node, canvas))
    // 先证明场景有效：确实有节点整块出界，只是非聚焦态不显示标注
    expect(outside.length).toBeGreaterThan(0)
    await expect(page.getByTestId('offscreen-indicator')).toHaveCount(0)
  })
})
