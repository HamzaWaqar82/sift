import { NextResponse } from "next/server";
import { listUsers } from "@/lib/admin/users";
import { requireAdmin } from "@/lib/auth";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Admin only: every staff account with role, availability and active status. */
export const GET = route(async (req: Request) => {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;
  return NextResponse.json({ users: await listUsers() });
});
