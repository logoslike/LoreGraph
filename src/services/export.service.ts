import {
  LORE_FORMAT_VERSION,
  LORE_GRAPH_FORMAT,
  LORE_UNIVERSE_FORMAT,
  LoreGraphFileSchema,
  LoreUniverseFileSchema,
  type LoreImportFile,
  type LoreUniverseFile,
} from '@/models/export-format'
import { now } from '@/models/ids'
import type { LoreEdge } from '@/models/edge'
import type { Repositories } from '@/repositories/types'
import { LoreGraphError } from './errors'
import type { ExportService, GraphExport } from './types'
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

/** 默认导出文件名：世界名或「图谱片段」加上日期与 .loregraph.json 后缀。 */
export function defaultExportFilename(data: LoreImportFile): string {
  const stem =
    data.format === LORE_UNIVERSE_FORMAT ? sanitizeFilenamePart(data.universe.name) : '图谱片段'
  return `${stem}-${formatDate(new Date())}.loregraph.json`
}

/** 加入与给定节点直接相邻的节点 id，只扩展一层，不递归。 */
export function expandWithNeighbors(
  edges: readonly LoreEdge[],
  nodeIds: Iterable<string>,
): Set<string> {
  const seeds = new Set(nodeIds)
  const expanded = new Set(seeds)
  for (const edge of edges) {
    if (seeds.has(edge.source)) {
      expanded.add(edge.target)
    }
    if (seeds.has(edge.target)) {
      expanded.add(edge.source)
    }
  }
  return expanded
}

/** 导出服务实现。 */
export class ExportServiceImpl implements ExportService {
  constructor(private readonly repos: Repositories) {}

  async exportUniverse(universeId: string): Promise<LoreUniverseFile> {
    const universe = await this.repos.universes.getById(universeId)
    if (!universe) {
      throw new LoreGraphError('世界不存在或已被删除')
    }
    const [types, nodes, edges] = await Promise.all([
      this.repos.types.getByUniverse(universeId),
      this.repos.nodes.getByUniverse(universeId),
      this.repos.edges.getByUniverse(universeId),
    ])
    return LoreUniverseFileSchema.parse({
      format: LORE_UNIVERSE_FORMAT,
      formatVersion: LORE_FORMAT_VERSION,
      exportedAt: now(),
      universe,
      types: sortByCreatedAt(types),
      nodes: sortByCreatedAt(nodes),
      edges: sortByCreatedAt(edges),
    })
  }

  async exportGraph(universeId: string, nodeIds: readonly string[]): Promise<GraphExport> {
    const universe = await this.repos.universes.getById(universeId)
    if (!universe) {
      throw new LoreGraphError('世界不存在或已被删除')
    }
    const [types, nodes, edges] = await Promise.all([
      this.repos.types.getByUniverse(universeId),
      this.repos.nodes.getByUniverse(universeId),
      this.repos.edges.getByUniverse(universeId),
    ])
    const requested = new Set(nodeIds)
    const selectedNodes = sortByCreatedAt(nodes).filter((node) => requested.has(node.id))
    const selectedIds = new Set(selectedNodes.map((node) => node.id))
    const includedEdges = sortByCreatedAt(edges).filter(
      (edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target),
    )
    // 只统计「有一端在选中集合内、另一端在外」的关系；完全在集合外的关系不算丢弃。
    const omittedEdgeCount = edges.filter((edge) => {
      return selectedIds.has(edge.source) !== selectedIds.has(edge.target)
    }).length

    const nodeTypeKeys = new Set(selectedNodes.map((node) => node.type))
    const relationTypeKeys = new Set(includedEdges.map((edge) => edge.relationType))
    const usedTypes = sortByCreatedAt(types).filter((type) =>
      type.scope === 'node' ? nodeTypeKeys.has(type.key) : relationTypeKeys.has(type.key),
    )

    return {
      data: LoreGraphFileSchema.parse({
        format: LORE_GRAPH_FORMAT,
        formatVersion: LORE_FORMAT_VERSION,
        exportedAt: now(),
        types: usedTypes,
        nodes: selectedNodes,
        edges: includedEdges,
      }),
      omittedEdgeCount,
    }
  }

  download(data: LoreImportFile, filename?: string): void {
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename ?? defaultExportFilename(data)
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }
}
