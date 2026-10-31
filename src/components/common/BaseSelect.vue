<script setup lang="ts">
withDefaults(
  defineProps<{
    modelValue: string
    options: { value: string; label: string }[]
    label?: string
  }>(),
  {
    label: '',
  },
)

const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>()

function onChange(event: Event): void {
  const target = event.target as HTMLSelectElement
  emit('update:modelValue', target.value)
}
</script>

<template>
  <label class="block">
    <span v-if="label" class="mb-1 block text-sm text-muted">{{ label }}</span>
    <select
      :value="modelValue"
      class="w-full rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      @change="onChange"
    >
      <option v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
  </label>
</template>
