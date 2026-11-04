import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import {
  confirmImportPreview,
  findStoredNode,
  gotoUniverses,
  readViewportTransform,
  resolveWorldIds,
  useEmptyLibrary,
  waitForStoredNodePosition,
  waitForViewportIdle,
  type WorldIds,
} from './helpers'
import {
  LARGE_NODE_COUNT,
  buildLargeWorld,
  buildObstacleWorld,
  largeNodeName,
} from './large-world-fixture'

/**
 * 大图拖动回归：共享障碍几何 + 稳定端口之后，
 * - 关联边端点仍然每帧跟随被拖动的节点；
 * - 未受移动障碍影响的远端边 path 保持不变（不重算）；
 * - 移动中的节点一旦进入某条关系的候选走廊，这条关系在拖动期间就重路由；
 * - drop 后按最终坐标精确重算，端点仍贴合节点、路径没有 NaN。
 *
 * 导入世界会重映射 id：节点按名称定位，关系 id 与 data-node-id 由 resolveWorldIds 反查。
 */

/** 拖动总位移（屏幕 px）：首步推进 40%，再一次性推到终点，全程朝同一方向、不回退。 */
const DRAG_DX = 180
const DRAG_DY = 120

async function waitTwoFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
}

/** 等到视口缩放到指定值以上：搜索定位会对单节点 fitView（约 1.25x）。 */
async function waitForZoomAbove(page: Page, min: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const style = await page
          .locator('.vue-flow__transformationpane')
          .first()
          .getAttribute('style')
        const match = /scale\(([\d.]+)\)/.exec(style ?? '')
        return match ? Number(match[1]) : 1
      },
      { timeout: 10_000, message: '等待搜索定位把视口放大超时' },
    )
    .toBeGreaterThan(min)
}

/** 等待 fitNode 动画结束：目标节点中心落在画布中心附近（避免动画期间开始拖动）。 */
async function waitForNodeCentered(page: Page, name: string): Promise<void> {
  const canvas = await page.getByTestId('graph-canvas').boundingBox()
  if (canvas === null) {
    throw new Error('画布不可见')
  }
  const centerX = canvas.x + canvas.width / 2
  const centerY = canvas.y + canvas.height / 2
  await expect
    .poll(
      async () => {
        const box = await page.getByTestId('lore-node').filter({ hasText: name }).boundingBox()
        if (box === null) {
          return Number.POSITIVE_INFINITY
        }
        return Math.hypot(box.x + box.width / 2 - centerX, box.y + box.height / 2 - centerY)
      },
      { timeout: 10_000, message: '等待搜索定位把节点移到画布中心超时' },
    )
    .toBeLessThan(80)
}

/** 通过画布查找面板定位节点：只展开目标一跳，并把视口居中放大。 */
async function locateViaSearch(page: Page, name: string): Promise<void> {
  await page.getByTestId('graph-search-btn').click()
  const input = page.getByTestId('graph-search-input')
  await input.fill(name)
  await expect(page.getByTestId('graph-search-result')).toHaveCount(1)
  await input.press('Enter')
  await waitForZoomAbove(page, 0.5)
  // fitNode 的缩放与平移是两段动画：先等节点接近中心，再等 transform 完全静止，
  // 最后复核中心位置，避免拿着动画中途的 boundingBox 去按下拖动。
  await waitForNodeCentered(page, name)
  await waitForViewportIdle(page)
  await waitForNodeCentered(page, name)
  await page.keyboard.press('Escape')
}

/** 读取关系 path 的 d 属性。 */
async function edgePathData(page: Page, edgeId: string): Promise<string> {
  return page.evaluate((id) => {
    const path = document.querySelector(
      '.vue-flow__edge[data-id="' + id + '"] .vue-flow__edge-path',
    )
    return path?.getAttribute('d') ?? ''
  }, edgeId)
}

/**
 * 关系起点到目标节点最近 handle 边框的屏幕距离（px）。
 * Vue Flow 的连接点落在 handle 盒的边缘而不是中心，因此用「点到矩形」的距离。
 */
