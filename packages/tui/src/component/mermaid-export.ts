import os from "node:os"
import path from "node:path"
import { copyFileSync, existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

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
  // The runtime is referenced as a sibling file, NOT inlined: the minified
  // bundle contains `<!--` sequences, and an HTML parser inside <script>
  // treats those as comment-openers, swallowing following markup.
  const runtimeSrc = getMermaidRuntimeFile()
  const runtimeTag = runtimeSrc
    ? `<script src="${runtimeSrc}"></script>`
    : `<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>`
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
  #mermaid-graph { display: flex; justify-content: center; }
  #mermaid-graph svg { max-width: 100%; height: auto; }
  #fallback { display: none; margin-top: 16px; }
  #fallback pre { white-space: pre-wrap; background: rgba(128,128,128,0.15); padding: 12px;
                  border-radius: 6px; font-size: 12px; }
  #error { display: none; color: ${palette.errorFg}; font-size: 14px; margin-top: 16px; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)} · rendered by opencode</h1>
  <div id="mermaid-graph"></div>
  <p id="error"></p>
  <div id="fallback"><pre id="source"></pre></div>
</main>
<script type="application/json" id="mermaid-source">${JSON.stringify(input.source).replace(/</g, "\\u003c")}</script>
${runtimeTag}
<script>
  // The runtime above is a UMD bundle exposing window.mermaid (inlined for
  // offline use; CDN fallback when the dependency is unavailable). Classic
  // script, no top-level await, guarded error stringification so the failure
  // path can never fail silently.
  (function () {
    var source = JSON.parse(document.getElementById("mermaid-source").textContent)
    document.getElementById("source").textContent = source
    function fail(err) {
      var detail = "unknown error"
      try { detail = err && err.message ? String(err.message) : String(err) } catch (e) {}
      document.getElementById("error").textContent = "Failed to render diagram: " + detail
      document.getElementById("error").style.display = "block"
      document.getElementById("fallback").style.display = "block"
    }
    try {
      if (!window.mermaid) throw new Error("mermaid runtime did not load")
      window.mermaid.initialize({ startOnLoad: false, theme: "${palette.mermaidTheme}", securityLevel: "strict" })
      window.mermaid
        .render("opencode-diagram", source)
        .then(function (result) {
          document.getElementById("mermaid-graph").innerHTML = result.svg
        })
        .catch(fail)
    } catch (err) {
      fail(err)
    }
  })()
</script>
</body>
</html>
`
}

/**
 * The mermaid UMD bundle is ~3.4MB. It is copied next to the exported HTML
 * files as a fixed-name sibling and referenced via <script src> so diagrams
 * render fully offline — no CDN, no network dependency. Inlining is not an
 * option: the minified bundle contains `<!--` sequences that an HTML parser
 * inside <script> treats as comment-openers, swallowing following markup.
 *
 * Returns the sibling filename, or undefined when the dependency is missing
 * (stripped install) — exports then fall back to the CDN script tag.
 */
const RUNTIME_FILENAME = "opencode-mermaid-runtime.js"
let runtimeCopied = false
function getMermaidRuntimeFile(): string | undefined {
  try {
    const dist = require.resolve("mermaid/dist/mermaid.min.js")
    const target = path.join(os.tmpdir(), RUNTIME_FILENAME)
    if (!runtimeCopied || !existsSync(target)) {
      copyFileSync(dist, target)
      runtimeCopied = true
    }
    return RUNTIME_FILENAME
  } catch {
    return undefined
  }
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
