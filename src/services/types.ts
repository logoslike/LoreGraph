import type { Universe } from '@/models/universe'
import type { EntityScope, EntityType } from '@/models/type-def'
import type { LoreNode, NodePosition } from '@/models/node'
import type { LoreEdge } from '@/models/edge'
import type { LoreExport } from '@/models/export-format'

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

/** 解析结果：成功时返回校验后的导出数据，失败时给出可读的问题列表。 */
export type ParseResult = { ok: true; data: LoreExport } | { ok: false; issues: string[] }

/** 导入服务：解析并校验导出文件，导入时总是新建世界。 */
export interface ImportService {
  parse(raw: string): ParseResult
  import(data: LoreExport): Promise<Universe>
}

/** 导出服务。 */
export interface ExportService {
  toExport(universeId: string): Promise<LoreExport>
  download(data: LoreExport, filename?: string): void
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