async function endpointGap(page: Page, edgeId: string, nodeId: string): Promise<number> {
  return page.evaluate(
    ({ edgeId: id, nodeId: node }) => {
      const path = document.querySelector(
        '.vue-flow__edge[data-id="' + id + '"] .vue-flow__edge-path',
      ) as SVGPathElement | null
      if (!path) {
        return Number.POSITIVE_INFINITY
      }
      const d = path.getAttribute('d') ?? ''
      const match = /^M\s*(-?[\d.]+)\s+(-?[\d.]+)/.exec(d)
      const matrix = path.getScreenCTM()
      if (!match || !matrix) {
        return Number.POSITIVE_INFINITY
      }
      const start = new DOMPoint(Number(match[1]), Number(match[2])).matrixTransform(matrix)
      const handles = Array.from(
        document.querySelectorAll('[data-node-id="' + node + '"] .vue-flow__handle'),
      )
      let best = Number.POSITIVE_INFINITY
      for (const handle of handles) {
        const rect = handle.getBoundingClientRect()
        const dx = Math.max(rect.left - start.x, 0, start.x - rect.right)
        const dy = Math.max(rect.top - start.y, 0, start.y - rect.bottom)
        best = Math.min(best, Math.hypot(dx, dy))
      }
      return best
    },
    { edgeId, nodeId },
  )
}

/** 画布内节点的 Vue Flow wrapper 矩形（屏幕坐标）。 */
async function canvasNodeRect(
  page: Page,
  nodeId: string,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return page.evaluate((id) => {
    // 必须限定在画布内：侧栏节点库的每一行也带 data-node-id，全局 querySelector 会先命中它。
    const lore = document.querySelector('.graph-canvas [data-node-id="' + id + '"]')
    const wrapper = lore?.closest('.vue-flow__node')
    if (!wrapper) {
      return null
    }
    const rect = wrapper.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }, nodeId)
}

/**
 * 断言指针按下点确实落在目标节点上（而不是画布空白/侧栏/浮层），并返回节点中心。
 * 大图节点被工具栏、小地图或搜索面板挡住时，这里会立刻给出可读的失败原因。
 */
async function pressPointOnNode(
  page: Page,
  nodeId: string,
): Promise<{
  x: number
  y: number
  rect: { x: number; y: number; width: number; height: number }
}> {
  const rect = await canvasNodeRect(page, nodeId)
  if (rect === null) {
    throw new Error('画布上找不到节点 wrapper：' + nodeId)
  }
  const x = rect.x + rect.width / 2
  const y = rect.y + rect.height / 2
  const hit = await page.evaluate(
    ({ px, py, id }) => {
      const stack = document.elementsFromPoint(px, py)
      const wrapper = stack.find((element) => element.classList.contains('vue-flow__node'))
      return {
        stack: stack
          .slice(0, 5)
          .map((element) => element.tagName.toLowerCase() + '.' + String(element.className)),
        hitNodeId: wrapper?.getAttribute('data-id') ?? null,
        expectedId: id,
      }
    },
    { px: x, py: y, id: nodeId },
  )
  if (hit.hitNodeId !== hit.expectedId) {
    throw new Error(
      '按下点没有落在目标节点上：命中 ' +
        String(hit.hitNodeId) +
        '，期望 ' +
        nodeId +
        '，元素栈 ' +
        JSON.stringify(hit.stack),
    )
  }
  return { x, y, rect }
}


/** 从视口 transform 读出世界→屏幕的缩放比例。 */
async function viewportScale(page: Page): Promise<number> {
  const transform = await readViewportTransform(page)
  const match = /scale\(([\d.]+)\)/.exec(transform)
  return match ? Number(match[1]) : 1
}

/**
 * 关系路径是否穿过某个节点的盒（屏幕空间采样，盒内缩 1px）。
 * 直接按渲染出的 SVG 路径长度采样，不解析 d，避免近似矩形漏判。
 */
