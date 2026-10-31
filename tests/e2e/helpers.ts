import { expect, type Page } from '@playwright/test'

/** 首启标记：存在时跳过自动载入示例世界，获得完全空的世界列表。 */
const FIRST_RUN_KEY = 'loregraph.firstRunSeeded'
const DB_NAME = 'loregraph'

export interface StoredNode {
  id: string
  name: string
  type: string
  properties: Record<string, unknown>
  position: { x: number; y: number }
}

/** 在导航前声明「已首启」，避免每个用例都自动载入示例世界。 */
export async function useEmptyLibrary(page: Page): Promise<void> {
  await page.addInitScript((key: string) => {
    window.localStorage.setItem(key, '1')
  }, FIRST_RUN_KEY)
}

/** 打开世界列表页，并等待首屏（列表或空状态）出现。 */
export async function gotoUniverses(page: Page): Promise<void> {
  await page.goto('/')
  await expect(
    page.getByTestId('universe-list').or(page.getByTestId('new-universe-empty-btn')),
  ).toBeVisible()
}

/** 从世界列表页新建世界并进入其工作区。 */
export async function createUniverse(page: Page, name: string): Promise<void> {
  await gotoUniverses(page)
  await page.getByTestId('new-universe-btn').click()
  await page.getByTestId('universe-name-input').fill(name)
  await page.getByTestId('create-universe-btn').click()
  await expect(page.getByTestId('graph-canvas')).toBeVisible()
}

/** 进入指定世界的工作区（按卡片标题文本匹配）。 */
export async function openUniverse(page: Page, nameContains: string): Promise<void> {
  await gotoUniverses(page)
  const card = page.getByTestId('universe-card').filter({ hasText: nameContains })
  await expect(card).toBeVisible()
  await card.getByRole('link', { name: '打开' }).click()
  await expect(page.getByTestId('graph-canvas')).toBeVisible()
}

/** 返回世界列表页。 */
export async function backToUniverses(page: Page): Promise<void> {
  await page.getByRole('link', { name: '全部世界' }).click()
  await expect(
    page.getByTestId('universe-list').or(page.getByTestId('new-universe-empty-btn')),
  ).toBeVisible()
}

/** 通过画布工具栏新建节点（默认类型为第一个节点类型）。 */
export async function createNodeViaToolbar(
  page: Page,
  name: string,
  typeLabel?: string,
): Promise<void> {
  await page.getByTestId('create-node-btn').click()
  const nameInput = page.getByTestId('name-input')
  await expect(nameInput).toBeVisible()
  await nameInput.fill(name)
  if (typeLabel !== undefined) {
    await page.getByTestId('type-select').selectOption({ label: typeLabel })
  }
  await page.getByTestId('submit-node-btn').click()
  await expect(page.getByTestId('name-input')).toBeHidden()
  await expect(page.getByTestId('lore-node').filter({ hasText: name })).toBeVisible()
}

/** 用鼠标把画布节点拖到相对偏移处（Vue Flow 只在拖拽结束时回写位置）。 */
export async function dragNodeBy(page: Page, name: string, dx: number, dy: number): Promise<void> {
  const node = page.getByTestId('lore-node').filter({ hasText: name })
  const box = await node.boundingBox()
  if (box === null) {
    throw new Error(`画布上找不到节点「${name}」`)
  }
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + dx, startY + dy, { steps: 12 })
  await page.mouse.up()
}

/**
 * 等待画布视口动画结束：连续多帧 transform 不再变化，再用节点坐标做鼠标操作。
 * 用 requestAnimationFrame 轮询，不引入固定 sleep。
 */
