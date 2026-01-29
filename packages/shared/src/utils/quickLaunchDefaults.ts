import type { QuickLaunchApp, QuickLaunchGroup } from "../types/quickLaunch"

export const DEFAULT_APPS: QuickLaunchApp[] = [
  { id: "1", name: "YouTube", url: "https://youtube.com", color: "#ff0000" },
  { id: "2", name: "GitHub", url: "https://github.com", color: "#333333" },
  { id: "3", name: "Google", url: "https://google.com", color: "#4285f4" },
  { id: "4", name: "Twitter", url: "https://twitter.com", color: "#1da1f2" },
  { id: "5", name: "ChatGPT", url: "https://chat.openai.com", color: "#10a37f" },
  { id: "6", name: "Figma", url: "https://figma.com", color: "#f24e1e" }
]

export const DEFAULT_GROUPS: QuickLaunchGroup[] = [
  { id: "default", name: "Default", apps: DEFAULT_APPS }
]
