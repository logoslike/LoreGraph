import {
  BUNDLED_WORLDS_DISABLED_KEY,
  importWorldSources,
  type BundledWorldSource,
  type BundledWorldsResult,
  type WorldLoaderDependencies,
} from './world-loader'

/**
 * 只匹配项目根目录 worlds 的第一层 JSON；不递归、不扫描其他 worlds 路径。
 * ?url 让 Vite 把 JSON 作为独立资产输出，?no-inline 避免小文件被内联成 data URL。
 */
const worldAssets = import.meta.glob('../../worlds/*.json', {
  query: '?url&no-inline',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** 按路径排序后的根级世界资产，便于稳定复现与测试。 */
export const BUNDLED_WORLD_SOURCES: readonly BundledWorldSource[] = Object.entries(worldAssets)
  .map(([path, url]) => ({ path, url }))
  .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))

/** 测试与本地调试开关：存在时关闭自动导入，避免工作区 worlds 污染固定计数用例。 */
export function bundledWorldsDisabled(): boolean {
  try {
    return (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(BUNDLED_WORLDS_DISABLED_KEY) === '1'
    )
  } catch {
    return false
  }
}

/** 自动导入根目录 worlds 下的世界；空 glob 时直接返回空结果。 */
export async function loadBundledWorlds(
  dependencies: WorldLoaderDependencies,
): Promise<BundledWorldsResult> {
  if (bundledWorldsDisabled()) {
    return { imported: [], skipped: 0, failures: [], warnings: [] }
  }
  return await importWorldSources(BUNDLED_WORLD_SOURCES, dependencies)
}
