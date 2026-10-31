import { computed, type ComputedRef } from 'vue'
import type { ThemeMode } from '@/stores/ui'
import { useUiStore } from '@/stores/ui'

/** 主题能力：读取当前主题、切换并持久化（持久化由 ui store 负责）。 */
export interface UseThemeReturn {
  /** 当前主题。 */
  theme: ComputedRef<ThemeMode>
  /** 是否为深色主题。 */
  isDark: ComputedRef<boolean>
  /** 重新按本地偏好/系统配色初始化主题，通常只在入口调用一次。 */
  initTheme: () => void
  /** 在浅色与深色之间切换，并写入 localStorage。 */
  toggleTheme: () => void
}

/** 主题组合式函数，组件内以只读方式消费主题状态。 */
export function useTheme(): UseThemeReturn {
  const ui = useUiStore()
  const theme = computed(() => ui.theme)
  const isDark = computed(() => ui.theme === 'dark')

  function initTheme(): void {
    ui.initTheme()
  }

  function toggleTheme(): void {
    ui.toggleTheme()
  }

  return { theme, isDark, initTheme, toggleTheme }
}
