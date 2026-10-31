<script setup lang="ts">
import { ref } from 'vue'
import { Plus, X } from '@lucide/vue'
import type { PropertyValue } from '@/services/types'

const props = defineProps<{
  modelValue: Record<string, PropertyValue>
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: Record<string, PropertyValue>): void
}>()

interface PropertyRow {
  key: string
  value: string
}

function toDisplay(value: PropertyValue): string {
  return value === null ? '' : String(value)
}

function initialRows(value: Record<string, PropertyValue>): PropertyRow[] {
  return Object.entries(value).map(([key, item]) => ({ key, value: toDisplay(item) }))
}

/** 数字、布尔自动还原为对应类型，其余保持字符串。 */
function parseValue(text: string): PropertyValue {
  if (text === '') {
    return ''
  }
  const trimmed = text.trim()
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed)
  }
  if (trimmed === 'true') {
    return true
  }
  if (trimmed === 'false') {
    return false
  }
  return text
}

function toRecord(rows: PropertyRow[]): Record<string, PropertyValue> {
  const record: Record<string, PropertyValue> = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (key !== '') {
      record[key] = parseValue(row.value)
    }
  }
  return record
}

const rows = ref<PropertyRow[]>(initialRows(props.modelValue))

function commit(): void {
  emit('update:modelValue', toRecord(rows.value))
}

function onKeyInput(row: PropertyRow, event: Event): void {
  row.key = (event.target as HTMLInputElement).value
  commit()
}

function onValueInput(row: PropertyRow, event: Event): void {
  row.value = (event.target as HTMLInputElement).value
  commit()
}

function addRow(): void {
  rows.value.push({ key: '', value: '' })
  commit()
}

function removeRow(index: number): void {
  rows.value.splice(index, 1)
  commit()
}
</script>

<template>
  <div class="block">
    <span class="mb-1 block text-sm text-muted">自定义属性</span>
    <div v-if="rows.length > 0" class="space-y-1.5">
      <div
        v-for="(row, index) in rows"
        :key="index"
        class="flex items-start gap-1.5"
        data-testid="property-row"
      >
        <input
          :value="row.key"
          type="text"
          placeholder="属性名"
          aria-label="属性名"
          data-testid="property-key-input"
          class="w-1/3 rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @input="onKeyInput(row, $event)"
        />
        <input
          :value="row.value"
          type="text"
          placeholder="属性值"
          aria-label="属性值"
          data-testid="property-value-input"
          class="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @input="onValueInput(row, $event)"
        />
        <button
          type="button"
          class="rounded p-1 text-muted hover:bg-surface-2 hover:text-danger"
          title="删除属性"
          aria-label="删除属性"
          @click="removeRow(index)"
        >
          <X :size="14" />
        </button>
      </div>
    </div>
    <p v-else class="text-xs text-muted">暂无自定义属性</p>
    <button
      type="button"
      class="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline"
      data-testid="add-property-btn"
      @click="addRow"
    >
      <Plus :size="14" />
      添加属性
    </button>
  </div>
</template>
