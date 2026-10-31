<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Check, ChevronDown } from '@lucide/vue'

interface TypeOption {
  value: string
  label: string
  color?: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: TypeOption[]
    label?: string
    placeholder?: string
    disabled?: boolean
  }>(),
  {
    label: '',
    placeholder: '选择类型',
    disabled: false,
  },
)

const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)

const selected = computed(
  () => props.options.find((option) => option.value === props.modelValue) ?? null,
)

function toggle(): void {
  if (props.disabled) {
    return
  }
  open.value = !open.value
}

function choose(value: string): void {
  emit('update:modelValue', value)
  open.value = false
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (root.value && !root.value.contains(event.target as Node)) {
    open.value = false
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
})
</script>

<template>
  <div ref="root" class="relative block">
    <span v-if="label" class="mb-1 block text-sm text-muted">{{ label }}</span>
    <button
      type="button"
      class="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      :disabled="disabled"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggle"
      @keydown.esc.stop="open = false"
    >
      <span class="flex min-w-0 items-center gap-2">
        <span
          v-if="selected?.color"
          class="size-2.5 shrink-0 rounded-full"
          :style="{ backgroundColor: selected.color }"
        />
        <span class="truncate" :class="selected ? '' : 'text-muted'">
          {{ selected?.label ?? placeholder }}
        </span>
      </span>
      <ChevronDown :size="14" class="shrink-0 text-muted" />
    </button>

    <ul
      v-if="open"
      role="listbox"
      class="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-bg p-1 shadow-lg"
    >
      <li v-for="option in options" :key="option.value">
        <button
          type="button"
          role="option"
          :aria-selected="option.value === modelValue"
          class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface-2"
          :class="option.value === modelValue ? 'text-fg' : 'text-muted'"
          @click="choose(option.value)"
        >
          <span
            class="size-2.5 shrink-0 rounded-full"
            :style="{ backgroundColor: option.color ?? 'var(--muted)' }"
          />
          <span class="truncate">{{ option.label }}</span>
          <Check
            v-if="option.value === modelValue"
            :size="14"
            class="ml-auto shrink-0 text-accent"
          />
        </button>
      </li>
      <li v-if="options.length === 0" class="px-2 py-1.5 text-xs text-muted">暂无可用类型</li>
    </ul>
  </div>
</template>
