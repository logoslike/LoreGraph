<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

const route = useRoute()
const universeId = computed(() => String(route.params.universeId ?? ''))
</script>

<template>
  <main class="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 px-6 py-16">
    <h1 class="text-2xl font-semibold text-fg">世界工作区</h1>
    <p class="text-sm text-muted">
      当前世界 id：<code class="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{{ universeId }}</code>
    </p>
    <p class="text-sm text-muted">
      三栏图谱工作区将在后续任务中实现；当前为 Phase 0 占位视图。
    </p>
    <RouterLink to="/" class="text-sm text-accent hover:underline">返回世界列表</RouterLink>
  </main>
</template>
