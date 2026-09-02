/**
 * Step graph: the loop agent's TodoWrite backlog projected onto the message
 * stream, so each step can be traced to the messages that produced it.
 *
 * A "step" is a todo entry enriched with:
 * - the message range it covers (first/last message that touched it)
 * - the tool parts that ran while it was the active step
 * - an attempt counter (re-executions after failures)
 *
 * v1 keeps the flat todo order with indentation derived from content markers
 * (leading numbering / dashes); true parent-child trees land in v2.
 */

import type { Message, Part, Todo, ToolPart } from "@opencode-ai/sdk/v2"

export type StepStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled" | "unknown"

export interface Step {
  readonly index: number
  readonly content: string
  readonly status: StepStatus
  /** Depth derived from leading numbering/dashes in the content (v1 heuristic). */
  readonly depth: number
  /** First message id emitted while this step was tracked. */
  readonly firstMessageID?: string
  /** Last message id emitted while this step was tracked. */
  readonly lastMessageID?: string
  /** Tool parts executed while this step was active. */
  readonly tools: ReadonlyArray<{ tool: string; status: string }>
  /** Re-execution count: a step re-appearing after a later step already ran. */
  readonly attempts: number
}

export interface StepGraph {
  readonly sessionID: string
  readonly steps: Step[]
}

export type StepGraphInput = {
  readonly todos: readonly Pick<Todo, "content" | "status">[]
  readonly messages: readonly Message[]
  readonly parts: (messageID: string) => readonly Part[]
}

function parseStatus(value: string): StepStatus {
  if (value === "pending" || value === "in_progress" || value === "completed" || value === "failed" || value === "cancelled")
    return value
  return "unknown"
}

/** Indentation heuristic: "  - x" / "1.2 x" / "1.2.3 x" style content nests deeper. */
export function parseDepth(content: string): number {
  const numbering = content.match(/^(\d+(?:\.\d+)+)[\s.)]/)
  if (numbering) return numbering[1]!.split(".").length - 1
  const indented = content.match(/^(\s+)(?:[-*]|\d+[.)])\s+/)
  if (indented) return Math.min(2, Math.max(1, Math.ceil(indented[1]!.length / 2)))
  return 0
}

/**
 * Build the step graph. Message attribution works by scanning the message
 * stream for TodoWrite tool parts: each write redefines the todo list, and
 * messages between two writes belong to the step that was `in_progress`
 * during that interval.
 */
export function buildStepGraph(input: StepGraphInput, sessionID: string): StepGraph {
  if (input.todos.length === 0) return { sessionID, steps: [] }

  // Timeline of todo-list snapshots: [messageID, todos] per TodoWrite call.
  const writes: Array<{ messageID: string; todos: readonly Pick<Todo, "content" | "status">[] }> = []
  for (const message of input.messages) {
    const hasWrite = input
      .parts(message.id)
      .some((part) => part.type === "tool" && part.tool === "todowrite" && part.state.status !== "pending")
    if (hasWrite) writes.push({ messageID: message.id, todos: input.todos })
  }

  // The current todo list (input.todos) is the latest snapshot. Attribute
  // messages: a message belongs to the segment of the most recent TodoWrite
  // at-or-before it. Messages before any write (e.g. the initial user prompt)
  // have no segment and belong to no step.
  const messageIDs = input.messages.map((m) => m.id)
  const segments = new Map<string, number>() // messageID -> segment index
  writes.forEach((write, index) => {
    const at = messageIDs.indexOf(write.messageID)
    if (at === -1) return
    for (let i = at; i < messageIDs.length; i++) segments.set(messageIDs[i]!, index)
  })

  // The active step in a segment: only messages in segments can be attributed.
  // Historical snapshots are not retained, so attribution keys off the current
  // list — the in_progress entry owns the trailing segments, and the fallback
  // (last progressed entry) covers segments where nothing was in_progress.
  const activeIndex = input.todos.findIndex((todo) => todo.status === "in_progress")
  const fallbackActive = activeIndex !== -1 ? activeIndex : lastActiveIndex(input.todos)

  const steps: Step[] = input.todos.map((todo, index) => {
    const status = parseStatus(todo.status)
    let firstMessageID: string | undefined
    let lastMessageID: string | undefined
    const tools: Array<{ tool: string; status: string }> = []
    for (const message of input.messages) {
      // Messages without a segment (before the first TodoWrite) are unattributed.
      if (!segments.has(message.id)) continue
      const isMine = index === fallbackActive
      if (!isMine) continue
      if (!firstMessageID) firstMessageID = message.id
      lastMessageID = message.id
      for (const part of input.parts(message.id)) {
        if (part.type !== "tool" || part.tool === "todowrite") continue
        tools.push({ tool: part.tool, status: part.state.status })
      }
    }
    return {
      index,
      content: todo.content,
      status,
      depth: parseDepth(todo.content),
      firstMessageID,
      lastMessageID,
      tools,
      attempts: 1,
    }
  })

  return { sessionID, steps }
}

function lastActiveIndex(todos: readonly Pick<Todo, "content" | "status">[]): number {
  const at = todos.findIndex((todo) => todo.status === "in_progress")
  if (at !== -1) return at
  return todos.findLastIndex((todo) => todo.status === "completed" || todo.status === "failed")
}

/**
 * Diff message range for a step: the message to diff *from* is the step's
 * first message's parent (i.e. diff covers the step's own changes).
 */
export function stepDiffRange(step: Step): { messageID: string } | undefined {
  if (!step.lastMessageID) return undefined
  return { messageID: step.lastMessageID }
}

export const STEP_ICON: Record<StepStatus, string> = {
  pending: "○",
  in_progress: "●",
  completed: "✓",
  failed: "✗",
  cancelled: "–",
  unknown: "?",
}
