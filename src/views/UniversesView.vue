<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { Download, Globe, Moon, Pencil, Plus, Sparkles, Sun, Trash, Upload } from '@lucide/vue'
import BaseButton from '@/components/common/BaseButton.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import ImportPreviewDialog from '@/components/common/ImportPreviewDialog.vue'
import UniverseFormDialog from '@/components/universe/UniverseFormDialog.vue'
import { useTheme } from '@/composables/useTheme'
import { useToast } from '@/composables/useToast'
import type { Universe } from '@/models/universe'
import { services } from '@/services'
import { loadBundledWorlds } from '@/services/bundled-worlds'
import type { ImportPreview } from '@/services/types'
import { useUniverseStore } from '@/stores/universe'

/** 首启标记：只在第一次没有世界时自动创建示例世界。 */
const FIRST_RUN_KEY = 'loregraph.firstRunSeeded'

const router = useRouter()
const universes = useUniverseStore()
const toast = useToast()
const { isDark, toggleTheme } = useTheme()

const bootstrapping = ref(true)
const createOpen = ref(false)
const busy = ref(false)

const editTarget = ref<Universe | null>(null)

const deleteTarget = ref<Universe | null>(null)
const importPreview = ref<ImportPreview | null>(null)
const importOpen = ref(false)
const importAnalyzing = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

interface UniverseStats {
  nodes: number
  edges: number
  types: number
}

interface UniverseFormPayload {
  name: string
  description: string
}

const stats = ref<Record<string, UniverseStats>>({})

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function hasSeeded(): boolean {
  try {
    return localStorage.getItem(FIRST_RUN_KEY) === '1'
  } catch {
    return false
  }
}

function markSeeded(): void {
  try {
    localStorage.setItem(FIRST_RUN_KEY, '1')
  } catch {
    // 隐私模式等存储不可用时忽略，不影响本次会话
  }
}

async function refreshStats(): Promise<void> {
  const entries = await Promise.all(
    universes.universes.map(async (universe) => {
      const [nodes, edges, types] = await Promise.all([
        services.graph.listNodes(universe.id),
        services.graph.listEdges(universe.id),
        services.types.list(universe.id),
      ])
      return [
        universe.id,
        { nodes: nodes.length, edges: edges.length, types: types.length },
      ] as const
    }),
  )
  stats.value = Object.fromEntries(entries)
}

async function loadUniverses(): Promise<void> {
  try {
    await universes.loadAll()
    await refreshStats()
  } catch (error) {
    toast.danger(`世界列表加载失败：${formatError(error)}`)
  }
}

/** 首页启动时导入项目根目录 worlds/*.json；失败文件会被跳过，不阻塞其余文件。 */
async function importBundledWorlds(): Promise<void> {
  try {
    const result = await loadBundledWorlds(services)
    for (const failure of result.failures) {
      console.warn(`[bundled-world] 跳过 ${failure.path}：${failure.message}`)
    }
    for (const warning of result.warnings) {
      console.warn(`[bundled-world] ${warning}`)
    }
    if (result.imported.length === 0 && result.failures.length === 0) {
      return
    }
    await loadUniverses()
    if (result.imported.length > 0) {
      toast.info(`已自动导入 ${result.imported.length} 个根目录世界文件`)
    }
    if (result.failures.length > 0) {
      toast.danger(`已跳过 ${result.failures.length} 个无法导入的根目录世界文件`)
    }
  } catch (error) {
    toast.danger(`根目录 worlds 自动导入失败：${formatError(error)}`)
  }
}

/** 没有任何世界且未标记首启时，自动载入内置示例世界。 */
async function seedFirstRun(): Promise<void> {
  if (universes.universes.length > 0 || hasSeeded()) {
    return
  }
  try {
    const created = await universes.seedSample()
    markSeeded()
    await loadUniverses()
    toast.info(`已为你准备示例世界「${created.name}」`)
  } catch (error) {
    toast.danger(`示例世界加载失败：${formatError(error)}`)
  }
}

async function onSeedSample(): Promise<void> {
  busy.value = true
  try {
    const created = await universes.seedSample()
    markSeeded()
    await refreshStats()
    toast.info(`已载入示例世界「${created.name}」`)
    await router.push({ name: 'workspace', params: { universeId: created.id } })
  } catch (error) {
    toast.danger(`示例世界加载失败：${formatError(error)}`)
  } finally {
    busy.value = false
  }
}

