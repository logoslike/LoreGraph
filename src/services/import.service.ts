import {
  LORE_FORMAT_VERSION,
  LORE_GRAPH_FORMAT,
  LORE_UNIVERSE_FORMAT,
  LoreGraphFileSchema,
  LoreUniverseFileSchema,
  type LoreFileFormat,
  type LoreImportFile,
  type LoreUniverseFile,
} from '@/models/export-format'
import { newId } from '@/models/ids'
import { LoreEdgeSchema, type LoreEdge } from '@/models/edge'
import { LoreNodeSchema, type LoreNode } from '@/models/node'
import { EntityTypeSchema, type EntityScope, type EntityType } from '@/models/type-def'
import { UniverseSchema, UNIVERSE_NAME_MAX_LENGTH, type Universe } from '@/models/universe'
import type { Repositories } from '@/repositories/types'
import { LoreGraphError } from './errors'
import type {
  ImportOptions,
  ImportPlan,
  ImportPreview,
  ImportResult,
  ImportService,
  ImportTypeConflict,
  ImportTypeSummary,
} from './types'

const IMPORT_SUFFIX = '（导入）'
const SUPPORTED_FORMATS: readonly LoreFileFormat[] = [LORE_UNIVERSE_FORMAT, LORE_GRAPH_FORMAT]

function formatPath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? '根' : path.map((part) => String(part)).join('.')
}

/** 导入世界名称统一追加「（导入）」，并保证不超出长度上限。 */
function buildImportedName(name: string): string {
  const base = name.slice(0, UNIVERSE_NAME_MAX_LENGTH - IMPORT_SUFFIX.length)
  return `${base}${IMPORT_SUFFIX}`
}

function unsupportedFormatMessage(value: unknown): string {
  if (value === undefined) {
    return '不支持的文件格式：缺少 format 字段'
  }
  if (typeof value === 'string') {
    return `不支持的文件格式：${value}`
  }
  return `不支持的文件格式：${JSON.stringify(value) ?? String(value)}`
}

function unsupportedVersionMessage(value: unknown): string {
  const version = value === undefined ? '缺少 formatVersion 字段' : String(value)
  return `不支持的格式版本：${version}，当前支持 ${LORE_FORMAT_VERSION}`
}

/** 解析原始 JSON 并识别文件格式与版本，格式问题给出明确中文提示。 */
function parseFile(
  raw: string,
): { file: LoreImportFile } | { issues: string[]; format: LoreFileFormat | null } {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { issues: [`JSON 解析失败：${detail}`], format: null }
  }
  const record =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const declaredFormat = record.format
  const declaredVersion = record.formatVersion
  const issues: string[] = []
  if (!SUPPORTED_FORMATS.includes(declaredFormat as LoreFileFormat)) {
    issues.push(unsupportedFormatMessage(declaredFormat))
  }
  if (declaredVersion !== LORE_FORMAT_VERSION) {
    issues.push(unsupportedVersionMessage(declaredVersion))
  }
  const knownFormat = SUPPORTED_FORMATS.includes(declaredFormat as LoreFileFormat)
    ? (declaredFormat as LoreFileFormat)
    : null
  if (issues.length > 0) {
    return { issues, format: knownFormat }
  }
  const schema = knownFormat === LORE_UNIVERSE_FORMAT ? LoreUniverseFileSchema : LoreGraphFileSchema
  const result = schema.safeParse(value)
  if (!result.success) {
    return {
      issues: result.error.issues.map((issue) => `${formatPath(issue.path)}：${issue.message}`),
      format: knownFormat,
    }
  }
  return { file: result.data }
}

