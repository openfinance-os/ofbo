// Parse design.md into a deterministic token map { 'color.brand.primary': '#1F4DB8', ... }.
// Single-value token rows look like:  | `token.name` | `value` | ... |
// Pure Node, zero deps. The brand profile stays the single source of visual truth.
import { read } from '../gates/lib.mjs';

export function parseTokens(designMdPath = 'discovery/brand/design.md') {
  const text = read(designMdPath);
  const tokens = {};
  for (const m of text.matchAll(/^\|\s*`([\w.-]+)`\s*\|\s*`([^`]+)`\s*\|/gm)) {
    tokens[m[1]] = m[2];
  }
  const version = (text.match(/profile_version:\s*(\d+)/) || [])[1] || '1';
  const banner = (text.match(/^banner:\s*"?([^"\n]+)"?/m) || [])[1] || 'DEMO — synthetic data, non-production';
  // rc.8 WS8: when the D7 seam is a BrainKit compatibility projection, its frontmatter pins the
  // BrainKit id/version/digest. Surface it so every rendered artifact carries the provenance.
  const fm = (k) => (text.match(new RegExp(`^${k}:\\s*"?([^"\\n]+)"?`, 'm')) || [])[1];
  const bkId = fm('brainkit_id');
  const brainkit = bkId ? { id: bkId, version: fm('brainkit_version') || null, digest: fm('brainkit_digest') || null } : null;
  // Writing direction and content language are BRAND properties, not renderer constants: the
  // shell hard-coded `lang="en"` and emitted no dir at all, so a right-to-left artifact was not
  // expressible at all — no token could fix it. Defaults are the previous behaviour, so every
  // brand file that says nothing renders exactly as before. Values are validated at emit time
  // (render.mjs), not here: this function parses, it does not decide what is safe in an attribute.
  const lang = fm('lang') || 'en';
  const dir = fm('dir') || 'ltr';
  return { tokens, version, banner, brainkit, lang, dir, present: text.length > 0 };
}

/** The one-line BrainKit provenance string embedded in rendered artifacts, or '' if none. */
export function brainkitProvenance(brainkit) {
  if (!brainkit || !brainkit.id) return '';
  return `brainkit:${brainkit.id}@${brainkit.version || '?'} ${brainkit.digest || ''}`.trim();
}

/** Resolve a token by name, with a fallback so a missing token never injects an empty colour. */
export function tokenResolver(tokens) {
  return (name, fallback = '') => (name in tokens ? tokens[name] : fallback);
}
