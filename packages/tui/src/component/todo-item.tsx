import { useTheme } from "../context/theme"

export interface TodoItemProps {
  status: string
  content: string
}

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()

  const icon = () =>
    props.status === "completed"
      ? "✓"
      : props.status === "in_progress"
        ? "•"
        : props.status === "failed"
          ? "✗"
          : props.status === "cancelled"
            ? "–"
            : " "
  const color = () =>
    props.status === "in_progress"
      ? theme.warning
      : props.status === "failed"
        ? theme.error
        : props.status === "completed"
          ? theme.success
          : theme.textMuted

  return (
    <box flexDirection="row" gap={0}>
      <text flexShrink={0} style={{ fg: color() }}>
        [{icon()}]{" "}
      </text>
      <text flexGrow={1} wrapMode="word" style={{ fg: color() }}>
        {props.content}
      </text>
    </box>
  )
}
