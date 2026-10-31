<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    width?: string
  }>(),
  {
    title: '',
    width: '480px',
  },
)

const emit = defineEmits<{ (event: 'close'): void }>()

const dialogRef = ref<HTMLDialogElement | null>(null)

/** 同步原生 dialog 的打开状态，兼容未实现 showModal 的环境。 */
function syncOpen(open: boolean): void {
  const dialog = dialogRef.value
  if (!dialog) {
    return
  }
  if (open) {
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') {
        dialog.showModal()
      } else {
        dialog.setAttribute('open', '')
      }
    }
  } else if (dialog.open) {
    dialog.close()
  }
}

watch(
  () => props.open,
  (open) => {
    syncOpen(open)
  },
)

onMounted(() => {
  syncOpen(props.open)
})

onBeforeUnmount(() => {
  const dialog = dialogRef.value
  if (dialog?.open) {
    dialog.close()
  }
})

function onCancel(event: Event): void {
  event.preventDefault()
  emit('close')
}

/** 点击遮罩（事件目标是 dialog 自身）时关闭。 */
function onBackdropClick(event: MouseEvent): void {
  if (event.target === dialogRef.value) {
    emit('close')
  }
}
</script>

<template>
  <dialog
    ref="dialogRef"
    class="max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-bg p-0 text-fg shadow-xl backdrop:bg-black/40"
    :style="{ width }"
    @cancel="onCancel"
    @click="onBackdropClick"
  >
    <header
      v-if="title"
      class="flex items-center justify-between gap-4 border-b border-border px-5 py-3"
    >
      <h2 class="text-base font-semibold">{{ title }}</h2>
      <button
        type="button"
        class="rounded px-2 py-1 text-sm text-muted hover:bg-surface-2"
        aria-label="关闭对话框"
        @click="emit('close')"
      >
        ✕
      </button>
    </header>
    <div class="px-5 py-4">
      <slot />
    </div>
    <footer
      v-if="$slots.footer"
      class="flex justify-end gap-2 border-t border-border px-5 py-3"
    >
      <slot name="footer" />
    </footer>
  </dialog>
</template>
