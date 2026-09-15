/**
 * Development mode: Vite dev server (hot reload) inside the app window.
 *
 *   npm run dev
 *
 * Starts Vite in frontend/, then `python desktop_app.py --dev`, which runs the
 * backend on :8765 (where Vite proxies /api) and opens the window on Vite's URL.
 * Closing the window stops everything. Backend changes need a restart.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rootDir = path.resolve(desktopDir, '..')
const backendDir = path.join(rootDir, 'backend')
const win = process.platform === 'win32'
const venvPython = path.join(backendDir, '.venv', win ? 'Scripts/python.exe' : 'bin/python')
const python = existsSync(venvPython) ? venvPython : process.env.PYTHON ?? 'python'
const DEV_URL = 'http://127.0.0.1:5173/'

const vite = spawn('npm', ['run', 'dev'], {
  cwd: path.join(rootDir, 'frontend'),
  stdio: 'inherit',
  shell: win,
  env: { ...process.env, VITE_API_TARGET: 'http://127.0.0.1:8765' },
})

function stopVite() {
  if (vite.exitCode !== null) return
  // npm runs vite in a child shell; kill the whole tree on Windows. Synchronous,
  // because the script exits right after this.
  if (win) spawnSync('taskkill', ['/pid', String(vite.pid), '/T', '/F'], { stdio: 'ignore' })
  else vite.kill()
}

for (let i = 0; ; i += 1) {
  try {
    if ((await fetch(DEV_URL)).ok) break
  } catch {
    // not up yet
  }
  if (i > 120) {
    stopVite()
    throw new Error('Vite dev server did not start')
  }
  await new Promise((r) => setTimeout(r, 500))
}

const app = spawn(python, ['desktop_app.py', '--dev', '--debug'], { cwd: backendDir, stdio: 'inherit' })
app.on('exit', (code) => {
  stopVite()
  process.exit(code ?? 0)
})
process.on('SIGINT', () => {
  app.kill()
  stopVite()
})
