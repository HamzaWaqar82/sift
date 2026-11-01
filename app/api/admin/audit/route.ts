import { NextResponse } from "next/server";
import { listAudit } from "@/lib/admin/users";
import { requireAdmin } from "@/lib/auth";
import { parseIntId, route } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Admin only: the audit log, newest first. `?limit=` (max 200) and `?before=<id>` page through it. */
export const GET = route(async (req: Request) => {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;
  const q = new URL(req.url).searchParams;
  const limit = parseIntId(q.get("limit") ?? "") ?? undefined;
  const before = parseIntId(q.get("before") ?? "") ?? undefined;
  return NextResponse.json({ entries: await listAudit({ limit, before }) });
});
