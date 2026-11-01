import type { Universe } from '@/models/universe'
import type { EntityScope, EntityType } from '@/models/type-def'
import type { LoreNode, NodePosition } from '@/models/node'
import type { LoreEdge } from '@/models/edge'
import type {
  LoreFileFormat,
  LoreGraphFile,
  LoreImportFile,
  LoreUniverseFile,
} from '@/models/export-format'

/** 自定义属性值。 */
export type PropertyValue = string | number | boolean | null

export interface UniverseCreateInput {
  name: string
  description?: string
}

export interface UniversePatch {
  name?: string
  description?: string
}

/** 世界服务：世界的增删改查，删除时级联清理其下全部数据。 */
export interface UniverseService {
  list(): Promise<Universe[]>
  get(id: string): Promise<Universe | null>
  create(input: UniverseCreateInput): Promise<Universe>
  update(id: string, patch: UniversePatch): Promise<Universe>
  remove(id: string): Promise<void>
  /** 加载内置示例世界（public/examples/emberfall.json）并作为新世界导入。 */
  seedSample(): Promise<Universe>
}

export interface NodeCreateInput {
  universeId: string
  type: string
  name: string
  description?: string
  properties?: Record<string, PropertyValue>
  position: NodePosition
}

export interface NodePatch {
  type?: string
  name?: string
  description?: string
  properties?: Record<string, PropertyValue>
  position?: NodePosition
}

export interface EdgeCreateInput {
  universeId: string
  source: string
  target: string
  relationType: string
  label?: string
  properties?: Record<string, PropertyValue>
}

export interface EdgePatch {
  relationType?: string
  label?: string
  properties?: Record<string, PropertyValue>
}

/** 删除节点后用于撤销的完整快照。 */
export interface DeleteNodeSnapshot {
  node: LoreNode
  edges: LoreEdge[]
}

/** 图谱服务：节点与关系的增删改查。 */
export interface GraphService {
  listNodes(universeId: string): Promise<LoreNode[]>
  listEdges(universeId: string): Promise<LoreEdge[]>
  createNode(input: NodeCreateInput): Promise<LoreNode>
  updateNode(id: string, patch: NodePatch): Promise<LoreNode>
  moveNode(id: string, position: NodePosition): Promise<LoreNode>
  /** 批量更新同一世界下多个节点的坐标，在单个事务内写入（自动布局、布局恢复用）。 */
  updateNodePositions(
    universeId: string,
    positions: Record<string, NodePosition>,
  ): Promise<LoreNode[]>
  deleteNode(id: string): Promise<DeleteNodeSnapshot>
  restoreNode(snapshot: DeleteNodeSnapshot): Promise<void>
  createEdge(input: EdgeCreateInput): Promise<LoreEdge>
  updateEdge(id: string, patch: EdgePatch): Promise<LoreEdge>
  deleteEdge(id: string): Promise<LoreEdge>
  restoreEdge(edge: LoreEdge): Promise<void>
}

export interface TypeCreateInput {
  universeId: string
  scope: EntityScope
  key: string
  label: string
  color: string
  icon?: string
  order?: number
}

export interface TypePatch {
  label?: string
  color?: string
  icon?: string
  order?: number
}

/** 类型服务：节点/关系类型定义。 */
export interface TypeService {
  list(universeId: string, scope?: EntityScope): Promise<EntityType[]>
  create(input: TypeCreateInput): Promise<EntityType>
  update(id: string, patch: TypePatch): Promise<EntityType>
  remove(id: string): Promise<void>
}

/** 导入模式：新建世界，或合并进已有世界。 */
export type ImportMode = 'new-universe' | 'merge'

export interface ImportOptions {
  mode: ImportMode
  /** merge 模式的目标世界 id。 */
  targetUniverseId?: string
}

/** 预览中的类型摘要。 */
export interface ImportTypeSummary {
  scope: EntityScope
  key: string
  label: string
  color: string
}

/** 类型冲突：同 scope+key 但名称或颜色不同，提交时以现有类型为准。 */
export interface ImportTypeConflict {
  scope: EntityScope
  key: string
  incoming: { label: string; color: string }
  existing: { label: string; color: string }
}

/** 分析阶段确定的提交计划，供 commitImport 使用；有错误时为 null。 */
export interface ImportPlan {
  file: LoreImportFile
  mode: ImportMode
  targetUniverseId: string | null
  /** merge 时目标世界的状态指纹，提交前用于检测世界是否已变化。 */
  targetFingerprint: string | null
  /** 源类型 id -> 复用的目标类型 id；未列出的类型需要新建。 */
  reusedTypeIds: Record<string, string>
}

/** 导入预览：analyzeImport 的只读结果，可用于展示与提交。 */
export interface ImportPreview {
  /** 文件格式无法识别时为 null。 */
  format: LoreFileFormat | null
  mode: ImportMode
  targetUniverseId: string | null
  /** 世界文件中的世界名；图谱片段为 null。 */
  universeName: string | null
  nodeCount: number
  edgeCount: number
  newTypes: ImportTypeSummary[]
  reusedTypes: ImportTypeSummary[]
  typeConflicts: ImportTypeConflict[]
  duplicateNodeNames: string[]
  warnings: string[]
  errors: string[]
  canImport: boolean
  plan: ImportPlan | null
}

/** 导入结果：写入的目标世界与各类写入数量。 */
export interface ImportResult {
  universeId: string
  universeName: string
  createdUniverse: boolean
  createdTypes: number
  reusedTypes: number
  createdNodes: number
  createdEdges: number
}

/** 导入服务：先只读分析并给出预览，再把计划一次性写入。 */
export interface ImportService {
  analyzeImport(raw: string, options: ImportOptions): Promise<ImportPreview>
  commitImport(preview: ImportPreview): Promise<ImportResult>
}

/** 图谱片段导出结果：omittedEdgeCount 是一端在选中集合外而被丢弃的关系数。 */
export interface GraphExport {
  data: LoreGraphFile
  omittedEdgeCount: number
}

/** 导出服务。 */
export interface ExportService {
  exportUniverse(universeId: string): Promise<LoreUniverseFile>
  exportGraph(universeId: string, nodeIds: readonly string[]): Promise<GraphExport>
  download(data: LoreImportFile, filename?: string): void
}

/** 防抖自动保存。 */
export interface Autosave {
  schedule(key: string, task: () => Promise<void>): void
  flushKey(key: string): Promise<void>
  flush(): Promise<void>
}

/** 服务集合。 */
export interface Services {
  universes: UniverseService
  graph: GraphService
  types: TypeService
  importer: ImportService
  exporter: ExportService
  autosave: Autosave
}
