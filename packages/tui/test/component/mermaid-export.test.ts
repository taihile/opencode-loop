import { describe, expect, test } from "bun:test"
import { mermaidHtml, exportMermaidFile } from "../../src/component/mermaid-export"
import { mermaidKind } from "../../src/component/mermaid-preview"

describe("mermaidHtml", () => {
  test("references the local runtime and theme", () => {
    const html = mermaidHtml({ source: "flowchart TD\n  A --> B", theme: "dark" })
    expect(html).toContain(`"flowchart TD\\n  A --> B"`)
    // Runtime ships as a sibling file (offline), falling back to CDN only
    // when the dependency is missing.
    expect(html).toMatch(/src="(opencode-mermaid-runtime\.js|https:\/\/cdn\.jsdelivr\.net[^"]*)"/)
    expect(html).toContain(`theme: "dark"`)
    expect(html).toContain(`securityLevel: "strict"`)
  })

  test("avoids the mermaid render id colliding with the container id", () => {
    // Regression: mermaid.render("graph", ...) removes the DOM element whose
    // id equals the render id — the diagram container vanished from the page.
    const html = mermaidHtml({ source: "flowchart TD", theme: "dark" })
    expect(html).toContain('id="mermaid-graph"')
    expect(html).not.toContain('render("graph"')
    expect(html).toContain('"opencode-diagram"')
  })

  test("uses light theme palette for light mode", () => {
    const html = mermaidHtml({ source: "sequenceDiagram", theme: "light" })
    expect(html).toContain(`theme: "default"`)
    expect(html).toContain("#fafafa")
  })

  test("escapes hostile script payloads out of the document markup", () => {
    const html = mermaidHtml({ source: `flowchart TD\n  A["</script><script>alert(1)</script>"]`, theme: "dark" })
    // The raw payload must never appear verbatim; JSON escaping turns `<` into \u003c
    expect(html).not.toContain("</script><script>")
    expect(html).not.toContain("<script>alert(1)")
  })

  test("escapes the title", () => {
    const html = mermaidHtml({ source: "flowchart TD", theme: "dark", title: `"<img onerror=x>"` })
    expect(html).not.toContain("<img onerror=x>")
  })
})

describe("exportMermaidFile", () => {
  test("is idempotent for the same source and theme", async () => {
    const input = { source: "flowchart TD\n  A --> B", theme: "dark" as const }
    const first = await exportMermaidFile(input)
    const second = await exportMermaidFile(input)
    expect(second).toBe(first)
    const file = Bun.file(first)
    expect(await file.exists()).toBe(true)
    expect(await file.text()).toContain("flowchart TD")
  })

  test("separates files by theme and source", async () => {
    const dark = await exportMermaidFile({ source: "flowchart TD\n  A --> B", theme: "dark" })
    const light = await exportMermaidFile({ source: "flowchart TD\n  A --> B", theme: "light" })
    const other = await exportMermaidFile({ source: "flowchart TD\n  A --> C", theme: "dark" })
    expect(new Set([dark, light, other]).size).toBe(3)
  })
})

describe("mermaidKind", () => {
  test("recognizes common diagram kinds from the first keyword", () => {
    expect(mermaidKind("flowchart TD\n  A --> B")).toBe("flowchart")
    expect(mermaidKind("graph LR\n  A --> B")).toBe("flowchart")
    expect(mermaidKind("sequenceDiagram\n  A->>B: hi")).toBe("sequencediagram")
    expect(mermaidKind("classDiagram\nclass A")).toBe("classdiagram")
  })

  test("falls back for empty or unrecognized sources", () => {
    expect(mermaidKind("   \n\n")).toBe("diagram")
    expect(mermaidKind("pie\n  A: 1")).toBe("pie")
  })
})
