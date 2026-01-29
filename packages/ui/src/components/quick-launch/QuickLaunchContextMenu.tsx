import { FiExternalLink, FiEdit2, FiTrash2, FiServer } from "react-icons/fi"
import type { QuickLaunchApp } from "@neutab/shared/types/quickLaunch"
import BodyPortal from "./BodyPortal"

export type QuickLaunchMenuAction = "open" | "openInternal" | "edit" | "delete"

interface QuickLaunchContextMenuProps {
  visible: boolean
  x: number
  y: number
  app: QuickLaunchApp | null
  groupId: string | null
  isDynamic: boolean
  labels: {
    openInNewWindow: string
    openInternalUrl: string
    edit: string
    delete: string
  }
  onAction: (action: QuickLaunchMenuAction) => void
}

const QuickLaunchContextMenu = ({
  visible,
  x,
  y,
  app,
  groupId,
  isDynamic,
  labels,
  onAction
}: QuickLaunchContextMenuProps) => {
  if (!visible || !app || !groupId) return null
  const showInternal = !!app.url && !!app.internalUrl

  return (
    <BodyPortal>
      <div
        className="ql-context-menu"
        style={{ top: y, left: x }}
        role="menu"
        aria-label="Quick Launch context menu"
        onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ql-menu-item" role="menuitem" autoFocus onClick={() => onAction("open")}>
          <FiExternalLink size={16} /> {labels.openInNewWindow}
        </button>
        {showInternal && (
          <button type="button" className="ql-menu-item" role="menuitem" onClick={() => onAction("openInternal")}>
            <FiServer size={16} /> {labels.openInternalUrl}
          </button>
        )}
        {!isDynamic && (
          <>
            <button type="button" className="ql-menu-item" role="menuitem" onClick={() => onAction("edit")}>
              <FiEdit2 size={16} /> {labels.edit}
            </button>
            <button type="button" className="ql-menu-item delete" role="menuitem" onClick={() => onAction("delete")}>
              <FiTrash2 size={16} /> {labels.delete}
            </button>
          </>
        )}
      </div>
    </BodyPortal>
  )
}

export default QuickLaunchContextMenu