async function pathInsideNode(page: Page, edgeId: string, nodeId: string): Promise<boolean> {
  return page.evaluate(
    ({ edgeId: id, nodeId: node }) => {
      const path = document.querySelector(
        '.graph-canvas .vue-flow__edge[data-id="' + id + '"] .vue-flow__edge-path',
      ) as SVGPathElement | null
      // 必须限定在画布内：侧栏节点库的每一行也带 data-node-id。
      const lore = document.querySelector('.graph-canvas [data-node-id="' + node + '"]')
      const wrapper = lore?.closest('.vue-flow__node') as HTMLElement | null
      if (!path || !wrapper) {
        return false
      }
      const matrix = path.getScreenCTM()
      const total = path.getTotalLength()
      const rect = wrapper.getBoundingClientRect()
      if (!matrix || total <= 0) {
        return false
      }
      const steps = 96
      for (let index = 0; index <= steps; index += 1) {
        const point = path.getPointAtLength((total * index) / steps)
        const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix)
        if (
          screen.x > rect.left + 1 &&
          screen.x < rect.right - 1 &&
          screen.y > rect.top + 1 &&
          screen.y < rect.bottom - 1
        ) {
          return true
        }
      }
      return false
    },
    { edgeId, nodeId },
  )
}

async function openLargeWorld(
  page: Page,
  testInfo: TestInfo,
  build: () => Record<string, unknown> = buildLargeWorld,
): Promise<WorldIds> {
  const world = build()
  const universe = world.universe as { name?: unknown } | undefined
  const worldName = String(universe?.name ?? '')
  const file = testInfo.outputPath('large-drag.loregraph.json')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(world, null, 2), 'utf8')

  await useEmptyLibrary(page)
  await gotoUniverses(page)
  await page.getByTestId('import-json-input').setInputFiles(file)
  await confirmImportPreview(page)

  const card = page.getByTestId('universe-card').filter({ hasText: worldName })
  await expect(card).toHaveCount(1)
  await card.getByRole('link', { name: '打开' }).click()
  await expect(page.getByTestId('graph-canvas')).toBeVisible()
  await expect(page.getByTestId('lore-node')).toHaveCount(LARGE_NODE_COUNT, { timeout: 60_000 })
  return resolveWorldIds(page)
}

test.describe('大图拖动：端点跟随、非关联边稳定、drop 精确重算', () => {
  test('拖动 n-000：关联边跟随，远端非关联边 path 不变，drop 后落库并重新贴合', async ({
    page,
  }, testInfo) => {
    const ids = await openLargeWorld(page, testInfo)
    const outgoing = ids.edgeId(largeNodeName(0), largeNodeName(1))
    const far = ids.edgeId(largeNodeName(90), largeNodeName(91))
    const draggedNodeId = ids.nodeId(largeNodeName(0))

    // 展开远端分支与拖动目标：far 成为「非关联边」，outgoing 成为「关联边」
    await locateViaSearch(page, largeNodeName(90))
    await locateViaSearch(page, largeNodeName(0))
    // 清掉定位产生的选中态，避免相邻变淡影响断言。
    // 空白点击现在会收回展开的关系线，这里用 Esc 只取消选中、保留已展开分支。
    await page.keyboard.press('Escape')
    await waitTwoFrames(page)

    await expect(page.locator('.vue-flow__edge')).toHaveCount(3)
    expect(await edgePathData(page, outgoing)).not.toBe('')
    expect(await edgePathData(page, far)).not.toBe('')
    expect(await endpointGap(page, outgoing, draggedNodeId)).toBeLessThan(4)

    const before = await waitForStoredNodePosition(page, largeNodeName(0))
    const farPathBefore = await edgePathData(page, far)

    // 指针落点必须真的在节点上：用画布内的 wrapper 矩形取中心，并核对命中栈。
    // （侧栏节点库同样带 data-node-id，所以选择器限定在 .graph-canvas 内。）
    const start = await pressPointOnNode(page, draggedNodeId)
    const viewportBeforeDrag = await readViewportTransform(page)

    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    // 拖动必须用「连续多步」指针移动（与 helpers.dragNodeBy 的 steps 手势一致）。
    // 实测：单次 page.mouse.move 跳跃（哪怕 40px）在大图上不会进入节点拖动——
    // .dragging 恒为 0、wrapper 矩形不动，而指针命中栈与视口都正常；
    // 换成带 steps 的多次 pointermove 后稳定进入拖动。
    await page.mouse.move(start.x + DRAG_DX * 0.4, start.y + DRAG_DY * 0.4, { steps: 8 })
    await waitTwoFrames(page)

    // 主证据：节点矩形确实随指针移动了（不依赖 class）。
    const midRect = await canvasNodeRect(page, draggedNodeId)
    if (midRect === null) {
      throw new Error('拖动中目标节点消失')
    }
    expect(Math.hypot(midRect.x - start.rect.x, midRect.y - start.rect.y)).toBeGreaterThan(8)
    // 视口没有平移：如果按在空白画布上，动的是视口而不是节点。
    expect(await readViewportTransform(page)).toBe(viewportBeforeDrag)
    // 辅助证据：Vue Flow 已进入节点拖动状态。
    await expect(page.locator('.vue-flow__node.dragging')).toHaveCount(1)

    // 拖动中途：关联边端点跟随节点 handle；远端非关联边没被移动障碍影响，path 逐字节不变（未重算）。
    const midDragGap = await endpointGap(page, outgoing, draggedNodeId)
    expect(midDragGap).toBeLessThan(4)
    expect(await edgePathData(page, far)).toBe(farPathBefore)

    // 继续推进到最终位置再松手（一路向前，不回退）。
    await page.mouse.move(start.x + DRAG_DX, start.y + DRAG_DY, { steps: 12 })
    await waitTwoFrames(page)
    await page.mouse.up()
    await expect(page.locator('.vue-flow__node.dragging')).toHaveCount(0)

    // 节点在画布上确实被移动了（否则后面的 IndexedDB 断言只会得到含糊的超时）
    const afterRect = await canvasNodeRect(page, draggedNodeId)
    if (afterRect === null) {
      throw new Error('拖动后目标节点不可见')
    }
    expect(Math.hypot(afterRect.x - start.rect.x, afterRect.y - start.rect.y)).toBeGreaterThan(50)

    // drop 后坐标落库
    await expect
      .poll(async () => (await findStoredNode(page, largeNodeName(0)))?.position ?? before, {
        timeout: 15_000,
        message: '等待拖动后的节点坐标写入 IndexedDB 超时',
      })
      .not.toEqual(before)
    const after = await waitForStoredNodePosition(page, largeNodeName(0))
    expect(after).not.toEqual(before)

    // drop 后按最终坐标精确重算：端点仍贴合节点，远端路径没有 NaN/Infinity
    await waitTwoFrames(page)
    expect(await endpointGap(page, outgoing, draggedNodeId)).toBeLessThan(4)
    const farPathAfter = await edgePathData(page, far)
    expect(farPathAfter).not.toMatch(/NaN|Infinity/)
    expect(farPathAfter.length).toBeGreaterThan(0)
  })
})

