import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import {
  confirmImportPreview,
  gotoUniverses,
  resolveWorldIds,
  useEmptyLibrary,
  waitForViewportIdle,
  type WorldIds,
} from './helpers'
import {
  LARGE_NODE_COUNT,
  LARGE_WORLD_NAME,
  buildLargeWorld,
  largeNodeName,
} from './large-world-fixture'

/**
 * 大图关系按需展开（nodes>=100 或 edges>=300）：
 * 节点卡片常驻、初始不显示关系线；点击节点显示全部直接入/出边，点击邻居再展开下一层；
 * 搜索定位只展开目标一跳；展开态按世界持久化；隐藏的选中边会被清除。
 *
 * 注意：导入世界会重映射全部节点/关系 id，因此断言一律按「节点名称」定位，
 * 关系 id 通过 IndexedDB 反查（resolveWorldIds），不能直接用 fixture 里的 id。
 */

function nodeByName(page: Page, index: number) {
  return page.getByTestId('lore-node').filter({ hasText: largeNodeName(index) })
}

function edgeById(page: Page, id: string) {
  return page.locator('.vue-flow__edge[data-id="' + id + '"]')
}

async function clickBlank(page: Page): Promise<void> {
  const box = await page.getByTestId('graph-canvas').boundingBox()
  if (box === null) {
    throw new Error('画布不可见，无法取消选中')
  }
  await page.mouse.click(box.x + box.width - 60, box.y + 60)
}

/** 在世界列表页导入大图世界并打开，停在「100 节点、0 条关系线、无选中」，返回导入后的真实 id。 */
async function openLargeWorld(page: Page, testInfo: TestInfo): Promise<WorldIds> {
  const file = testInfo.outputPath('large-expansion.loregraph.json')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(buildLargeWorld(), null, 2), 'utf8')

  await useEmptyLibrary(page)
  await gotoUniverses(page)
  await page.getByTestId('import-json-input').setInputFiles(file)
  await confirmImportPreview(page)

  const card = page.getByTestId('universe-card').filter({ hasText: LARGE_WORLD_NAME })
  await expect(card).toHaveCount(1)
  await card.getByRole('link', { name: '打开' }).click()
  await expect(page.getByTestId('graph-canvas')).toBeVisible()
  await expect(page.getByTestId('lore-node')).toHaveCount(LARGE_NODE_COUNT, { timeout: 60_000 })

  await page.getByTestId('fit-view-btn').click()
  await waitForViewportIdle(page)
  await clickBlank(page)
  return resolveWorldIds(page)
}

