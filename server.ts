#!/usr/bin/env bun
/**
 * YesWeHack MCP server
 *
 * Tools:
 *   ywh_login          — authenticate, stores JWT to ~/.claude/config/ywh_token.json
 *   ywh_list_programs  — list public (and, when authed, private) programs
 *   ywh_get_program    — full program detail: rules, scopes, reward grid
 *   ywh_my_reports     — list your submitted reports (auth required)
 *   ywh_get_report     — get a single report by ID (auth required)
 *   ywh_submit_report  — submit a new report to a program (auth required)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const BASE = 'https://api.yeswehack.com'
const TOKEN_FILE = join(homedir(), '.claude', 'config', 'ywh_token.json')

// ── token persistence ────────────────────────────────────────────────────────

function loadToken(): string | null {
  try {
    const d = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'))
    return d.token ?? null
  } catch {
    return null
  }
}

function saveToken(token: string) {
  mkdirSync(join(homedir(), '.claude', 'config'), { recursive: true })
  writeFileSync(TOKEN_FILE, JSON.stringify({ token }, null, 2), { mode: 0o600 })
}

// ── http helpers ─────────────────────────────────────────────────────────────

async function api(
  method: string,
  path: string,
  body?: unknown,
  token?: string | null,
): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const t = token ?? loadToken()
  if (t) headers['Authorization'] = `Bearer ${t}`

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  if (!res.ok) throw new Error(`YWH API ${res.status}: ${text}`)

  try { return JSON.parse(text) } catch { return text }
}

const get  = (path: string, token?: string | null) => api('GET',  path, undefined, token)
const post = (path: string, body: unknown, token?: string | null) => api('POST', path, body, token)

// ── tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'ywh_login',
    description: 'Authenticate to YesWeHack. Stores the JWT locally so all other tools use it automatically. Required for private programs, your reports, and submitting reports.',
    inputSchema: {
      type: 'object',
      properties: {
        email:    { type: 'string', description: 'YesWeHack account email' },
        password: { type: 'string', description: 'Account password' },
        totp:     { type: 'string', description: '6-digit TOTP code (only required if 2FA is enabled)' },
      },
      required: ['email', 'password'],
    },
  },
  {
    name: 'ywh_list_programs',
    description: 'List YesWeHack bug bounty programs. Public programs are visible without auth. Authenticated requests also return private/invite-only programs you have access to.',
    inputSchema: {
      type: 'object',
      properties: {
        page:        { type: 'number', description: 'Page number (default: 1)' },
        nb_results:  { type: 'number', description: 'Results per page (default: 25, max: 100)' },
        bounty_only: { type: 'boolean', description: 'Only show programs that pay bounties (default: false)' },
        public_only: { type: 'boolean', description: 'Only show public programs (default: false)' },
      },
    },
  },
  {
    name: 'ywh_get_program',
    description: 'Get full details for a YesWeHack program: rules, scope items with asset values and types, reward grid, response times, and program status.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Program slug (e.g. "contentsquare-bug-bounty-program"). Use ywh_list_programs to find slugs.' },
      },
      required: ['slug'],
    },
  },
  {
    name: 'ywh_my_reports',
    description: 'List reports you have submitted on YesWeHack. Requires authentication via ywh_login first.',
    inputSchema: {
      type: 'object',
      properties: {
        page:       { type: 'number', description: 'Page number (default: 1)' },
        nb_results: { type: 'number', description: 'Results per page (default: 25)' },
        program:    { type: 'string', description: 'Filter by program slug' },
        status:     { type: 'string', description: 'Filter by status: open, triaged, resolved, informative, duplicate, not-applicable, out-of-scope' },
      },
    },
  },
  {
    name: 'ywh_get_report',
    description: 'Get full details for a specific report by ID. Requires authentication.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Report ID number' },
      },
      required: ['id'],
    },
  },
  {
    name: 'ywh_submit_report',
    description: 'Submit a new vulnerability report to a YesWeHack program. Requires authentication. The report is created as a draft — review it on the YesWeHack platform before finalizing.',
    inputSchema: {
      type: 'object',
      properties: {
        program_slug: { type: 'string', description: 'Slug of the target program' },
        title:        { type: 'string', description: 'Report title' },
        description:  { type: 'string', description: 'Full vulnerability description in Markdown' },
        scope:        { type: 'string', description: 'Affected scope/asset (must match a scope item in the program)' },
        cvss_vector:  { type: 'string', description: 'CVSS 3.1 vector string (e.g. CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N)' },
        severity:     { type: 'string', description: 'Severity: critical, high, medium, low, informational' },
      },
      required: ['program_slug', 'title', 'description', 'scope', 'severity'],
    },
  },
]

// ── tool handlers ─────────────────────────────────────────────────────────────

async function handle(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {

    case 'ywh_login': {
      const body: Record<string, unknown> = {
        email: args.email,
        password: args.password,
      }
      if (args.totp) body.totp = args.totp

      const data = await post('/account/login', body) as Record<string, unknown>
      const token = (data.token as string) ?? (data.data as Record<string, unknown>)?.token as string

      if (!token) throw new Error('Login succeeded but no token in response: ' + JSON.stringify(data))

      saveToken(token)
      return `Logged in successfully. JWT saved to ${TOKEN_FILE}.\nYou now have access to private programs, your reports, and report submission.`
    }

    case 'ywh_list_programs': {
      const page       = (args.page as number) ?? 1
      const nb_results = Math.min((args.nb_results as number) ?? 25, 100)
      const params     = new URLSearchParams({
        page: String(page),
        nb_results: String(nb_results),
      })

      const data = await get(`/programs?${params}`) as Record<string, unknown>
      const items = (data.items as Record<string, unknown>[]) ?? []
      const pagination = data.pagination as Record<string, unknown>

      let filtered = items
      if (args.bounty_only) filtered = filtered.filter(p => p.bounty)
      if (args.public_only)  filtered = filtered.filter(p => p.public)

      const lines = filtered.map(p => {
        const buName = (p.business_unit as Record<string, unknown>)?.name ?? ''
        const reward = p.bounty_reward_max
          ? `€${p.bounty_reward_min}–€${p.bounty_reward_max}`
          : p.bounty ? 'bounty (undisclosed)' : 'VDP'
        const tags = [
          p.bounty    ? 'bounty' : 'vdp',
          p.public    ? 'public' : 'private',
          p.secured   ? 'secured' : null,
        ].filter(Boolean).join(', ')
        return `• [${p.slug}] ${p.title} (${buName}) | ${reward} | ${tags} | reports: ${p.reports_count}`
      })

      const summary = `Page ${pagination?.page}/${pagination?.nb_pages} — ${pagination?.nb_results} total programs`
      return [summary, '', ...lines].join('\n')
    }

    case 'ywh_get_program': {
      const slug = args.slug as string
      const data = await get(`/programs/${slug}`) as Record<string, unknown>

      const scopes = (data.scopes as Record<string, unknown>[]) ?? []
      const scopeLines = scopes.map(s =>
        `  [${s.asset_value}] ${s.scope_type_name}: ${s.scope}`
      )

      const out_of_scopes = (data.out_of_scope as Record<string, unknown>[]) ?? []
      const outLines = out_of_scopes.map(s =>
        `  ${s.scope_type_name}: ${s.scope}`
      )

      const parts = [
        `# ${data.title}`,
        `Slug: ${data.slug}`,
        `Type: ${data.type} | Status: ${data.status} | Bounty: ${data.bounty} | VDP: ${data.vdp}`,
        `Rewards: €${data.bounty_reward_min}–€${data.bounty_reward_max}`,
        `Response time: ${data.average_first_response_time}d avg | Reports: ${data.reports_count}`,
        '',
        '## In-Scope Assets',
        ...scopeLines,
      ]

      if (outLines.length) {
        parts.push('', '## Out of Scope', ...outLines)
      }

      if (data.rules) {
        // Trim rules to first 3000 chars to keep response manageable
        const rules = (data.rules as string).slice(0, 3000)
        parts.push('', '## Rules (excerpt)', rules)
        if ((data.rules as string).length > 3000) parts.push('... (truncated — full rules on yeswehack.com)')
      }

      return parts.join('\n')
    }

    case 'ywh_my_reports': {
      const token = loadToken()
      if (!token) return 'Not authenticated. Run ywh_login first.'

      const params = new URLSearchParams({
        page: String((args.page as number) ?? 1),
        nb_results: String((args.nb_results as number) ?? 25),
      })
      if (args.program) params.set('program', args.program as string)
      if (args.status)  params.set('status',  args.status  as string)

      const data = await get(`/reports?${params}`, token) as Record<string, unknown>
      const items = (data.items as Record<string, unknown>[]) ?? []
      const pagination = data.pagination as Record<string, unknown>

      if (!items.length) return 'No reports found matching your filters.'

      const lines = items.map(r => {
        const prog = (r.program as Record<string, unknown>)?.slug ?? '?'
        return `• [#${r.id}] ${r.title}\n  Program: ${prog} | Status: ${r.status} | Severity: ${(r.cvss as Record<string,unknown>)?.criticity ?? 'N/A'} | ${r.created_at}`
      })

      return [`Page ${pagination?.page}/${pagination?.nb_pages} (${pagination?.nb_results} total)`, '', ...lines].join('\n')
    }

    case 'ywh_get_report': {
      const token = loadToken()
      if (!token) return 'Not authenticated. Run ywh_login first.'

      const data = await get(`/reports/${args.id}`, token) as Record<string, unknown>
      const cvss  = data.cvss as Record<string, unknown> ?? {}
      const prog  = (data.program as Record<string, unknown>)?.slug ?? '?'

      const parts = [
        `# Report #${data.id}: ${data.title}`,
        `Program: ${prog} | Status: ${data.status} | Created: ${data.created_at}`,
        `Severity: ${cvss.criticity ?? 'N/A'} | CVSS: ${cvss.score ?? 'N/A'} | Vector: ${cvss.vector ?? 'N/A'}`,
        '',
        '## Description',
        (data.description as string) ?? '(no description)',
      ]

      if (data.attachments && (data.attachments as unknown[]).length) {
        const atts = data.attachments as Record<string, unknown>[]
        parts.push('', '## Attachments', ...atts.map(a => `  • ${a.original_name} — ${a.url}`))
      }

      if (data.logs && (data.logs as unknown[]).length) {
        const logs = data.logs as Record<string, unknown>[]
        parts.push('', '## Activity Log')
        for (const l of logs.slice(-10)) {
          parts.push(`  [${l.created_at}] ${l.type}: ${l.message ?? ''}`)
        }
      }

      return parts.join('\n')
    }

    case 'ywh_submit_report': {
      const token = loadToken()
      if (!token) return 'Not authenticated. Run ywh_login first.'

      const body: Record<string, unknown> = {
        program:     { slug: args.program_slug },
        title:       args.title,
        description: args.description,
        scope:       args.scope,
        severity:    args.severity,
      }

      if (args.cvss_vector) {
        body.cvss = { vector: args.cvss_vector }
      }

      const data = await post('/reports', body, token) as Record<string, unknown>

      return [
        `Report submitted successfully.`,
        `ID: ${data.id}`,
        `Title: ${data.title}`,
        `Status: ${data.status}`,
        `URL: https://yeswehack.com/dashboard/reports/${data.id}`,
        '',
        'Review and finalize the report on the YesWeHack platform before it is sent to the triage team.',
      ].join('\n')
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ── MCP server setup ─────────────────────────────────────────────────────────

const server = new Server(
  { name: 'yeswehack', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params
  try {
    const result = await handle(name, args as Record<string, unknown>)
    return { content: [{ type: 'text', text: result }] }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }
  }
})

process.on('unhandledRejection', err => process.stderr.write(`ywh-mcp: ${err}\n`))
process.on('uncaughtException',  err => process.stderr.write(`ywh-mcp: ${err}\n`))

const transport = new StdioServerTransport()
await server.connect(transport)
