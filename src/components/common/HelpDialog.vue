<script setup lang="ts">
import BaseButton from './BaseButton.vue'
import BaseDialog from './BaseDialog.vue'

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{ (event: 'close'): void }>()

interface ShortcutRow {
  keys: string
  description: string
}

const SHORTCUTS: ShortcutRow[] = [
  { keys: 'N', description: '在当前世界新建节点' },
  { keys: 'Delete', description: '删除选中的节点或关系（可在通知中撤销）' },
  { keys: 'Esc', description: '取消选中，或关闭当前对话框' },
  { keys: 'Ctrl / ⌘ + K', description: '聚焦侧边栏搜索框' },
  { keys: '?', description: '打开本快捷键帮助' },
]
</script>

<template>
  <BaseDialog :open="open" title="快捷键" width="440px" @close="emit('close')">
    <dl class="divide-y divide-border">
      <div
        v-for="row in SHORTCUTS"
        :key="row.keys"
        class="flex items-center justify-between gap-4 py-2"
      >
        <dt class="text-sm text-fg">{{ row.description }}</dt>
        <dd>
          <kbd
            class="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-xs text-muted"
            >{{ row.keys }}</kbd
          >
        </dd>
      </div>
    </dl>
    <template #footer>
      <BaseButton variant="secondary" size="sm" @click="emit('close')">知道了</BaseButton>
    </template>
  </BaseDialog>
</template>
