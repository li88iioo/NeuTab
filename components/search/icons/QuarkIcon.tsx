import React from "react"

interface QuarkIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string
}

export const QuarkIcon = ({ size = 18, ...props }: QuarkIconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <circle cx="24" cy="24" r="21" fill="#2B6CFF" />
    <circle cx="24" cy="24" r="15" fill="rgba(255, 255, 255, 0.18)" />
    <text
      x="24"
      y="30"
      textAnchor="middle"
      fontSize="18"
      fontWeight="700"
      fontFamily="Arial, Helvetica, sans-serif"
      fill="#FFFFFF"
    >
      Q
    </text>
  </svg>
)
