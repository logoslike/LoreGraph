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
 * 关系曲线、全局箭头开关与选中高亮的固定场景：
 * 左邻(0,0) - 中枢(400,0) - 右邻(800,0)，另有 左邻 -> 远端(400,300)。
 * 选中「中枢」时，两条入/出边应加粗，左邻/右邻应获得邻域强调，
 * 远端与 左邻->远端 这条非关联边应变淡；清除选择后全部恢复。
 */

const WORLD_NAME = '关系视觉'
const TIMESTAMP = 1767225600000
const UNIVERSE_ID = 'u-edge-visuals'

function buildWorld(): Record<string, unknown> {
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
  const node = (id: string, name: string, x: number, y: number) => ({
    id,
    universeId: UNIVERSE_ID,
    type: 'character',
    name,
    description: '',
    properties: {},
    position: { x, y },
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
      description: '关系曲线、箭头与选中高亮的固定场景。',
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
    types: [
      type('t-character', 'node', 'character', '角色', '#6366f1', 0),
      type('t-related-to', 'relation', 'related-to', '相关', '#10b981', 0),
    ],
    nodes: [
      node('n-left', '左邻', 0, 0),
      node('n-center', '中枢', 400, 0),
      node('n-right', '右邻', 800, 0),
      node('n-far', '远端', 400, 300),
    ],
    edges: [
      edge('e-left-center', 'n-left', 'n-center', '左到中'),
      edge('e-center-right', 'n-center', 'n-right', '中到右'),
      edge('e-left-far', 'n-left', 'n-far', '左到远'),
    ],
  }
}

async function openWorld(page: Page, testInfo: TestInfo): Promise<void> {
  const file = testInfo.outputPath('edge-visuals.loregraph.json')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(buildWorld(), null, 2), 'utf8')

  await useEmptyLibrary(page)
  await gotoUniverses(page)
  await page.getByTestId('import-json-input').setInputFiles(file)
  await confirmImportPreview(page)

  const card = page.getByTestId('universe-card').filter({ hasText: WORLD_NAME })
  await expect(card).toHaveCount(1)
  await card.getByRole('link', { name: '打开' }).click()
  await expect(page.getByTestId('graph-canvas')).toBeVisible()
  await expect(page.getByTestId('lore-node')).toHaveCount(4)
  await expect(page.locator('.vue-flow__edge-path')).toHaveCount(3)
  await page.getByTestId('fit-view-btn').click()
  await waitForViewportIdle(page)
}

function nodeByName(page: Page, name: string) {
  return page.getByTestId('lore-node').filter({ hasText: name })
}

async function clickBlank(page: Page): Promise<void> {
  const box = await page.getByTestId('graph-canvas').boundingBox()
  if (box === null) {
    throw new Error('画布不可见，无法取消选中')
  }
  await page.mouse.click(box.x + box.width - 60, box.y + 60)
}

async function edgeStyles(page: Page): Promise<{ strokeWidth: string; opacity: string }[]> {
  return page.locator('.vue-flow__edge-path').evaluateAll((elements) =>
    elements.map((element) => {
      const path = element as SVGPathElement
      return { strokeWidth: path.style.strokeWidth, opacity: path.style.opacity }
    }),
  )
}

test.describe('关系曲线、全局箭头与选中高亮', () => {
  test('默认显示曲线与箭头，一个开关控制全部边，选中节点强调入/出关系', async ({
    page,
  }, testInfo) => {
    await openWorld(page, testInfo)

    const paths = page.locator('.vue-flow__edge-path')
    const toggle = page.getByTestId('edge-arrows-toggle')

    // 默认：所有边都有箭头；共线边可以是直线，至少错位边使用曲线命令
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    for (let index = 0; index < 3; index += 1) {
      const path = paths.nth(index)
      await expect(path).toHaveAttribute('marker-end', /url\(/)
      expect(await path.getAttribute('d')).not.toMatch(/NaN|Infinity/)
    }
    const pathData = await paths.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('d') ?? ''),
    )
    expect(pathData.some((d) => d.includes('C'))).toBe(true)
    // 不仅是属性占位：Vue Flow 必须真的生成 marker 定义
    expect(await page.locator('marker.vue-flow__arrowhead').count()).toBeGreaterThan(0)

    // 全局关闭：所有边同时失去箭头；再打开全部恢复
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    for (let index = 0; index < 3; index += 1) {
      // Vue Flow 在未设置 marker 时会保留 url('#') 占位，视觉上等同于无箭头
      const marker = await paths.nth(index).getAttribute('marker-end')
      expect(marker === "url('#')" || marker === 'url(#)').toBe(true)
    }
    await expect(page.locator('marker.vue-flow__arrowhead')).toHaveCount(0)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    for (let index = 0; index < 3; index += 1) {
      const marker = await paths.nth(index).getAttribute('marker-end')
      expect(marker).toMatch(/url\(/)
      expect(marker).not.toBe("url('#')")
      expect(marker).not.toBe('url(#)')
    }

    // 选中中枢：邻节点强调、非邻节点变淡
    await nodeByName(page, '中枢').click()
    await expect(nodeByName(page, '左邻')).toHaveAttribute('data-neighbor', 'true')
    await expect(nodeByName(page, '右邻')).toHaveAttribute('data-neighbor', 'true')
    await expect(nodeByName(page, '远端')).toHaveAttribute('data-dimmed', 'true')
    await expect(nodeByName(page, '远端')).toHaveAttribute('data-neighbor', 'false')

    // 两条入/出边加粗，非关联边保持普通线宽并变淡
    const selectedStyles = await edgeStyles(page)
    expect(selectedStyles.filter((style) => style.strokeWidth === '2.15')).toHaveLength(2)
    expect(selectedStyles.filter((style) => style.strokeWidth === '1.6')).toHaveLength(1)
    expect(selectedStyles.filter((style) => style.opacity === '0.2')).toHaveLength(1)

    // 变淡的边不显示标签，关联边标签保留
    await expect(page.locator('.vue-flow__edge-text')).toHaveCount(2)

    // 清除选择后完全恢复
    await clickBlank(page)
    for (const name of ['左邻', '中枢', '右邻', '远端']) {
      await expect(nodeByName(page, name)).toHaveAttribute('data-dimmed', 'false')
      await expect(nodeByName(page, name)).toHaveAttribute('data-neighbor', 'false')
    }
    const restored = await edgeStyles(page)
    expect(restored.every((style) => style.strokeWidth === '1.6')).toBe(true)
    expect(restored.every((style) => style.opacity === '0.8')).toBe(true)
    await expect(page.locator('.vue-flow__edge-text')).toHaveCount(3)
  })

  test('全局箭头开关在刷新后保持关闭', async ({ page }, testInfo) => {
    await openWorld(page, testInfo)
    const toggle = page.getByTestId('edge-arrows-toggle')
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('marker.vue-flow__arrowhead')).toHaveCount(0)

    await page.reload()
    await expect(page.getByTestId('graph-canvas')).toBeVisible()
    await expect(page.getByTestId('lore-node')).toHaveCount(4)
    await expect(page.getByTestId('edge-arrows-toggle')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.vue-flow__edge-path').first()).toHaveAttribute(
      'marker-end',
      /url\(/,
    )
    const marker = await page.locator('.vue-flow__edge-path').first().getAttribute('marker-end')
    expect(marker === "url('#')" || marker === 'url(#)').toBe(true)
    await expect(page.locator('marker.vue-flow__arrowhead')).toHaveCount(0)
  })
})
