import { describe, expect, test } from "bun:test"
import { buildAgentGraph, renderGraphLines, renderGraphMermaid } from "../../src/component/agent-graph"
import type { GraphInput } from "../../src/component/agent-graph"

function makeInput(input: {
  messages?: Record<string, Array<{ id: string; role: string }>>
  parts?: Record<string, Array<Record<string, unknown>>>
  status?: Record<string, { type: string }>
}): GraphInput {
  return {
    sessions: [],
    messages: (sessionID) => (input.messages?.[sessionID] ?? []) as any,
    parts: (messageID) => (input.parts?.[messageID] ?? []) as any,
    status: (sessionID) => input.status?.[sessionID],
  }
}

function taskPart(input: {
  id: string
  status: "pending" | "running" | "completed" | "error"
  sessionID?: string
  subagent?: string
  description?: string
  background?: boolean
}) {
  return {
    id: input.id,
    type: "tool",
    tool: "task",
    state: {
      status: input.status,
      input: {
        subagent_type: input.subagent ?? "general",
        description: input.description ?? "do the thing",
      },
      metadata: input.sessionID
        ? { sessionId: input.sessionID, ...(input.background ? { background: true } : {}) }
        : undefined,
    },
  }
}

describe("buildAgentGraph", () => {
  test("collects task nodes with resolved agent and description", () => {
    const graph = buildAgentGraph(
      makeInput({
        messages: { root: [{ id: "m1", role: "assistant" }] },
        parts: {
          m1: [taskPart({ id: "p1", status: "completed", sessionID: "child1", subagent: "explore" })],
        },
      }),
      "root",
    )
    expect(graph).toBeDefined()
    expect(graph!.nodes).toHaveLength(1)
    expect(graph!.nodes[0]).toMatchObject({
      id: "p1",
      sessionID: "child1",
      agent: "explore",
      status: "completed",
    })
  })

  test("maps tool error and running states to node statuses", () => {
    const graph = buildAgentGraph(
      makeInput({
        messages: { root: [{ id: "m1", role: "assistant" }, { id: "m2", role: "assistant" }] },
        parts: {
          m1: [taskPart({ id: "p1", status: "error", sessionID: "c1" })],
          m2: [taskPart({ id: "p2", status: "running", sessionID: "c2" })],
        },
      }),
      "root",
    )
    expect(graph!.nodes.map((n) => n.status)).toEqual(["error", "running"])
  })

  test("background tasks keep running until session goes idle", () => {
    const parts = { m1: [taskPart({ id: "p1", status: "completed", sessionID: "c1", background: true })] }
    const running = buildAgentGraph(
      makeInput({ messages: { root: [{ id: "m1", role: "assistant" }] }, parts, status: { c1: { type: "running" } } }),
      "root",
    )
    const idle = buildAgentGraph(
      makeInput({ messages: { root: [{ id: "m1", role: "assistant" }] }, parts, status: { c1: { type: "idle" } } }),
      "root",
    )
    expect(running!.nodes[0].status).toBe("running")
    expect(idle!.nodes[0].status).toBe("completed")
  })

  test("pending task parts without session metadata are skipped", () => {
    const graph = buildAgentGraph(
      makeInput({
        messages: { root: [{ id: "m1", role: "assistant" }] },
        parts: { m1: [taskPart({ id: "p1", status: "pending" })] },
      }),
      "root",
    )
    expect(graph!.nodes).toHaveLength(0)
  })

  test("exposes subagent activity from its tool parts", () => {
    const graph = buildAgentGraph(
      makeInput({
        messages: {
          root: [{ id: "m1", role: "assistant" }],
          c1: [{ id: "m2", role: "assistant" }],
        },
        parts: {
          m1: [taskPart({ id: "p1", status: "running", sessionID: "c1", subagent: "general" })],
          m2: [
            {
              id: "p2",
              type: "tool",
              tool: "bash",
              state: { status: "running", title: "bun test" },
            },
          ],
        },
      }),
      "root",
    )
    expect(graph!.nodes[0].activity).toBe("bash: bun test")
  })
})

describe("renderGraphMermaid", () => {
  test("renders nodes with status decorations", () => {
    const graph = buildAgentGraph(
      makeInput({
        messages: { root: [{ id: "m1", role: "assistant" }, { id: "m2", role: "assistant" }] },
        parts: {
          m1: [taskPart({ id: "p1", status: "completed", sessionID: "c1", description: `say "hi"` })],
          m2: [taskPart({ id: "p2", status: "error", sessionID: "c2" })],
        },
      }),
      "root",
    )
    const mermaid = renderGraphMermaid(graph!)
    expect(mermaid).toContain("flowchart TD")
    expect(mermaid).toContain('root["build orchestrator"]')
    expect(mermaid).toContain('n0("general\\nsay \'hi\' ✓")')
    expect(mermaid).toContain("n1([")
    expect(mermaid).toContain("root --> n0")
    expect(mermaid).not.toContain('"hi"')
    // Edges must reference bare node ids — a labeled shape on an edge
    // (root --> n0("...")) is a mermaid parse error.
    for (const line of mermaid.split("\n")) {
      if (line.includes("-->")) expect(line.includes("(")).toBe(false)
    }
  })

  test("empty graph renders a placeholder", () => {
    const mermaid = renderGraphMermaid({ sessionID: "root", agent: "loop", nodes: [] })
    expect(mermaid).toContain('none("no subagents dispatched yet")')
  })
})

describe("renderGraphLines", () => {
  test("renders a compact status summary and node lines", () => {
    const graph = buildAgentGraph(
      makeInput({
        messages: { root: [{ id: "m1", role: "assistant" }] },
        parts: { m1: [taskPart({ id: "p1", status: "running", sessionID: "c1", subagent: "explore" })] },
      }),
      "root",
    )
    const lines = renderGraphLines(graph!)
    expect(lines[0]).toContain("build (orchestrator)")
    expect(lines[1]).toContain("● explore: do the thing")
  })
})
