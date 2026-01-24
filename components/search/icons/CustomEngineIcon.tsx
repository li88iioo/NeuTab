import React from "react"

interface CustomEngineIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string
}

// Icon for user-defined/custom search engines.
// Matches the "search box + magnifier" metaphor.
export const CustomEngineIcon = ({ size = 18, ...props }: CustomEngineIconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    {/* Search box background */}
    <rect x="4" y="10" width="40" height="28" rx="4" fill="#E0E0E0" />
    <rect x="7" y="13" width="34" height="22" rx="2" fill="#FFFFFF" />

    {/* Text cursor */}
    <rect x="12" y="18" width="2" height="12" fill="#212121">
      <animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite" />
    </rect>

    {/* Magnifier badge */}
    <circle cx="34" cy="34" r="9" fill="#2962FF" stroke="#FFFFFF" strokeWidth="2" />
    <path d="M40 40L44 44" stroke="#0D47A1" strokeWidth="3" strokeLinecap="round" />
    <circle cx="34" cy="34" r="6" fill="#90CAF9" />
  </svg>
)
