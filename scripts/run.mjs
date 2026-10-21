import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const ROOT = resolve(import.meta.dirname, '..')
const ENV_FILE = resolve(ROOT, '.env')
const BOCHA_DIR = resolve(ROOT, '.runtime/bocha-search-mcp')
const FLYWORKS_DIR = resolve(ROOT, '.runtime/flyworks-mcp')
const UV_PATH = resolve(ROOT, '.runtime/bin/uv')
const DSH_ENTRY = resolve(ROOT, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const BOCHA_PATCH_FILE = resolve(ROOT, 'config/bocha.cordis.yml')
const FLYWORKS_PATCH_FILE = resolve(ROOT, 'config/flyworks.cordis.yml')
const VARIFLIGHT_PATCH_FILE = resolve(ROOT, 'config/variflight.cordis.yml')
const FLYWORKS_SERVER_PATH = resolve(ROOT, 'mcp/flyworks_server.py')
const VARIFLIGHT_SERVER_PATH = resolve(ROOT, 'mcp/variflight_server.mjs')
const VARIFLIGHT_MCP_ENTRY = resolve(
  ROOT,
  'node_modules/@variflight-ai/tripmatch-mcp/dist/index.js',
)
const FLYWORKS_MEDIA_DIR = resolve(ROOT, '.runtime/media/flyworks')
const FLYWORKS_OUTPUT_DIR = resolve(ROOT, '.runtime/output/flyworks')

if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE)

const apiKey = process.env.BOCHA_API_KEY?.trim()
if (!apiKey) {
  console.error('BOCHA_API_KEY is missing. Copy .env.example to .env and add a rotated key.')
  process.exit(1)
}

const flyworksPythonPath = resolve(ROOT, '.runtime/flyworks-venv/bin/python')
if (
  !existsSync(resolve(BOCHA_DIR, 'uv.lock'))
  || !existsSync(resolve(FLYWORKS_DIR, 'uv.lock'))
  || !existsSync(flyworksPythonPath)
  || !existsSync(VARIFLIGHT_MCP_ENTRY)
  || !existsSync(UV_PATH)
) {
  console.error('MCP dependencies are incomplete. Run: pnpm run setup')
  process.exit(1)
}

if (!existsSync(DSH_ENTRY)) {
  console.error('DeepSeek Harness is not installed. Run: pnpm install')
  process.exit(1)
}

const open = process.argv.includes('--open')
const forwardedArgs = process.argv.slice(2).filter((arg) => arg !== '--open' && arg !== '--')
console.log('Starting DeepSeek Harness; the first profile initialization may take about one minute...')
const child = spawn(process.execPath, [
  DSH_ENTRY,
  'web',
  '--patch',
  BOCHA_PATCH_FILE,
  '--patch',
  FLYWORKS_PATCH_FILE,
  '--patch',
  VARIFLIGHT_PATCH_FILE,
  ...(open ? [] : ['--no-open']),
  ...forwardedArgs,
], {
  cwd: ROOT,
  env: {
    ...process.env,
    BOCHA_API_KEY: apiKey,
    BOCHA_MCP_DIR: BOCHA_DIR,
    BOCHA_UV_PATH: UV_PATH,
    FLYWORKS_API_TOKEN: process.env.FLYWORKS_API_TOKEN?.trim() || '',
    FLYWORKS_API_BASE_URL: process.env.FLYWORKS_API_BASE_URL?.trim()
      || 'https://hfw-api.hifly.cc/api/v2/hifly',
    FLYWORKS_PYTHON_PATH: flyworksPythonPath,
    FLYWORKS_SERVER_PATH,
    FLYWORKS_SOURCE_DIR: resolve(FLYWORKS_DIR, 'src'),
    FLYWORKS_MEDIA_DIR,
    FLYWORKS_OUTPUT_DIR,
    VARIFLIGHT_API_KEY: process.env.VARIFLIGHT_API_KEY?.trim() || '',
    VARIFLIGHT_API_URL: process.env.VARIFLIGHT_API_URL?.trim()
      || 'https://mcp.variflight.com/api/v1/mcp/data',
    VARIFLIGHT_SERVER_PATH,
    VARIFLIGHT_MCP_ENTRY,
    DSH_HOME: resolve(ROOT, '.dsh'),
    DSH_TELEMETRY_MODE: process.env.DSH_TELEMETRY_MODE || 'DISABLED',
  },
  stdio: 'inherit',
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('error', (error) => {
  console.error(`Failed to start DeepSeek Harness: ${error.message}`)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1)
})
