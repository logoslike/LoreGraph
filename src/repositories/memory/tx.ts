import type { TableName, TransactionRunner } from '@/repositories/types'

/**
 * 内存版事务执行器。
 * 内存仓储没有回滚能力，这里直接执行回调，仅提供统一的事务接口；
 * 真正的原子性由 T2 的 Dexie 实现保证。
 */
export class MemoryTransactionRunner implements TransactionRunner {
  async run<T>(_tables: TableName[], fn: () => Promise<T>): Promise<T> {
    return await fn()
  }
}