function openCreate(): void {
  createOpen.value = true
}

async function onCreate(payload: UniverseFormPayload): Promise<void> {
  busy.value = true
  try {
    const created = await universes.create(payload.name, payload.description)
    createOpen.value = false
    await refreshStats()
    toast.info(`已创建世界「${created.name}」`)
    await router.push({ name: 'workspace', params: { universeId: created.id } })
  } catch (error) {
    toast.danger(`创建世界失败：${formatError(error)}`)
  } finally {
    busy.value = false
  }
}

function openEdit(target: Universe): void {
  editTarget.value = target
}

async function onEdit(payload: UniverseFormPayload): Promise<void> {
  const target = editTarget.value
  if (!target) {
    return
  }
  busy.value = true
  try {
    await universes.updateInfo(target.id, payload)
    editTarget.value = null
    toast.info('世界信息已更新')
  } catch (error) {
    toast.danger(`保存失败：${formatError(error)}`)
  } finally {
    busy.value = false
  }
}

function openDelete(target: Universe): void {
  deleteTarget.value = target
}

async function onDelete(): Promise<void> {
  const target = deleteTarget.value
  if (!target) {
    return
  }
  busy.value = true
  try {
    await universes.remove(target.id)
    deleteTarget.value = null
    await refreshStats()
    toast.info(`已删除世界「${target.name}」`)
  } catch (error) {
    toast.danger(`删除失败：${formatError(error)}`)
  } finally {
    busy.value = false
  }
}

async function onExport(target: Universe): Promise<void> {
  try {
    const data = await services.exporter.exportUniverse(target.id)
    services.exporter.download(data)
    toast.info(`已导出世界「${target.name}」`)
  } catch (error) {
    toast.danger(`导出失败：${formatError(error)}`)
  }
}

function openImport(): void {
  fileInput.value?.click()
}

/** 选择文件后只做只读分析，具体导入在预览对话框中确认。 */
async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) {
    return
  }
  importAnalyzing.value = true
  try {
    const raw = await file.text()
    importPreview.value = await services.importer.analyzeImport(raw, { mode: 'new-universe' })
    importOpen.value = true
  } catch (error) {
    toast.danger(`读取导入文件失败：${formatError(error)}`)
  } finally {
    importAnalyzing.value = false
  }
}

/** 关闭预览对话框并清掉上一次的分析结果。 */
function onImportClose(): void {
  importOpen.value = false
  importPreview.value = null
}

/** 导入成功后刷新世界列表与统计。 */
async function onImported(): Promise<void> {
  onImportClose()
  await loadUniverses()
}

onMounted(async () => {
  await loadUniverses()
  await importBundledWorlds()
  await seedFirstRun()
  bootstrapping.value = false
})
</script>

