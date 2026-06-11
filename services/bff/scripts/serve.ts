import { serve } from '@hono/node-server'
import { createApp } from '../src/app.js'

const port = Number(process.env.PORT ?? 8787)
serve({ fetch: createApp().fetch, port })
console.log(`OFBO BFF (demo profile) listening on http://localhost:${port}`)
