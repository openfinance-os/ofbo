import { defineCloudflareConfig } from '@opennextjs/cloudflare'

// M1-PORTAL-SHELL: portal → Cloudflare Workers via the OpenNext adapter
// (README §deploy). Defaults are sufficient for the shell — no incremental
// cache or queue bindings needed yet; M2 features add them as required.
export default defineCloudflareConfig({})
