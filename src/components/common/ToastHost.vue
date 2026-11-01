<script setup lang="ts">
import type { UiToast } from '@/stores/ui'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()

function handleAction(toast: UiToast): void {
  toast.onAction?.()
  ui.dismissToast(toast.id)
}
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
    aria-live="polite"
  >
    <div
      v-for="toast in ui.toasts"
      :key="toast.id"
      class="pointer-events-auto flex w-full max-w-md items-center justify-between gap-3 rounded-lg border bg-surface px-4 py-2.5 text-fg shadow-lg"
      :class="toast.variant === 'danger' ? 'border-danger/40' : 'border-border'"
      data-testid="toast"
    >
      <p class="text-sm">{{ toast.message }}</p>
      <div class="flex shrink-0 items-center gap-1">
        <button
          v-if="toast.actionLabel"
          type="button"
          class="rounded px-2 py-1 text-xs font-medium text-accent hover:bg-surface-2"
          data-testid="toast-action-btn"
          @click="handleAction(toast)"
        >
          {{ toast.actionLabel }}
        </button>
        <button
          type="button"
          class="rounded px-2 py-1 text-xs text-muted hover:bg-surface-2"
          aria-label="关闭通知"
          data-testid="toast-dismiss-btn"
          @click="ui.dismissToast(toast.id)"
        >
          ✕
        </button>
      </div>
    </div>
  </div>
</template>
