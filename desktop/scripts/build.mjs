/**
 * Builds the Gold Backtester setup file.
 *
 *   node scripts/build.mjs          (or: npm run dist)
 *
 * 1. Builds the React frontend (frontend/dist).
 * 2. Creates/updates backend/.venv from backend/requirements.txt.
 * 3. Bundles backend/desktop_app.py + frontend + data with PyInstaller.
 * 4. Wraps the bundle in an NSIS installer: release/Gold Backtester-Setup-<version>.exe
 *
 * Environment:
 *   PYTHON                interpreter used to create the venv (default: python)
 *   PIP_INDEX_URL         package mirror, if PyPI is unreachable
 *   MAKENSIS              path to makensis.exe (otherwise found automatically)
 *   BACKTESTER_BUILD_DIR  where intermediate files go (default: desktop/build)
 *   BACKTESTER_OUT_DIR    where the setup file goes (default: desktop/release)
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rootDir = path.resolve(desktopDir, '..')
const backendDir = path.join(rootDir, 'backend')
const frontendDir = path.join(rootDir, 'frontend')
const buildDir = path.resolve(process.env.BACKTESTER_BUILD_DIR ?? path.join(desktopDir, 'build'))
const outDir = path.resolve(process.env.BACKTESTER_OUT_DIR ?? path.join(desktopDir, 'release'))

const win = process.platform === 'win32'
const { version } = JSON.parse(readFileSync(path.join(desktopDir, 'package.json'), 'utf8'))
const venvPython = path.join(backendDir, '.venv', win ? 'Scripts/python.exe' : 'bin/python')
const appName = 'GoldBacktester'
const setupFile = path.join(outDir, `Gold Backtester-Setup-${version}.exe`)

// Keep pip / PyInstaller scratch files next to the build instead of the system temp dir.
const tmpDir = path.join(buildDir, 'tmp')
mkdirSync(tmpDir, { recursive: true })
mkdirSync(outDir, { recursive: true })
const env = { ...process.env, TEMP: tmpDir, TMP: tmpDir }

function step(title) {
  console.log(`\n=== ${title} ===`)
}

function run(command, args, cwd) {
  console.log(`> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: win && !command.endsWith('.exe') })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function findMakensis() {
  const candidates = [
    process.env.MAKENSIS,
    'C:\\Program Files (x86)\\NSIS\\makensis.exe',
    'C:\\Program Files\\NSIS\\makensis.exe',
  ]
  // A full NSIS also lives in electron-builder's download cache, if that tool was ever used here.
  const cache = path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'electron-builder', 'Cache')
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).filter((d) => d.startsWith('nsis-3'))) {
      for (const sub of readdirSync(path.join(cache, dir))) {
        candidates.push(path.join(cache, dir, sub, 'makensis.exe'))
      }
    }
  }
  const found = candidates.find((candidate) => candidate && existsSync(candidate))
  if (!found) {
    console.error('\nNSIS not found. Install it (winget install NSIS.NSIS) or set MAKENSIS.')
    process.exit(1)
  }
  return found
}

// --- 1. frontend -----------------------------------------------------------------
step('Frontend')
run('npm', ['run', 'build'], frontendDir)

// --- 2. python environment ----------------------------------------------------------
step('Python environment')
if (!existsSync(venvPython)) run(process.env.PYTHON ?? (win ? 'python' : 'python3'), ['-m', 'venv', '.venv'], backendDir)
run(venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-r', 'requirements.txt'], backendDir)

// --- 3. app bundle -------------------------------------------------------------------
step('App bundle (PyInstaller)')
const sep = win ? ';' : ':'
const excluded = [
  // desktop_app.py stubs out backtesting's bokeh plotting; bokeh and its deps stay out.
  'bokeh', 'backtesting._plotting', 'PIL', 'tornado', 'jinja2', 'markupsafe', 'yaml',
  'xyzservices', 'narwhals', 'contourpy',
  // pywebview GUI backends other than WinForms + WebView2.
  'webview.platforms.qt', 'webview.platforms.gtk', 'webview.platforms.cocoa',
  'webview.platforms.android', 'webview.platforms.cef', 'PyQt5', 'PyQt6', 'PySide2', 'PySide6',
  'qtpy', 'gi', 'cefpython3',
  'tkinter', 'matplotlib', 'IPython', 'setuptools', 'pip',
]
run(
  venvPython,
  [
    '-m', 'PyInstaller',
    'desktop_app.py',
    '--name', appName,
    '--onedir', // starts much faster than --onefile, which unpacks itself on every launch
    '--windowed',
    '--icon', path.join(desktopDir, 'assets', 'icon.ico'),
    '--noconfirm',
    '--clean',
    '--log-level', 'WARN',
    '--distpath', path.join(buildDir, 'dist'),
    '--workpath', path.join(buildDir, 'work'),
    '--specpath', buildDir,
    '--paths', backendDir,
    '--collect-submodules', 'app',
    '--add-data', `${path.join(frontendDir, 'dist')}${sep}frontend`,
    '--add-data', `${path.join(backendDir, 'data')}${sep}data`,
    ...excluded.flatMap((name) => ['--exclude-module', name]),
  ],
  backendDir,
)
const bundleDir = path.join(buildDir, 'dist', appName)

// --- 4. setup file ---------------------------------------------------------------------
step('Setup file (NSIS)')
if (!win) {
  console.log(`App bundle ready in ${bundleDir}. The NSIS setup file is Windows-only.`)
  process.exit(0)
}
run(
  findMakensis(),
  ['/V2', `/DVERSION=${version}`, `/DSRC=${bundleDir}`, `/DOUTFILE=${setupFile}`, path.join(desktopDir, 'installer.nsi')],
  desktopDir,
)

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const folderSize = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
    const full = path.join(dir, entry.name)
    return sum + (entry.isDirectory() ? folderSize(full) : statSync(full).size)
  }, 0)

console.log(`\nApp bundle: ${bundleDir} (${mb(folderSize(bundleDir))})`)
console.log(`Setup file: ${setupFile} (${mb(statSync(setupFile).size)})`)
