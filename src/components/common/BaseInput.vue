<script setup lang="ts">
defineOptions({ inheritAttrs: false })

withDefaults(
  defineProps<{
    modelValue: string
    label?: string
    placeholder?: string
    type?: string
  }>(),
  {
    label: '',
    placeholder: '',
    type: 'text',
  },
)

const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>()

function onInput(event: Event): void {
  const target = event.target as HTMLInputElement
  emit('update:modelValue', target.value)
}
</script>

<template>
  <label class="block">
    <span v-if="label" class="mb-1 block text-sm text-muted">{{ label }}</span>
    <input
      v-bind="$attrs"
      :value="modelValue"
      :type="type"
      :placeholder="placeholder"
      class="w-full rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      @input="onInput"
    />
  </label>
</template>