/** 校验 id 唯一性、类型 key 唯一性与引用完整性，一次给出全部问题。 */
function collectReferenceIssues(file: LoreImportFile): string[] {
  const issues: string[] = []
  const universeId = file.format === LORE_UNIVERSE_FORMAT ? file.universe.id : null

  const seenIds = new Set<string>()
  const checkId = (id: string, path: string): void => {
    if (seenIds.has(id)) {
      issues.push(`${path}：id「${id}」重复`)
      return
    }
    seenIds.add(id)
  }

  if (universeId !== null) {
    checkId(universeId, 'universe.id')
  }
  file.types.forEach((type, index) => {
    checkId(type.id, `types.${index}.id`)
    // 图谱片段可来自任意世界，只要求世界文件内部的 universeId 一致。
    if (universeId !== null && type.universeId !== universeId) {
      issues.push(`types.${index}.universeId：与世界 id 不一致`)
    }
  })
  file.nodes.forEach((node, index) => {
    checkId(node.id, `nodes.${index}.id`)
    if (universeId !== null && node.universeId !== universeId) {
      issues.push(`nodes.${index}.universeId：与世界 id 不一致`)
    }
  })
  file.edges.forEach((edge, index) => {
    checkId(edge.id, `edges.${index}.id`)
    if (universeId !== null && edge.universeId !== universeId) {
      issues.push(`edges.${index}.universeId：与世界 id 不一致`)
    }
  })

  const nodeTypeKeys = new Set<string>()
  const relationTypeKeys = new Set<string>()
  file.types.forEach((type, index) => {
    const bucket = type.scope === 'node' ? nodeTypeKeys : relationTypeKeys
    if (bucket.has(type.key)) {
      issues.push(`types.${index}.key：${type.scope} 类型 key「${type.key}」重复`)
      return
    }
    bucket.add(type.key)
  })

  const nodeIds = new Set(file.nodes.map((node) => node.id))
  file.nodes.forEach((node, index) => {
    if (!nodeTypeKeys.has(node.type)) {
      issues.push(`nodes.${index}.type：节点类型「${node.type}」未定义`)
    }
  })
  file.edges.forEach((edge, index) => {
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

  return issues
}

/** 自连与重复关系不拒绝导入，只在预览中提示。 */
function collectWarnings(file: LoreImportFile): string[] {
  const warnings: string[] = []
  const selfLoops = file.edges.filter((edge) => edge.source === edge.target).length
  if (selfLoops > 0) {
    warnings.push(`检测到 ${selfLoops} 条自连关系（起点与终点为同一节点），导入后将保留`)
  }
  const groups = new Map<string, number>()
  for (const edge of file.edges) {
    const key = `${edge.source}|${edge.target}|${edge.relationType}`
    groups.set(key, (groups.get(key) ?? 0) + 1)
  }
  const duplicateGroups = [...groups.values()].filter((count) => count > 1).length
  if (duplicateGroups > 0) {
    warnings.push(`检测到 ${duplicateGroups} 组重复关系（同起点、同终点、同类型），导入后将保留`)
  }
  return warnings
}

function summarizeType(type: EntityType): ImportTypeSummary {
  return { scope: type.scope, key: type.key, label: type.label, color: type.color }
}

/** 目标世界在分析时的状态指纹：世界记录与全部类型定义。 */
function fingerprintTarget(universe: Universe, types: readonly EntityType[]): string {
  const typeSignature = types
    .map(
      (type) =>
        `${type.id}:${type.scope}:${type.key}:${type.label}:${type.color}:${type.order}:${type.updatedAt}`,
    )
    .sort()
    .join('|')
  return `${universe.id}:${universe.updatedAt}@${typeSignature}`
}

function emptyPreview(
  options: ImportOptions,
  format: LoreFileFormat | null,
  errors: string[],
): ImportPreview {
  return {
    format,
    mode: options.mode,
    targetUniverseId: options.targetUniverseId ?? null,
    universeName: null,
    nodeCount: 0,
    edgeCount: 0,
    newTypes: [],
    reusedTypes: [],
    typeConflicts: [],
    duplicateNodeNames: [],
    warnings: [],
    errors,
    canImport: false,
    plan: null,
  }
}

/** 重新生成节点与关系：id 全部换新，universeId 重映射，关系端点同步指向新节点。 */
function buildNodesAndEdges(
  file: LoreImportFile,
  universeId: string,
): { nodes: LoreNode[]; edges: LoreEdge[] } {
  const nodeIdMap = new Map<string, string>()
  const nodes = file.nodes.map((node) => {
    const id = newId()
    nodeIdMap.set(node.id, id)
    return LoreNodeSchema.parse({ ...node, id, universeId })
  })
  const edges = file.edges.map((edge) => {
    const source = nodeIdMap.get(edge.source)
    const target = nodeIdMap.get(edge.target)
    if (!source || !target) {
      throw new LoreGraphError('关系端点无法映射到导入后的节点')
    }
    return LoreEdgeSchema.parse({ ...edge, id: newId(), universeId, source, target })
  })
  return { nodes, edges }
}

/** 导入服务实现：先只读分析（analyzeImport），再把计划一次事务写入（commitImport）。 */
export class ImportServiceImpl implements ImportService {
  constructor(private readonly repos: Repositories) {}

  async analyzeImport(raw: string, options: ImportOptions): Promise<ImportPreview> {
    const parsed = parseFile(raw)
    if ('issues' in parsed) {
      return emptyPreview(options, parsed.format, parsed.issues)
    }
    const file = parsed.file
    const format = file.format
    const errors = collectReferenceIssues(file)
    const warnings = collectWarnings(file)

    if (format === LORE_GRAPH_FORMAT && options.mode === 'new-universe') {
      errors.push('图谱片段只能合并到已有世界，请选择目标世界后再导入')
    }
    if (options.mode === 'merge' && !options.targetUniverseId) {
      errors.push('合并导入必须指定目标世界')
    }

    let target: Universe | null = null
    let targetTypes: EntityType[] = []
    if (options.mode === 'merge' && options.targetUniverseId) {
      target = await this.repos.universes.getById(options.targetUniverseId)
      if (target) {
        targetTypes = await this.repos.types.getByUniverse(target.id)
      } else {
        errors.push('目标世界不存在或已被删除')
      }
    }

    const newTypes: ImportTypeSummary[] = []
    const reusedTypes: ImportTypeSummary[] = []
    const typeConflicts: ImportTypeConflict[] = []
    const reusedTypeIds: Record<string, string> = {}

    if (options.mode === 'merge') {
      if (target) {
        const existingByKey = new Map(
          targetTypes.map((type) => [`${type.scope}:${type.key}`, type] as const),
        )
        for (const type of file.types) {
          const existing = existingByKey.get(`${type.scope}:${type.key}`)
          if (!existing) {
            newTypes.push(summarizeType(type))
            continue
          }
          reusedTypes.push(summarizeType(type))
          reusedTypeIds[type.id] = existing.id
          if (existing.label !== type.label || existing.color !== type.color) {
            typeConflicts.push({
              scope: type.scope,
              key: type.key,
              incoming: { label: type.label, color: type.color },
              existing: { label: existing.label, color: existing.color },
            })
          }
        }
      }
    } else {
      newTypes.push(...file.types.map(summarizeType))
    }

    const duplicateNodeNames: string[] = []
    if (options.mode === 'merge' && target) {
      const targetNodes = await this.repos.nodes.getByUniverse(target.id)
      const names = new Set(targetNodes.map((node) => node.name))
      for (const node of file.nodes) {
        if (names.has(node.name) && !duplicateNodeNames.includes(node.name)) {
          duplicateNodeNames.push(node.name)
        }
      }
    }

    const canImport = errors.length === 0
    const plan: ImportPlan | null = canImport
      ? {
          file,
          mode: options.mode,
          targetUniverseId: target?.id ?? null,
          targetFingerprint: target ? fingerprintTarget(target, targetTypes) : null,
          reusedTypeIds,
        }
      : null

    return {
      format,
      mode: options.mode,
      targetUniverseId: target?.id ?? null,
      universeName: format === LORE_UNIVERSE_FORMAT ? file.universe.name : null,
      nodeCount: file.nodes.length,
      edgeCount: file.edges.length,
      newTypes,
      reusedTypes,
      typeConflicts,
      duplicateNodeNames,
      warnings,
      errors,
      canImport,
      plan,
    }
  }

  async commitImport(preview: ImportPreview): Promise<ImportResult> {
    if (!preview.canImport || !preview.plan) {
      throw new LoreGraphError(preview.errors[0] ?? '导入文件未通过校验')
    }
    const plan = preview.plan
    const schema =
      plan.file.format === LORE_UNIVERSE_FORMAT ? LoreUniverseFileSchema : LoreGraphFileSchema
    const checked = schema.safeParse(plan.file)
    if (!checked.success) {
      throw new LoreGraphError('导入计划中的数据已损坏，请重新分析文件')
    }
    if (plan.mode === 'new-universe') {
      if (checked.data.format !== LORE_UNIVERSE_FORMAT) {
        throw new LoreGraphError('图谱片段只能合并到已有世界，请选择目标世界后再导入')
      }
      return await this.commitAsNewUniverse(checked.data)
    }
    if (!plan.targetUniverseId) {
      throw new LoreGraphError('合并导入必须指定目标世界')
    }
    return await this.commitAsMerge(checked.data, plan)
  }

  /** 新建世界导入：沿用「名称加（导入）」、全部 id 重映射的行为。 */
  private async commitAsNewUniverse(file: LoreUniverseFile): Promise<ImportResult> {
    const universeId = newId()
    const types = file.types.map((type) =>
      EntityTypeSchema.parse({ ...type, id: newId(), universeId }),
    )
    const { nodes, edges } = buildNodesAndEdges(file, universeId)
    const universe = UniverseSchema.parse({
      ...file.universe,
      id: universeId,
      name: buildImportedName(file.universe.name),
    })
    await this.repos.tx.run(['universes', 'entityTypes', 'nodes', 'edges'], async () => {
      await this.repos.universes.create(universe)
      await this.repos.types.bulkPut(types)
      await this.repos.nodes.bulkPut(nodes)
      await this.repos.edges.bulkPut(edges)
    })
    return {
      universeId,
      universeName: universe.name,
      createdUniverse: true,
      createdTypes: types.length,
      reusedTypes: 0,
      createdNodes: nodes.length,
      createdEdges: edges.length,
    }
  }

  /** 合并导入：类型按 scope+key 复用或新建，节点与关系全部换新 id，目标世界信息不变。 */
  private async commitAsMerge(file: LoreImportFile, plan: ImportPlan): Promise<ImportResult> {
    const targetUniverseId = plan.targetUniverseId
    if (!targetUniverseId) {
      throw new LoreGraphError('合并导入必须指定目标世界')
    }
    const { nodes, edges } = buildNodesAndEdges(file, targetUniverseId)
    let createdTypes = 0
    let reusedTypes = 0
    let universeName = ''

    await this.repos.tx.run(['universes', 'entityTypes', 'nodes', 'edges'], async () => {
      const universe = await this.repos.universes.getById(targetUniverseId)
      if (!universe) {
        throw new LoreGraphError('目标世界不存在或已被删除')
      }
      const existingTypes = await this.repos.types.getByUniverse(targetUniverseId)
      if (fingerprintTarget(universe, existingTypes) !== plan.targetFingerprint) {
        throw new LoreGraphError('目标世界在分析后已发生变化，请重新分析后再导入')
      }

      const nextOrder: Record<EntityScope, number> = { node: 0, relation: 0 }
      for (const type of existingTypes) {
        nextOrder[type.scope] = Math.max(nextOrder[type.scope], type.order + 1)
      }
      const typesToCreate: EntityType[] = []
      for (const type of file.types) {
        if (plan.reusedTypeIds[type.id] !== undefined) {
          reusedTypes += 1
          continue
        }
        typesToCreate.push(
          EntityTypeSchema.parse({
            ...type,
            id: newId(),
            universeId: targetUniverseId,
            order: nextOrder[type.scope],
          }),
        )
        nextOrder[type.scope] += 1
      }

      await this.repos.types.bulkPut(typesToCreate)
      await this.repos.nodes.bulkPut(nodes)
      await this.repos.edges.bulkPut(edges)
      createdTypes = typesToCreate.length
      universeName = universe.name
    })

    return {
      universeId: targetUniverseId,
      universeName,
      createdUniverse: false,
      createdTypes,
      reusedTypes,
      createdNodes: nodes.length,
      createdEdges: edges.length,
    }
  }
}
