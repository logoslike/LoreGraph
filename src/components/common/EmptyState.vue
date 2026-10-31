<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    description?: string
  }>(),
  {
    description: '',
  },
)
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
    <div v-if="$slots.icon" class="text-muted">
      <slot name="icon" />
    </div>
    <h3 class="text-sm font-medium text-fg">{{ title }}</h3>
    <p v-if="description" class="max-w-sm text-xs text-muted">{{ description }}</p>
    <div v-if="$slots.action" class="mt-2">
      <slot name="action" />
    </div>
  </div>
</template>