/**
 * 实时避障回归：n-000 被拖进 n-001→n-010 的曲线走廊时，这条非关联关系必须在拖动期间
 * 就按移动中的矩形重路由；拖回原点后恢复基线路径；远端关系全程不受影响。
 * 落点 (144,64) 是实测选出的敏感点：直连候选穿节点、平切线候选不穿（两个候选命中不同）。
 */
test.describe('大图实时避障：移动中的节点参与其它关系的障碍判定', () => {
  test('拖动 n-000 进入/离开走廊：非关联边拖动中重路由、远端边不变、drop 后避障并落库', async ({
    page,
  }, testInfo) => {
    const ids = await openLargeWorld(page, testInfo, buildObstacleWorld)
    const cross = ids.edgeId(largeNodeName(1), largeNodeName(10))
    const incident = ids.edgeId(largeNodeName(0), largeNodeName(1))
    const far = ids.edgeId(largeNodeName(90), largeNodeName(91))
    const draggedNodeId = ids.nodeId(largeNodeName(0))
    const draggedName = largeNodeName(0)

    // 依次展开远端分支与走廊两端：e-far、e-cross、e-in、e-out 共 4 条可见
    await locateViaSearch(page, largeNodeName(90))
    await locateViaSearch(page, largeNodeName(10))
    await locateViaSearch(page, largeNodeName(0))
    // 清掉定位产生的选中态，避免相邻变淡影响断言。
    // 空白点击现在会收回展开的关系线，这里用 Esc 只取消选中、保留已展开分支。
    await page.keyboard.press('Escape')
    await waitTwoFrames(page)

    await expect(page.locator('.vue-flow__edge')).toHaveCount(4)
    const crossBefore = await edgePathData(page, cross)
    const farBefore = await edgePathData(page, far)
    expect(crossBefore).not.toBe('')
    expect(farBefore).not.toBe('')
    // 基线：n-000 在原点时这条非关联边不穿它
    expect(await pathInsideNode(page, cross, draggedNodeId)).toBe(false)

    // 屏幕位移 = 世界位移 × 当前缩放；落点世界坐标 (144,64)，16px 网格上的整数格点
    const scale = await viewportScale(page)
    const dragX = 144 * scale
    const dragY = 64 * scale

    const start = await pressPointOnNode(page, draggedNodeId)
    const viewportBeforeDrag = await readViewportTransform(page)

    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    // 与上面那条拖动用例同样的连续多步手势：单次跳跃不会进入节点拖动
    await page.mouse.move(start.x + dragX * 0.4, start.y + dragY * 0.4, { steps: 8 })
    await waitTwoFrames(page)
    // 推进到终点但先不松手：此时移动中的节点盒已经在走廊里
    await page.mouse.move(start.x + dragX, start.y + dragY, { steps: 12 })
    await waitTwoFrames(page)

    const midRect = await canvasNodeRect(page, draggedNodeId)
    if (midRect === null) {
      throw new Error('拖动中目标节点消失')
    }
    expect(Math.hypot(midRect.x - start.rect.x, midRect.y - start.rect.y)).toBeGreaterThan(50)
    expect(await readViewportTransform(page)).toBe(viewportBeforeDrag)
    await expect(page.locator('.vue-flow__node.dragging')).toHaveCount(1)

    // 主证据（进入）：非关联边在拖动中已按移动中的矩形重路由，且不再穿过该节点
    const crossDuring = await edgePathData(page, cross)
    expect(crossDuring).not.toBe(crossBefore)
    expect(await pathInsideNode(page, cross, draggedNodeId)).toBe(false)
    // 停用冻结的旧实现会在这里失败：路径仍是基线，且实际穿过被拖动的节点
    // 远端关系没有被移动障碍影响：path 逐字节不变（性能回归信号）
    expect(await edgePathData(page, far)).toBe(farBefore)
    // 关联边端点跟随移动中的节点
    expect(await endpointGap(page, incident, draggedNodeId)).toBeLessThan(4)

    await page.mouse.up()
    await expect(page.locator('.vue-flow__node.dragging')).toHaveCount(0)

    // drop 后坐标落库（世界 (144,64)，16px 网格）
    await expect
      .poll(async () => (await findStoredNode(page, draggedName))?.position ?? null, {
        timeout: 15_000,
        message: '等待拖动后的节点坐标写入 IndexedDB 超时',
      })
      .toEqual({ x: 144, y: 64 })

    // drop 后按最终坐标精确重算：仍然避障，端点贴合
    await waitTwoFrames(page)
    expect(await pathInsideNode(page, cross, draggedNodeId)).toBe(false)
    expect(await edgePathData(page, cross)).not.toBe(crossBefore)
    expect(await endpointGap(page, incident, draggedNodeId)).toBeLessThan(4)

    // 第二次拖动：把 n-000 拖回原点，离开走廊 → 非关联边在拖动中就恢复基线路径
    const backStart = await pressPointOnNode(page, draggedNodeId)
    await page.mouse.move(backStart.x, backStart.y)
    await page.mouse.down()
    await page.mouse.move(backStart.x - dragX * 0.4, backStart.y - dragY * 0.4, { steps: 8 })
    await waitTwoFrames(page)
    await page.mouse.move(backStart.x - dragX, backStart.y - dragY, { steps: 12 })
    await waitTwoFrames(page)

    await expect(page.locator('.vue-flow__node.dragging')).toHaveCount(1)
    // 主证据（离开）：障碍离开走廊后几何立即回到基线，而不是等 drop
    expect(await edgePathData(page, cross)).toBe(crossBefore)
    expect(await pathInsideNode(page, cross, draggedNodeId)).toBe(false)

    await page.mouse.up()
    await expect
      .poll(async () => (await findStoredNode(page, draggedName))?.position ?? null, {
        timeout: 15_000,
        message: '等待拖回原点的坐标写入 IndexedDB 超时',
      })
      .toEqual({ x: 0, y: 0 })
    await waitTwoFrames(page)
    expect(await edgePathData(page, cross)).toBe(crossBefore)
  })
})
