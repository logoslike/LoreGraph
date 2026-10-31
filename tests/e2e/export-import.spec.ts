import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { backToUniverses, openUniverse } from './helpers'

const SAMPLE_PATH = resolve(process.cwd(), 'public/examples/emberfall.json')

/** 在世界列表页导出首个世界，返回下载文件路径与解析后的 JSON。 */
async function exportFirstUniverse(
  page: Page,
  testInfo: TestInfo,
): Promise<{ file: string; data: Record<string, unknown> }> {
  await backToUniverses(page)
  const file = testInfo.outputPath('export.json')
  await mkdir(dirname(file), { recursive: true })

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-universe-btn').first().click(),
  ])
  expect(download.suggestedFilename()).toContain('.loregraph.json')
  expect(download.suggestedFilename()).toContain('烬海纪元')

  await download.saveAs(file)
  const data = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
  return { file, data }
}

/** LG-011 导出世界。 */
test.describe('LG-011 导出', () => {
  test('导出下载 JSON 文件，内容与当前世界一致', async ({ page }, testInfo) => {
    await openUniverse(page, '烬海纪元')
    await expect(page.getByTestId('lore-node')).toHaveCount(12)

    const { data } = await exportFirstUniverse(page, testInfo)

    expect(data.format).toBe('loregraph')
    expect(data.formatVersion).toBe(1)
    expect((data.universe as { name: string }).name).toBe('烬海纪元')
    expect(data.nodes as unknown[]).toHaveLength(12)
    expect(data.edges as unknown[]).toHaveLength(14)
    expect(data.types as unknown[]).toHaveLength(13)
  })
})

/** LG-012 导入世界（含非法文件的可读提示）。 */
test.describe('LG-012 导入', () => {
  test('导出的 JSON 再导入为新世界，节点数一致且数据隔离', async ({ page }, testInfo) => {
    await openUniverse(page, '烬海纪元')
    const { file } = await exportFirstUniverse(page, testInfo)

    await page.getByTestId('import-json-input').setInputFiles(file)
    await expect(page.getByTestId('universe-card')).toHaveCount(2)

    const imported = page.getByTestId('universe-card').filter({ hasText: '烬海纪元（导入）' })
    await expect(imported).toHaveCount(1)
    await expect(imported).toContainText('12 节点')
    await expect(imported).toContainText('14 关系')

    await imported.getByRole('link', { name: '打开' }).click()
    await expect(page.getByTestId('graph-canvas')).toBeVisible()
    await expect(page.getByTestId('lore-node')).toHaveCount(12)
    await expect(page.locator('.vue-flow__edge')).toHaveCount(14)

    // 导入生成的是新世界：世界列表共 2 条，原世界仍在
    await backToUniverses(page)
    await expect(page.getByTestId('universe-card')).toHaveCount(2)
    await expect(
      page.getByTestId('universe-card').filter({ hasText: '烬海纪元' }).first(),
    ).toBeVisible()
  })

  test('引用完整性错误逐条展示', async ({ page }, testInfo) => {
    const sample = JSON.parse(await readFile(SAMPLE_PATH, 'utf8')) as {
      nodes: { type: string }[]
    }
    sample.nodes[0]!.type = 'unknown-type'

    const broken = testInfo.outputPath('broken-ref.json')
    await mkdir(dirname(broken), { recursive: true })
    await writeFile(broken, JSON.stringify(sample), 'utf8')

    await page.goto('/')
    await expect(page.getByTestId('universe-card')).toHaveCount(1)

    await page.getByTestId('import-json-input').setInputFiles(broken)
    const issues = page.getByTestId('import-issues')
    await expect(issues).toBeVisible()
    await expect(issues).toContainText('nodes.0.type')
    await expect(issues).toContainText('未定义')
    await expect(issues.locator('li')).not.toHaveCount(0)
    // 校验失败不会新增世界
    await expect(page.getByTestId('universe-card')).toHaveCount(1)
  })

  test('无法解析的 JSON 展示解析失败原因', async ({ page }, testInfo) => {
    const broken = testInfo.outputPath('broken-syntax.json')
    await mkdir(dirname(broken), { recursive: true })
    await writeFile(broken, '{ not valid json', 'utf8')

    await page.goto('/')
    await expect(page.getByTestId('universe-card')).toHaveCount(1)

    await page.getByTestId('import-json-input').setInputFiles(broken)
    const issues = page.getByTestId('import-issues')
    await expect(issues).toBeVisible()
    await expect(issues).toContainText('JSON 解析失败')
    await expect(page.getByTestId('universe-card')).toHaveCount(1)
  })
})
