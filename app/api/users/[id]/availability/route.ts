import { NextResponse } from "next/server";
import { isAdmin, requireUser } from "@/lib/auth";
import { apiError, parseBody, parseIntId, route } from "@/lib/http";
import { availabilitySchema, setAvailability } from "@/lib/users/availability";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => apiError(404, "User not found", { code: "not_found" });

/** Sets Available/Away: your own, or (admins) anyone's. Body `{availability}`. Returns `{user}`. */
export const PUT = route(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  const id = parseIntId((await ctx.params).id);
  if (id === null) return notFound();
  if (id !== user.id && !isAdmin(user)) {
    return apiError(403, "Only an admin can change someone else's availability", { code: "forbidden" });
  }
  const { availability } = await parseBody(req, availabilitySchema);
  const updated = await setAvailability(user.id, id, availability);
  return updated ? NextResponse.json({ user: updated }) : notFound();
});
