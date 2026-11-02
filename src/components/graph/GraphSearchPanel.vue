<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Focus, Search, X } from '@lucide/vue'
import { searchNodes } from '@/services/search'
import { useGraphStore } from '@/stores/graph'
import { useTypesStore } from '@/stores/types'
import { useUiStore } from '@/stores/ui'

/**
 * 画布内的节点查找面板：与侧栏搜索共用 ui.searchQuery，
 * 一处输入、两处同步，避免在同一个工作区里维护两套搜索词。
 * 面板不遮挡画布：只占右上角卡片区域，点击画布、拖拽和快捷键照常工作。
 */
const emit = defineEmits<{
  (event: 'close'): void
  (event: 'locate', nodeId: string): void
  (event: 'focus', nodeId: string): void
}>()

const graph = useGraphStore()
const types = useTypesStore()
const ui = useUiStore()

const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)
const activeIndex = ref(0)

const SEARCH_RESULTS_ID = 'graph-search-results'
/** 活动项 id 由当前索引生成，保证 aria-activedescendant 永远指向真实存在的 option。 */
function optionId(index: number): string {
  return `graph-search-option-${index}`
}

const keyword = computed(() => ui.searchQuery.trim())
const results = computed(() =>
  keyword.value === '' ? [] : searchNodes(graph.nodes, ui.searchQuery),
)
const hasQuery = computed(() => keyword.value !== '')
/** 结果列表只有在有查询且至少一条结果时才存在。 */
const listOpen = computed(() => hasQuery.value && results.value.length > 0)
/** 防御结果收缩后 activeIndex 短暂越界，语义引用始终落在有效项上。 */
const selectedIndex = computed(() => {
  if (results.value.length === 0) {
    return -1
  }
  return Math.min(activeIndex.value, results.value.length - 1)
})
const activeDescendantId = computed(() =>
  listOpen.value && selectedIndex.value >= 0 ? optionId(selectedIndex.value) : undefined,
)
/** 当前活动结果：Focus 操作作为 listbox 外的独立按钮，作用于它。 */
const activeNode = computed(() =>
  selectedIndex.value >= 0 ? (results.value[selectedIndex.value] ?? null) : null,
)

function typeLabelOf(typeKey: string): string {
  return types.nodeTypeByKey(typeKey)?.label ?? typeKey
}

function colorOf(typeKey: string): string {
  return types.nodeTypeByKey(typeKey)?.color ?? 'var(--muted)'
}

/** 输入即写入共享搜索词；画布高亮与侧栏节点库会同步更新。 */
function onInput(event: Event): void {
  ui.setSearch((event.target as HTMLInputElement).value)
}

function focusInput(): void {
  const input = inputRef.value
  if (input) {
    input.focus()
    input.select()
  }
}

function clearSearch(): void {
  ui.setSearch('')
  void nextTick(focusInput)
}

function scrollActiveIntoView(): void {
  void nextTick(() => {
    const item = listRef.value?.querySelector<HTMLElement>(
      `[data-result-index="${activeIndex.value}"]`,
    )
    if (item && typeof item.scrollIntoView === 'function') {
      item.scrollIntoView({ block: 'nearest' })
    }
  })
}

/** 上下键在结果间循环移动，保持输入框焦点，方便继续输入或回车定位。 */
function moveActive(step: number): void {
  const count = results.value.length
  if (count === 0) {
    return
  }
  activeIndex.value = (activeIndex.value + step + count) % count
  scrollActiveIntoView()
}

function onInputKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveActive(1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveActive(-1)
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    if (selectedIndex.value < 0) {
      return
    }
    const node = results.value[selectedIndex.value]
    if (node) {
      locate(node.id, selectedIndex.value)
    }
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
  }
}

function locate(nodeId: string, index: number): void {
  activeIndex.value = index
  emit('locate', nodeId)
  // 点击结果后回到输入框，继续用键盘切换其他结果
  void nextTick(focusInput)
}

function focusNode(nodeId: string, index: number): void {
  activeIndex.value = index
  emit('focus', nodeId)
  void nextTick(focusInput)
}

watch([keyword, results], () => {
  activeIndex.value = 0
})

onMounted(() => {
  void nextTick(focusInput)
})
</script>

