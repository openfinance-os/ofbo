import { serve } from '@hono/node-server'
import { createNebrasSim } from '../src/app.js'

const port = Number(process.env.PORT ?? 8788)
serve({ fetch: createNebrasSim().fetch, port })
console.log(`Nebras simulator v1 listening on http://localhost:${port} — fault injection at POST /admin/faults`)
