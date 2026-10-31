import { createMemoryRepositories } from '@/repositories/memory'
import type { Repositories } from '@/repositories/types'
import { DebouncedAutosave } from './autosave'
import { ExportServiceImpl } from './export.service'
import { GraphServiceImpl } from './graph.service'
import { ImportServiceImpl } from './import.service'
import { TypeServiceImpl } from './type.service'
import type { Services } from './types'
import { UniverseServiceImpl } from './universe.service'

/** 用给定仓储装配全部服务。 */
export function createServices(repos: Repositories): Services {
  return {
    universes: new UniverseServiceImpl(repos),
    graph: new GraphServiceImpl(repos),
    types: new TypeServiceImpl(repos),
    importer: new ImportServiceImpl(repos),
    exporter: new ExportServiceImpl(repos),
    autosave: new DebouncedAutosave(),
  }
}

/** 默认单例：T1 先装配内存仓储，T2 切换为 Dexie 实现。 */
export const services: Services = createServices(createMemoryRepositories())
