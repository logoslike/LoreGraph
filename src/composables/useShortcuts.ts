import { onBeforeUnmount } from 'vue'

/** 搜索输入框的 DOM id，Ctrl/Cmd+K 与 Sidebar 共用。 */
export const SEARCH_INPUT_ID = 'loregraph-search-input'

/** 全局快捷键处理器：只声明行为，不关心具体视图。 */
export interface ShortcutHandlers {
  /** N：打开新建节点对话框。 */
  onCreateNode?: () => void
  /** Delete/Backspace：删除当前选中的节点或关系。 */
  onDeleteSelection?: () => void
  /** Esc：关闭弹层或取消选中。 */
  onEscape?: () => void
  /** Esc：退出聚焦模式（对话框打开或事件已被其他逻辑消费时不触发）。 */
  onExitFocus?: () => void
  /** F：进入或退出聚焦模式。 */
  onToggleFocus?: () => void
  /** Ctrl/Cmd+K：聚焦搜索框。 */
  onFocusSearch?: () => void
  /** ?：打开快捷键帮助。 */
  onToggleHelp?: () => void
}

/** 判断事件目标是否处于文本输入场景，避免抢占输入。 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true
  }
  return target.isContentEditable
}

/** 是否有原生 dialog 处于打开状态：此时只响应 Esc。 */
function hasOpenDialog(): boolean {
  return typeof document !== 'undefined' && document.querySelector('dialog[open]') !== null
}

/**
 * 注册全局快捷键，返回注销函数。
 * 同时只应在工作区视图挂载一次，避免重复监听。
 */
export function useShortcuts(handlers: ShortcutHandlers): () => void {
  function onKeydown(event: KeyboardEvent): void {
    if (event.isComposing) {
      return
    }

    const modifier = event.ctrlKey || event.metaKey
    const key = event.key

    // Ctrl/Cmd+K：搜索框聚焦（输入态下同样可用）
    if (modifier && !event.altKey && key.toLowerCase() === 'k') {
      event.preventDefault()
      handlers.onFocusSearch?.()
      return
    }

    // Esc：先退出聚焦（对话框自行处理 Esc，已被消费的事件也不重复处理），
    // 再交给视图取消选中或关闭弹层
    if (key === 'Escape') {
      if (!event.defaultPrevented && !hasOpenDialog() && !isEditableTarget(event.target)) {
        handlers.onExitFocus?.()
      }
      handlers.onEscape?.()
      return
    }

    // 输入中或对话框打开时不再响应无修饰键快捷键
    if (isEditableTarget(event.target) || hasOpenDialog()) {
      return
    }
    if (modifier || event.altKey) {
      return
    }

    if (key.toLowerCase() === 'n') {
      event.preventDefault()
      handlers.onCreateNode?.()
      return
    }

    if (key.toLowerCase() === 'f') {
      event.preventDefault()
      handlers.onToggleFocus?.()
      return
    }

    if (key === 'Delete' || key === 'Backspace') {
      if (handlers.onDeleteSelection) {
        event.preventDefault()
        handlers.onDeleteSelection()
      }
      return
    }

    if (key === '?') {
      event.preventDefault()
      handlers.onToggleHelp?.()
    }
  }

  window.addEventListener('keydown', onKeydown)

  function stop(): void {
    window.removeEventListener('keydown', onKeydown)
  }

  onBeforeUnmount(stop)

  return stop
}
