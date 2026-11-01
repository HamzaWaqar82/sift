import { ImageResponse } from "next/og";

// 180px apple-touch icon: the same navy tile and ticket logomark as app/icon.svg.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: "#0d1b3d" }}>
        <svg width="180" height="180" viewBox="0 0 32 32">
          <g transform="translate(2 5.5) scale(0.875)">
            <path
              d="M3 1H29a2 2 0 0 1 2 2V9.5a2.5 2.5 0 0 0 0 5V21a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V14.5a2.5 2.5 0 0 0 0-5V3a2 2 0 0 1 2-2Z"
              fill="#ffffff"
            />
            <rect x="6" y="6.2" width="12.5" height="3" rx="0.4" fill="#0d1b3d" />
            <rect x="6" y="10.5" width="9" height="3" rx="0.4" fill="#0d1b3d" />
            <rect x="6" y="14.8" width="5" height="3" rx="0.4" fill="#d7262d" />
            <circle cx="27" cy="12" r="1.5" fill="#d7262d" />
          </g>
        </svg>
      </div>
    ),
    size,
  );
}
