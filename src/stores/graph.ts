import { defineStore } from 'pinia'
import type { LoreEdge } from '@/models/edge'
import type { LoreNode, NodePosition } from '@/models/node'
import { services } from '@/services'
import { LoreGraphError } from '@/services/errors'
import { computeLayout, type LayoutMode } from '@/services/layout.service'
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
  /** 布局计算与落库进行中，用于禁用按钮、阻止重复触发。 */
  isLayouting: boolean
  /** 一级布局快照，只存在内存：首次自动布局前保存，恢复、拖动或切换世界时清除。 */
  layoutSnapshot: LayoutSnapshot | null
}

/** 自动布局前的坐标快照。 */
interface LayoutSnapshot {
  universeId: string
  positions: Record<string, NodePosition>
}

/** 待合并的节点补丁：同一节点的连续修改合并后一次落库。 */
const pendingPatches = new Map<string, NodePatch>()
/** 首次修改前的节点快照，用于保存失败时回滚。 */
const rollbackNodes = new Map<string, LoreNode>()
/** 正在执行的节点保存：布局前等它们结束，避免旧坐标晚于布局写入。 */
const inflightSaves = new Set<Promise<void>>()

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

/** 取出全部节点的坐标副本。 */
function positionsOf(nodes: readonly LoreNode[]): Record<string, NodePosition> {
  return Object.fromEntries(nodes.map((node) => [node.id, { ...node.position }]))
}

/** 只保留当前世界仍然存在的节点，已删除的节点跳过。 */
function pickPositions(
  nodes: readonly LoreNode[],
  positions: Record<string, NodePosition>,
): Record<string, NodePosition> {
  const ids = new Set(nodes.map((node) => node.id))
  return Object.fromEntries(Object.entries(positions).filter(([id]) => ids.has(id)))
}

/** 把坐标写回内存节点，未出现在映射里的节点保持原样。 */
function applyPositions(nodes: readonly LoreNode[], positions: Record<string, NodePosition>): void {
  for (const node of nodes) {
    const position = positions[node.id]
    if (position) {
      node.position = { ...position }
    }
  }
}

/** 登记一个正在落库的节点保存，供布局前等待。 */
function trackSave(task: Promise<void>): Promise<void> {
  inflightSaves.add(task)
  void task.then(
    () => inflightSaves.delete(task),
    () => inflightSaves.delete(task),
  )
  return task
}

/** 等逐节点自动保存全部落地：先触发防抖队列，再等已经开始的保存。 */
async function drainNodeSaves(): Promise<void> {
  await services.autosave.flush()
  while (inflightSaves.size > 0) {
    await Promise.allSettled([...inflightSaves])
  }
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
    isLayouting: false,
    layoutSnapshot: null,
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
    /** 存在属于当前世界的布局快照时才可恢复。 */
    canRestoreLayout(state): boolean {
      return state.layoutSnapshot !== null && state.layoutSnapshot.universeId === state.universeId
    },
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
        this.layoutSnapshot = null
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
      this.isLayouting = false
      this.layoutSnapshot = null
      pendingPatches.clear()
      rollbackNodes.clear()
      inflightSaves.clear()
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
      const save = async (): Promise<void> => {
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
      }
      services.autosave.schedule(`node:${id}`, () => trackSave(save()))
    },
    async moveNode(id: string, position: NodePosition): Promise<void> {
      if (!this.nodes.some((node) => node.id === id)) {
        return
      }
      // 用户手动排布即视为放弃自动布局前的快照，撤销提示不能再把布局改回去
      this.layoutSnapshot = null
      await this.updateNode(id, { position })
    },
    /**
     * 自动布局：计算 → 首次布局前存快照 → 一次性更新内存 → 单事务落库。
     * 连续布局只有第一次保存快照；落库失败时把内存坐标回滚到本次布局前并抛出，由调用方提示用户。
     */
    async applyLayout(mode: LayoutMode = 'force'): Promise<void> {
      if (this.isLayouting) {
        return
      }
      const universeId = this.requireUniverseId()
      if (this.nodes.length === 0) {
        return
      }
      this.isLayouting = true
      try {
        const positions = await computeLayout(
          this.nodes.map((node) => ({ id: node.id })),
          this.edges.map((edge) => ({ source: edge.source, target: edge.target })),
          mode,
        )
        // 计算期间可能切换了世界，结果作废
        if (this.universeId !== universeId) {
          return
        }
        // 用户可能刚拖动过节点：先把排队的逐节点保存写完，旧坐标才不会晚于布局落库
        await drainNodeSaves()
        const beforeLayout = positionsOf(this.nodes)
        applyPositions(this.nodes, positions)
        try {
          const saved = await services.graph.updateNodePositions(universeId, positions)
          const byId = new Map(saved.map((node) => [node.id, node]))
          this.nodes = this.nodes.map((node) => byId.get(node.id) ?? node)
        } catch (error) {
          applyPositions(this.nodes, beforeLayout)
          console.error('[graph] 自动布局落库失败', error)
          throw error
        }
        // 快照只记录第一次自动布局前的坐标，连续布局不覆盖
        if (!this.layoutSnapshot) {
          this.layoutSnapshot = { universeId, positions: beforeLayout }
        }
      } finally {
        this.isLayouting = false
      }
    },
    /** 恢复到上一次自动布局前的坐标；成功后清空快照。 */
    async restoreLayout(): Promise<void> {
      if (this.isLayouting) {
        return
      }
      const snapshot = this.layoutSnapshot
      if (!snapshot || snapshot.universeId !== this.universeId) {
        return
      }
      const universeId = snapshot.universeId
      this.isLayouting = true
      try {
        await drainNodeSaves()
        if (this.universeId !== universeId) {
          return
        }
        // 等待保存期间节点可能已被删除或新建：落库前重新过滤，避免整批写入因缺失节点报错
        const positions = pickPositions(this.nodes, snapshot.positions)
        const current = positionsOf(this.nodes)
        applyPositions(this.nodes, positions)
        try {
          const saved = await services.graph.updateNodePositions(universeId, positions)
          const byId = new Map(saved.map((node) => [node.id, node]))
          this.nodes = this.nodes.map((node) => byId.get(node.id) ?? node)
        } catch (error) {
          applyPositions(this.nodes, current)
          console.error('[graph] 布局恢复落库失败', error)
          throw error
        }
        this.layoutSnapshot = null
      } finally {
        this.isLayouting = false
      }
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
