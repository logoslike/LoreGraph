import type { LoreDatabase } from '@/db/schema'
import type { TableName, TransactionRunner } from '@/repositories/types'

/** Dexie 版事务执行器：把表名映射为表实例后开启读写事务。 */
export class DexieTransactionRunner implements TransactionRunner {
  constructor(private readonly db: LoreDatabase) {}

  async run<T>(tables: TableName[], fn: () => Promise<T>): Promise<T> {
    const tableInstances = tables.map((name) => this.db.table(name))
    return await this.db.transaction('rw', tableInstances, async () => fn())
  }
}
