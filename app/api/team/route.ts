import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { listTeamPresence } from "@/lib/users/availability";

export const dynamic = "force-dynamic";

/** The active team with each person's availability: `{team: [{id, name, availability}]}`. */
export const GET = route(async (req: Request) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  return NextResponse.json({ team: await listTeamPresence() });
});
