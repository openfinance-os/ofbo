import type { NextConfig } from 'next'

/**
 * M1-PORTAL-SHELL. The portal deploys to Cloudflare Workers via the OpenNext
 * adapter (README §deploy) — `transpilePackages` lets Next compile the
 * workspace TS sources (@ofbo/*) it consumes server-side without a prebuild
 * step. The DEMO banner and synthetic-only posture (CLAUDE.md hard stops) make
 * this a permanently non-prod surface; no real PII ever reaches it.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Linting is owned by the root flat ESLint config in CI (Q2); don't re-run
  // Next's bundled lint during the production/deploy build.
  eslint: { ignoreDuringBuilds: true },
  transpilePackages: ['@ofbo/bff', '@ofbo/db', '@ofbo/ports', '@ofbo/redaction'],
  // pg ships optional native/cloud bindings the portal never uses server-side
  // beyond the standard client; keep the bundle from trying to resolve them.
  serverExternalPackages: ['pg'],
  // The @ofbo/* workspace packages are consumed as TS source with NodeNext `.js`
  // import specifiers (no build step). Teach webpack to resolve `.js` → `.ts`.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs']
    }
    return config
  }
}

export default nextConfig
