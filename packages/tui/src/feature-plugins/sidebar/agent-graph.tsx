import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show } from "solid-js"
import { buildAgentGraph, type AgentNode } from "../../component/agent-graph"
import { exportMermaidFile } from "../../component/mermaid-export"
import { renderGraphMermaid } from "../../component/agent-graph"
import open from "open"
import path from "node:path"
import { writeFile, mkdir } from "node:fs/promises"

const id = "internal:agent-graph"

const STATUS_ICON = {
  pending: "○",
  running: "●",
  completed: "✓",
  error: "✗",
} as const

function statusColor(theme: () => any, status: AgentNode["status"]) {
  const t = theme()
  if (status === "error") return t.error
  if (status === "running") return t.warning
  if (status === "completed") return t.success
  return t.textMuted
}

/** Sidebar view: live collaboration status while the orchestrator runs. */
function SidebarView(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const state = props.api.state
  const graph = createMemo(() =>
    buildAgentGraph(
      {
        sessions: [],
        messages: (sessionID) => state.session.messages(sessionID),
        parts: (messageID) => state.part(messageID),
        status: (sessionID) => state.session.status(sessionID),
      },
      props.session_id,
    ),
  )
  const nodes = createMemo(() => graph()?.nodes ?? [])

  return (
    <Show when={nodes().length > 0}>
      <box>
        <box flexDirection="row" gap={1}>
          <text fg={theme().text}>
            <b>Agents</b>
          </text>
          <text fg={theme().textMuted}>{nodes().length} subagents</text>
        </box>
        <For each={nodes()}>
          {(node) => (
            <box flexDirection="row" gap={1}>
              <text flexShrink={0} fg={statusColor(theme, node.status)}>
                {STATUS_ICON[node.status]}
              </text>
              <box flexDirection="column" flexGrow={1} minWidth={0}>
                <text fg={theme().text} wrapMode="none">
                  {node.agent} · {node.description.slice(0, 34)}
                </text>
                <Show when={node.activity}>
                  <text fg={theme().textMuted} wrapMode="none">
                    ↳ {node.activity!.slice(0, 36)}
                  </text>
                </Show>
              </box>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}

/**
 * Save a user agent to `.opencode/agents/<name>.md` in the project worktree
 * (or the global config directory when no worktree is available).
 */
async function saveAgentFile(api: TuiPluginApi, name: string, description: string, prompt: string) {
  const safe = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!safe) throw new Error("invalid agent name")
  const worktree = api.state.path.worktree
  const dir = worktree ? path.join(worktree, ".opencode", "agents") : path.join(api.state.path.config, "agents")
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, `${safe}.md`)
  const frontmatter = ["---", `description: ${JSON.stringify(description)}`, "mode: subagent", "---"].join("\n")
  await writeFile(file, `${frontmatter}\n\n${prompt.trim()}\n`, "utf8")
  return file
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 350,
    slots: {
      sidebar_content(_ctx, props) {
        return <SidebarView api={api} session_id={props.session_id} />
      },
    },
  })

  api.keymap.registerLayer({
    commands: [
      {
        name: "agents.graph",
        title: "Open agent collaboration graph",
        slashName: "agents",
        category: "Session",
        namespace: "palette",
        run() {
          const current = api.route.current
          const params = current.name === "session" && current.params ? current.params : undefined
          const sessionID = params && "sessionID" in params ? String(params.sessionID) : undefined
          api.ui.dialog.clear()
          if (!sessionID) {
            api.ui.toast({ message: "Open a session first", variant: "error" })
            return
          }
          const state = api.state
          const graph = buildAgentGraph(
            {
              sessions: [],
              messages: (sid) => state.session.messages(sid),
              parts: (mid) => state.part(mid),
              status: (sid) => state.session.status(sid),
            },
            sessionID,
          )
          if (!graph) {
            api.ui.toast({ message: "Session not found", variant: "error" })
            return
          }
          void exportMermaidFile({ source: renderGraphMermaid(graph), theme: "dark" })
            .then((filepath) => open(filepath))
            .then(() => api.ui.toast({ message: "Collaboration graph opened in browser", variant: "success" }))
            .catch(() => api.ui.toast({ message: "Failed to open collaboration graph", variant: "error" }))
        },
      },
      {
        name: "agents.create",
        title: "Save a reusable subagent",
        category: "Session",
        namespace: "palette",
        run() {
          api.ui.dialog.replace(() => (
            <api.ui.DialogPrompt
              title="Save subagent"
              placeholder="agent name (e.g. api-tester)"
              onConfirm={(name) => {
                api.ui.dialog.replace(() => (
                  <api.ui.DialogPrompt
                    title={`Describe agent "${name}"`}
                    placeholder="what should this agent do?"
                    onConfirm={(description) => {
                      api.ui.dialog.replace(() => (
                        <api.ui.DialogPrompt
                          title="System prompt"
                          placeholder="You are a... (leave empty for a default prompt)"
                          onConfirm={(prompt) => {
                            api.ui.dialog.clear()
                            void saveAgentFile(
                              api,
                              name,
                              description,
                              prompt || `You are a specialized agent. Task: ${description}`,
                            )
                              .then((file) =>
                                api.ui.toast({ message: `Agent saved: ${file}`, variant: "success" }),
                              )
                              .catch((err) =>
                                api.ui.toast({
                                  message: err instanceof Error ? err.message : "Failed to save agent",
                                  variant: "error",
                                }),
                              )
                          }}
                          onCancel={() => api.ui.dialog.clear()}
                        />
                      ))
                    }}
                    onCancel={() => api.ui.dialog.clear()}
                  />
                ))
              }}
              onCancel={() => api.ui.dialog.clear()}
            />
          ))
        },
      },
    ],
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
