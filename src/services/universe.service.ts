import { newId, now } from '@/models/ids'
import { EntityTypeSchema, type EntityScope, type EntityType } from '@/models/type-def'
import { UniverseSchema, type Universe } from '@/models/universe'
import type { Repositories } from '@/repositories/types'
import { LoreGraphError } from './errors'
import type { ImportService, UniverseCreateInput, UniversePatch, UniverseService } from './types'

interface DefaultTypeSeed {
  scope: EntityScope
  key: string
  label: string
  color: string
  icon?: string
}

/** 默认节点类型种子。 */
export const DEFAULT_NODE_TYPE_SEEDS: readonly DefaultTypeSeed[] = [
  { scope: 'node', key: 'character', label: '角色', color: '#6366f1', icon: 'user-round' },
  { scope: 'node', key: 'organization', label: '组织', color: '#f59e0b', icon: 'building-2' },
  { scope: 'node', key: 'location', label: '地点', color: '#10b981', icon: 'map-pin' },
  { scope: 'node', key: 'event', label: '事件', color: '#ef4444', icon: 'calendar-clock' },
  { scope: 'node', key: 'item', label: '物品', color: '#8b5cf6', icon: 'package' },
  { scope: 'node', key: 'concept', label: '概念', color: '#64748b', icon: 'lightbulb' },
]

/** 默认关系类型种子。 */
export const DEFAULT_RELATION_TYPE_SEEDS: readonly DefaultTypeSeed[] = [
  { scope: 'relation', key: 'member-of', label: '隶属于', color: '#6366f1' },
  { scope: 'relation', key: 'allies-with', label: '结盟', color: '#f59e0b' },
  { scope: 'relation', key: 'located-in', label: '位于', color: '#10b981' },
  { scope: 'relation', key: 'participates-in', label: '参与', color: '#8b5cf6' },
  { scope: 'relation', key: 'causes', label: '导致', color: '#ef4444' },
  { scope: 'relation', key: 'related-to', label: '相关', color: '#94a3b8' },
]

/** 内置示例世界导出文件的路径（相对应用 BASE_URL）。 */
export const SAMPLE_UNIVERSE_PATH = 'examples/emberfall.json'

/** 为新建世界生成默认类型实体；order 在每个 scope 内从 0 开始递增。 */
export function buildDefaultTypes(universeId: string, timestamp: number): EntityType[] {
  const build = (seeds: readonly DefaultTypeSeed[]): EntityType[] =>
    seeds.map((seed, index) =>
      EntityTypeSchema.parse({
        id: newId(),
        universeId,
        scope: seed.scope,
        key: seed.key,
        label: seed.label,
        color: seed.color,
        ...(seed.icon === undefined ? {} : { icon: seed.icon }),
        order: index,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    )
  return [...build(DEFAULT_NODE_TYPE_SEEDS), ...build(DEFAULT_RELATION_TYPE_SEEDS)]
}

/** 读取示例世界 JSON；网络错误与 HTTP 错误统一转换为领域错误。 */
async function fetchSampleUniverse(url: string): Promise<string> {
  let response: Response
  try {
    response = await fetch(url)
  } catch (error) {
    throw new LoreGraphError('示例世界加载失败，请检查网络连接', { cause: error })
  }
  if (!response.ok) {
    throw new LoreGraphError(`示例世界加载失败（HTTP ${response.status}）`)
  }
  try {
    return await response.text()
  } catch (error) {
    throw new LoreGraphError('示例世界文件读取失败', { cause: error })
  }
}

/** 世界服务实现。 */
export class UniverseServiceImpl implements UniverseService {
  constructor(
    private readonly repos: Repositories,
    private readonly importer: ImportService,
  ) {}

  async list(): Promise<Universe[]> {
    const universes = await this.repos.universes.list()
    // 新建的世界排在前面
    return universes.sort((a, b) => b.createdAt - a.createdAt)
  }

  async get(id: string): Promise<Universe | null> {
    return await this.repos.universes.getById(id)
  }

  async create(input: UniverseCreateInput): Promise<Universe> {
    const timestamp = now()
    const universe = UniverseSchema.parse({
      id: newId(),
      name: input.name,
      description: input.description,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    const types = buildDefaultTypes(universe.id, timestamp)
    await this.repos.tx.run(['universes', 'entityTypes'], async () => {
      await this.repos.universes.create(universe)
      await this.repos.types.bulkPut(types)
    })
    return universe
  }

  async update(id: string, patch: UniversePatch): Promise<Universe> {
    const existing = await this.repos.universes.getById(id)
    if (!existing) {
      throw new LoreGraphError('世界不存在或已被删除')
    }
    const updated = UniverseSchema.parse({
      ...existing,
      name: patch.name ?? existing.name,
      description: patch.description ?? existing.description,
      updatedAt: now(),
    })
    return await this.repos.universes.update(updated)
  }

  async remove(id: string): Promise<void> {
    const existing = await this.repos.universes.getById(id)
    if (!existing) {
      throw new LoreGraphError('世界不存在或已被删除')
    }
    const [nodes, edges, types] = await Promise.all([
      this.repos.nodes.getByUniverse(id),
      this.repos.edges.getByUniverse(id),
      this.repos.types.getByUniverse(id),
    ])
    await this.repos.tx.run(['universes', 'nodes', 'edges', 'entityTypes'], async () => {
      for (const edge of edges) {
        await this.repos.edges.delete(edge.id)
      }
      for (const node of nodes) {
        await this.repos.nodes.delete(node.id)
      }
      for (const type of types) {
        await this.repos.types.delete(type.id)
      }
      await this.repos.universes.delete(id)
    })
  }

  async seedSample(): Promise<Universe> {
    const url = `${import.meta.env.BASE_URL}${SAMPLE_UNIVERSE_PATH}`
    const raw = await fetchSampleUniverse(url)
    const parsed = this.importer.parse(raw)
    if (!parsed.ok) {
      throw new LoreGraphError(`示例世界数据无效：${parsed.issues.join('；')}`)
    }
    const universe = await this.importer.import(parsed.data)
    // 示例世界不是用户主动导入，恢复原始名称（import 会追加「（导入）」）。
    if (universe.name !== parsed.data.universe.name) {
      return await this.update(universe.id, { name: parsed.data.universe.name })
    }
    return universe
  }
}
