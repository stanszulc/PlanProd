import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

function git(cmd, fallback) {
  try { return execSync(cmd).toString().trim() } catch { return fallback }
}

// Wstrzykuje hash i datę OSTATNIEGO commita do index.html przy KAŻDYM
// żądaniu strony (transformIndexHtml), nie raz przy starcie dev servera —
// inaczej przy długo działającym `npm run dev` strona pokazywałaby commit
// sprzed wielu godzin, mimo nowych commitów w międzyczasie. Odśwież stronę
// (F5), żeby zobaczyć najnowszy — restart serwera nie jest potrzebny.
function gitVersionPlugin() {
  return {
    name: 'git-version',
    transformIndexHtml(html) {
      const commitHash = git('git rev-parse --short HEAD', 'dev')
      const commitDate = git('git log -1 --format=%cd --date="format:%Y-%m-%d %H:%M"', '')
      const script = `<script>window.__COMMIT_HASH__=${JSON.stringify(commitHash)};window.__COMMIT_DATE__=${JSON.stringify(commitDate)};</script>`
      return html.replace('</head>', `${script}</head>`)
    },
  }
}

export default defineConfig({
  base: '/PlanProd/',
  plugins: [react(), gitVersionPlugin()],
})
