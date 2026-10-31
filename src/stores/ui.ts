import { defineStore } from 'pinia'
import { newId } from '@/models/ids'

export type ThemeMode = 'light' | 'dark'
export type ToastVariant = 'info' | 'danger'

export interface ToastOptions {
  variant?: ToastVariant
  actionLabel?: string
  onAction?: () => void
  duration?: number
}

export interface UiToast {
  id: string
  message: string
  variant: ToastVariant
  actionLabel?: string
  onAction?: () => void
  duration: number
}

const THEME_STORAGE_KEY = 'loregraph.theme'
const DEFAULT_TOAST_DURATION = 4000
const toastTimers = new Map<string, ReturnType<typeof setTimeout>>()

interface UiState {
  theme: ThemeMode
  sidebarCollapsed: boolean
  inspectorCollapsed: boolean
  searchQuery: string
  activeTypeKeys: string[]
  helpOpen: boolean
  toasts: UiToast[]
}

/** 全局 UI 状态：主题、面板折叠、搜索与通知。 */
export const useUiStore = defineStore('ui', {
  state: (): UiState => ({
    theme: 'light',
    sidebarCollapsed: false,
    inspectorCollapsed: false,
    searchQuery: '',
    activeTypeKeys: [],
    helpOpen: false,
    toasts: [],
  }),
  actions: {
    /** 挂载前调用：优先读本地偏好，否则跟随系统配色。 */
    initTheme(): void {
      const saved =
        typeof localStorage === 'undefined' ? null : localStorage.getItem(THEME_STORAGE_KEY)
      const prefersDark =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches
      this.theme = saved === 'light' || saved === 'dark' ? saved : prefersDark ? 'dark' : 'light'
      this.applyTheme()
    },
    toggleTheme(): void {
      this.theme = this.theme === 'dark' ? 'light' : 'dark'
      this.applyTheme()
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(THEME_STORAGE_KEY, this.theme)
        }
      } catch {
        // 存储不可用（隐私模式等）时忽略，主题仍在本次会话生效
      }
    },
    applyTheme(): void {
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('dark', this.theme === 'dark')
      }
    },
    toggleSidebar(): void {
      this.sidebarCollapsed = !this.sidebarCollapsed
    },
    toggleInspector(): void {
      this.inspectorCollapsed = !this.inspectorCollapsed
    },
    setSearch(query: string): void {
      this.searchQuery = query
    },
    toggleTypeFilter(key: string): void {
      const index = this.activeTypeKeys.indexOf(key)
      if (index >= 0) {
        this.activeTypeKeys.splice(index, 1)
      } else {
        this.activeTypeKeys.push(key)
      }
    },
    clearTypeFilters(): void {
      this.activeTypeKeys = []
    },
    /** 显示右下角通知；返回 toast id 便于手动关闭。 */
    notify(message: string, options: ToastOptions = {}): string {
      const toast: UiToast = {
        id: newId(),
        message,
        variant: options.variant ?? 'info',
        actionLabel: options.actionLabel,
        onAction: options.onAction,
        duration: options.duration ?? DEFAULT_TOAST_DURATION,
      }
      this.toasts.push(toast)
      if (toast.duration > 0) {
        const timer = setTimeout(() => {
          toastTimers.delete(toast.id)
          this.dismissToast(toast.id)
        }, toast.duration)
        toastTimers.set(toast.id, timer)
      }
      return toast.id
    },
    dismissToast(id: string): void {
      const timer = toastTimers.get(id)
      if (timer) {
        clearTimeout(timer)
        toastTimers.delete(id)
      }
      this.toasts = this.toasts.filter((toast) => toast.id !== id)
    },
  },
})
