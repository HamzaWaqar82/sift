import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** The signed-in user, or 401. */
export async function GET(req: Request) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  return NextResponse.json({ user });
}
