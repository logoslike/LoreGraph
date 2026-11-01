import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import {
  backToUniverses,
  confirmImportPreview,
  exportGraphFragment,
  importGraphFragment,
  importWorldViaInspector,
  openGraphMoreMenu,
  openUniverse,
  readDownloadJson,
} from './helpers'

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

  const data = await readDownloadJson(download, file)
  return { file, data }
}

/** LG-011 导出世界。 */
test.describe('LG-011 导出', () => {
  test('导出下载 JSON 文件，内容与当前世界一致', async ({ page }, testInfo) => {
    await openUniverse(page, '烬海纪元')
    await expect(page.getByTestId('lore-node')).toHaveCount(12)

    const { data } = await exportFirstUniverse(page, testInfo)

    expect(data.format).toBe('loregraph.universe')
    expect(data.formatVersion).toBe(1)
    expect((data.universe as { name: string }).name).toBe('烬海纪元')
    expect(data.nodes as unknown[]).toHaveLength(12)
    expect(data.edges as unknown[]).toHaveLength(14)
    expect(data.types as unknown[]).toHaveLength(13)
  })
})

/** LG-012 导入世界（导入前必须先在预览中确认，含非法文件的可读提示）。 */
test.describe('LG-012 导入', () => {
  test('导出的 JSON 再导入为新世界，节点数一致且数据隔离', async ({ page }, testInfo) => {
    await openUniverse(page, '烬海纪元')
    const { file } = await exportFirstUniverse(page, testInfo)

    await page.getByTestId('import-json-input').setInputFiles(file)

    // 先看预览：文件类型、目标与数量，确认后才真正写入
    const dialog = page.getByTestId('import-preview-dialog')
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('import-preview-format')).toHaveText('完整世界')
    await expect(page.getByTestId('import-preview-target')).toContainText('新世界')
    await expect(page.getByTestId('import-preview-node-count')).toHaveText('12')
    await expect(page.getByTestId('import-preview-edge-count')).toHaveText('14')
    await expect(page.getByTestId('universe-card')).toHaveCount(1)

    await confirmImportPreview(page)
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
    await expect(page.getByTestId('import-preview-dialog')).toBeVisible()
    const issues = page.getByTestId('import-preview-errors')
    await expect(issues).toBeVisible()
    await expect(issues).toContainText('nodes.0.type')
    await expect(issues).toContainText('未定义')
    await expect(issues.locator('li')).not.toHaveCount(0)
    // 校验失败时禁用确认，且不会新增世界
    await expect(page.getByTestId('import-preview-confirm-btn')).toBeDisabled()
    await expect(page.getByTestId('universe-card')).toHaveCount(1)
    await page.getByTestId('import-preview-cancel-btn').click()
    await expect(page.getByTestId('import-preview-dialog')).toBeHidden()
  })

  test('无法解析的 JSON 展示解析失败原因', async ({ page }, testInfo) => {
    const broken = testInfo.outputPath('broken-syntax.json')
    await mkdir(dirname(broken), { recursive: true })
    await writeFile(broken, '{ not valid json', 'utf8')

    await page.goto('/')
    await expect(page.getByTestId('universe-card')).toHaveCount(1)

    await page.getByTestId('import-json-input').setInputFiles(broken)
    await expect(page.getByTestId('import-preview-dialog')).toBeVisible()
    const issues = page.getByTestId('import-preview-errors')
    await expect(issues).toBeVisible()
    await expect(issues).toContainText('JSON 解析失败')
    await expect(page.getByTestId('import-preview-confirm-btn')).toBeDisabled()
    await expect(page.getByTestId('universe-card')).toHaveCount(1)
  })

  test('世界导出后删除，再导入为新世界可恢复节点、关系与描述', async ({ page }, testInfo) => {
    await page.goto('/')
    await expect(page.getByTestId('universe-card')).toHaveCount(1)

    const file = testInfo.outputPath('world.json')
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-universe-btn').first().click(),
    ])
    const data = await readDownloadJson(download, file)
    expect(data.format).toBe('loregraph.universe')
    const exported = data.universe as { name: string; description: string }
    const exportedNodes = data.nodes as unknown[]
    const exportedEdges = data.edges as unknown[]

    // 删掉原世界，避免导入时靠已有数据「蒙混过关」
    await page.getByTestId('delete-universe-btn').first().click()
    await page.getByTestId('confirm-delete-btn').click()
    await expect(page.getByTestId('universe-card')).toHaveCount(0)

    await page.getByTestId('import-json-input').setInputFiles(file)
    await expect(page.getByTestId('import-preview-dialog')).toBeVisible()
    await confirmImportPreview(page)

    const card = page.getByTestId('universe-card')
    await expect(card).toHaveCount(1)
    await expect(card).toContainText(`${exported.name}（导入）`)
    await expect(card).toContainText(`${exportedNodes.length} 节点`)
    await expect(card).toContainText(`${exportedEdges.length} 关系`)
    // 世界描述随文件一起恢复
    await expect(card).toContainText(exported.description)

    await card.getByRole('link', { name: '打开' }).click()
    await expect(page.getByTestId('lore-node')).toHaveCount(exportedNodes.length)
    await expect(page.locator('.vue-flow__edge')).toHaveCount(exportedEdges.length)
    await expect(page.getByTestId('inspector-empty')).toContainText(exported.description)
  })
})

