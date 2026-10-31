import { LoreExportSchema, type LoreExport } from '@/models/export-format'
import { newId } from '@/models/ids'
import { LoreEdgeSchema } from '@/models/edge'
import { LoreNodeSchema } from '@/models/node'
import { EntityTypeSchema } from '@/models/type-def'
import { UniverseSchema, type Universe } from '@/models/universe'
import type { Repositories } from '@/repositories/types'
import { LoreGraphError } from './errors'
import type { ImportService, ParseResult } from './types'

const IMPORT_SUFFIX = '（导入）'
const MAX_NAME_LENGTH = 120

function formatPath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? '根' : path.map((part) => String(part)).join('.')
}

/** 导入世界名称统一追加「（导入）」，并保证不超出长度上限。 */
function buildImportedName(name: string): string {
  const base = name.slice(0, MAX_NAME_LENGTH - IMPORT_SUFFIX.length)
  return `${base}${IMPORT_SUFFIX}`
}

/** 导入服务实现：parse 做结构与引用完整性校验，import 总是新建世界并重映射 id。 */
export class ImportServiceImpl implements ImportService {
  constructor(private readonly repos: Repositories) {}

  parse(raw: string): ParseResult {
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return { ok: false, issues: [`JSON 解析失败：${detail}`] }
    }
    const result = LoreExportSchema.safeParse(value)
    if (!result.success) {
      return {
        ok: false,
        issues: result.error.issues.map((issue) => `${formatPath(issue.path)}：${issue.message}`),
      }
    }
    return this.checkReferences(result.data)
  }

  async import(data: LoreExport): Promise<Universe> {
    const source = LoreExportSchema.parse(data)
    const universeId = newId()
    const nodeIdMap = new Map<string, string>()

    const types = source.types.map((type) =>
      EntityTypeSchema.parse({ ...type, id: newId(), universeId }),
    )
    const nodes = source.nodes.map((node) => {
      const id = newId()
      nodeIdMap.set(node.id, id)
      return LoreNodeSchema.parse({ ...node, id, universeId })
    })
    const edges = source.edges.map((edge) => {
      const sourceId = nodeIdMap.get(edge.source)
      const targetId = nodeIdMap.get(edge.target)
      if (!sourceId || !targetId) {
        throw new LoreGraphError('关系端点无法映射到导入后的节点')
      }
      return LoreEdgeSchema.parse({
        ...edge,
        id: newId(),
        universeId,
        source: sourceId,
        target: targetId,
      })
    })
    const universe = UniverseSchema.parse({
      ...source.universe,
      id: universeId,
      name: buildImportedName(source.universe.name),
    })

    await this.repos.tx.run(['universes', 'entityTypes', 'nodes', 'edges'], async () => {
      await this.repos.universes.create(universe)
      await this.repos.types.bulkPut(types)
      await this.repos.nodes.bulkPut(nodes)
      await this.repos.edges.bulkPut(edges)
    })
    return universe
  }

  /** 校验引用完整性与 id/key 唯一性，问题信息带字段路径。 */
  private checkReferences(data: LoreExport): ParseResult {
    const issues: string[] = []
    const universeId = data.universe.id

    const seenIds = new Set<string>()
    const checkId = (id: string, path: string): void => {
      if (seenIds.has(id)) {
        issues.push(`${path}：id「${id}」重复`)
        return
      }
      seenIds.add(id)
    }

    checkId(data.universe.id, 'universe.id')
    data.types.forEach((type, index) => {
      checkId(type.id, `types.${index}.id`)
      if (type.universeId !== universeId) {
        issues.push(`types.${index}.universeId：与世界 id 不一致`)
      }
    })
    data.nodes.forEach((node, index) => {
      checkId(node.id, `nodes.${index}.id`)
      if (node.universeId !== universeId) {
        issues.push(`nodes.${index}.universeId：与世界 id 不一致`)
      }
    })
    data.edges.forEach((edge, index) => {
      checkId(edge.id, `edges.${index}.id`)
      if (edge.universeId !== universeId) {
        issues.push(`edges.${index}.universeId：与世界 id 不一致`)
      }
    })

    const nodeTypeKeys = new Set<string>()
    const relationTypeKeys = new Set<string>()
    data.types.forEach((type, index) => {
      const bucket = type.scope === 'node' ? nodeTypeKeys : relationTypeKeys
      if (bucket.has(type.key)) {
        issues.push(`types.${index}.key：${type.scope} 类型 key「${type.key}」重复`)
        return
      }
      bucket.add(type.key)
    })

    const nodeIds = new Set(data.nodes.map((node) => node.id))
    data.nodes.forEach((node, index) => {
      if (!nodeTypeKeys.has(node.type)) {
        issues.push(`nodes.${index}.type：节点类型「${node.type}」未定义`)
      }
    })
    data.edges.forEach((edge, index) => {
      if (!nodeIds.has(edge.source)) {
        issues.push(`edges.${index}.source：端点节点「${edge.source}」不存在`)
      }
      if (!nodeIds.has(edge.target)) {
        issues.push(`edges.${index}.target：端点节点「${edge.target}」不存在`)
      }
      if (!relationTypeKeys.has(edge.relationType)) {
        issues.push(`edges.${index}.relationType：关系类型「${edge.relationType}」未定义`)
      }
    })

    if (issues.length > 0) {
      return { ok: false, issues }
    }
    return { ok: true, data }
  }
}
