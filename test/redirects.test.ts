import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

/** A Location is host-safe when it is relative (never a bound address like 0.0.0.0). */
function expectHostSafe(location: string | null) {
  expect(location).toBeTruthy();
  expect(location).not.toContain("0.0.0.0");
  expect(location!.startsWith("/") && !location!.startsWith("//")).toBe(true);
}

describe("sign-out redirect", () => {
  it("is relative even when the request URL carries the bound address", async () => {
    const { POST } = await import("@/app/api/auth/sign-out/route");
    const res = await POST(new Request("http://0.0.0.0:3000/api/auth/sign-out", { method: "POST" }));
    expect(res.status).toBe(303);
    expectHostSafe(res.headers.get("location"));
    expect(res.headers.get("location")).toBe("/sign-in");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("stays relative behind a proxy that sends forwarded headers", async () => {
    const { POST } = await import("@/app/api/auth/sign-out/route");
    const res = await POST(
      new Request("http://0.0.0.0:3000/api/auth/sign-out", {
        method: "POST",
        headers: { "x-forwarded-host": "sift.example.com", "x-forwarded-proto": "https", host: "sift.example.com" },
      }),
    );
    expect(res.headers.get("location")).toBe("/sign-in");
  });
});

describe("proxy auth redirect", () => {
  it("redirects signed-out page requests to /sign-in on the request's own host", async () => {
    // Next's proxy adapter throws on a relative Location, and relativizes a same-host one before it
    // reaches the browser. So the proxy must answer with the request's own host, nothing else.
    const { proxy } = await import("@/proxy");
    const res = await proxy(new NextRequest("http://0.0.0.0:3000/tickets/1"));
    expect([302, 303, 307, 308]).toContain(res.status);
    const location = new URL(res.headers.get("location")!);
    expect(location.host).toBe("0.0.0.0:3000");
    expect(location.pathname).toBe("/sign-in");
  });

  it("the same-host redirect reaches the browser as a relative Location", async () => {
    const { getRelativeURL } = await import("next/dist/shared/lib/router/utils/relativize-url");
    expect(getRelativeURL("http://0.0.0.0:3000/sign-in", "http://0.0.0.0:3000/tickets/1")).toBe("/sign-in");
    expectHostSafe(getRelativeURL("http://0.0.0.0:3000/sign-in", "http://0.0.0.0:3000/tickets/1"));
  });

  it("still returns 401 JSON for signed-out API calls", async () => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(new NextRequest("http://0.0.0.0:3000/api/tickets"));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "Sign in required", code: "unauthorized" });
  });
});
