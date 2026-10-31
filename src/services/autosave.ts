import type { Autosave } from './types'

/** 自动保存防抖间隔（毫秒）。 */
export const AUTOSAVE_DELAY_MS = 400

interface PendingTask {
  timer: ReturnType<typeof setTimeout>
  task: () => Promise<void>
}

/** 按 key 防抖的自动保存：同一 key 的重复 schedule 只保留最后一次任务。 */
export class DebouncedAutosave implements Autosave {
  private readonly pending = new Map<string, PendingTask>()

  schedule(key: string, task: () => Promise<void>): void {
    const existing = this.pending.get(key)
    if (existing) {
      clearTimeout(existing.timer)
    }
    const timer = setTimeout(() => {
      this.pending.delete(key)
      void this.execute(task)
    }, AUTOSAVE_DELAY_MS)
    this.pending.set(key, { timer, task })
  }

  async flushKey(key: string): Promise<void> {
    const pending = this.pending.get(key)
    if (!pending) {
      return
    }
    clearTimeout(pending.timer)
    this.pending.delete(key)
    await this.execute(pending.task)
  }

  async flush(): Promise<void> {
    const keys = [...this.pending.keys()]
    await Promise.all(keys.map((key) => this.flushKey(key)))
  }

  /** 保存失败只记录日志，不影响后续保存。 */
  private async execute(task: () => Promise<void>): Promise<void> {
    try {
      await task()
    } catch (error) {
      console.error('[autosave] 自动保存失败', error)
    }
  }
}
