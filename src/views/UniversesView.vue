<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { Download, Globe, Moon, Pencil, Plus, Sparkles, Sun, Trash, Upload } from '@lucide/vue'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { useTheme } from '@/composables/useTheme'
import { useToast } from '@/composables/useToast'
import type { Universe } from '@/models/universe'
import { services } from '@/services'
import { useUniverseStore } from '@/stores/universe'

/** 首启标记：只在第一次没有世界时自动创建示例世界。 */
const FIRST_RUN_KEY = 'loregraph.firstRunSeeded'

const router = useRouter()
const universes = useUniverseStore()
const toast = useToast()
const { isDark, toggleTheme } = useTheme()

const bootstrapping = ref(true)
const createOpen = ref(false)
const createName = ref('')
const createDescription = ref('')
const createError = ref(false)
const busy = ref(false)

const editTarget = ref<Universe | null>(null)
const editName = ref('')
const editDescription = ref('')
const editError = ref(false)

const deleteTarget = ref<Universe | null>(null)
const importIssues = ref<string[]>([])
const fileInput = ref<HTMLInputElement | null>(null)

interface UniverseStats {
  nodes: number
  edges: number
  types: number
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
  createName.value = ''
  createDescription.value = ''
  createError.value = false
  createOpen.value = true
}

async function onCreate(): Promise<void> {
  const name = createName.value.trim()
  if (name === '') {
    createError.value = true
    return
  }
  busy.value = true
  try {
    const created = await universes.create(name, createDescription.value.trim())
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
  editName.value = target.name
  editDescription.value = target.description
  editError.value = false
}

async function onEdit(): Promise<void> {
  const target = editTarget.value
  const name = editName.value.trim()
  if (!target) {
    return
  }
  if (name === '') {
    editError.value = true
    return
  }
  busy.value = true
  try {
    await universes.updateInfo(target.id, { name, description: editDescription.value.trim() })
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
    const data = await services.exporter.toExport(target.id)
    services.exporter.download(data)
    toast.info(`已导出世界「${target.name}」`)
  } catch (error) {
    toast.danger(`导出失败：${formatError(error)}`)
  }
}

function openImport(): void {
  importIssues.value = []
  fileInput.value?.click()
}

async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) {
    return
  }
  try {
    const raw = await file.text()
    const parsed = services.importer.parse(raw)
    if (!parsed.ok) {
      importIssues.value = parsed.issues
      return
    }
    const imported = await services.importer.import(parsed.data)
    await loadUniverses()
    toast.info(`已导入世界「${imported.name}」`)
  } catch (error) {
    importIssues.value = [formatError(error)]
  }
}

onMounted(async () => {
  await loadUniverses()
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

    <BaseDialog :open="createOpen" title="新建世界" width="420px" @close="createOpen = false">
      <label class="block">
        <span class="mb-1 block text-sm text-muted">世界名称</span>
        <input
          v-model="createName"
          type="text"
          maxlength="120"
          placeholder="例如：余烬王朝"
          autofocus
          data-testid="universe-name-input"
          class="w-full rounded-md border bg-bg px-3 py-1.5 text-sm text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="createError ? 'border-danger' : 'border-border'"
          @input="createError = false"
          @keydown.enter="onCreate"
        />
        <span v-if="createError" class="mt-1 block text-xs text-danger">名称不能为空</span>
      </label>
      <label class="mt-3 block">
        <span class="mb-1 block text-sm text-muted">世界简介（可选）</span>
        <textarea
          v-model="createDescription"
          rows="3"
          maxlength="20000"
          placeholder="一句话介绍这个世界，会显示在世界卡片与检查器的世界概览上"
          data-testid="universe-description-input"
          class="w-full resize-y rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        ></textarea>
        <span class="mt-1 block text-xs text-muted">简介可选，之后也能在世界卡片上修改。</span>
      </label>
      <template #footer>
        <BaseButton variant="secondary" size="sm" @click="createOpen = false">取消</BaseButton>
        <BaseButton size="sm" :disabled="busy" data-testid="create-universe-btn" @click="onCreate"
          >创建并进入</BaseButton
        >
      </template>
    </BaseDialog>

    <BaseDialog
      :open="editTarget !== null"
      title="编辑世界"
      width="420px"
      @close="editTarget = null"
    >
      <label class="block">
        <span class="mb-1 block text-sm text-muted">世界名称</span>
        <input
          v-model="editName"
          type="text"
          maxlength="120"
          autofocus
          data-testid="rename-universe-input"
          class="w-full rounded-md border bg-bg px-3 py-1.5 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="editError ? 'border-danger' : 'border-border'"
          @input="editError = false"
          @keydown.enter="onEdit"
        />
        <span v-if="editError" class="mt-1 block text-xs text-danger">名称不能为空</span>
      </label>
      <label class="mt-3 block">
        <span class="mb-1 block text-sm text-muted">世界简介（可选）</span>
        <textarea
          v-model="editDescription"
          rows="4"
          maxlength="20000"
          placeholder="一句话介绍这个世界，会显示在世界卡片与检查器的世界概览上"
          data-testid="rename-universe-description-input"
          class="w-full resize-y rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        ></textarea>
        <span class="mt-1 block text-xs text-muted">留空则清除简介。</span>
      </label>
      <template #footer>
        <BaseButton variant="secondary" size="sm" @click="editTarget = null">取消</BaseButton>
        <BaseButton size="sm" :disabled="busy" @click="onEdit">保存</BaseButton>
      </template>
    </BaseDialog>

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

    <BaseDialog
      :open="importIssues.length > 0"
      title="导入失败"
      width="560px"
      @close="importIssues = []"
    >
      <p class="mb-2 text-sm text-muted">文件未通过校验，请检查以下问题后重试：</p>
      <ul
        class="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border bg-surface p-2 text-xs text-muted"
        data-testid="import-issues"
      >
        <li v-for="(issue, index) in importIssues" :key="index">{{ issue }}</li>
      </ul>
      <template #footer>
        <BaseButton variant="secondary" size="sm" @click="importIssues = []">关闭</BaseButton>
      </template>
    </BaseDialog>
  </div>
</template>
