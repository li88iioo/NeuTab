import QuickLaunch from "@neutab/ui/components/quick-launch/QuickLaunch"
import { useQuickLaunchGroups } from "./hooks/useQuickLaunchGroups"
import { useQuickLaunchIcons } from "./hooks/useQuickLaunchIcons"

export default function QuickLaunchWrapper() {
  return <QuickLaunch useQuickLaunchGroups={useQuickLaunchGroups} useQuickLaunchIcons={useQuickLaunchIcons} />
}
