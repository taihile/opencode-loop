import os from "node:os"
import path from "node:path"
import { writeFile } from "node:fs/promises"

const MERMAID_CDN = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs"

const DARK = {
  bodyBg: "#1e1e2e",
  bodyFg: "#cdd6f4",
  errorFg: "#f38ba8",
  mermaidTheme: "dark",
}

const LIGHT = {
  bodyBg: "#fafafa",
  bodyFg: "#4c4f69",
  errorFg: "#d20f39",
  mermaidTheme: "default",
}

/**
 * Build a self-contained HTML document that renders a mermaid diagram.
 * The source is embedded as JSON so hostile content in the diagram source
 * (e.g. `</script><script>` payloads) can never break out into markup.
 */
export function mermaidHtml(input: { source: string; theme: "dark" | "light"; title?: string }): string {
  const palette = input.theme === "dark" ? DARK : LIGHT
  const title = input.title ?? "Mermaid diagram"
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; padding: 24px; background: ${palette.bodyBg}; color: ${palette.bodyFg};
         font-family: system-ui, sans-serif; min-height: 100vh; box-sizing: border-box; }
  main { max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 14px; font-weight: normal; opacity: 0.7; margin: 0 0 16px; }
  #graph { display: flex; justify-content: center; }
  #graph svg { max-width: 100%; height: auto; }
  #fallback { display: none; margin-top: 16px; }
  #fallback pre { white-space: pre-wrap; background: rgba(128,128,128,0.15); padding: 12px;
                  border-radius: 6px; font-size: 12px; }
  #error { display: none; color: ${palette.errorFg}; font-size: 14px; margin-top: 16px; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)} · rendered by opencode</h1>
  <div id="graph"></div>
  <p id="error"></p>
  <div id="fallback"><pre id="source"></pre></div>
</main>
<script type="application/json" id="mermaid-source">${JSON.stringify(input.source).replace(/</g, "\\u003c")}</script>
<script type="module">
  const source = JSON.parse(document.getElementById("mermaid-source").textContent)
  document.getElementById("source").textContent = source
  try {
    const mermaid = (await import("${MERMAID_CDN}")).default
    mermaid.initialize({ startOnLoad: false, theme: "${palette.mermaidTheme}", securityLevel: "strict" })
    const { svg } = await mermaid.render("graph", source)
    document.getElementById("graph").innerHTML = svg
  } catch (err) {
    document.getElementById("error").textContent =
      "Failed to render diagram: " + (err?.message ?? err) +
      ". Rendering requires network access to load mermaid.js."
    document.getElementById("fallback").style.display = "block"
  }
</script>
</body>
</html>
`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

/** djb2 — stable filename hash without external dependencies. */
function hashString(value: string): string {
  let hash = 5381
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(16)
}

/**
 * Write the diagram to a stable temp path keyed by content hash so the same
 * diagram always maps to the same file (idempotent re-open, multi-click safe).
 */
export async function exportMermaidFile(input: { source: string; theme: "dark" | "light" }): Promise<string> {
  const filename = `opencode-mermaid-${input.theme}-${hashString(input.source)}.html`
  const filepath = path.join(os.tmpdir(), filename)
  await writeFile(filepath, mermaidHtml({ source: input.source, theme: input.theme }), "utf8")
  return filepath
}
