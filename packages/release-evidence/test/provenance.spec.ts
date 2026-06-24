import { describe, expect, it } from 'vitest'
import { parseProvenance, parseGitLog, EMPTY_PROVENANCE, type RawCommit } from '../src/provenance.js'

const commit = (over: Partial<RawCommit> & { message: string }): RawCommit => ({
  sha: 'a'.repeat(40),
  author: 'github-actions[bot]',
  ...over
})

describe('parseProvenance', () => {
  it('infers the build-agent model from the agent Co-Authored-By trailer', () => {
    const p = parseProvenance([
      commit({
        sha: 'deadbeef',
        message:
          'Implement consent revoke (BACKOFFICE-17)\n\nbody text\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_xyz'
      })
    ])
    expect(p.commits[0]?.model).toBe('Claude Opus 4.8')
    expect(p.commits[0]?.session).toBe('https://claude.ai/code/session_xyz')
    expect(p.commits[0]?.story).toBe('BACKOFFICE-17')
    expect(p.build_agents).toEqual(['Claude Opus 4.8'])
    expect(p.unattributed_commits).toBe(0)
  })

  it('prefers an explicit Build-Model trailer over the co-author inference', () => {
    const p = parseProvenance([
      commit({ message: 'x\n\nBuild-Model: Claude Sonnet 4.6\nCo-Authored-By: Claude Opus 4.8 <x@y>' })
    ])
    expect(p.commits[0]?.model).toBe('Claude Sonnet 4.6')
  })

  it('does NOT attribute a human co-author as a build agent', () => {
    const p = parseProvenance([commit({ message: 'manual fix\n\nCo-Authored-By: Jane Dev <jane@bank.example>' })])
    expect(p.commits[0]?.model).toBeNull()
    expect(p.unattributed_commits).toBe(1)
    expect(p.build_agents).toEqual([])
  })

  it('parses milestone ids as the story when there is no BACKOFFICE id', () => {
    expect(parseProvenance([commit({ message: 'M1-DEMO-DEPLOY substrate live' })]).commits[0]?.story).toBe('M1-DEMO-DEPLOY')
  })

  it('dedupes and sorts distinct build-agent models across the range', () => {
    const p = parseProvenance([
      commit({ message: 'a\n\nCo-Authored-By: Claude Opus 4.8 <x>' }),
      commit({ message: 'b\n\nCo-Authored-By: Claude Sonnet 4.6 <x>' }),
      commit({ message: 'c\n\nCo-Authored-By: Claude Opus 4.8 <x>' })
    ])
    expect(p.build_agents).toEqual(['Claude Opus 4.8', 'Claude Sonnet 4.6'])
  })

  it('returns the empty record for no commits', () => {
    expect(parseProvenance([])).toEqual(EMPTY_PROVENANCE)
  })
})

describe('parseGitLog', () => {
  it('round-trips NUL-delimited fields and RS-delimited records, preserving colons in bodies', () => {
    const raw =
      ['sha1', 'Author One', 'subject one\n\nClaude-Session: https://x/y'].join('\x00') +
      '\x1e' +
      ['sha2', 'Author Two', 'subject two'].join('\x00') +
      '\x1e'
    const commits = parseGitLog(raw)
    expect(commits).toHaveLength(2)
    expect(commits[0]).toMatchObject({ sha: 'sha1', author: 'Author One' })
    expect(commits[0]?.message).toContain('Claude-Session: https://x/y')
    expect(commits[1]?.sha).toBe('sha2')
  })

  it('ignores trailing empty records', () => {
    expect(parseGitLog('\x1e\x1e')).toEqual([])
  })
})
