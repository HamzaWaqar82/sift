import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/auth/public-paths";

describe("favicon", () => {
  it("ships an SVG icon and serves the 180px apple-touch icon as a PNG", async () => {
    expect(existsSync("app/icon.svg")).toBe(true);

    const { default: AppleIcon, size } = await import("@/app/apple-icon");
    const res = AppleIcon();

    expect(size).toEqual({ width: 180, height: 180 });
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("serves the icons without a session, so the sign-in page has one", () => {
    expect(isPublicPath("/icon.svg")).toBe(true);
    expect(isPublicPath("/apple-icon")).toBe(true);
  });
});
