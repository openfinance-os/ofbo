// CODE-02 — in-memory store(s) lifted verbatim out of services/bff/src/agents/service.ts.
// Behaviour unchanged; see ./README.md for why they live outside src/.
import type { AgentListQuery, AgentPage, AgentStore, StoredAgent } from '../src/agents/service.js'

// CODE-02 — moved with its only caller (the store below).
const encodeAgentCursor = (createdAt: string, id: string) => Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url')
function decodeAgentCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
    return createdAt && id ? { createdAt, id } : null
  } catch {
    return null
  }
}

export class InMemoryAgentStore implements AgentStore {
  private readonly rows: StoredAgent[] = []
  async create(agent: StoredAgent, _traceId?: string): Promise<StoredAgent> {
    this.rows.push(agent)
    return agent
  }
  async get(agentId: string): Promise<StoredAgent | null> {
    return this.rows.find((r) => r.agent_id === agentId) ?? null
  }
  /**
   * Cursor pagination matching PgAgentStore (port parity, CLAUDE.md M6): stable sort by
   * (created_at, agent_id), slice `limit`, emit a base64url cursor. So the demo profile and
   * the unit tests exercise real cursor behaviour, not an everything-in-one-page stub.
   */
  async list(query: AgentListQuery = {}): Promise<AgentPage> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
    const sorted = [...this.rows].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.agent_id.localeCompare(b.agent_id))
    const after = query.cursor ? decodeAgentCursor(query.cursor) : null
    const start = after
      ? sorted.findIndex((r) => r.created_at > after.createdAt || (r.created_at === after.createdAt && r.agent_id > after.id))
      : 0
    const slice = start < 0 ? [] : sorted.slice(start, start + limit)
    const hasMore = start >= 0 && sorted.length > start + limit
    const last = slice[slice.length - 1]
    return { rows: slice, next_cursor: hasMore && last ? encodeAgentCursor(last.created_at, last.agent_id) : null }
  }
  async update(agentId: string, patch: Partial<StoredAgent>, _traceId?: string): Promise<StoredAgent | null> {
    const r = this.rows.find((x) => x.agent_id === agentId)
    if (!r) return null
    Object.assign(r, patch)
    return r
  }
}
