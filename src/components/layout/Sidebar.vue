<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ChevronDown,
  ChevronRight,
  Keyboard,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Sparkles,
  Sun,
  X,
} from '@lucide/vue'
import BaseButton from '@/components/common/BaseButton.vue'
import TypeDot from '@/components/common/TypeDot.vue'
import { SEARCH_INPUT_ID } from '@/composables/useShortcuts'
import { useSidebarPreferences } from '@/composables/useSidebarPreferences'
import { useTheme } from '@/composables/useTheme'
import type { LoreNode } from '@/models/node'
import { searchNodes } from '@/services/search'
import { useGraphStore } from '@/stores/graph'
import { useTypesStore } from '@/stores/types'
import { useUiStore } from '@/stores/ui'
import { useUniverseStore } from '@/stores/universe'

defineOptions({ name: 'AppSidebar' })

/**
 * 收起态由父级（AppShell）通过 collapsed 属性驱动，属性值来自 ui.sidebarCollapsed；
 * 收起时只渲染一条 Rail，仅保留展开按钮：新建节点入口只由画布工具栏提供，不做重复入口。
 */
withDefaults(defineProps<{ collapsed?: boolean }>(), { collapsed: false })

const emit = defineEmits<{
  (event: 'create-node'): void
  /** 选中并定位节点由父级处理：侧栏只上报节点 id，不直接改选中状态。 */
  (event: 'select-node', id: string): void
}>()

const route = useRoute()
const router = useRouter()
const universes = useUniverseStore()
const types = useTypesStore()
const graph = useGraphStore()
const ui = useUiStore()
const { isDark, toggleTheme } = useTheme()

const currentUniverseId = computed(() => String(route.params.universeId ?? ''))
const preferences = useSidebarPreferences(currentUniverseId)

/** 与 AppShell 共用的窄屏断点：窄屏由抽屉承载，桌面才把收起态渲染成 Rail。 */
const NARROW_SCREEN_QUERY = '(max-width: 899px)'
const narrowQuery =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(NARROW_SCREEN_QUERY)
    : null
const narrowScreen = ref(narrowQuery?.matches ?? false)

function onNarrowChange(event: MediaQueryListEvent): void {
  narrowScreen.value = event.matches
}

onMounted(() => {
  narrowQuery?.addEventListener('change', onNarrowChange)
})

onBeforeUnmount(() => {
  narrowQuery?.removeEventListener('change', onNarrowChange)
})

interface TypeFilterRow {
  key: string
  label: string
  color: string
  count: number
}

/** 节点类型 + 当前世界中的使用数量。 */
const typeRows = computed<TypeFilterRow[]>(() =>
  types.nodeTypes.map((type) => ({
    key: type.key,
    label: type.label,
    color: type.color,
    count: graph.nodes.filter((node) => node.type === type.key).length,
  })),
)

/** 搜索命中的节点：节点库只受搜索词影响，画布的类型筛选不参与其中。 */
const matchedNodes = computed(() => searchNodes(graph.nodes, ui.searchQuery))

interface NodeGroup {
  key: string
  label: string
  color: string
  count: number
  nodes: LoreNode[]
}

function typeColor(key: string): string {
  return types.nodeTypeByKey(key)?.color ?? 'var(--muted)'
}

/** 按类型分组：已登记的类型按定义顺序在前，未登记的类型按 key 排在最后。 */
const nodeGroups = computed<NodeGroup[]>(() => {
  const buckets = new Map<string, LoreNode[]>()
  for (const node of matchedNodes.value) {
    const bucket = buckets.get(node.type)
    if (bucket) {
      bucket.push(node)
    } else {
      buckets.set(node.type, [node])
    }
  }
  const knownKeys = new Set(types.nodeTypes.map((type) => type.key))
  const headers = types.nodeTypes
    .filter((type) => buckets.has(type.key))
    .map((type) => ({ key: type.key, label: type.label, color: type.color }))
  const unknown = [...buckets.keys()]
    .filter((key) => !knownKeys.has(key))
    .sort()
    .map((key) => ({ key, label: key, color: typeColor(key) }))
  return [...headers, ...unknown].map((header) => ({
    ...header,
    count: buckets.get(header.key)?.length ?? 0,
    nodes: buckets.get(header.key) ?? [],
  }))
})