<template>
  <div
    class="graph-search"
    role="search"
    aria-label="查找节点"
    data-testid="graph-search-panel"
    @keydown.esc.stop.prevent="emit('close')"
  >
    <div class="flex items-center justify-between gap-2 px-1 pb-1.5">
      <span class="text-xs font-medium text-fg">查找节点</span>
      <button
        type="button"
        class="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg"
        data-testid="graph-search-close"
        aria-label="关闭查找"
        title="关闭查找（Esc）"
        @click="emit('close')"
      >
        <X :size="14" />
      </button>
    </div>

    <label class="relative block">
      <Search
        :size="14"
        class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted"
      />
      <input
        ref="inputRef"
        :value="ui.searchQuery"
        type="search"
        autocomplete="off"
        spellcheck="false"
        placeholder="查找节点名称或描述…"
        aria-label="查找节点名称或描述"
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        :aria-expanded="listOpen ? 'true' : 'false'"
        :aria-controls="listOpen ? SEARCH_RESULTS_ID : undefined"
        :aria-activedescendant="activeDescendantId"
        data-testid="graph-search-input"
        class="graph-search__input w-full rounded-md border border-border bg-bg py-1.5 pr-8 pl-8 text-sm text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @input="onInput"
        @keydown="onInputKeydown"
      />
      <button
        v-if="hasQuery"
        type="button"
        class="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-muted hover:bg-surface-2 hover:text-fg"
        data-testid="graph-search-clear"
        aria-label="清空查找"
        title="清空查找"
        @click="clearSearch"
      >
        <X :size="14" />
      </button>
    </label>

    <p
      v-if="hasQuery"
      class="px-1 pt-1.5 text-[11px] tabular-nums text-muted"
      aria-live="polite"
      data-testid="graph-search-count"
    >
      {{ results.length }} 个匹配
    </p>

    <p v-if="!hasQuery" class="px-2 py-3 text-xs text-muted" data-testid="graph-search-hint">
      输入名称或描述查找节点，选中结果即可定位到画布中心。
    </p>
    <p
      v-else-if="graph.nodes.length === 0"
      class="px-2 py-3 text-xs text-muted"
      data-testid="graph-search-empty-world"
    >
      当前世界还没有节点。
    </p>
    <p
      v-else-if="results.length === 0"
      class="px-2 py-3 text-xs text-muted"
      data-testid="graph-search-empty"
    >
      没有匹配的节点，换个关键词试试。
    </p>
    <ul
      v-else
      :id="SEARCH_RESULTS_ID"
      ref="listRef"
      role="listbox"
      aria-label="查找结果"
      class="graph-search__results mt-1 space-y-0.5"
      data-testid="graph-search-results"
    >
      <li
        v-for="(node, index) in results"
        :id="optionId(index)"
        :key="node.id"
        role="option"
        :aria-selected="selectedIndex === index ? 'true' : 'false'"
        :data-result-index="index"
        :data-active="selectedIndex === index ? 'true' : 'false'"
        data-testid="graph-search-result"
        :data-node-id="node.id"
        class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5"
        :class="selectedIndex === index ? 'bg-surface-2' : 'hover:bg-surface-2'"
        @click="locate(node.id, index)"
      >
        <span
          class="size-2 shrink-0 rounded-full"
          :style="{ backgroundColor: colorOf(node.type) }"
          aria-hidden="true"
        />
        <span class="truncate text-xs text-fg">{{ node.name }}</span>
        <span class="ml-auto shrink-0 text-[11px] text-muted">{{ typeLabelOf(node.type) }}</span>
      </li>
    </ul>

    <div class="mt-1 flex items-center justify-between gap-1 border-t border-border px-1 pt-1.5">
      <p class="text-[11px] text-muted">↑↓ 选择 · Enter 定位 · Esc 关闭</p>
      <button
        v-if="listOpen && activeNode"
        type="button"
        class="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-accent"
        data-testid="graph-search-focus-btn"
        :aria-label="`聚焦「${activeNode.name}」`"
        title="聚焦当前结果（只看直接相邻节点）"
        @click="focusNode(activeNode.id, selectedIndex)"
      >
        <Focus :size="13" />
        聚焦
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 画布右上角的非模态查找卡片：不铺遮罩，不阻断画布平移与点选 */
.graph-search {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 8;
  width: 288px;
  max-width: calc(100% - 24px);
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg);
  color: var(--fg);
  box-shadow: 0 6px 24px rgb(0 0 0 / 14%);
}

.graph-search__results {
  max-height: 240px;
  overflow-y: auto;
}

/* 清空按钮已单独提供，隐藏 WebKit 自带的搜索取消图标避免出现两个 X */
.graph-search__input::-webkit-search-cancel-button {
  display: none;
}
</style>
