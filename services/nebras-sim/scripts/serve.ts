import { serve } from '@hono/node-server'
import { createNebrasSim } from '../src/app.js'

const port = Number(process.env.PORT ?? 8788)
const adminToken = process.env.ADMIN_TOKEN
serve({ fetch: createNebrasSim(adminToken ? { adminToken } : {}).fetch, port })
console.log(
  `Nebras simulator v1 listening on http://localhost:${port} — fault injection at POST /admin/faults (${adminToken ? 'x-admin-token guarded' : 'OPEN — set ADMIN_TOKEN before exposing'})`
)
