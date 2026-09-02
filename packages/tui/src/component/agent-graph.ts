/**
 * Agent collaboration graph extracted from session data.
 *
 * The loop orchestrator (or any primary session) spawns subagent sessions via
 * the task tool. Each task tool part carries metadata with `parentSessionId`
 * and `sessionId`, and the child session's messages/parts stream in through
 * sync. This module derives a live tree of coordination nodes:
 *
 *   orchestrator ── task#1 (explore) ── running
 *                ── task#2 (general) ── completed
 *                ── task#3 (general) ── error
 *
 * plus a mermaid flowchart rendering of the same data for browser preview.
 */

import type { Message, Part, Session, ToolPart } from "@opencode-ai/sdk/v2"

export type NodeStatus = "pending" | "running" | "completed" | "error"

export interface AgentNode {
  /** Tool part id of the task call (stable key). */
  readonly id: string
  /** Child session id (task_id). */
  readonly sessionID: string
  /** Subagent name (subagent_type). */
  readonly agent: string
  /** Short description from the task call. */
  readonly description: string
  readonly status: NodeStatus
  /** What the subagent is currently doing, when observable. */
  readonly activity?: string
  readonly background: boolean
}

export interface AgentGraph {
  /** Orchestrator session id. */
  readonly sessionID: string
  /** Orchestrator agent name. */
  readonly agent: string
  readonly nodes: AgentNode[]
}

export type GraphInput = {
  /** All known sessions (to resolve parents + orchestrator agent). */
  readonly sessions: readonly Session[]
  /** Messages by session id. */
  readonly messages: (sessionID: string) => readonly Message[]
  /** Parts by message id. */
  readonly parts: (messageID: string) => readonly Part[]
  /** Session status by session id. */
  readonly status: (sessionID: string) => { type: string } | undefined
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/** Current activity line for a subagent session: last running/completed tool title. */
function subagentActivity(input: GraphInput, sessionID: string): string | undefined {
  const tools = input
    .messages(sessionID)
    .flatMap((msg) => input.parts(msg.id))
    .filter((part): part is ToolPart => part.type === "tool")
    .filter((part) => part.state.status === "running" || part.state.status === "completed")
  const last = tools.findLast((part) => part.state.status === "running") ?? tools.at(-1)
  if (!last) return undefined
  const state = last.state
  if (state.status !== "running" && state.status !== "completed") return undefined
  return `${last.tool}: ${state.title ?? ""}`.trim()
}

function nodeStatus(input: GraphInput, part: ToolPart, sessionID: string, background: boolean): NodeStatus {
  if (part.state.status === "error") return "error"
  const status = input.status(sessionID)
  if (part.state.status === "running") return "running"
  if (part.state.status === "pending") return "pending"
  // Foreground task parts flip to completed when the subagent finishes. Background
  // parts complete immediately, so consult the session status instead.
  if (part.state.status === "completed") {
    if (!background) return "completed"
    if (status === undefined || status.type === "idle") return "completed"
    return "running"
  }
  return "running"
}

/**
 * Build the collaboration graph for a root session. The root is either the
 * given session (when it is the orchestrator) or its parent — subagent views
 * show the collaboration they belong to.
 *
 * `sessions` is optional: the TUI state layer cannot enumerate all sessions,
 * so the root is discovered by scanning messages for task parts. Pass sessions
 * when available to resolve the orchestrator agent name and parent links.
 */
export function buildAgentGraph(input: GraphInput, sessionID: string): AgentGraph | undefined {
  const session = input.sessions.find((s) => s.id === sessionID)
  // A subagent view resolves to its orchestrator via parentID when the parent
  // session is known; otherwise fall back to the given session itself.
  const rootID = session?.parentID ?? sessionID
  const root = session?.parentID ? input.sessions.find((s) => s.id === rootID) : session

  const nodes = collectNodes(input, rootID)
  // When the resolved root has no task parts but the caller's session does
  // (parent messages not synced), fall back to the caller's session.
  const fallback = nodes.length === 0 && rootID !== sessionID ? collectNodes(input, sessionID) : nodes
  return { sessionID: rootID, agent: root?.agent ?? session?.agent ?? "build", nodes: fallback }
}

function collectNodes(input: GraphInput, sessionID: string): AgentNode[] {
  return input
    .messages(sessionID)
    .flatMap((msg) => input.parts(msg.id))
    .filter((part): part is ToolPart => part.type === "tool" && part.tool === "task")
    .flatMap((part) => {
      const meta = part.state.status === "pending" ? {} : (part.state.metadata ?? {})
      const childID = stringMetadata(meta.sessionId)
      if (!childID) return []
      const agent = stringMetadata(
        part.state.status === "pending" ? undefined : part.state.input?.subagent_type,
      )
      const description =
        stringMetadata(part.state.status === "pending" ? undefined : part.state.input?.description) ?? "task"
      const background = meta.background === true
      return [
        {
          id: part.id,
          sessionID: childID,
          agent: agent ?? "general",
          description,
          status: nodeStatus(input, part, childID, background),
          activity: subagentActivity(input, childID),
          background,
        } satisfies AgentNode,
      ]
    })
}

const STATUS_ICON: Record<NodeStatus, string> = {
  pending: "○",
  running: "●",
  completed: "✓",
  error: "✗",
}

/** Render the graph as a compact tree for the TUI sidebar/panel. */
export function renderGraphLines(graph: AgentGraph): string[] {
  const counts = graph.nodes.reduce(
    (acc, node) => {
      acc[node.status]++
      return acc
    },
    { pending: 0, running: 0, completed: 0, error: 0 } as Record<NodeStatus, number>,
  )
  const header = [
    `${STATUS_ICON.running} ${counts.running}`,
    `${STATUS_ICON.completed} ${counts.completed}`,
    `${STATUS_ICON.error} ${counts.error}`,
    `${STATUS_ICON.pending} ${counts.pending}`,
  ].join("  ")
  const lines = [`${graph.agent} (orchestrator)  ${header}`]
  for (const node of graph.nodes) {
    lines.push(`  ${STATUS_ICON[node.status]} ${node.agent}: ${node.description}`)
    if (node.activity) lines.push(`      ↳ ${node.activity}`)
  }
  return lines
}

/** Render the graph as a mermaid flowchart (live node states) for browser preview. */
export function renderGraphMermaid(graph: AgentGraph): string {
  const lines = ["flowchart TD"]
  const safe = (value: string) => value.replaceAll('"', "'").replaceAll("\n", " ")
  lines.push(`  root["${safe(graph.agent)} orchestrator"]`)
  graph.nodes.forEach((node, index) => {
    const id = `n${index}`
    const label = `${node.agent}\\n${safe(node.description).slice(0, 60)}`
    const shape =
      node.status === "completed"
        ? `${id}("${label} ✓")`
        : node.status === "error"
          ? `${id}(["${label} ✗"])`
          : node.status === "running"
            ? `${id}>{{"${label}"}}`
            : `${id}("${label}")`
    // Define labeled nodes on their own lines; edges reference bare ids only —
    // mermaid rejects `root --> n0("...")` as a parse error.
    lines.push(`  ${shape}`)
    lines.push(`  root --> ${id}`)
  })
  if (graph.nodes.length === 0) lines.push(`  none("no subagents dispatched yet")`)
  return lines.join("\n")
}
