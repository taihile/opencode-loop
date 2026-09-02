import { BoxRenderable, TextRenderable, type ColorInput, type Renderable, type RenderContext } from "@opentui/core"

/**
 * Mermaid diagram preview card rendered inside the markdown message stream.
 *
 * Built with raw opentui renderables (not Solid JSX) because markdown custom
 * renderers (`MarkdownOptions.renderNode`) run outside the solid reconciler.
 * The card shows the diagram type plus a source preview; clicking it exports
 * the diagram to a self-contained HTML file and opens it in the browser.
 */

export interface MermaidCardInput {
  source: string
  ctx: RenderContext
  fg: ColorInput
  muted: ColorInput
  background: ColorInput
  backgroundHover: ColorInput
  border: ColorInput
  onOpen: () => void
}

export const MERMAID_LANGS = ["mermaid", "mmd"]

/** Parse the diagram kind (flowchart, sequenceDiagram, ...) from the source's first keyword. */
export function mermaidKind(source: string): string {
  const first = source
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (!first) return "diagram"
  const keyword = first.split(/\s+/)[0]!.toLowerCase()
  return keyword === "graph" || keyword === "flowchart" ? "flowchart" : keyword
}

function sourcePreview(source: string): string {
  const lines = source
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(0, 2)
  return lines.join(" · ")
}

export function createMermaidCard(input: MermaidCardInput): Renderable {
  const kind = mermaidKind(input.source)
  const preview = sourcePreview(input.source)

  const card = new BoxRenderable(input.ctx, {
    width: "100%",
    flexDirection: "column",
    paddingLeft: 2,
    paddingTop: 0,
    paddingBottom: 0,
    flexShrink: 0,
    backgroundColor: input.background,
    onMouseOver: () => {
      card.backgroundColor = input.backgroundHover
    },
    onMouseOut: () => {
      card.backgroundColor = input.background
    },
    onMouseUp: () => {
      input.onOpen()
    },
  })

  const title = new TextRenderable(input.ctx, {
    content: `◈ ${kind} diagram · click to open in browser`,
    fg: input.fg,
    width: "100%",
  })
  card.add(title)

  if (preview) {
    const detail = new TextRenderable(input.ctx, {
      content: preview.slice(0, 120),
      fg: input.muted,
      width: "100%",
    })
    card.add(detail)
  }

  return card
}
