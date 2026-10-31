<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <main class="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 px-6 py-16">
    <h1 class="text-2xl font-semibold text-fg">世界列表</h1>
    <p class="text-sm text-muted">
      这里将展示全部世界卡片；当前为 Phase 0 占位视图，业务 UI 由后续任务实现。
    </p>
    <RouterLink to="/u/demo-universe" class="text-sm text-accent hover:underline">
      进入示例工作区
    </RouterLink>
  </main>
</template>
