<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ChevronDown,
  Keyboard,
  Moon,
  PanelLeftClose,
  Plus,
  Search,
  Sparkles,
  Sun,
  X,
} from '@lucide/vue'
import BaseButton from '@/components/common/BaseButton.vue'
import TypeDot from '@/components/common/TypeDot.vue'
import { SEARCH_INPUT_ID } from '@/composables/useShortcuts'
import { useTheme } from '@/composables/useTheme'
import { visibleNodes } from '@/services/search'
import { useGraphStore } from '@/stores/graph'
import { useTypesStore } from '@/stores/types'
import { useUiStore } from '@/stores/ui'
import { useUniverseStore } from '@/stores/universe'

defineOptions({ name: 'AppSidebar' })

const emit = defineEmits<{ (event: 'create-node'): void }>()

const route = useRoute()
const router = useRouter()
const universes = useUniverseStore()
const types = useTypesStore()
const graph = useGraphStore()
const ui = useUiStore()
const { isDark, toggleTheme } = useTheme()

const currentUniverseId = computed(() => String(route.params.universeId ?? ''))

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

/** 同时受搜索词与类型筛选影响的节点列表。 */
const filteredNodes = computed(() =>
  visibleNodes(graph.nodes, {
    activeTypeKeys: ui.activeTypeKeys,
    searchQuery: ui.searchQuery,
  }),
)

function typeColor(key: string): string {
  return types.nodeTypeByKey(key)?.color ?? 'var(--muted)'
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

function selectNode(id: string): void {
  graph.selectNode(id)
}
</script>

<template>
  <aside
    class="flex h-full w-full flex-col border-r border-border bg-surface text-fg"
    data-testid="sidebar"
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
          placeholder="搜索节点名称…"
          aria-label="搜索节点名称"
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

    <section class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <div class="mb-1.5 flex items-center justify-between">
        <h2 class="text-xs font-medium tracking-wide text-muted uppercase">类型筛选</h2>
        <button
          v-if="ui.activeTypeKeys.length > 0"
          type="button"
          class="text-xs text-accent hover:underline"
          data-testid="clear-type-filters"
          @click="ui.clearTypeFilters()"
        >
          清除
        </button>
      </div>
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

      <template v-if="graph.nodes.length > 0">
        <div class="my-2 border-t border-border" />
        <h2 class="mb-1.5 text-xs font-medium tracking-wide text-muted uppercase">
          节点（{{ filteredNodes.length }}）
        </h2>
        <ul v-if="filteredNodes.length > 0" class="space-y-0.5">
          <li v-for="node in filteredNodes" :key="node.id">
            <button
              type="button"
              data-testid="node-list-item"
              :data-node-id="node.id"
              class="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-surface-2"
              :class="graph.selectedNodeId === node.id ? 'bg-surface-2 text-fg' : 'text-muted'"
              @click="selectNode(node.id)"
            >
              <span
                class="size-2 shrink-0 rounded-full"
                :style="{ backgroundColor: typeColor(node.type) }"
              />
              <span class="truncate">{{ node.name }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="px-1.5 py-2 text-xs text-muted">没有匹配的节点</p>
      </template>
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