export async function waitForViewportIdle(page: Page): Promise<void> {
  const pane = page.locator('.vue-flow__transformationpane')
  await expect(pane).toBeVisible()
  await pane.evaluate((element) => {
    return new Promise<void>((resolve) => {
      let previous = element.getAttribute('style') ?? ''
      let stableFrames = 0
      const tick = (): void => {
        const current = element.getAttribute('style') ?? ''
        stableFrames = current === previous ? stableFrames + 1 : 0
        previous = current
        if (stableFrames >= 4) {
          resolve()
          return
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  })
}

/**
 * 新建两个节点并拉开距离，再适应视图，确保两端都完整落在画布可视区
 * （避免节点被侧边栏 / 检查器遮挡导致 hover 被拦截）。
 */
export async function createTwoSeparatedNodes(
  page: Page,
  firstName: string,
  secondName: string,
): Promise<void> {
  await createNodeViaToolbar(page, firstName)
  await dragNodeBy(page, firstName, -140, -90)
  await createNodeViaToolbar(page, secondName)
  await dragNodeBy(page, secondName, 140, 90)
  await page.getByTestId('fit-view-btn').click()
  await waitForViewportIdle(page)
}

/** 从源节点右侧连接点拖到目标节点左侧连接点，等待关系对话框弹出。 */
export async function connectNodes(
  page: Page,
  sourceName: string,
  targetName: string,
): Promise<void> {
  const source = page.getByTestId('lore-node').filter({ hasText: sourceName })
  const target = page.getByTestId('lore-node').filter({ hasText: targetName })
  const sourceHandle = source.locator('.vue-flow__handle[data-handleid="right"]')
  const targetHandle = target.locator('.vue-flow__handle[data-handleid="left"]')

  await source.scrollIntoViewIfNeeded()
  await expect(sourceHandle).toBeVisible()
  await source.hover()
  const sourceBox = await sourceHandle.boundingBox()
  const targetBox = await targetHandle.boundingBox()
  if (sourceBox === null || targetBox === null) {
    throw new Error('找不到节点连接点，无法完成拖拽连线')
  }

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 16,
  })
  await page.mouse.up()
  await expect(page.getByTestId('relation-type-select')).toBeVisible()
}

/** 在 Inspector 的属性区新增一条自定义属性。 */
export async function addProperty(page: Page, key: string, value: string): Promise<void> {
  await page.getByTestId('add-property-btn').click()
  await page.getByTestId('property-key-input').last().fill(key)
  await page.getByTestId('property-value-input').last().fill(value)
}

/** 读取 Vue Flow 视口的 transform 样式串，用于断言视图发生位移/缩放。 */
export async function readViewportTransform(page: Page): Promise<string> {
  return await page
    .locator('.vue-flow__transformationpane')
    .evaluate((element) => element.getAttribute('style') ?? '')
}

/** 从 IndexedDB 读取指定名称的节点。 */
export async function findStoredNode(page: Page, name: string): Promise<StoredNode | undefined> {
  const nodes = await readTable<StoredNode>(page, 'nodes')
  return nodes.find((node) => node.name === name)
}

/** 轮询 IndexedDB，等待指定节点的坐标落库并返回该坐标。 */
export async function waitForStoredNodePosition(
  page: Page,
  name: string,
): Promise<{ x: number; y: number }> {
  let position: { x: number; y: number } | null = null
  await expect
    .poll(
      async () => {
        const node = await findStoredNode(page, name)
        position = node?.position ?? null
        return position
      },
      { timeout: 15_000, message: `等待节点「${name}」坐标写入 IndexedDB 超时` },
    )
    .not.toBeNull()
  if (position === null) {
    throw new Error(`节点「${name}」没有写入 IndexedDB`)
  }
  return position
}

/** 读取 IndexedDB 中某张表（应用使用 Dexie，库名 loregraph）。 */
export async function readTable<T>(
  page: Page,
  table: 'nodes' | 'edges' | 'universes' | 'entityTypes',
): Promise<T[]> {
  return (await page.evaluate(
    async ({ dbName, tableName }) => {
      return await new Promise<unknown[]>((resolve, reject) => {
        const request = indexedDB.open(dbName)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(tableName)) {
            db.close()
            resolve([])
            return
          }
          try {
            const tx = db.transaction(tableName, 'readonly')
            const query = tx.objectStore(tableName).getAll()
            query.onerror = () => {
              db.close()
              reject(query.error)
            }
            query.onsuccess = () => {
              db.close()
              resolve(query.result as unknown[])
            }
          } catch (error) {
            db.close()
            reject(error)
          }
        }
      })
    },
    { dbName: DB_NAME, tableName: table },
  )) as T[]
}

/** 轮询 IndexedDB，等待满足条件的节点真正落库（不依赖固定 sleep）。 */
export async function waitForPersistedNode(
  page: Page,
  predicate: (node: StoredNode) => boolean,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const nodes = await readTable<StoredNode>(page, 'nodes')
        return nodes.filter(predicate).map((node) => node.name)
      },
      { timeout: 15_000, message: '等待节点写入 IndexedDB 超时' },
    )
    .not.toHaveLength(0)
}
