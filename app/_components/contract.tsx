"use client";

import { useEffect } from "react";

/** The design direction contract (impeccable seed 09f5c47e). Kept verbatim. */
export const DIRECTION_CONTRACT = `
THESIS: Sift is a ticket wallet: every customer ticket is a coupon, and a reply is a stamp a human applies. It refuses the grey SaaS sidebar-and-feed helpdesk.
OWN-WORLD: Stock-white ground, coupon-white panels ruled in navy hairlines, carrier-navy ink and header band, jet red only for the send action, high urgency and VOID/closed stamps, carbon-purple tabular numerals for ticket numbers and times, lilac carbon copies for sent replies. Condensed airline grotesk caps on tabbed coupon heads; one grotesk body.
STORY: An agent scans the wallet, sees what needs a reply and how urgent, opens one coupon, reads the draft beside its source article, edits, and stamps it SENT under their own name.
FIRST VIEWPORT: Navy band with wordmark and tab views; left the coupon list with search and filter tabs; right the open coupon with message, draft, article, and a red Send.
FORM: Jet-age ticket wallet, challenger chosen by the user; seed key 09f5c47e.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
`;

/**
 * Renders the contract as body's first child.
 *
 * React cannot emit an HTML comment, and raw-HTML injection is banned in this codebase. So the
 * server HTML carries the exact comment text inside an inert `<script type="text/plain">` (React
 * writes script text unescaped, so the bytes `<!--...-->` survive `next build` verbatim), and on
 * the client the same text becomes a real Comment node placed first in <body>.
 */
export function DirectionContract() {
  useEffect(() => {
    const body = document.body;
    const first = body.firstChild;
    if (first?.nodeType === Node.COMMENT_NODE && first.nodeValue === DIRECTION_CONTRACT) return;
    body.insertBefore(document.createComment(DIRECTION_CONTRACT), first);
  }, []);
  return (
    <script type="text/plain" id="direction-contract" data-seed="09f5c47e">
      {`<!--${DIRECTION_CONTRACT}-->`}
    </script>
  );
}
