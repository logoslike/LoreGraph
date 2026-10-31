import { defineStore } from 'pinia'
import type { LoreEdge } from '@/models/edge'
import type { LoreNode, NodePosition } from '@/models/node'
import { services } from '@/services'
import { LoreGraphError } from '@/services/errors'
import type { EdgePatch, NodePatch } from '@/services/types'
import { pickDefined } from '@/services/utils'
import { useUiStore } from './ui'

export interface NodeDraft {
  name: string
  type: string
  description?: string
  position: NodePosition
}

export interface EdgeDraft {
  source: string
  target: string
  relationType: string
  label?: string
}

interface GraphState {
  universeId: string | null
  nodes: LoreNode[]
  edges: LoreEdge[]
  selectedNodeId: string | null
  selectedEdgeId: string | null
  loading: boolean
  error: string | null
}

/** 待合并的节点补丁：同一节点的连续修改合并后一次落库。 */
const pendingPatches = new Map<string, NodePatch>()
/** 首次修改前的节点快照，用于保存失败时回滚。 */
const rollbackNodes = new Map<string, LoreNode>()

function cloneNode(node: LoreNode): LoreNode {
  return {
    ...node,
    properties: { ...node.properties },
    position: { ...node.position },
  }
}

function applyNodePatch(node: LoreNode, patch: NodePatch): void {
  const defined = pickDefined(patch)
  if (defined.name !== undefined) node.name = defined.name
  if (defined.type !== undefined) node.type = defined.type
  if (defined.description !== undefined) node.description = defined.description
  if (defined.properties !== undefined) node.properties = { ...defined.properties }
  if (defined.position !== undefined) node.position = { ...defined.position }
  node.updatedAt = Date.now()
}

/** 当前世界的图谱数据与选中状态。 */
export const useGraphStore = defineStore('graph', {
  state: (): GraphState => ({
    universeId: null,
    nodes: [],
    edges: [],
    selectedNodeId: null,
    selectedEdgeId: null,
    loading: false,
    error: null,
  }),
  getters: {
    selectedNode(state): LoreNode | null {
      return state.nodes.find((node) => node.id === state.selectedNodeId) ?? null
    },
    selectedEdge(state): LoreEdge | null {
      return state.edges.find((edge) => edge.id === state.selectedEdgeId) ?? null
    },
    nodeById:
      (state) =>
      (id: string): LoreNode | null =>
        state.nodes.find((node) => node.id === id) ?? null,
    edgeById:
      (state) =>
      (id: string): LoreEdge | null =>
        state.edges.find((edge) => edge.id === id) ?? null,
    incidentEdgesOf:
      (state) =>
      (nodeId: string): LoreEdge[] =>
        state.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId),
    edgeBetween:
      (state) =>
      (source: string, target: string): LoreEdge | null =>
        state.edges.find((edge) => edge.source === source && edge.target === target) ?? null,
  },
  actions: {
    async load(universeId: string): Promise<void> {
      this.universeId = universeId
      this.loading = true
      this.error = null
      try {
        const [nodes, edges] = await Promise.all([
          services.graph.listNodes(universeId),
          services.graph.listEdges(universeId),
        ])
        this.nodes = nodes
        this.edges = edges
        this.selectedNodeId = null
        this.selectedEdgeId = null
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
      } finally {
        this.loading = false
      }
    },
    reset(): void {
      this.universeId = null
      this.nodes = []
      this.edges = []
      this.selectedNodeId = null
      this.selectedEdgeId = null
      this.loading = false
      this.error = null
      pendingPatches.clear()
      rollbackNodes.clear()
    },
    async createNode(input: NodeDraft): Promise<LoreNode> {
      const universeId = this.requireUniverseId()
      const node = await services.graph.createNode({ universeId, ...input })
      this.nodes.push(node)
      return node
    },
    async updateNode(id: string, patch: NodePatch): Promise<void> {
      const node = this.nodes.find((item) => item.id === id)
      if (!node) {
        return
      }
      if (!rollbackNodes.has(id)) {
        rollbackNodes.set(id, cloneNode(node))
      }
      applyNodePatch(node, patch)
      pendingPatches.set(id, { ...pendingPatches.get(id), ...pickDefined(patch) })
      services.autosave.schedule(`node:${id}`, async () => {
        const merged = pendingPatches.get(id) ?? {}
        pendingPatches.delete(id)
        try {
          const saved = await services.graph.updateNode(id, merged)
          const index = this.nodes.findIndex((item) => item.id === id)
          if (index >= 0) {
            this.nodes[index] = saved
          }
          rollbackNodes.delete(id)
        } catch (error) {
          const snapshot = rollbackNodes.get(id)
          if (snapshot) {
            const index = this.nodes.findIndex((item) => item.id === id)
            if (index >= 0) {
              this.nodes[index] = snapshot
            }
          }
          rollbackNodes.delete(id)
          console.error('[graph] 节点保存失败', error)
        }
      })
    },
    async moveNode(id: string, position: NodePosition): Promise<void> {
      await this.updateNode(id, { position })
    },
    async deleteNode(id: string): Promise<void> {
      const snapshot = await services.graph.deleteNode(id)
      this.nodes = this.nodes.filter((node) => node.id !== id)
      const removedEdgeIds = new Set(snapshot.edges.map((edge) => edge.id))
      this.edges = this.edges.filter((edge) => !removedEdgeIds.has(edge.id))
      if (this.selectedNodeId === id) {
        this.selectedNodeId = null
      }
      if (this.selectedEdgeId && removedEdgeIds.has(this.selectedEdgeId)) {
        this.selectedEdgeId = null
      }
      const ui = useUiStore()
      ui.notify(`已删除节点「${snapshot.node.name}」`, {
        variant: 'info',
        actionLabel: '撤销',
        duration: 8000,
        onAction: async () => {
          await services.graph.restoreNode(snapshot)
          await this.load(snapshot.node.universeId)
        },
      })
    },
    async createEdge(input: EdgeDraft): Promise<LoreEdge> {
      const universeId = this.requireUniverseId()
      const edge = await services.graph.createEdge({ universeId, ...input })
      this.edges.push(edge)
      return edge
    },
    async updateEdge(id: string, patch: EdgePatch): Promise<void> {
      const saved = await services.graph.updateEdge(id, patch)
      const index = this.edges.findIndex((edge) => edge.id === id)
      if (index >= 0) {
        this.edges[index] = saved
      }
    },
    async deleteEdge(id: string): Promise<void> {
      const edge = await services.graph.deleteEdge(id)
      this.edges = this.edges.filter((item) => item.id !== id)
      if (this.selectedEdgeId === id) {
        this.selectedEdgeId = null
      }
      const ui = useUiStore()
      ui.notify('已删除关系', {
        variant: 'info',
        actionLabel: '撤销',
        duration: 8000,
        onAction: async () => {
          await services.graph.restoreEdge(edge)
          await this.load(edge.universeId)
        },
      })
    },
    selectNode(id: string | null): void {
      this.selectedNodeId = id
      if (id !== null) {
        this.selectedEdgeId = null
      }
    },
    selectEdge(id: string | null): void {
      this.selectedEdgeId = id
      if (id !== null) {
        this.selectedNodeId = null
      }
    },
    async flush(): Promise<void> {
      await services.autosave.flush()
    },
    requireUniverseId(): string {
      if (!this.universeId) {
        throw new LoreGraphError('尚未加载世界图谱')
      }
      return this.universeId
    },
  },
})
