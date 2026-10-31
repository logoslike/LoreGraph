import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

const baseURL = 'http://127.0.0.1:4173'
const isCI = Boolean(process.env.CI)

/**
 * 本机沙箱需要该 shim 规避 Vite 对 cwd realpath 的探测（spawn EPERM）；
 * 该目录被 .gitignore 忽略，CI 上不存在时退化为普通启动，避免 --import 缺文件。
 */
const SANDBOX_SHIM = './.local/sandbox-shim.mjs'
const webserverEnv = { ...process.env } as Record<string, string>
if (existsSync(fileURLToPath(new URL(SANDBOX_SHIM, import.meta.url)))) {
  webserverEnv.NODE_OPTIONS = `--import ${SANDBOX_SHIM}`
}

export default defineConfig({
  testDir: 'tests/e2e',
  // 串行执行：所有用例共用同一个 dev server，且断言依赖 IndexedDB 的单上下文语义。
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    // 未设置时使用 Playwright 自带 chromium（CI 默认走这条）；本机可用 PLAYWRIGHT_CHANNEL=msedge 复用系统 Edge。
    channel: process.env.PLAYWRIGHT_CHANNEL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    // 固定 1440x900：默认 1280x720 下画布可用宽度不足，拖拽节点容易落到侧边面板下方。
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'npm run dev -- --port 4173 --strictPort',
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
    env: webserverEnv,
  },
  projects: [{ name: 'chromium' }],
})
