import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { status, transcribe } from './api/transcribe.ts'

/**
 * En desarrollo (`npm run dev`), responde /api/transcribe igual que la función de Vercel,
 * leyendo OPENROUTER_API_KEY de .env.local (que no se sube a git).
 */
function devApi(apiKey: string | undefined): Plugin {
  return {
    name: 'earth-symphony-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/transcribe', async (req, res) => {
        let result
        if (req.method === 'GET') {
          result = status(apiKey)
        } else {
          let raw = ''
          for await (const chunk of req) raw += chunk
          let body: unknown = null
          try { body = JSON.parse(raw) } catch { /* cuerpo inválido */ }
          result = await transcribe(body, apiKey)
        }
        res.statusCode = result.status
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(result.json))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), devApi(env.OPENROUTER_API_KEY)],
  }
})
