import { LoreEdgeSchema, type LoreEdge } from '@/models/edge'
import { newId, now } from '@/models/ids'
import { LoreNodeSchema, type LoreNode, type NodePosition } from '@/models/node'
import type { Repositories } from '@/repositories/types'
import { GraphError, LoreGraphError } from './errors'
import type {
  DeleteNodeSnapshot,
  EdgeCreateInput,
  EdgePatch,
  GraphService,
  NodeCreateInput,
  NodePatch,
} from './types'
import { pickDefined, sortByCreatedAt } from './utils'

/** 图谱服务实现：所有写操作都会做 Zod 校验，删除节点在事务内级联删除关联边。 */
export class GraphServiceImpl implements GraphService {
  constructor(private readonly repos: Repositories) {}

  async listNodes(universeId: string): Promise<LoreNode[]> {
    return sortByCreatedAt(await this.repos.nodes.getByUniverse(universeId))
  }

  async listEdges(universeId: string): Promise<LoreEdge[]> {
    return sortByCreatedAt(await this.repos.edges.getByUniverse(universeId))
  }

  async createNode(input: NodeCreateInput): Promise<LoreNode> {
    const timestamp = now()
    const node = LoreNodeSchema.parse({
      id: newId(),
      universeId: input.universeId,
      type: input.type,
      name: input.name,
      description: input.description,
      properties: input.properties,
      position: input.position,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    return await this.repos.nodes.create(node)
  }

  async updateNode(id: string, patch: NodePatch): Promise<LoreNode> {
    const existing = await this.repos.nodes.getById(id)
    if (!existing) {
      throw new LoreGraphError('节点不存在或已被删除')
    }
    const updated = LoreNodeSchema.parse({
      ...existing,
      ...pickDefined(patch),
      updatedAt: now(),
    })
    return await this.repos.nodes.update(updated)
  }

  async moveNode(id: string, position: NodePosition): Promise<LoreNode> {
    return await this.updateNode(id, { position })
  }

  /** 批量坐标写入：一次读取、一次事务、一次 bulkPut，避免自动布局触发 N 次落库。 */
  async updateNodePositions(
    universeId: string,
    positions: Record<string, NodePosition>,
  ): Promise<LoreNode[]> {
    const ids = Object.keys(positions)
    if (ids.length === 0) {
      return []
    }
    const existing = await this.repos.nodes.getByUniverse(universeId)
    const byId = new Map(existing.map((node) => [node.id, node]))
    const timestamp = now()
    const updated = ids.map((id) => {
      const node = byId.get(id)
      if (!node) {
        throw new LoreGraphError('节点不存在或已被删除')
      }
      return LoreNodeSchema.parse({
        ...node,
        position: positions[id],
        updatedAt: timestamp,
      })
    })
    await this.repos.tx.run(['nodes'], async () => {
      await this.repos.nodes.bulkPut(updated)
    })
    return updated
  }

  async deleteNode(id: string): Promise<DeleteNodeSnapshot> {
    const node = await this.repos.nodes.getById(id)
    if (!node) {
      throw new LoreGraphError('节点不存在或已被删除')
    }
    const edges = (await this.repos.edges.getByUniverse(node.universeId)).filter(
      (edge) => edge.source === id || edge.target === id,
    )
    await this.repos.tx.run(['nodes', 'edges'], async () => {
      for (const edge of edges) {
        await this.repos.edges.delete(edge.id)
      }
      await this.repos.nodes.delete(id)
    })
    return { node, edges }
  }

  async restoreNode(snapshot: DeleteNodeSnapshot): Promise<void> {
    const node = LoreNodeSchema.parse(snapshot.node)
    const edges = snapshot.edges.map((edge) => LoreEdgeSchema.parse(edge))
    await this.repos.tx.run(['nodes', 'edges'], async () => {
      await this.repos.nodes.bulkPut([node])
      await this.repos.edges.bulkPut(edges)
    })
  }

  async createEdge(input: EdgeCreateInput): Promise<LoreEdge> {
    if (input.source === input.target) {
      throw new GraphError('不允许创建自连关系')
    }
    const [sourceNode, targetNode] = await Promise.all([
      this.repos.nodes.getById(input.source),
      this.repos.nodes.getById(input.target),
    ])
    if (!sourceNode || !targetNode) {
      throw new GraphError('关系两端的节点必须存在')
    }
    const siblings = await this.repos.edges.getByUniverse(input.universeId)
    const duplicated = siblings.some(
      (edge) =>
        edge.source === input.source &&
        edge.target === input.target &&
        edge.relationType === input.relationType,
    )
    if (duplicated) {
      throw new GraphError('已存在同源、同目标、同关系类型的重复关系')
    }
    const timestamp = now()
    const edge = LoreEdgeSchema.parse({
      id: newId(),
      universeId: input.universeId,
      source: input.source,
      target: input.target,
      relationType: input.relationType,
      label: input.label,
      properties: input.properties,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    return await this.repos.edges.create(edge)
  }

  async updateEdge(id: string, patch: EdgePatch): Promise<LoreEdge> {
    const existing = await this.repos.edges.getById(id)
    if (!existing) {
      throw new LoreGraphError('关系不存在或已被删除')
    }
    const updated = LoreEdgeSchema.parse({
      ...existing,
      ...pickDefined(patch),
      updatedAt: now(),
    })
    return await this.repos.edges.update(updated)
  }

  async deleteEdge(id: string): Promise<LoreEdge> {
    const edge = await this.repos.edges.getById(id)
    if (!edge) {
      throw new LoreGraphError('关系不存在或已被删除')
    }
    await this.repos.edges.delete(id)
    return edge
  }

  async restoreEdge(edge: LoreEdge): Promise<void> {
    const parsed = LoreEdgeSchema.parse(edge)
    await this.repos.edges.bulkPut([parsed])
  }
}
