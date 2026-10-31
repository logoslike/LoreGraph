<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <main class="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 px-6 py-16">
    <h1 class="text-2xl font-semibold text-fg">页面不存在</h1>
    <p class="text-sm text-muted">你访问的地址没有对应的页面，可能已经被删除或输入有误。</p>
    <RouterLink to="/" class="text-sm text-accent hover:underline">返回世界列表</RouterLink>
  </main>
</template>
