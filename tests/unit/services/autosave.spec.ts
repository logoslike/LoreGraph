import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTOSAVE_DELAY_MS, DebouncedAutosave } from '@/services/autosave'

describe('自动保存防抖', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('防抖间隔为 400ms，连续调度只保存最后一次', async () => {
    expect(AUTOSAVE_DELAY_MS).toBe(400)
    const autosave = new DebouncedAutosave()
    const first = vi.fn(async () => Promise.resolve())
    const second = vi.fn(async () => Promise.resolve())

    autosave.schedule('node:1', first)
    await vi.advanceTimersByTimeAsync(200)
    autosave.schedule('node:1', second)

    await vi.advanceTimersByTimeAsync(399)
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })

  it('flushKey 立即执行任务并取消定时器', async () => {
    const autosave = new DebouncedAutosave()
    const task = vi.fn(async () => Promise.resolve())

    autosave.schedule('node:1', task)
    await autosave.flushKey('node:1')
    expect(task).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)
    expect(task).toHaveBeenCalledTimes(1)

    await expect(autosave.flushKey('node:1')).resolves.toBeUndefined()
  })

  it('flush 会执行所有待保存的 key', async () => {
    const autosave = new DebouncedAutosave()
    const nodeTask = vi.fn(async () => Promise.resolve())
    const edgeTask = vi.fn(async () => Promise.resolve())

    autosave.schedule('node:1', nodeTask)
    autosave.schedule('edge:2', edgeTask)
    await autosave.flush()

    expect(nodeTask).toHaveBeenCalledTimes(1)
    expect(edgeTask).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)
    expect(nodeTask).toHaveBeenCalledTimes(1)
    expect(edgeTask).toHaveBeenCalledTimes(1)
  })

  it('保存失败只记录错误，后续保存不受影响', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const autosave = new DebouncedAutosave()
    const failing = vi.fn(async () => {
      throw new Error('写入失败')
    })

    autosave.schedule('node:1', failing)
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)
    await vi.advanceTimersByTimeAsync(0)
    expect(errorSpy).toHaveBeenCalled()

    const recovered = vi.fn(async () => Promise.resolve())
    autosave.schedule('node:1', recovered)
    await autosave.flush()
    expect(recovered).toHaveBeenCalledTimes(1)
  })
})