/** 搜索进行中：此时分组临时展开，清空后恢复用户自己的折叠偏好。 */
const searching = computed(() => ui.searchQuery.trim() !== '')

/** 搜索期间的临时开合状态，不写入偏好：'library' 或 'group:<key>'。 */
const transientOpen = ref<Record<string, boolean>>({})

watch(searching, (active) => {
  if (!active) {
    transientOpen.value = {}
  }
})

function groupOpen(key: string): boolean {
  if (!searching.value) {
    return preferences.isGroupExpanded(key)
  }
  return transientOpen.value[`group:${key}`] ?? true
}

function setTransient(key: string, open: boolean): void {
  transientOpen.value = { ...transientOpen.value, [key]: open }
}

function toggleGroup(key: string): void {
  if (searching.value) {
    setTransient(`group:${key}`, !groupOpen(key))
    return
  }
  preferences.toggleGroup(key)
}

/** 类型筛选分区的开合：直接跟随用户偏好，不随搜索变化。 */
const filterOpen = computed(() => preferences.filterOpen.value)

/** 节点库分区的开合：搜索期间临时展开，清空搜索后回到用户偏好。 */
const libraryOpen = computed(() =>
  searching.value ? (transientOpen.value.library ?? true) : preferences.libraryOpen.value,
)

function toggleLibrary(): void {
  if (searching.value) {
    setTransient('library', !libraryOpen.value)
    return
  }
  preferences.toggleLibrary()
}

const allGroupsCollapsed = computed(
  () => nodeGroups.value.length > 0 && nodeGroups.value.every((group) => !groupOpen(group.key)),
)

function toggleAllGroups(): void {
  const collapse = !allGroupsCollapsed.value
  if (searching.value) {
    transientOpen.value = {
      ...transientOpen.value,
      ...Object.fromEntries(nodeGroups.value.map((group) => [`group:${group.key}`, !collapse])),
    }
    return
  }
  if (collapse) {
    preferences.collapseAllGroups(nodeGroups.value.map((group) => group.key))
    return
  }
  preferences.expandAllGroups()
}

interface HighlightPart {
  text: string
  hit: boolean
}

/** 把节点名按搜索词切成「命中 / 未命中」片段，命中片段在模板里高亮。 */
function highlightParts(name: string): HighlightPart[] {
  const keyword = ui.searchQuery.trim()
  if (keyword === '') {
    return [{ text: name, hit: false }]
  }
  const haystack = name.toLowerCase()
  const needle = keyword.toLowerCase()
  const parts: HighlightPart[] = []
  let cursor = 0
  let index = haystack.indexOf(needle)
  while (index >= 0) {
    if (index > cursor) {
      parts.push({ text: name.slice(cursor, index), hit: false })
    }
    parts.push({ text: name.slice(index, index + keyword.length), hit: true })
    cursor = index + keyword.length
    index = haystack.indexOf(needle, cursor)
  }
  if (cursor < name.length) {
    parts.push({ text: name.slice(cursor), hit: false })
  }
  return parts
}

function onUniverseChange(event: Event): void {
  const id = (event.target as HTMLSelectElement).value
  if (!id || id === currentUniverseId.value) {
    return
  }
  void router.push({ name: 'workspace', params: { universeId: id } })
}

function onSearchInput(event: Event): void {
  ui.setSearch((event.target as HTMLInputElement).value)
}

function clearSearch(): void {
  ui.setSearch('')
  const input = document.getElementById(SEARCH_INPUT_ID)
  if (input instanceof HTMLInputElement) {
    input.focus()
  }
}
</script>

