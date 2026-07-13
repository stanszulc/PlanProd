import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// Wstrzykuje hash i datę ostatniego commita jako stałe wkompilowane w build —
// automatyczne, żeby nie trzeba było ręcznie aktualizować wersji w kodzie
// po każdym komicie (patrz DashboardTab.jsx, ekran powitalny).
function git(cmd, fallback) {
  try { return execSync(cmd).toString().trim() } catch { return fallback }
}
const commitHash = git('git rev-parse --short HEAD', 'dev')
const commitDate = git('git log -1 --format=%cd --date="format:%Y-%m-%d %H:%M"', '')

export default defineConfig({
  base: '/PlanProd/',
  plugins: [react()],
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
    __COMMIT_DATE__: JSON.stringify(commitDate),
  },
})
