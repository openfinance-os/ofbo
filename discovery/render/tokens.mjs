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
  return { tokens, version, banner, present: text.length > 0 };
}

/** Resolve a token by name, with a fallback so a missing token never injects an empty colour. */
export function tokenResolver(tokens) {
  return (name, fallback = '') => (name in tokens ? tokens[name] : fallback);
}