/** 图谱片段：导出、合并导入与「更多」菜单入口。 */
test.describe('图谱片段导出与导入', () => {
  test('导出对话框选 2 个相关节点，文件只含内部关系', async ({ page }, testInfo) => {
    await openUniverse(page, '烬海纪元')
    await expect(page.getByTestId('lore-node')).toHaveCount(12)

    await openGraphMoreMenu(page)
    await page.getByTestId('export-graph-btn').click()
    await expect(page.getByTestId('graph-export-dialog')).toBeVisible()

    const search = page.getByTestId('graph-export-search-input')
    await search.fill('澜舟')
    await page
      .getByTestId('graph-export-node-item')
      .filter({ hasText: '澜舟' })
      .getByTestId('graph-export-node-checkbox')
      .check()
    await search.fill('潮汐教团')
    await page
      .getByTestId('graph-export-node-item')
      .filter({ hasText: '潮汐教团' })
      .getByTestId('graph-export-node-checkbox')
      .check()
    await search.fill('')

    // 两个节点之间 1 条关系；另有 5 条关系因另一端未选中而不导出
    await expect(page.getByTestId('graph-export-summary')).toContainText(
      '将导出 2 个节点、1 条关系',
    )
    await expect(page.getByTestId('graph-export-omitted')).toContainText('5 条关系因另一端未选中')

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('graph-export-confirm-btn').click(),
    ])
    expect(download.suggestedFilename()).toContain('烬海纪元-图谱片段')
    const data = await readDownloadJson(download, testInfo.outputPath('fragment.json'))

    expect(data.format).toBe('loregraph.graph')
    expect(data.nodes as unknown[]).toHaveLength(2)
    expect(data.edges as unknown[]).toHaveLength(1)
    await expect(page.getByTestId('graph-export-dialog')).toBeHidden()
  })

  test('图谱片段合并导入当前世界后节点与关系增加', async ({ page }, testInfo) => {
    await openUniverse(page, '烬海纪元')
    await expect(page.getByTestId('lore-node')).toHaveCount(12)
    await expect(page.locator('.vue-flow__edge')).toHaveCount(14)

    const { file } = await exportGraphFragment(page, testInfo.outputPath('fragment.json'), [
      '澜舟',
      '潮汐教团',
    ])

    await importGraphFragment(page, file)
    await expect(page.getByTestId('import-preview-format')).toHaveText('图谱片段')
    await expect(page.getByTestId('import-preview-target')).toContainText('烬海纪元')
    await expect(page.getByTestId('import-preview-node-count')).toHaveText('2')
    // 同名节点不会自动合并，预览里明确列出
    await expect(page.getByTestId('import-preview-duplicate-names')).toContainText('澜舟')

    await confirmImportPreview(page)
    await expect(page.getByTestId('lore-node')).toHaveCount(14)
    await expect(page.locator('.vue-flow__edge')).toHaveCount(15)
  })

  test('世界概览导入图谱片段时只能合并到当前世界', async ({ page }, testInfo) => {
    await openUniverse(page, '烬海纪元')
    const { file } = await exportGraphFragment(page, testInfo.outputPath('fragment.json'), [
      '澜舟',
      '潮汐教团',
    ])

    await importWorldViaInspector(page, file)
    // 图谱片段只能合并：自动选中合并并禁用新建世界
    await expect(page.getByTestId('import-mode-merge')).toBeChecked()
    await expect(page.getByTestId('import-mode-new')).toBeDisabled()
    await expect(page.getByTestId('import-preview-target')).toContainText('合并到「烬海纪元」')
    await expect(page.getByTestId('import-mode-graph-hint')).toContainText(
      '图谱片段只能合并到已有世界',
    )

    await confirmImportPreview(page)
    await expect(page.getByTestId('lore-node')).toHaveCount(14)
  })

  test('世界概览导入完整世界默认为新建世界，可切换为合并到当前世界', async ({ page }, testInfo) => {
    await openUniverse(page, '烬海纪元')

    const worldFile = testInfo.outputPath('world.json')
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-world-btn').click(),
    ])
    const data = await readDownloadJson(download, worldFile)
    expect(data.format).toBe('loregraph.universe')

    await importWorldViaInspector(page, worldFile)
    await expect(page.getByTestId('import-preview-format')).toHaveText('完整世界')
    await expect(page.getByTestId('import-mode-new')).toBeChecked()
    await expect(page.getByTestId('import-mode-new')).toBeEnabled()
    await expect(page.getByTestId('import-preview-target')).toContainText('新世界')

    // 切换方式会重新分析：目标与重名节点提示随之变化
    await page.getByTestId('import-mode-merge').check()
    await expect(page.getByTestId('import-preview-target')).toContainText('合并到「烬海纪元」')
    await expect(page.getByTestId('import-preview-duplicate-names')).toContainText('澜舟')

    await page.getByTestId('import-mode-new').check()
    await expect(page.getByTestId('import-preview-target')).toContainText('新世界')

    await page.getByTestId('import-preview-cancel-btn').click()
    await expect(page.getByTestId('import-preview-dialog')).toBeHidden()
    // 取消不写入任何数据
    await expect(page.getByTestId('lore-node')).toHaveCount(12)
  })
})
