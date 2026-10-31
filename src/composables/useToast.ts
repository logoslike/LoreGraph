import { useUiStore } from '@/stores/ui'
import type { ToastOptions } from '@/stores/ui'

/** 通知能力：统一封装 ui store 的通知队列与撤销动作。 */
export interface ToastApi {
  /** 通用通知，可自定义模板与操作按钮。 */
  notify: (message: string, options?: ToastOptions) => string
  /** 普通信息通知。 */
  info: (message: string, options?: Omit<ToastOptions, 'variant'>) => string
  /** 错误通知（红色边框）。 */
  danger: (message: string, options?: Omit<ToastOptions, 'variant'>) => string
  /** 带「撤销」按钮的通知，默认展示 8 秒。 */
  undo: (message: string, onAction: () => void) => string
  /** 手动关闭指定通知。 */
  dismiss: (id: string) => void
  /** 清空当前全部通知。 */
  clear: () => void
}

/** 通知组合式函数：业务代码只依赖它，不直接操作 ui.toasts。 */
export function useToast(): ToastApi {
  const ui = useUiStore()

  function notify(message: string, options: ToastOptions = {}): string {
    return ui.notify(message, options)
  }

  function info(message: string, options: Omit<ToastOptions, 'variant'> = {}): string {
    return ui.notify(message, { ...options, variant: 'info' })
  }

  function danger(message: string, options: Omit<ToastOptions, 'variant'> = {}): string {
    return ui.notify(message, { ...options, variant: 'danger' })
  }

  function undo(message: string, onAction: () => void): string {
    return ui.notify(message, {
      variant: 'info',
      actionLabel: '撤销',
      duration: 8000,
      onAction,
    })
  }

  function dismiss(id: string): void {
    ui.dismissToast(id)
  }

  function clear(): void {
    for (const toast of [...ui.toasts]) {
      ui.dismissToast(toast.id)
    }
  }

  return { notify, info, danger, undo, dismiss, clear }
}
