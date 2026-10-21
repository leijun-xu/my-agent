import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(import.meta.dirname, '..')
const ENV_FILE = resolve(ROOT, '.env')
const BOCHA_DIR = resolve(ROOT, '.runtime/bocha-search-mcp')
const FLYWORKS_DIR = resolve(ROOT, '.runtime/flyworks-mcp')
const UV_PATH = resolve(ROOT, '.runtime/bin/uv')
const BOCHA_COMMIT = '285bf4064a3317ad0f29966da8af5e1fdace14f1'
const FLYWORKS_COMMIT = '3561ded8ac0473eef21451caf7166dabeae47e3e'
const DSH_ENTRY = resolve(ROOT, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const BOCHA_PATCH_FILE = resolve(ROOT, 'config/bocha.cordis.yml')
const FLYWORKS_PATCH_FILE = resolve(ROOT, 'config/flyworks.cordis.yml')
const VARIFLIGHT_PATCH_FILE = resolve(ROOT, 'config/variflight.cordis.yml')
const FLYWORKS_SERVER_PATH = resolve(ROOT, 'mcp/flyworks_server.py')
const VARIFLIGHT_SERVER_PATH = resolve(ROOT, 'mcp/variflight_server.mjs')
const VARIFLIGHT_PACKAGE_PATH = resolve(
  ROOT,
  'node_modules/@variflight-ai/tripmatch-mcp/package.json',
)
const VARIFLIGHT_MCP_ENTRY = resolve(
  ROOT,
  'node_modules/@variflight-ai/tripmatch-mcp/dist/index.js',
)
const FLYWORKS_MEDIA_DIR = resolve(ROOT, '.runtime/media/flyworks')
const FLYWORKS_OUTPUT_DIR = resolve(ROOT, '.runtime/output/flyworks')

if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE)

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim()
    throw new Error(`${command} exited with status ${result.status}${detail ? `: ${detail}` : ''}`)
  }
  return result.stdout.trim()
}

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 19)) {
  throw new Error(`Node 22.19+ is required; found ${process.version}`)
}

const flyworksPythonPath = resolve(ROOT, '.runtime/flyworks-venv/bin/python')
if (
  !existsSync(resolve(BOCHA_DIR, '.git'))
  || !existsSync(resolve(FLYWORKS_DIR, '.git'))
  || !existsSync(flyworksPythonPath)
  || !existsSync(FLYWORKS_SERVER_PATH)
  || !existsSync(VARIFLIGHT_SERVER_PATH)
  || !existsSync(VARIFLIGHT_PACKAGE_PATH)
  || !existsSync(VARIFLIGHT_MCP_ENTRY)
  || !existsSync(UV_PATH)
  || !existsSync(DSH_ENTRY)
) {
  throw new Error('Dependencies are incomplete. Run: pnpm install && pnpm run setup')
}

const installedCommit = run('git', ['-C', BOCHA_DIR, 'rev-parse', 'HEAD'])
if (installedCommit !== BOCHA_COMMIT) {
  throw new Error(`Bocha MCP commit mismatch: expected ${BOCHA_COMMIT}, found ${installedCommit}`)
}

const installedFlyworksCommit = run('git', ['-C', FLYWORKS_DIR, 'rev-parse', 'HEAD'])
if (installedFlyworksCommit !== FLYWORKS_COMMIT) {
  throw new Error(`Flyworks MCP commit mismatch: expected ${FLYWORKS_COMMIT}, found ${installedFlyworksCommit}`)
}

const uvVersion = run(UV_PATH, ['--version'])
if (!uvVersion.startsWith('uv 0.13.3 ')) throw new Error(`Expected uv 0.13.3, found ${uvVersion}`)

run(UV_PATH, [
  'run',
  '--frozen',
  '--directory',
  BOCHA_DIR,
  'python',
  '-c',
  'import bocha_search_mcp; print("bocha-import-ok")',
])

const flyworksTools = run(flyworksPythonPath, [
  '-c',
  [
    'import asyncio, os',
    'from mcp import ClientSession, StdioServerParameters',
    'from mcp.client.stdio import stdio_client',
    'async def check():',
    '  server = StdioServerParameters(command=os.environ["FLYWORKS_PYTHON_PATH"], args=[os.environ["FLYWORKS_SERVER_PATH"]], env=os.environ.copy())',
    '  async with stdio_client(server) as (read, write):',
    '    async with ClientSession(read, write) as session:',
    '      await session.initialize()',
    '      result = await session.list_tools()',
    '      missing_token = await session.call_tool("get_task_status", {"task_id": "configuration-check-only"})',
    '      assert "not configured" in str(missing_token.content)',
    '      print("\\n".join(tool.name for tool in result.tools))',
    'asyncio.run(check())',
  ].join('\n'),
], {
  env: {
    ...process.env,
    FLYWORKS_API_TOKEN: '',
    FLYWORKS_API_BASE_URL: 'https://hfw-api.hifly.cc/api/v2/hifly',
    FLYWORKS_PYTHON_PATH: flyworksPythonPath,
    FLYWORKS_SERVER_PATH,
    FLYWORKS_SOURCE_DIR: resolve(FLYWORKS_DIR, 'src'),
    FLYWORKS_MEDIA_DIR,
    FLYWORKS_OUTPUT_DIR,
  },
})

