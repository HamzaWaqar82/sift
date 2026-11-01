import { NextResponse } from "next/server";
import { apiError, parseIntId } from "@/lib/http";
import type { UserChange } from "./users";

export type UserRouteContext = { params: Promise<{ id: string }> };

export async function targetId(ctx: UserRouteContext): Promise<number | null> {
  return parseIntId((await ctx.params).id);
}

export const userNotFound = () => apiError(404, "User not found", { code: "not_found" });

/** Turns a UserChange into the response every admin user action shares. */
export function changeResponse(result: UserChange): Response {
  if (result.ok) return NextResponse.json({ user: result.user });
  if (result.reason === "self") {
    return apiError(400, "You cannot do that to your own account", { code: "self_change" });
  }
  return userNotFound();
}
