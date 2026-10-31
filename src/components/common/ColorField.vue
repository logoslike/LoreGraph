<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    label?: string
  }>(),
  {
    label: '',
  },
)

const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>()

/** 与 models/type-def 的 colorSchema 保持一致。 */
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

const draft = ref(props.modelValue)
const valid = computed(() => COLOR_PATTERN.test(draft.value))

watch(
  () => props.modelValue,
  (value) => {
    draft.value = value
  },
)

function onColorInput(event: Event): void {
  const value = (event.target as HTMLInputElement).value
  draft.value = value
  if (COLOR_PATTERN.test(value)) {
    emit('update:modelValue', value)
  }
}

function onTextInput(event: Event): void {
  draft.value = (event.target as HTMLInputElement).value
  if (COLOR_PATTERN.test(draft.value)) {
    emit('update:modelValue', draft.value)
  }
}
</script>

<template>
  <label class="block">
    <span v-if="label" class="mb-1 block text-sm text-muted">{{ label }}</span>
    <span class="flex items-center gap-2">
      <input
        type="color"
        class="size-8 shrink-0 cursor-pointer rounded border border-border bg-bg p-0.5"
        :value="valid ? draft : modelValue"
        aria-label="选择颜色"
        @input="onColorInput"
      />
      <input
        type="text"
        class="w-full rounded-md border bg-bg px-2.5 py-1.5 font-mono text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="valid ? 'border-border' : 'border-danger'"
        :value="draft"
        maxlength="7"
        spellcheck="false"
        placeholder="#6366f1"
        @input="onTextInput"
      />
    </span>
    <span v-if="!valid" class="mt-1 block text-xs text-danger"
      >颜色需为 6 位十六进制，例如 #6366f1</span
    >
  </label>
</template>
