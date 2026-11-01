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
    class="m-auto max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-bg p-0 text-fg shadow-xl backdrop:bg-black/40 open:flex"
    :style="{ width }"
    @cancel="onCancel"
    @click="onBackdropClick"
  >
    <!-- m-auto 必须显式声明：Tailwind preflight 把全部元素 margin 重置为 0，
         原生模态 dialog 依赖 UA 的 margin: auto 居中，重置后会贴在视口左上角。
         高度上限 + flex 纵向布局让内容超高时在正文区内部滚动。
         flex 只能用 open: 变体：无条件 flex（display: flex）会盖掉 UA 的
         dialog:not([open]) { display: none }，让所有未打开的对话框依然可见并拦截点击。
         open 变体匹配 [open] 属性，showModal() 与 setAttribute 回退路径都会设置它。
         注释放在 dialog 内部，保证模板根节点是唯一的 dialog，属性（如 data-testid）才能透传。 -->
    <header
      v-if="title"
      class="flex shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-3"
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
    <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <slot />
    </div>
    <footer
      v-if="$slots.footer"
      class="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3"
    >
      <slot name="footer" />
    </footer>
  </dialog>
</template>
