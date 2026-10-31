<script setup lang="ts">
withDefaults(
  defineProps<{
    color: string
    label?: string
  }>(),
  {
    label: '',
  },
)
</script>

<template>
  <span class="inline-flex items-center gap-1.5 text-xs text-fg">
    <span class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: color }" />
    <span v-if="label">{{ label }}</span>
  </span>
</template>
