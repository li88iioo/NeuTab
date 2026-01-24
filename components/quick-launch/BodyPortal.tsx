import type { ReactNode } from "react"
import { createPortal } from "react-dom"

interface BodyPortalProps {
  children: ReactNode
}

const BodyPortal = ({ children }: BodyPortalProps) => {
  if (typeof document === "undefined") return null
  return createPortal(children, document.body)
}

export default BodyPortal
