/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { type ScrollBoxRenderable } from "@opentui/core"
import { useBindings } from "../../keymap"
import { useTheme } from "../../context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createResource, createSignal, For, Match, Show, Switch } from "solid-js"
import { Panel, PanelGroup, Separator } from "./diff-viewer-ui"
import { DialogSelect } from "../../ui/dialog-select"
import { getScrollAcceleration } from "../../util/scroll"
import { buildStepGraph, STEP_ICON, stepDiffRange, type Step } from "../../component/step-graph"
import { exportMermaidFile } from "../../component/mermaid-export"
import open from "open"

const ROUTE = "steps"
const DETAIL_WIDTH = 46

function statusColor(theme: () => any, status: Step["status"]) {
  const t = theme()
  if (status === "failed") return t.error
  if (status === "in_progress") return t.warning
  if (status === "completed") return t.success
  if (status === "cancelled") return t.textMuted
  return t.text
}

function StepGraphViewer(props: { api: TuiPluginApi }) {
  const dimensions = useTerminalDimensions()
  const themeState = useTheme()
  const theme = () => props.api.theme.current
  const params = () => ("params" in props.api.route.current ? props.api.route.current.params : undefined) as
    | { sessionID?: string; returnRoute?: { name: string; params?: Record<string, unknown> } }
    | undefined
  const sessionID = () => params()?.sessionID
  const returnRoute = () => params()?.returnRoute

  const state = props.api.state
  const graph = createMemo(() =>
    buildStepGraph(
      {
        todos: state.session.todo(sessionID() ?? ""),
        messages: state.session.messages(sessionID() ?? ""),
        parts: (messageID) => state.part(messageID),
      },
      sessionID() ?? "",
    ),
  )
  const steps = createMemo(() => graph().steps)
  const [selected, setSelected] = createSignal<number>(0)
  const step = createMemo(() => steps()[selected()])

  // Keep selection in range as the backlog changes.
  createEffect(() => {
    if (selected() >= steps().length) setSelected(Math.max(0, steps().length - 1))
  })

  const [diff] = createResource(
    () => ({ id: sessionID(), messageID: stepDiffRange(step())?.messageID }),
    async (input) => {
      if (!input.id || !input.messageID) return []
      const result = await props.api.client.session.diff(
        { sessionID: input.id, messageID: input.messageID },
        { throwOnError: true },
      )
      return (result.data ?? []).filter((item) => item.patch)
    },
  )
  const patches = createMemo(() => diff() ?? [])

  const editCount = createMemo(() => step()?.tools.filter((t) => t.tool === "edit" || t.tool === "write").length ?? 0)

  // Null-safe accessors: the backlog can be empty (task just started, no
  // TodoWrite yet) and `step()` is undefined until steps arrive.
  const stepStatus = createMemo(() => step()?.status)
  const stepAttempts = createMemo(() => step()?.attempts)
  const stepFirstMessage = createMemo(() => step()?.firstMessageID)
  const stepLastMessage = createMemo(() => step()?.lastMessageID)

  let tree: ScrollBoxRenderable | undefined
  const scrollAcceleration = createMemo(() => getScrollAcceleration(props.api.tuiConfig))

  const move = (offset: number) =>
    setSelected((current) => Math.max(0, Math.min(steps().length - 1, current + offset)))

  const openMermaid = () => {
    const lines = ["flowchart TD"]
    // Define nodes first; edges reference bare ids — mermaid rejects edges
    // whose target repeats a labeled shape definition (s0 --> s1("...") is a
    // parse error), so labels live only on the node lines.
    steps().forEach((item, index) => {
      const safe = item.content.replaceAll('"', "'").slice(0, 50)
      const shape = item.status === "failed" ? `s${index}(["${safe} ✗"])` : `s${index}("${safe} ${STEP_ICON[item.status]}")`
      lines.push(`  ${shape}`)
    })
    steps().forEach((_item, index) => {
      if (index > 0) lines.push(`  s${index - 1} --> s${index}`)
    })
    if (steps().length === 0) lines.push('  none("no steps tracked")')
    void exportMermaidFile({ source: lines.join("\n"), theme: "dark" })
      .then((filepath) => open(filepath))
      .catch(() => props.api.ui.toast({ message: "Failed to open step graph", variant: "error" }))
  }

  /** Redo: revert to before the step's first message, then re-inject the step as a prompt. */
  const redoStep = () => {
    const current = step()
    if (!current || !sessionID()) return
    props.api.ui.dialog.replace(() => (
      <DialogSelect
        title="Redo Step"
        options={[
          {
            title: "Revert and re-run this step",
            value: "confirm",
            description: current.content.slice(0, 60),
            onSelect: () => {
              props.api.ui.dialog.clear()
              const target = current.firstMessageID ?? current.lastMessageID
              if (!target) return
              void props.api.client.session
                .revert({ sessionID: sessionID()!, messageID: target })
                .then(() =>
                  props.api.client.session.prompt({
                    sessionID: sessionID()!,
                    parts: [
                      {
                        type: "text",
                        text: `Redo this step from scratch. Previous attempt failed verification.\n\nStep: ${current.content}\n\nAnalyze what went wrong, then implement and verify the fix.`,
                      },
                    ],
                  }),
                )
                .then(() => props.api.ui.toast({ message: "Step redo started", variant: "success" }))
                .catch(() => props.api.ui.toast({ message: "Failed to redo step", variant: "error" }))
            },
          },
          { title: "Cancel", value: "cancel", onSelect: () => props.api.ui.dialog.clear() },
        ]}
      />
    ))
  }

  /** Analyze failure: inject a diagnostic prompt without reverting. */
  const analyzeFailure = () => {
    const current = step()
    if (!current || !sessionID()) return
    const tools = current.tools
      .filter((t) => t.status === "error")
      .map((t) => t.tool)
      .join(", ")
    void props.api.client.session
      .prompt({
        sessionID: sessionID()!,
        parts: [
          {
            type: "text",
            text: [
              `Step "${current.content}" is marked failed.`,
              tools ? `Tools that errored during this step: ${tools}.` : "",
              "Diagnose the root cause (read the failing output, re-run the check), then fix and verify it.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      })
      .then(() => props.api.ui.toast({ message: "Failure analysis queued", variant: "success" }))
      .catch(() => props.api.ui.toast({ message: "Failed to queue analysis", variant: "error" }))
  }

  const commands = [
    {
      name: "steps.close",
      title: "Close step graph",
      category: "Session",
      run() {
        props.api.ui.dialog.clear()
        props.api.route.navigate(returnRoute()?.name ?? "home", returnRoute()?.params)
      },
    },
    { name: "steps.down", title: "Move step selection down", category: "Session", run: () => move(1) },
    { name: "steps.up", title: "Move step selection up", category: "Session", run: () => move(-1) },
    { name: "steps.mermaid", title: "Open step graph as mermaid diagram", category: "Session", run: openMermaid },
    { name: "steps.redo", title: "Revert and redo selected step", category: "Session", run: redoStep },
    { name: "steps.analyze", title: "Analyze selected step failure", category: "Session", run: analyzeFailure },
  ]

  useBindings(() => ({
    commands,
    bindings: [
      { key: "j,down", cmd: "steps.down", desc: "Next step" },
      { key: "k,up", cmd: "steps.up", desc: "Previous step" },
      { key: "m", cmd: "steps.mermaid", desc: "Open mermaid graph" },
      { key: "r", cmd: "steps.redo", desc: "Redo step" },
      { key: "a", cmd: "steps.analyze", desc: "Analyze failure" },
      { key: "q,escape", cmd: "steps.close", desc: "Close" },
    ],
  }))

  return (
    <box position="absolute" zIndex={2500} left={0} top={0} width={dimensions().width} height={dimensions().height}>
      <PanelGroup axis="y" width="100%" height="100%">
        <Panel border="none" flexShrink={0} padding={0} paddingLeft={1}>
          <text fg={theme().text}>Step Graph </text>
          <text fg={theme().textMuted}>
            {steps().length} steps · {steps().filter((s) => s.status === "completed").length} done ·{" "}
            {steps().filter((s) => s.status === "failed").length} failed
          </text>
          <box flexGrow={1} />
          <text fg={theme().textMuted}>j/k move · m mermaid · r redo · a analyze · q close</text>
        </Panel>

        <box flexGrow={1} minHeight={0}>
          <Switch>
            <Match when={steps().length === 0}>
              <Separator axis="x" />
              <box flexGrow={1} paddingLeft={1}>
                <text fg={theme().textMuted}>No steps tracked yet — the loop agent maintains them via TodoWrite.</text>
              </box>
            </Match>
            <Match when={steps().length > 0}>
              <box flexDirection="row" flexGrow={1} minHeight={0}>
                <scrollbox
                  ref={(r) => (tree = r)}
                  flexGrow={1}
                  scrollAcceleration={scrollAcceleration()}
                  onMouseDown={() => undefined}
                >
                  <box flexDirection="column" paddingTop={1} paddingBottom={1} gap={0}>
                    <For each={steps()}>
                      {(item, index) => (
                        <box
                          flexDirection="row"
                          paddingLeft={1 + item.depth * 2}
                          backgroundColor={index() === selected() ? theme().backgroundElement : undefined}
                          onMouseDown={() => setSelected(index())}
                        >
                          <text flexShrink={0} fg={statusColor(theme, item.status)}>
                            {STEP_ICON[item.status]}{" "}
                          </text>
                          <text
                            flexGrow={1}
                            wrapMode="word"
                            fg={index() === selected() ? theme().text : statusColor(theme, item.status)}
                          >
                            {item.content}
                          </text>
                        </box>
                      )}
                    </For>
                  </box>
                </scrollbox>

                <Show when={step()}>
                  <box
                    width={DETAIL_WIDTH}
                    border={["left"]}
                    borderColor={theme().border}
                    flexDirection="column"
                    paddingTop={1}
                    paddingLeft={2}
                    gap={0}
                  >
                    <text fg={theme().text} wrapMode="word">
                      <b>Step {(step()?.index ?? 0) + 1}</b>
                    </text>
                    <text fg={statusColor(theme, stepStatus() ?? "unknown")} wrapMode="word">
                      Status: {stepStatus() ?? "unknown"} · attempts: {stepAttempts() ?? 0}
                    </text>
                    <Show when={step()?.tools.length}>
                      <text fg={theme().textMuted} wrapMode="word">
                        {editCount()} edits · {step()?.tools.length ?? 0} tool calls
                      </text>
                    </Show>
                    <Show
                      when={stepFirstMessage()}
                      fallback={<text fg={theme().textMuted}>No messages linked yet</text>}
                    >
                      <text fg={theme().textMuted} wrapMode="none">
                        Linked: {stepFirstMessage()!.slice(0, 18)}
                      </text>
                    </Show>
                    <box marginTop={1} flexDirection="column" gap={0}>
                      <For each={patches().slice(0, 8)}>
                        {(file) => (
                          <text fg={theme().diffAdded} wrapMode="none">
                            + {file.file?.slice(-40)}
                          </text>
                        )}
                      </For>
                      <Show when={diff.loading}>
                        <text fg={theme().textMuted}>Loading diff...</text>
                      </Show>
                      <Show when={!diff.loading && patches().length === 0 && stepLastMessage()}>
                        <text fg={theme().textMuted}>No file changes in this step</text>
                      </Show>
                    </box>
                    <box flexGrow={1} />
                    <text fg={theme().textMuted} wrapMode="none">
                      [r] redo · [a] analyze · [m] mermaid
                    </text>
                  </box>
                </Show>
              </box>
            </Match>
          </Switch>
        </box>
      </PanelGroup>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.route.register([
    {
      name: ROUTE,
      render: () => <StepGraphViewer api={api} />,
    },
  ])

  api.keymap.registerLayer({
    commands: [
      {
        name: "steps.open",
        title: "Open step graph",
        slashName: "steps",
        category: "Session",
        namespace: "palette",
        run() {
          const current = api.route.current
          const params = current.name === "session" && current.params ? current.params : undefined
          const sessionID = params && "sessionID" in params ? String(params.sessionID) : undefined
          api.route.navigate(ROUTE, { sessionID, returnRoute: current })
          api.ui.dialog.clear()
        },
      },
    ],
  })
}

export default {
  id: "step-graph-viewer",
  tui,
} as const
