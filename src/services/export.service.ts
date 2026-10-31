import {
  LORE_EXPORT_FORMAT,
  LORE_FORMAT_VERSION,
  LoreExportSchema,
  type LoreExport,
} from '@/models/export-format'
import { now } from '@/models/ids'
import type { Repositories } from '@/repositories/types'
import { LoreGraphError } from './errors'
import type { ExportService } from './types'
import { sortByCreatedAt } from './utils'

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 生成 YYYYMMDD 形式的本地日期。 */
function formatDate(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
}

/** 去掉文件名中的系统保留字符。 */
function sanitizeFilenamePart(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|]/g, '-').trim()
  return cleaned === '' ? '未命名世界' : cleaned
}

/** 默认导出文件名：世界名-YYYYMMDD.loregraph.json。 */
export function defaultExportFilename(universeName: string): string {
  return `${sanitizeFilenamePart(universeName)}-${formatDate(new Date())}.loregraph.json`
}

/** 导出服务实现。 */
export class ExportServiceImpl implements ExportService {
  constructor(private readonly repos: Repositories) {}

  async toExport(universeId: string): Promise<LoreExport> {
    const universe = await this.repos.universes.getById(universeId)
    if (!universe) {
      throw new LoreGraphError('世界不存在或已被删除')
    }
    const [types, nodes, edges] = await Promise.all([
      this.repos.types.getByUniverse(universeId),
      this.repos.nodes.getByUniverse(universeId),
      this.repos.edges.getByUniverse(universeId),
    ])
    return LoreExportSchema.parse({
      format: LORE_EXPORT_FORMAT,
      formatVersion: LORE_FORMAT_VERSION,
      exportedAt: now(),
      universe,
      types: sortByCreatedAt(types),
      nodes: sortByCreatedAt(nodes),
      edges: sortByCreatedAt(edges),
    })
  }

  download(data: LoreExport, filename?: string): void {
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename ?? defaultExportFilename(data.universe.name)
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }
}
