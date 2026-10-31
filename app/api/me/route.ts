import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";

/** The signed-in user, or 401. */
export const GET = route(async (req: Request) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  return NextResponse.json({ user });
});