<template>
  <aside
    v-if="collapsed && !narrowScreen"
    class="flex h-full w-full flex-col items-center gap-1 border-r border-border bg-surface py-3 text-fg"
    data-testid="sidebar-rail"
    data-collapsed="true"
    aria-label="侧边栏（已收起）"
  >
    <button
      type="button"
      class="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
      title="展开侧边栏"
      aria-label="展开侧边栏"
      data-testid="toggle-sidebar"
      @click="ui.sidebarCollapsed = false"
    >
      <PanelLeftOpen :size="16" />
    </button>
  </aside>

  <aside
    v-else
    class="flex h-full w-full flex-col border-r border-border bg-surface text-fg"
    data-testid="sidebar"
    aria-label="侧边栏"
  >
    <header class="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
      <RouterLink to="/" class="flex min-w-0 items-center gap-2">
        <span
          class="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-fg"
        >
          <Sparkles :size="16" />
        </span>
        <span class="truncate text-sm font-semibold">LoreGraph</span>
      </RouterLink>
      <button
        type="button"
        class="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg"
        title="收起侧边栏"
        aria-label="收起侧边栏"
        data-testid="collapse-sidebar"
        @click="ui.toggleSidebar()"
      >
        <PanelLeftClose :size="16" />
      </button>
    </header>

    <div class="space-y-2.5 border-b border-border px-3 py-3">
      <div class="flex items-center justify-between">
        <span class="text-xs text-muted">当前世界</span>
        <RouterLink to="/" class="text-xs text-accent hover:underline">全部世界</RouterLink>
      </div>
      <span class="relative block">
        <select
          :value="currentUniverseId"
          class="w-full appearance-none rounded-md border border-border bg-bg px-2.5 py-1.5 pr-7 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="切换世界"
          data-testid="world-switcher"
          @change="onUniverseChange"
        >
          <option v-if="!currentUniverseId" value="" disabled>选择世界</option>
          <option v-for="universe in universes.universes" :key="universe.id" :value="universe.id">
            {{ universe.name }}
          </option>
        </select>
        <ChevronDown
          :size="14"
          class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-muted"
        />
      </span>

      <div class="relative">
        <Search
          :size="14"
          class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted"
        />
        <input
          :id="SEARCH_INPUT_ID"
          :value="ui.searchQuery"
          data-search-input
          data-testid="search-input"
          type="search"
          placeholder="搜索节点名称或描述…"
          aria-label="搜索节点名称或描述"
          class="w-full rounded-md border border-border bg-bg py-1.5 pr-8 pl-8 text-sm text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @input="onSearchInput"
        />
        <button
          v-if="ui.searchQuery"
          type="button"
          class="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-muted hover:bg-surface-2 hover:text-fg"
          title="清除搜索"
          aria-label="清除搜索"
          @click="clearSearch"
        >
          <X :size="14" />
        </button>
      </div>

      <BaseButton class="w-full" data-testid="new-node-btn" @click="emit('create-node')">
        <Plus :size="16" />
        新建节点
      </BaseButton>
    </div>

    <section class="min-h-0 flex-1 overflow-y-auto px-3 py-2">
      <div class="flex items-center justify-between gap-1">
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 py-1.5 text-left text-muted hover:bg-surface-2 hover:text-fg"
          :aria-expanded="filterOpen"
          data-testid="toggle-type-filter"
          @click="preferences.toggleFilter()"
        >
          <ChevronRight
            :size="12"
            class="shrink-0 transition-transform"
            :class="filterOpen ? 'rotate-90' : ''"
          />
          <span class="text-xs font-medium tracking-wide uppercase">类型筛选</span>
          <span
            v-if="ui.activeTypeKeys.length > 0"
            class="rounded bg-surface-2 px-1 text-xs tabular-nums text-accent"
            >{{ ui.activeTypeKeys.length }}</span
          >
        </button>
        <button
          v-if="ui.activeTypeKeys.length > 0"
          type="button"
          class="shrink-0 text-xs text-accent hover:underline"
          data-testid="clear-type-filters"
          @click="ui.clearTypeFilters()"
        >
          清除
        </button>
      </div>

      <div v-if="filterOpen" class="mt-0.5">
        <ul v-if="typeRows.length > 0" class="space-y-0.5">
          <li v-for="row in typeRows" :key="row.key">
            <label
              class="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface-2"
              :data-testid="`type-filter-${row.key}`"
              :data-type-key="row.key"
            >
              <input
                type="checkbox"
                class="size-3.5 shrink-0 accent-accent"
                :checked="ui.activeTypeKeys.includes(row.key)"
                @change="ui.toggleTypeFilter(row.key)"
              />
              <TypeDot :color="row.color" :label="row.label" />
              <span class="ml-auto text-xs tabular-nums text-muted">{{ row.count }}</span>
            </label>
          </li>
        </ul>
        <p v-else class="px-1.5 py-2 text-xs text-muted">暂无节点类型</p>
      </div>

      <div class="my-1 border-t border-border" />

      <div class="flex items-center justify-between gap-1">
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 py-1.5 text-left text-muted hover:bg-surface-2 hover:text-fg"
          :aria-expanded="libraryOpen"
          data-testid="toggle-node-library"
          @click="toggleLibrary()"
        >
          <ChevronRight
            :size="12"
            class="shrink-0 transition-transform"
            :class="libraryOpen ? 'rotate-90' : ''"
          />
          <span class="text-xs font-medium tracking-wide uppercase">节点库</span>
          <span class="text-xs tabular-nums text-muted">（{{ matchedNodes.length }}）</span>
        </button>
        <button
          v-if="libraryOpen && nodeGroups.length > 0"
          type="button"
          class="shrink-0 text-xs text-accent hover:underline"
          data-testid="toggle-all-groups"
          @click="toggleAllGroups()"
        >
          {{ allGroupsCollapsed ? '全部展开' : '全部收起' }}
        </button>
      </div>

      <div v-if="libraryOpen">
        <p
          v-if="graph.nodes.length === 0"
          class="px-1.5 py-2 text-xs text-muted"
          data-testid="empty-node-library"
        >
          还没有节点
        </p>
        <p
          v-else-if="matchedNodes.length === 0"
          class="px-1.5 py-2 text-xs text-muted"
          data-testid="empty-search-result"
        >
          没有匹配的节点
        </p>
        <template v-else>
          <div
            v-for="group in nodeGroups"
            :key="group.key"
            class="mt-0.5"
            data-testid="node-group"
            :data-type-key="group.key"
          >
            <button
              type="button"
              class="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-surface-2"
              :aria-expanded="groupOpen(group.key)"
              data-testid="node-group-toggle"
              :data-type-key="group.key"
              @click="toggleGroup(group.key)"
            >
              <ChevronRight
                :size="12"
                class="shrink-0 text-muted transition-transform"
                :class="groupOpen(group.key) ? 'rotate-90' : ''"
              />
              <TypeDot :color="group.color" :label="group.label" />
              <span class="ml-auto text-xs tabular-nums text-muted">{{ group.count }}</span>
            </button>
            <ul v-if="groupOpen(group.key)" class="space-y-0.5">
              <li v-for="node in group.nodes" :key="node.id">
                <button
                  type="button"
                  data-testid="node-list-item"
                  :data-node-id="node.id"
                  class="flex w-full items-center gap-2 rounded-md py-1 pr-1.5 pl-6 text-left text-xs hover:bg-surface-2"
                  :class="graph.selectedNodeId === node.id ? 'bg-surface-2 text-fg' : 'text-muted'"
                  @click="emit('select-node', node.id)"
                >
                  <span
                    class="size-1.5 shrink-0 rounded-full"
                    :style="{ backgroundColor: group.color }"
                  />
                  <span class="truncate">
                    <template v-for="(part, index) in highlightParts(node.name)" :key="index">
                      <mark
                        v-if="part.hit"
                        class="rounded bg-transparent font-semibold text-accent"
                        data-testid="search-highlight"
                        >{{ part.text }}</mark
                      >
                      <template v-else>{{ part.text }}</template>
                    </template>
                  </span>
                </button>
              </li>
            </ul>
          </div>
        </template>
      </div>
    </section>

    <footer class="space-y-0.5 border-t border-border px-2 py-2">
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-fg"
        data-testid="theme-toggle"
        @click="toggleTheme()"
      >
        <component :is="isDark ? Sun : Moon" :size="16" />
        {{ isDark ? '切换到浅色主题' : '切换到深色主题' }}
      </button>
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-fg"
        data-testid="help-btn"
        @click="ui.helpOpen = true"
      >
        <Keyboard :size="16" />
        快捷键帮助
        <kbd class="ml-auto rounded border border-border px-1 text-xs">?</kbd>
      </button>
    </footer>
  </aside>
</template>