test.describe('大图关系按需展开', () => {
  test('初始不显示关系线；点节点显示全部直接入/出边，点邻居再展开下一层', async ({
    page,
  }, testInfo) => {
    const ids = await openLargeWorld(page, testInfo)
    const incoming = ids.edgeId(largeNodeName(10), largeNodeName(0))
    const outgoing = ids.edgeId(largeNodeName(0), largeNodeName(1))
    const next = ids.edgeId(largeNodeName(1), largeNodeName(2))
    const far = ids.edgeId(largeNodeName(90), largeNodeName(91))

    // 大图初始：100 个节点卡片全部常驻，0 条关系线
    await expect(page.getByTestId('lore-node')).toHaveCount(LARGE_NODE_COUNT)
    await expect(page.locator('.vue-flow__edge')).toHaveCount(0)

    await nodeByName(page, 0).click()

    // 点击 n-000 同时点亮入边与出边，邻居的下一层仍然隐藏
    await expect(page.locator('.vue-flow__edge')).toHaveCount(2)
    await expect(edgeById(page, incoming)).toHaveCount(1)
    await expect(edgeById(page, outgoing)).toHaveCount(1)
    await expect(edgeById(page, next)).toHaveCount(0)
    await expect(nodeByName(page, 0)).toHaveAttribute('data-relations-expanded', 'true')

    await nodeByName(page, 1).click()

    // 点击邻居 n-001 展开它的关系：新增下一层关系，远端分支仍隐藏
    await expect(page.locator('.vue-flow__edge')).toHaveCount(3)
    await expect(edgeById(page, next)).toHaveCount(1)
    await expect(edgeById(page, far)).toHaveCount(0)
    await expect(nodeByName(page, 1)).toHaveAttribute('data-relations-expanded', 'true')

    // 点击空白只取消选中，已展开的关系保持可见
    await clickBlank(page)
    await expect(page.locator('.vue-flow__edge')).toHaveCount(3)
  })

  test('chevron 可用键盘收起关系；被隐藏的选中边同步清除选中态', async ({ page }, testInfo) => {
    const ids = await openLargeWorld(page, testInfo)

    await nodeByName(page, 0).click()
    await expect(page.locator('.vue-flow__edge')).toHaveCount(2)

    // 通过 Inspector 的「所属关系」显式选边，进入 edge-editor
    await page
      .getByTestId('node-editor')
      .getByRole('button', { name: new RegExp(largeNodeName(1)) })
      .click()
    await expect(page.getByTestId('edge-editor')).toBeVisible()

    // 关系 chevron 是原生 button：聚焦后 Enter 即可收起
    const toggleSelector =
      '[data-testid="node-relations-toggle"][data-node-id="' + ids.nodeId(largeNodeName(0)) + '"]'
    const toggle = page.locator(toggleSelector)
    // 关系按钮默认淡出，但仍是原生 button：直接聚焦后按 Enter 验证键盘可达
    await page.evaluate((selector) => {
      const element = document.querySelector(selector)
      if (element instanceof HTMLElement) {
        element.focus()
      }
    }, toggleSelector)
    await page.keyboard.press('Enter')

    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.vue-flow__edge')).toHaveCount(0)
    // 选中边被收起后不可见，Inspector 必须回到空态，而不是指向隐藏边
    await expect(page.getByTestId('inspector-empty')).toBeVisible()
  })

  test('搜索定位只展开目标一跳，不扩散到邻居的下一层', async ({ page }, testInfo) => {
    const ids = await openLargeWorld(page, testInfo)
    const far = ids.edgeId(largeNodeName(90), largeNodeName(91))
    const far2 = ids.edgeId(largeNodeName(91), largeNodeName(92))

    await page.getByTestId('graph-search-btn').click()
    const input = page.getByTestId('graph-search-input')
    await input.fill(largeNodeName(90))
    await expect(page.getByTestId('graph-search-result')).toHaveCount(1)
    await input.press('Enter')
    await waitForViewportIdle(page)

    // 只展开 n-090：它自己的出边可见，邻居 n-091 的下一层不可见
    await expect(page.locator('.vue-flow__edge')).toHaveCount(1)
    await expect(edgeById(page, far)).toHaveCount(1)
    await expect(edgeById(page, far2)).toHaveCount(0)
  })

  test('展开态按世界持久化：刷新后已展开的关系仍可见', async ({ page }, testInfo) => {
    await openLargeWorld(page, testInfo)

    await nodeByName(page, 0).click()
    await expect(page.locator('.vue-flow__edge')).toHaveCount(2)

    await page.reload()
    await expect(page.getByTestId('graph-canvas')).toBeVisible()
    await expect(page.getByTestId('lore-node')).toHaveCount(LARGE_NODE_COUNT, { timeout: 60_000 })
    await expect(page.locator('.vue-flow__edge')).toHaveCount(2, { timeout: 30_000 })
  })

  test('小图保持原有行为：全部关系常显，chevron 仍是折叠下级节点', async ({ page }, testInfo) => {
    const world = {
      format: 'loregraph.universe',
      formatVersion: 1,
      exportedAt: 1767225600000,
      universe: {
        id: 'u-small-regression',
        name: '小图回归',
        description: '',
        createdAt: 1767225600000,
        updatedAt: 1767225600000,
      },
      types: [
        {
          id: 't-character',
          universeId: 'u-small-regression',
          scope: 'node',
          key: 'character',
          label: '角色',
          color: '#6366f1',
          order: 0,
          createdAt: 1767225600000,
          updatedAt: 1767225600000,
        },
        {
          id: 't-related-to',
          universeId: 'u-small-regression',
          scope: 'relation',
          key: 'related-to',
          label: '相关',
          color: '#94a3b8',
          order: 0,
          createdAt: 1767225600000,
          updatedAt: 1767225600000,
        },
      ],
      nodes: [
        {
          id: 'n-a',
          universeId: 'u-small-regression',
          type: 'character',
          name: '甲',
          description: '',
          properties: {},
          position: { x: 0, y: 0 },
          createdAt: 1767225600000,
          updatedAt: 1767225600000,
        },
        {
          id: 'n-b',
          universeId: 'u-small-regression',
          type: 'character',
          name: '乙',
          description: '',
          properties: {},
          position: { x: 400, y: 0 },
          createdAt: 1767225600000,
          updatedAt: 1767225600000,
        },
        {
          id: 'n-c',
          universeId: 'u-small-regression',
          type: 'character',
          name: '丙',
          description: '',
          properties: {},
          position: { x: 800, y: 0 },
          createdAt: 1767225600000,
          updatedAt: 1767225600000,
        },
      ],
      edges: [
        {
          id: 'e-a-b',
          universeId: 'u-small-regression',
          source: 'n-a',
          target: 'n-b',
          relationType: 'related-to',
          label: '',
          properties: {},
          createdAt: 1767225600000,
          updatedAt: 1767225600000,
        },
        {
          id: 'e-b-c',
          universeId: 'u-small-regression',
          source: 'n-b',
          target: 'n-c',
          relationType: 'related-to',
          label: '',
          properties: {},
          createdAt: 1767225600000,
          updatedAt: 1767225600000,
        },
      ],
    }
    const file = testInfo.outputPath('small-regression.loregraph.json')
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(world, null, 2), 'utf8')

    await useEmptyLibrary(page)
    await gotoUniverses(page)
    await page.getByTestId('import-json-input').setInputFiles(file)
    await confirmImportPreview(page)
    await page
      .getByTestId('universe-card')
      .filter({ hasText: '小图回归' })
      .getByRole('link', { name: '打开' })
      .click()

    await expect(page.getByTestId('lore-node')).toHaveCount(3)
    await expect(page.locator('.vue-flow__edge')).toHaveCount(2)
    await expect(page.getByTestId('node-relations-toggle')).toHaveCount(0)
    // 甲、乙都有出边，各自保留旧的「折叠下级节点」按钮
    await expect(page.getByTestId('node-collapse-toggle')).toHaveCount(2)
  })
})
