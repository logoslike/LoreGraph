<script setup lang="ts">
import { LUCIDE_ICONS } from '@/models/icons'

withDefaults(
  defineProps<{
    modelValue?: string
    label?: string
  }>(),
  {
    modelValue: '',
    label: '图标',
  },
)

const emit = defineEmits<{ (event: 'update:modelValue', value: string | undefined): void }>()

const iconNames = Object.keys(LUCIDE_ICONS)

function select(name: string): void {
  emit('update:modelValue', name)
}

function clear(): void {
  emit('update:modelValue', undefined)
}
</script>

<template>
  <div class="block">
    <div class="mb-1 flex items-center justify-between">
      <span class="text-sm text-muted">{{ label }}</span>
      <button
        v-if="modelValue"
        type="button"
        class="text-xs text-accent hover:underline"
        @click="clear"
      >
        清除图标
      </button>
    </div>
    <div
      class="grid max-h-40 grid-cols-8 gap-1 overflow-y-auto rounded-md border border-border bg-bg p-1.5"
    >
      <button
        v-for="name in iconNames"
        :key="name"
        type="button"
        class="flex items-center justify-center rounded p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
        :class="name === modelValue ? 'bg-accent/10 text-accent' : ''"
        :title="name"
        :aria-label="name"
        :aria-pressed="name === modelValue"
        @click="select(name)"
      >
        <component :is="LUCIDE_ICONS[name]" :size="16" />
      </button>
    </div>
  </div>
</template>
