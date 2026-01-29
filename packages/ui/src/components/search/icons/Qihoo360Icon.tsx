import React from "react"

interface Qihoo360IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string
}

export const Qihoo360Icon = ({ size = 18, ...props }: Qihoo360IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <circle cx="24" cy="24" r="21" fill="#2DB7FF" />
    <circle cx="24" cy="24" r="15" fill="rgba(255, 255, 255, 0.18)" />
    <text
      x="24"
      y="29"
      textAnchor="middle"
      fontSize="16"
      fontWeight="700"
      fontFamily="Arial, Helvetica, sans-serif"
      fill="#FFFFFF"
    >
      360
    </text>
  </svg>
)