<template>
  <div class="min-h-screen bg-bg text-fg">
    <header class="border-b border-border bg-surface">
      <div class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-4">
        <RouterLink to="/" class="flex items-center gap-2">
          <span class="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <Sparkles :size="18" />
          </span>
          <span class="text-lg font-semibold">LoreGraph</span>
          <span class="hidden text-xs text-muted sm:inline">设定集与关系图谱</span>
        </RouterLink>
        <div class="flex items-center gap-2">
          <BaseButton variant="ghost" size="sm" @click="toggleTheme()">
            <component :is="isDark ? Sun : Moon" :size="16" />
            {{ isDark ? '浅色主题' : '深色主题' }}
          </BaseButton>
          <input
            ref="fileInput"
            type="file"
            accept="application/json,.json"
            class="hidden"
            data-testid="import-json-input"
            @change="onImportFile"
          />
          <BaseButton
            variant="secondary"
            size="sm"
            title="从 JSON 文件新建一个世界，不会修改现有世界"
            data-testid="import-universe-btn"
            @click="openImport"
          >
            <Upload :size="16" />
            导入世界
          </BaseButton>
          <BaseButton size="sm" data-testid="new-universe-btn" @click="openCreate">
            <Plus :size="16" />
            新建世界
          </BaseButton>
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-5xl px-6 py-8">
      <div v-if="bootstrapping" class="py-20 text-center text-sm text-muted">正在加载世界…</div>

      <EmptyState
        v-else-if="universes.universes.length === 0"
        title="还没有任何世界"
        description="创建一个世界开始记录人物、地点与事件，或先载入内置的中文奇幻示例世界；也可用右上角「导入世界」从 JSON 文件新建一个世界。"
      >
        <template #icon>
          <Globe :size="36" />
        </template>
        <template #action>
          <div class="flex flex-wrap items-center justify-center gap-2">
            <BaseButton data-testid="new-universe-empty-btn" @click="openCreate">
              <Plus :size="16" />
              新建世界
            </BaseButton>
            <BaseButton
              variant="secondary"
              :disabled="busy"
              data-testid="sample-universe-btn"
              @click="onSeedSample"
            >
              <Sparkles :size="16" />
              加载示例世界
            </BaseButton>
          </div>
        </template>
      </EmptyState>

      <div v-else class="space-y-4">
        <div class="flex items-center justify-between gap-2">
          <h1 class="text-xl font-semibold">我的世界</h1>
          <span class="text-xs text-muted">共 {{ universes.universes.length }} 个</span>
        </div>
        <p class="text-xs text-muted">导入会新建一个世界；导出与备份在每张世界卡片上进行。</p>

        <ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="universe-list">
          <li
            v-for="universe in universes.universes"
            :key="universe.id"
            class="flex flex-col rounded-xl border border-border bg-surface p-4"
            data-testid="universe-card"
            :data-universe-id="universe.id"
          >
            <RouterLink
              :to="{ name: 'workspace', params: { universeId: universe.id } }"
              class="min-w-0"
            >
              <h2 class="truncate text-base font-semibold hover:text-accent">
                {{ universe.name }}
              </h2>
              <p class="mt-1 text-xs text-muted">
                {{ stats[universe.id]?.nodes ?? 0 }} 节点 ·
                {{ stats[universe.id]?.edges ?? 0 }} 关系 ·
                {{ stats[universe.id]?.types ?? 0 }} 类型
              </p>
              <p class="mt-0.5 text-xs text-muted">创建于 {{ formatDate(universe.createdAt) }}</p>
            </RouterLink>

            <p v-if="universe.description" class="mt-2 line-clamp-2 text-xs text-muted">
              {{ universe.description }}
            </p>

            <div class="mt-auto flex flex-wrap items-center gap-1 border-t border-border pt-3">
              <RouterLink
                :to="{ name: 'workspace', params: { universeId: universe.id } }"
                class="rounded px-2 py-1 text-xs font-medium text-accent hover:bg-surface-2"
              >
                打开
              </RouterLink>
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-fg"
                data-testid="rename-universe-btn"
                @click="openEdit(universe)"
              >
                <Pencil :size="14" />
                编辑
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-fg"
                data-testid="export-universe-btn"
                @click="onExport(universe)"
              >
                <Download :size="14" />
                导出
              </button>
              <button
                type="button"
                class="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-danger hover:bg-surface-2"
                data-testid="delete-universe-btn"
                @click="openDelete(universe)"
              >
                <Trash :size="14" />
                删除
              </button>
            </div>
          </li>
        </ul>
      </div>
    </main>

    <UniverseFormDialog
      :open="createOpen"
      mode="create"
      :busy="busy"
      :test-ids="{
        name: 'universe-name-input',
        description: 'universe-description-input',
        submit: 'create-universe-btn',
      }"
      @close="createOpen = false"
      @submit="onCreate"
    />

    <UniverseFormDialog
      :open="editTarget !== null"
      mode="edit"
      :initial-name="editTarget?.name ?? ''"
      :initial-description="editTarget?.description ?? ''"
      :busy="busy"
      :test-ids="{
        name: 'rename-universe-input',
        description: 'rename-universe-description-input',
      }"
      @close="editTarget = null"
      @submit="onEdit"
    />

    <ConfirmDialog
      :open="deleteTarget !== null"
      title="删除世界"
      :message="
        deleteTarget
          ? `确定删除世界「${deleteTarget.name}」吗？\n该世界下的 ${stats[deleteTarget.id]?.nodes ?? 0} 个节点、${stats[deleteTarget.id]?.edges ?? 0} 条关系与 ${stats[deleteTarget.id]?.types ?? 0} 个类型都会被永久删除，且无法恢复。`
          : ''
      "
      confirm-label="永久删除"
      confirm-test-id="confirm-delete-btn"
      @confirm="onDelete"
      @close="deleteTarget = null"
    />

    <ImportPreviewDialog
      :open="importOpen"
      :preview="importPreview"
      :analyzing="importAnalyzing"
      @close="onImportClose"
      @imported="onImported"
    />
  </div>
</template>
