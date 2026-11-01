// Reading the dev mailbox (mail kept by the capture transport) for /dev/mailbox.
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { devMailbox } from "@/lib/db/schema";
import { parseHeaders } from "./headers";

export const MAILBOX_PAGE_SIZE = 50;

export type CapturedMailSummary = { id: number; from: string; to: string; subject: string; capturedAt: Date };

export type CapturedMail = CapturedMailSummary & {
  messageId: string;
  text: string;
  html: string | null;
  raw: string;
  /** Header fields in order, folded lines joined, as the recipient's client would see them. */
  headers: [name: string, value: string][];
};

export async function listCapturedMail(limit = MAILBOX_PAGE_SIZE): Promise<CapturedMailSummary[]> {
  return getDb()
    .select({
      id: devMailbox.id,
      from: devMailbox.from,
      to: devMailbox.to,
      subject: devMailbox.subject,
      capturedAt: devMailbox.capturedAt,
    })
    .from(devMailbox)
    .orderBy(desc(devMailbox.capturedAt), desc(devMailbox.id))
    .limit(limit);
}

export async function getCapturedMail(id: number): Promise<CapturedMail | null> {
  const [row] = await getDb().select().from(devMailbox).where(eq(devMailbox.id, id));
  if (!row) return null;
  return { ...row, headers: parseHeaders(row.raw) };
}
