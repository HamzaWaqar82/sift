"use client";

import { useEffect, useState } from "react";

/** Key under which the composer records the idempotency key of the reply it just sent (for the landing). */
export const JUST_SENT_KEY = "sift:just-sent";

/**
 * The SENT rubber stamp on a carbon copy. The one authored motion in Sift: when this is the reply
 * you just sent, the stamp lands (scale and rotation settle); reduced motion shows it in place.
 */
export function SentStamp({ sentKey, name, time, iso }: { sentKey: string | null; name: string; time: string; iso: string }) {
  const [landing, setLanding] = useState(false);
  useEffect(() => {
    if (sentKey && sessionStorage.getItem(JUST_SENT_KEY) === sentKey) {
      sessionStorage.removeItem(JUST_SENT_KEY);
      setLanding(true);
    }
  }, [sentKey]);

  return (
    <div className={`rubber rubber-sent bg-lilac ${landing ? "rubber-landing" : ""}`} style={{ ["--rubber-rot" as string]: "-5deg" }}>
      <span className="rubber-word">Sent</span>
      <span className="rubber-meta">{name}</span>
      <time dateTime={iso} className="rubber-meta font-mono normal-case tracking-normal">
        {time}
      </time>
    </div>
  );
}
