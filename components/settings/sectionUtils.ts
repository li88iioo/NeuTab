import type React from "react"

/** 处理输入框 Enter 提交(忽略输入法合成事件) */
export const handleCommitOnEnter = (
  event: React.KeyboardEvent<HTMLInputElement>,
  onCommit: () => void
) => {
  if (event.key !== "Enter") return
  if ((event.nativeEvent as KeyboardEvent).isComposing) return
  onCommit()
  event.currentTarget.blur()
}
