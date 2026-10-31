/**
 * Sift logomark: a ticket coupon with side notches and a perforated stub; inside, three sieve
 * bars that narrow as tickets are sifted, the last one in jet red (what needs a reply now).
 * `tone="band"` draws it for the navy header band.
 */
export function Logomark({ tone = "paper", className = "h-6 w-8" }: { tone?: "paper" | "band"; className?: string }) {
  const outline = tone === "band" ? "#ffffff" : "#0d1b3d";
  const fill = tone === "band" ? "#0d1b3d" : "#ffffff";
  return (
    <svg viewBox="0 0 32 24" className={className} aria-hidden="true" focusable="false">
      <path
        d="M3 1H29a2 2 0 0 1 2 2V9.5a2.5 2.5 0 0 0 0 5V21a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V14.5a2.5 2.5 0 0 0 0-5V3a2 2 0 0 1 2-2Z"
        fill={fill}
        stroke={outline}
        strokeWidth="1.6"
      />
      <path d="M23 4.2V19.8" stroke={outline} strokeWidth="1.3" strokeDasharray="1.6 1.6" />
      <rect x="6" y="6.6" width="12.5" height="2.2" rx="0.4" fill={outline} />
      <rect x="6" y="10.9" width="9" height="2.2" rx="0.4" fill={outline} />
      <rect x="6" y="15.2" width="5" height="2.2" rx="0.4" fill="#d7262d" />
      <circle cx="27" cy="12" r="1.5" fill="#d7262d" />
    </svg>
  );
}

export function Wordmark({ tone = "paper", size = "md" }: { tone?: "paper" | "band"; size?: "md" | "lg" }) {
  const lg = size === "lg";
  return (
    <span className={`inline-flex items-center ${lg ? "gap-3" : "gap-2"}`}>
      <Logomark tone={tone} className={lg ? "h-9 w-12" : "h-6 w-8"} />
      <span
        className={`font-display font-bold uppercase leading-none tracking-[0.08em] ${
          lg ? "text-3xl" : "text-xl"
        } ${tone === "band" ? "text-white" : "text-ink"}`}
      >
        Sift
      </span>
    </span>
  );
}
