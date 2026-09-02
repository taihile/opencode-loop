import { describe, expect, test } from "bun:test"
import { mermaidHtml, exportMermaidFile } from "../../src/component/mermaid-export"
import { mermaidKind } from "../../src/component/mermaid-preview"

describe("mermaidHtml", () => {
  test("embeds escaped source, CDN import and theme", () => {
    const html = mermaidHtml({ source: "flowchart TD\n  A --> B", theme: "dark" })
    expect(html).toContain(`"flowchart TD\\n  A --> B"`)
    expect(html).toContain("cdn.jsdelivr.net/npm/mermaid@11")
    expect(html).toContain(`theme: "dark"`)
    expect(html).toContain(`securityLevel: "strict"`)
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
