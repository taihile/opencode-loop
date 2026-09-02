import { describe, expect, test } from "bun:test"
import { buildStepGraph, parseDepth, stepDiffRange } from "../../src/component/step-graph"

function todo(content: string, status: string) {
  return { content, status, priority: "high" }
}

function message(id: string, role: "user" | "assistant") {
  return { id, role, time: { created: 1 } } as any
}

function toolPart(id: string, tool: string, status: string) {
  return { id, type: "tool", tool, state: { status } } as any
}

const baseInput = {
  todos: [todo("Analyze code structure", "completed"), todo("Fix type errors", "in_progress"), todo("Run regression", "pending")],
  messages: [message("m1", "user"), message("m2", "assistant"), message("m3", "assistant"), message("m4", "assistant")],
  parts: (messageID: string) =>
    ({
      m1: [],
      m2: [toolPart("p1", "todowrite", "completed"), toolPart("p2", "grep", "completed")],
      m3: [toolPart("p3", "todowrite", "completed"), toolPart("p4", "edit", "completed"), toolPart("p5", "bash", "error")],
      m4: [toolPart("p6", "read", "running")],
    })[messageID] ?? [],
}

describe("buildStepGraph", () => {
  test("maps todos to steps with status and depth", () => {
    const graph = buildStepGraph(baseInput as any, "s1")
    expect(graph.steps).toHaveLength(3)
    expect(graph.steps[0]).toMatchObject({ content: "Analyze code structure", status: "completed", depth: 0 })
    expect(graph.steps[1]).toMatchObject({ status: "in_progress" })
    expect(graph.steps[2]).toMatchObject({ status: "pending" })
  })

  test("attributes messages and tools to the active step", () => {
    const graph = buildStepGraph(baseInput as any, "s1")
    const active = graph.steps[1]!
    // The in_progress step owns the messages from the first TodoWrite (m2)
    // onward; historical snapshots are not retained, so attribution starts
    // at the first segmented message.
    expect(active.firstMessageID).toBe("m2")
    expect(active.lastMessageID).toBe("m4")
    const toolNames = active.tools.map((t) => t.tool)
    expect(toolNames).toContain("grep")
    expect(toolNames).toContain("edit")
    expect(toolNames).toContain("bash")
    expect(toolNames).toContain("read")
    expect(toolNames).not.toContain("todowrite")
  })

  test("pending steps have no linked messages", () => {
    const graph = buildStepGraph(baseInput as any, "s1")
    expect(graph.steps[2]!.firstMessageID).toBeUndefined()
    expect(graph.steps[2]!.tools).toHaveLength(0)
  })

  test("empty todo list yields an empty graph", () => {
    const graph = buildStepGraph({ todos: [], messages: [], parts: () => [] }, "s1")
    expect(graph.steps).toHaveLength(0)
  })

  test("unknown status strings map to unknown", () => {
    const graph = buildStepGraph(
      { ...baseInput, todos: [todo("weird", "blocked")] } as any,
      "s1",
    )
    expect(graph.steps[0]!.status).toBe("unknown")
  })
})

describe("parseDepth", () => {
  test("flat content is depth 0", () => {
    expect(parseDepth("Fix the bug")).toBe(0)
  })

  test("numbered sub-steps nest", () => {
    expect(parseDepth("1. Do the thing")).toBe(0)
    expect(parseDepth("1.2 Sub step")).toBe(1)
    expect(parseDepth("2.3.4 Deep step")).toBe(2)
  })

  test("indented bullet content nests", () => {
    expect(parseDepth("  - child item")).toBe(1)
  })
})

describe("stepDiffRange", () => {
  test("returns the last linked message for diffing", () => {
    const graph = buildStepGraph(baseInput as any, "s1")
    expect(stepDiffRange(graph.steps[1]!)).toEqual({ messageID: "m4" })
  })

  test("unlinked steps have no diff range", () => {
    const graph = buildStepGraph(baseInput as any, "s1")
    expect(stepDiffRange(graph.steps[2]!)).toBeUndefined()
  })
})
