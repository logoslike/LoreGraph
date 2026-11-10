import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import {
  confirmImportPreview,
  createNodeViaToolbar,
  gotoUniverses,
  resolveWorldIds,
  useEmptyLibrary,
  waitForViewportIdle,
  type WorldIds,
} from './helpers'
import {
  COLLAPSE_NODE_COUNT,
  COLLAPSE_WORLD_NAME,
  buildCollapseThresholdWorld,
  largeNodeName,
} from './large-world-fixture'

/**
 * 跨大图阈值的折叠清理回归（LG 折叠审计）：
 * 99 节点时折叠 X 会藏起 Y/Z；加到 100 节点后大图模式停用旧折叠，Y/Z 重新出现；
 * 在 Y 上进入聚焦、选中邻居 Z 并删除回 99 后，旧折叠重新生效把聚焦中心 Y 藏起来。
 * 此时必须同时清除聚焦提示条，否则它指向画布上不存在的节点。
 */

const X = largeNodeName(0)
const Y = largeNodeName(1)
const Z = largeNodeName(2)

function nodeByName(page: Page, name: string) {
  return page.getByTestId('lore-node').filter({ hasText: name })
}

async function openWorld(page: Page, testInfo: TestInfo): Promise<WorldIds> {
  const file = testInfo.outputPath('collapse-threshold.loregraph.json')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(buildCollapseThresholdWorld(), null, 2), 'utf8')

  await useEmptyLibrary(page)
  await gotoUniverses(page)
  await page.getByTestId('import-json-input').setInputFiles(file)
  await confirmImportPreview(page)

  const card = page.getByTestId('universe-card').filter({ hasText: COLLAPSE_WORLD_NAME })
  await expect(card).toHaveCount(1)
  await card.getByRole('link', { name: '打开' }).click()
  await expect(page.getByTestId('graph-canvas')).toBeVisible()
  await expect(page.getByTestId('lore-node')).toHaveCount(COLLAPSE_NODE_COUNT, { timeout: 60_000 })
  await page.getByTestId('fit-view-btn').click()
  await waitForViewportIdle(page)
  return resolveWorldIds(page)
}

/** 节点必须完整落在画布可视区内，否则点击会被两侧侧栏/检查器拦截。 */
async function expectNodeInsideCanvas(page: Page, name: string): Promise<void> {
  const canvas = await page.getByTestId('graph-canvas').boundingBox()
  const box = await nodeByName(page, name).boundingBox()
  expect(canvas, '画布不可见').not.toBeNull()
  expect(box, `画布上找不到节点「${name}」`).not.toBeNull()
  if (canvas === null || box === null) {
    return
  }
  expect(box.x, `节点「${name}」左侧出界`).toBeGreaterThanOrEqual(canvas.x - 1)
  expect(box.y, `节点「${name}」上方出界`).toBeGreaterThanOrEqual(canvas.y - 1)
  expect(box.x + box.width, `节点「${name}」右侧出界`).toBeLessThanOrEqual(
    canvas.x + canvas.width + 1,
  )
  expect(box.y + box.height, `节点「${name}」下方出界`).toBeLessThanOrEqual(
    canvas.y + canvas.height + 1,
  )
}

/** 通过画布查找定位并选中节点（大图模式会同时展开它的一跳关系）。 */
async function locateNodeByName(page: Page, name: string): Promise<void> {
  await page.getByTestId('graph-search-btn').click()
  const input = page.getByTestId('graph-search-input')
  await input.fill(name)
  await expect(page.getByTestId('graph-search-result')).toHaveCount(1)
  await input.press('Enter')
  await waitForViewportIdle(page)
  await page.keyboard.press('Escape')
}

test.describe('跨大图阈值的折叠清理', () => {
  test('99 折叠 X → 加到 100 → Y 聚焦 → 删邻居回 99：隐藏的聚焦中心被清除', async ({
    page,
  }, testInfo) => {
    const ids = await openWorld(page, testInfo)

    // 1) 小图：折叠 X，Y 与 Z 都被藏起来
    await page
      .locator('[data-testid="node-collapse-toggle"][data-node-id="' + ids.nodeId(X) + '"]')
      .click()
    await expect(nodeByName(page, Y)).toHaveCount(0)
    await expect(nodeByName(page, Z)).toHaveCount(0)
    await expect(page.getByTestId('lore-node')).toHaveCount(COLLAPSE_NODE_COUNT - 2)

    // 2) 加到 100 节点：进入大图模式，旧折叠停用，Y/Z 重新可见
    await createNodeViaToolbar(page, '阈值新增节点')
    await expect(page.getByTestId('lore-node')).toHaveCount(COLLAPSE_NODE_COUNT + 1)
    await expect(nodeByName(page, Y)).toHaveCount(1)
    await expect(nodeByName(page, Z)).toHaveCount(1)

    // 3) 在 Y 上进入聚焦：邻域只有 X/Y/Z
    await locateNodeByName(page, Y)
    await nodeByName(page, Y).click()
    await page.keyboard.press('f')
    await expect(page.getByTestId('focus-banner')).toBeVisible()
    await expect(page.getByTestId('lore-node')).toHaveCount(3)

    // 4) 选中邻居 Z 并删除：总节点回到 99，旧折叠重新生效把 Y 藏起来
    // 大图聚焦保留进入前的缩放（步骤 3 的搜索定位把视口放大到 1.25），邻域两端的 X/Z
    // 只剩一小条露在画布边缘、其余被两侧面板盖住，点击会被检查器拦截；屏外标注只标注
    // 与画布完全不相交的节点，所以这里没有可点的标注。先用工具栏的「适应视图」把聚焦
    // 邻域收进画布（用户可见的操作，不用 force click、也不靠放大超时），再点 Z。
    await page.getByTestId('fit-view-btn').click()
    await waitForViewportIdle(page)
    await expectNodeInsideCanvas(page, Z)
    await nodeByName(page, Z).click()
    await page.keyboard.press('Delete')
    await expect(page.getByTestId('lore-node')).toHaveCount(COLLAPSE_NODE_COUNT - 1)

    // 核心断言：聚焦中心 Y 已被隐藏，提示条必须同步消失
    await expect(nodeByName(page, Y)).toHaveCount(0)
    await expect(page.getByTestId('focus-banner')).toHaveCount(0)
    // 退出聚焦后其余节点恢复可见（只少了被折叠隐藏的 Y）
    await expect(page.getByTestId('lore-node')).toHaveCount(COLLAPSE_NODE_COUNT - 1)
    await expect(nodeByName(page, X)).toHaveCount(1)
  })
})
