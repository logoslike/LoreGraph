import { createLoreDatabase } from '@/db/schema'
import { createDexieRepositories } from '@/repositories'
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
  const importer = new ImportServiceImpl(repos)
  return {
    universes: new UniverseServiceImpl(repos, importer),
    graph: new GraphServiceImpl(repos),
    types: new TypeServiceImpl(repos),
    importer,
    exporter: new ExportServiceImpl(repos),
    autosave: new DebouncedAutosave(),
  }
}

/** 浏览器端默认单例：Dexie 持久化仓储。 */
export const services: Services = createServices(createDexieRepositories(createLoreDatabase()))