for (const expected of [
  'create_avatar',
  'create_lipsync_video_by_audio',
  'create_lipsync_video_by_text',
  'get_task_status',
  'download_completed_video',
]) {
  if (!flyworksTools.split('\n').includes(expected)) {
    throw new Error(`Flyworks MCP is missing tool: ${expected}`)
  }
}

const variflightPackage = JSON.parse(readFileSync(VARIFLIGHT_PACKAGE_PATH, 'utf8'))
if (variflightPackage.version !== '1.1.0') {
  throw new Error(`Expected Tripmatch MCP 1.1.0, found ${variflightPackage.version}`)
}

const variflightTools = run(flyworksPythonPath, [
  '-c',
  [
    'import asyncio, os',
    'from mcp import ClientSession, StdioServerParameters',
    'from mcp.client.stdio import stdio_client',
    'async def check():',
    '  server = StdioServerParameters(command=os.environ["VARIFLIGHT_NODE_PATH"], args=[os.environ["VARIFLIGHT_SERVER_PATH"]], env=os.environ.copy())',
    '  async with stdio_client(server) as (read, write):',
    '    async with ClientSession(read, write) as session:',
    '      await session.initialize()',
    '      result = await session.list_tools()',
    '      missing_token = await session.call_tool("searchTrainStations", {"query": "configuration-check-only"})',
    '      assert "not configured" in str(missing_token.content)',
    '      print("\\n".join(tool.name for tool in result.tools))',
    'asyncio.run(check())',
  ].join('\n'),
], {
  env: {
    ...process.env,
    VARIFLIGHT_API_KEY: '',
    VARIFLIGHT_API_URL: 'https://mcp.variflight.com/api/v1/mcp/data',
    VARIFLIGHT_NODE_PATH: process.execPath,
    VARIFLIGHT_SERVER_PATH,
    VARIFLIGHT_MCP_ENTRY,
  },
})

for (const expected of [
  'searchFlightsByDepArr',
  'searchFlightsByNumber',
  'getFlightAndTrainTransferInfo',
  'flightHappinessIndex',
  'getRealtimeLocationByAnum',
  'getTodayDate',
  'getFutureWeatherByAirport',
  'searchFlightItineraries',
  'searchTrainTicketsByStation',
  'searchTrainTicketsByCity',
  'getFlightPriceByCities',
  'searchTrainStations',
]) {
  if (!variflightTools.split('\n').includes(expected)) {
    throw new Error(`Variflight MCP is missing tool: ${expected}`)
  }
}
if (variflightTools.split('\n').includes('searchTrainTickets')) {
  throw new Error('Deprecated Variflight tool searchTrainTickets must remain hidden')
}

const config = run(process.execPath, [
  DSH_ENTRY,
  'web',
  '--patch',
  BOCHA_PATCH_FILE,
  '--patch',
  FLYWORKS_PATCH_FILE,
  '--patch',
  VARIFLIGHT_PATCH_FILE,
  '--dump-config',
], {
  env: {
    ...process.env,
    BOCHA_API_KEY: 'configuration-check-only',
    BOCHA_MCP_DIR: BOCHA_DIR,
    BOCHA_UV_PATH: UV_PATH,
    FLYWORKS_API_TOKEN: '',
    FLYWORKS_API_BASE_URL: 'https://hfw-api.hifly.cc/api/v2/hifly',
    FLYWORKS_PYTHON_PATH: flyworksPythonPath,
    FLYWORKS_SERVER_PATH,
    FLYWORKS_SOURCE_DIR: resolve(FLYWORKS_DIR, 'src'),
    FLYWORKS_MEDIA_DIR,
    FLYWORKS_OUTPUT_DIR,
    VARIFLIGHT_API_KEY: '',
    VARIFLIGHT_API_URL: 'https://mcp.variflight.com/api/v1/mcp/data',
    VARIFLIGHT_SERVER_PATH,
    VARIFLIGHT_MCP_ENTRY,
    DSH_HOME: resolve(ROOT, '.dsh'),
    DSH_TELEMETRY_MODE: 'DISABLED',
  },
})

for (const expected of [
  'id: mcp-bocha',
  'serverName: bocha',
  'id: mcp-flyworks',
  'serverName: flyworks',
  'id: mcp-variflight',
  'serverName: variflight',
  '@deepseek-ai/dsh-mcp-client',
]) {
  if (!config.includes(expected)) throw new Error(`Composed Harness config is missing: ${expected}`)
}

console.log(`Node: ${process.version}`)
console.log(`DeepSeek Harness: 0.2.1-rc.2`)
console.log(`Bocha MCP: ${BOCHA_COMMIT.slice(0, 12)}`)
console.log(`Flyworks MCP: ${FLYWORKS_COMMIT.slice(0, 12)} (${flyworksTools.split('\n').length} tools)`)
console.log(`Variflight MCP: ${variflightPackage.version} (${variflightTools.split('\n').length} tools)`)
console.log('Harness overlay: valid')
console.log(`BOCHA_API_KEY: ${process.env.BOCHA_API_KEY?.trim() ? 'configured' : 'missing (rotate the exposed key before adding it)'}`)
console.log(`FLYWORKS_API_TOKEN: ${process.env.FLYWORKS_API_TOKEN?.trim() ? 'configured' : 'missing (Flyworks tools will remain unavailable)'}`)
console.log(`VARIFLIGHT_API_KEY: ${process.env.VARIFLIGHT_API_KEY?.trim() ? 'configured' : 'missing (Variflight tools will remain unavailable)'}`)
