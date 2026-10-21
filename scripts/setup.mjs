import { chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(import.meta.dirname, '..')
const RUNTIME_DIR = resolve(ROOT, '.runtime')
const BOCHA_DIR = resolve(RUNTIME_DIR, 'bocha-search-mcp')
const BOCHA_REPO = 'https://github.com/BochaAI/bocha-search-mcp.git'
const BOCHA_COMMIT = '285bf4064a3317ad0f29966da8af5e1fdace14f1'
const FLYWORKS_DIR = resolve(RUNTIME_DIR, 'flyworks-mcp')
const FLYWORKS_REPO = 'https://github.com/Flyworks-AI/flyworks-mcp.git'
const FLYWORKS_COMMIT = '3561ded8ac0473eef21451caf7166dabeae47e3e'
const FLYWORKS_PROJECT_DIR = resolve(ROOT, 'mcp')
const FLYWORKS_ENV_DIR = resolve(RUNTIME_DIR, 'flyworks-venv')
const UV_VERSION = '0.13.3'
const UV_DIR = resolve(RUNTIME_DIR, 'bin')
const UV_PATH = resolve(UV_DIR, 'uv')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    ...options,
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`)
  }
  return result.stdout?.trim()
}

function requireCommand(command, installHint) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' })
  if (result.status !== 0) {
    throw new Error(`Missing ${command}. ${installHint}`)
  }
}

requireCommand('git', 'Install Git and rerun pnpm run setup.')
requireCommand('curl', 'Install curl and rerun pnpm run setup.')
requireCommand('tar', 'Install tar and rerun pnpm run setup.')
mkdirSync(RUNTIME_DIR, { recursive: true })

if (!existsSync(UV_PATH)) {
  const targets = {
    'darwin-arm64': 'aarch64-apple-darwin',
    'darwin-x64': 'x86_64-apple-darwin',
    'linux-arm64': 'aarch64-unknown-linux-gnu',
    'linux-x64': 'x86_64-unknown-linux-gnu',
  }
  const target = targets[`${process.platform}-${process.arch}`]
  if (!target) throw new Error(`Unsupported platform for uv: ${process.platform}-${process.arch}`)

  const archive = resolve(RUNTIME_DIR, `uv-${UV_VERSION}.tar.gz`)
  mkdirSync(UV_DIR, { recursive: true })
  run('curl', [
    '--fail',
    '--location',
    '--silent',
    '--show-error',
    `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${target}.tar.gz`,
    '--output',
    archive,
  ])
  run('tar', ['-xzf', archive, '--strip-components', '1', '-C', UV_DIR, `uv-${target}/uv`, `uv-${target}/uvx`])
  rmSync(archive)
  chmodSync(UV_PATH, 0o755)
}

const uvVersion = run(UV_PATH, ['--version'], { capture: true })
if (!uvVersion.startsWith(`uv ${UV_VERSION} `) && uvVersion !== `uv ${UV_VERSION}`) {
  throw new Error(`Expected uv ${UV_VERSION}, found ${uvVersion}`)
}

if (!existsSync(resolve(BOCHA_DIR, '.git'))) {
  run('git', ['clone', '--filter=blob:none', '--no-checkout', BOCHA_REPO, BOCHA_DIR])
}

const remote = run('git', ['-C', BOCHA_DIR, 'remote', 'get-url', 'origin'], { capture: true })
if (remote !== BOCHA_REPO) {
  throw new Error(`Unexpected Bocha remote at ${BOCHA_DIR}: ${remote}`)
}

run('git', ['-C', BOCHA_DIR, 'fetch', '--depth', '1', 'origin', BOCHA_COMMIT])
run('git', ['-C', BOCHA_DIR, 'checkout', '--detach', BOCHA_COMMIT])
run(UV_PATH, ['sync', '--frozen', '--directory', BOCHA_DIR])

if (!existsSync(resolve(FLYWORKS_DIR, '.git'))) {
  run('git', ['clone', '--filter=blob:none', '--no-checkout', FLYWORKS_REPO, FLYWORKS_DIR])
}

const flyworksRemote = run('git', ['-C', FLYWORKS_DIR, 'remote', 'get-url', 'origin'], { capture: true })
if (flyworksRemote !== FLYWORKS_REPO) {
  throw new Error(`Unexpected Flyworks remote at ${FLYWORKS_DIR}: ${flyworksRemote}`)
}

run('git', ['-C', FLYWORKS_DIR, 'fetch', '--depth', '1', 'origin', FLYWORKS_COMMIT])
run('git', ['-C', FLYWORKS_DIR, 'checkout', '--detach', FLYWORKS_COMMIT])
run(UV_PATH, ['sync', '--frozen', '--directory', FLYWORKS_PROJECT_DIR], {
  env: {
    ...process.env,
    UV_PROJECT_ENVIRONMENT: FLYWORKS_ENV_DIR,
  },
})

mkdirSync(resolve(RUNTIME_DIR, 'media/flyworks'), { recursive: true })
mkdirSync(resolve(RUNTIME_DIR, 'output/flyworks'), { recursive: true })

console.log(`uv ${UV_VERSION}, Bocha ${BOCHA_COMMIT.slice(0, 12)}, and Flyworks ${FLYWORKS_COMMIT.slice(0, 12)} are ready.`)
