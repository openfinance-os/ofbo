/**
 * Agent build provenance for the release evidence bundle. A regulated, AI-built system has to
 * answer "which model/agent/session produced this change, and under what story?" — EU AI Act
 * Art. 12 (automatic logging) + Art. 17 (lifecycle traceability), and the field's emerging
 * SLSA/in-toto provenance practice ({model, session, change} bound to the artifact). We don't
 * need a second logging path: the build loop already stamps every commit with Co-Authored-By /
 * Claude-Session trailers, so provenance is recovered deterministically from git history and
 * folded into the SAME sha256-sealed bundle as the quality gates — tamper-evident by construction.
 */

/** One commit's git metadata, as read from `git log`. */
export interface RawCommit {
  sha: string
  author?: string
  /** Full commit message (subject + body + trailers). */
  message: string
}

export interface ProvenanceEntry {
  commit: string
  author: string | null
  /** The build agent's model, e.g. "Claude Opus 4.8" — from a Build-Model trailer or the agent Co-Authored-By line. */
  model: string | null
  /** Build session URL (Claude-Session trailer), the audit anchor back to the agent run. */
  session: string | null
  /** Owning story/milestone id parsed from the subject (BACKOFFICE-NN / M<n>). */
  story: string | null
}

export interface BuildProvenance {
  commits: ProvenanceEntry[]
  /** Distinct build-agent models that contributed to the release. */
  build_agents: string[]
  /** Commits with no agent attribution (human-authored or unstamped) — a visible, honest signal. */
  unattributed_commits: number
}

const trailer = (message: string, key: string): string | null => {
  // Trailers live at the foot of the message: "Key: value", case-insensitive key.
  const re = new RegExp(`^${key}:\\s*(.+)$`, 'im')
  const value = message.match(re)?.[1]
  return value ? value.trim() : null
}

/** "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" → "Claude Opus 4.8". */
function modelFromCoAuthor(message: string): string | null {
  for (const line of message.split('\n')) {
    const name = line.match(/^Co-Authored-By:\s*(.+?)\s*</i)?.[1]
    if (name && /\b(claude|opus|sonnet|haiku|fable)\b/i.test(name)) return name.trim()
  }
  return null
}

function storyId(message: string): string | null {
  const subject = message.split('\n', 1)[0] ?? ''
  const back = subject.match(/BACKOFFICE-\d+/i)
  if (back) return back[0].toUpperCase()
  const milestone = subject.match(/\bM\d[A-Za-z-]*\b/)
  return milestone ? milestone[0] : null
}

export function parseProvenance(commits: RawCommit[]): BuildProvenance {
  const entries: ProvenanceEntry[] = commits.map((c) => ({
    commit: c.sha,
    author: c.author ?? null,
    // An explicit Build-Model trailer wins; otherwise infer from the agent Co-Authored-By line.
    model: trailer(c.message, 'Build-Model') ?? modelFromCoAuthor(c.message),
    session: trailer(c.message, 'Claude-Session'),
    story: storyId(c.message)
  }))
  const build_agents = [...new Set(entries.map((e) => e.model).filter((m): m is string => m !== null))].sort()
  const unattributed_commits = entries.filter((e) => e.model === null).length
  return { commits: entries, build_agents, unattributed_commits }
}

/** Parse `git log --format=%H%x00%an%x00%B%x1e`-style output (NUL-delimited fields, RS-delimited records). */
export function parseGitLog(raw: string): RawCommit[] {
  return raw
    .split('\x1e')
    .map((rec) => rec.replace(/^\n/, ''))
    .filter((rec) => rec.trim().length > 0)
    .map((rec) => {
      const [sha = '', author = '', message = ''] = rec.split('\x00')
      return { sha: sha.trim(), author: author.trim() || undefined, message }
    })
}

export const EMPTY_PROVENANCE: BuildProvenance = { commits: [], build_agents: [], unattributed_commits: 0 }
