<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { ArrowLeft, Compass } from '@lucide/vue'
</script>

<template>
  <main
    class="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-6 text-center text-fg"
  >
    <span class="flex size-14 items-center justify-center rounded-2xl bg-surface-2 text-muted">
      <Compass :size="30" />
    </span>
    <p class="text-sm font-mono text-muted">404</p>
    <h1 class="text-2xl font-semibold">页面不存在</h1>
    <p class="max-w-md text-sm text-muted">
      你访问的地址没有对应的页面，可能已经被删除或输入有误。回到世界列表继续整理你的设定吧。
    </p>
    <div class="mt-2 flex items-center gap-2">
      <RouterLink
        to="/"
        class="inline-flex items-center justify-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-sm font-medium text-accent-fg transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft :size="16" />
        返回世界列表
      </RouterLink>
    </div>
  </main>
</template>
