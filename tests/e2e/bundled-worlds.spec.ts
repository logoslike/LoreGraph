import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

const WORLDS_DIR = resolve(process.cwd(), 'worlds')
const WORLD_FILES = existsSync(WORLDS_DIR)
  ? readdirSync(WORLDS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
  : []
const MARKER_KEY = 'loregraph.bundledWorlds.imported'

/** 至少存在一个声明完整世界且结构可解析的 JSON，才运行依赖本地数据的集成用例。 */
function declaresCompleteWorld(name: string): boolean {
  try {
    const value = JSON.parse(readFileSync(resolve(WORLDS_DIR, name), 'utf8')) as Record<
      string,
      unknown
    >
    const universe =
      typeof value.universe === 'object' && value.universe !== null
        ? (value.universe as Record<string, unknown>)
        : null
    return (
      value.format === 'loregraph.universe' &&
      value.formatVersion === 1 &&
      typeof universe?.id === 'string' &&
      universe.id.length > 0 &&
      typeof universe.name === 'string' &&
      universe.name.length > 0 &&
      Array.isArray(value.types) &&
      Array.isArray(value.nodes) &&
      Array.isArray(value.edges)
    )
  } catch {
    return false
  }
}

const COMPLETE_WORLD_FILES = WORLD_FILES.filter(declaresCompleteWorld)

/**
 * 根目录 worlds 自动导入是工作树能力：CI 或不带 worlds 的检出应跳过。
 * 这里不使用带隔离开关的 gotoUniverses，直接访问首页验证真实启动路径。
 */
test.describe('BR-013 根目录 worlds 自动导入', () => {
  test.skip(
    COMPLETE_WORLD_FILES.length === 0,
    '当前工作树没有有效的根级 worlds/*.json，跳过本地数据集成用例',
  )

  test('首页自动导入有效世界，可打开且刷新后数量与标记不重复', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/')

    await expect(
      page.getByTestId('universe-list').or(page.getByTestId('new-universe-empty-btn')),
    ).toBeVisible({ timeout: 30_000 })
    const cards = page.getByTestId('universe-card')
    await expect(cards.first()).toBeVisible()
    const cardCount = await cards.count()
    expect(cardCount).toBeGreaterThan(0)

    const marker = await page.evaluate((key: string) => localStorage.getItem(key), MARKER_KEY)
    expect(marker).not.toBeNull()
    const sourceIds = JSON.parse(marker!) as string[]
    expect(sourceIds.length).toBeGreaterThan(0)

    await cards.first().getByRole('link', { name: '打开' }).click()
    await expect(page.getByTestId('graph-canvas')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('lore-node').first()).toBeVisible({ timeout: 30_000 })

    await page.getByRole('link', { name: '全部世界' }).click()
    await expect(page.getByTestId('universe-list')).toBeVisible()
    await page.reload()
    await expect(cards.first()).toBeVisible({ timeout: 30_000 })
    await expect(cards).toHaveCount(cardCount)
    const markerAfter = await page.evaluate((key: string) => localStorage.getItem(key), MARKER_KEY)
    expect(markerAfter).toBe(marker)
  })
})
