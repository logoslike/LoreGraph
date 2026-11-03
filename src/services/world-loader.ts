import { LORE_UNIVERSE_FORMAT } from '@/models/export-format'
import type { ImportPreview, ImportService, UniverseService } from './types'

/** 记录已导入源世界的 localStorage 键；值为源 universe.id 的 JSON 数组。 */
export const BUNDLED_WORLDS_MARKER_KEY = 'loregraph.bundledWorlds.imported'
/** 测试与本地调试用的关闭开关；设置后跳过根目录 worlds 自动导入。 */
export const BUNDLED_WORLDS_DISABLED_KEY = 'loregraph.bundledWorlds.disabled'

/** 根目录 worlds 下的一个 JSON 资产。 */
export interface BundledWorldSource {
  path: string
  url: string
}

/** 自动导入成功的一个世界。 */
export interface ImportedBundledWorld {
  path: string
  sourceUniverseId: string
  universeId: string
  name: string
}

/** 单个文件的导入失败；只影响该文件，不阻塞同批其他文件。 */
export interface BundledWorldFailure {
  path: string
  message: string
}

/** 自动导入汇总。 */
export interface BundledWorldsResult {
  imported: ImportedBundledWorld[]
  skipped: number
  failures: BundledWorldFailure[]
  warnings: string[]
}

/** localStorage 的最小结构，便于单元测试注入。 */
export interface WorldLoaderStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 自动导入依赖：复用现有服务，不另建持久化路径。 */
export interface WorldLoaderDependencies {
  importer: Pick<ImportService, 'analyzeImport' | 'commitImport'>
  universes: Pick<UniverseService, 'update'>
  fetchText?: (url: string) => Promise<string>
  /** 传 null 可显式禁用存储；省略时读取全局 localStorage。 */
  storage?: WorldLoaderStorage | null
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 按 UTF-16 码点比较路径，避免不同浏览器 locale 改变重复 id 的胜出顺序。 */
function compareSourcePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function emptyResult(): BundledWorldsResult {
  return { imported: [], skipped: 0, failures: [], warnings: [] }
}

/** 隐私模式等场景下 localStorage 可能不可用，此时退化为仅本次运行内幂等。 */
function resolveStorage(): WorldLoaderStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function readImportedSourceIds(storage: WorldLoaderStorage | null): Set<string> {
  if (!storage) {
    return new Set()
  }
  try {
    const raw = storage.getItem(BUNDLED_WORLDS_MARKER_KEY)
    if (!raw) {
      return new Set()
    }
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) {
      return new Set()
    }
    return new Set(value.filter((item): item is string => typeof item === 'string'))
  } catch {
    return new Set()
  }
}

function writeImportedSourceIds(storage: WorldLoaderStorage | null, ids: Set<string>): void {
  if (!storage) {
    return
  }
  try {
    storage.setItem(BUNDLED_WORLDS_MARKER_KEY, JSON.stringify([...ids].sort()))
  } catch {
    // 存储不可用时只影响跨刷新幂等，不中断本次导入。
  }
}

/** 从原始 JSON 中轻量读取源世界 id；非法 JSON 留给 analyzeImport 给出完整错误。 */
function readRawSourceUniverseId(raw: string): string | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) {
      return null
    }
    const record = value as Record<string, unknown>
    if (record.format !== LORE_UNIVERSE_FORMAT) {
      return null
    }
    const universe = record.universe
    if (typeof universe !== 'object' || universe === null) {
      return null
    }
    const id = (universe as Record<string, unknown>).id
    return typeof id === 'string' && id.length > 0 ? id : null
  } catch {
    return null
  }
}

function sourceUniverseIdFromPreview(preview: ImportPreview): string | null {
  const file = preview.plan?.file
  if (!file || file.format !== LORE_UNIVERSE_FORMAT) {
    return null
  }
  return file.universe.id
}

async function fetchWorldText(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`世界文件加载失败（HTTP ${response.status}）`)
  }
  return await response.text()
}

/**
 * 逐个导入根目录 worlds 下的世界文件。
 *
 * - 按路径排序，结果稳定；
 * - 每个文件独立捕获错误，单文件失败不影响其余文件；
 * - 只在 commitImport 成功后写入源 universe.id 标记，失败不会留下标记；
 * - 同一源 universe.id（含重复文件）只处理一次，已删除的世界不会被标记复活。
 */
export async function importWorldSources(
  sources: readonly BundledWorldSource[],
  dependencies: WorldLoaderDependencies,
): Promise<BundledWorldsResult> {
  const result = emptyResult()
  const storage = dependencies.storage === undefined ? resolveStorage() : dependencies.storage
  const importedSourceIds = readImportedSourceIds(storage)
  const fetchText = dependencies.fetchText ?? fetchWorldText
  const sortedSources = [...sources].sort((left, right) =>
    compareSourcePaths(left.path, right.path),
  )

  for (const source of sortedSources) {
    try {
      const raw = await fetchText(source.url)
      const rawSourceUniverseId = readRawSourceUniverseId(raw)
      if (rawSourceUniverseId !== null && importedSourceIds.has(rawSourceUniverseId)) {
        result.skipped += 1
        continue
      }

      const preview = await dependencies.importer.analyzeImport(raw, { mode: 'new-universe' })
      if (!preview.canImport || !preview.plan) {
        result.failures.push({
          path: source.path,
          message: preview.errors.join('；') || '世界文件未通过校验',
        })
        continue
      }

      const sourceUniverseId = rawSourceUniverseId ?? sourceUniverseIdFromPreview(preview)
      if (sourceUniverseId === null) {
        result.failures.push({ path: source.path, message: '只支持完整的世界文件' })
        continue
      }
      if (importedSourceIds.has(sourceUniverseId)) {
        result.skipped += 1
        continue
      }

      const imported = await dependencies.importer.commitImport(preview)
      importedSourceIds.add(sourceUniverseId)
      writeImportedSourceIds(storage, importedSourceIds)

      let name = imported.universeName
      if (preview.universeName !== null && preview.universeName !== imported.universeName) {
        try {
          // 与 seedSample 一致：自动导入不是用户主动导入，恢复源世界名。
          const updated = await dependencies.universes.update(imported.universeId, {
            name: preview.universeName,
          })
          name = updated.name
        } catch (error) {
          result.warnings.push(`${source.path} 已导入，但恢复源世界名失败：${formatError(error)}`)
        }
      }

      result.imported.push({
        path: source.path,
        sourceUniverseId,
        universeId: imported.universeId,
        name,
      })
    } catch (error) {
      result.failures.push({ path: source.path, message: formatError(error) })
    }
  }

  return result
}
