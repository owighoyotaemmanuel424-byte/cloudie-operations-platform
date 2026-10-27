import { describe, expect, test } from "bun:test";
import { describeAuthError } from "@/components/AuthSplitLayout";
import { NeonApiError } from "@/lib/neonApi";

describe("describeAuthError tells the user what actually happened", () => {
  test("a missing database schema is reported as an unfinished setup", () => {
    const err = new NeonApiError(
      "Service not ready: the database schema is missing or incomplete. Finish the Neon migration, then retry.",
      503,
    );
    expect(describeAuthError(err, "login")).toContain("isn't fully set up yet");
    expect(describeAuthError(err, "register")).toContain("isn't fully set up yet");
  });

  test("a server-side failure is not blamed on the user's credentials", () => {
    const err = new NeonApiError("Internal server error", 500);
    expect(describeAuthError(err, "login")).toContain("problem signing you in");
    expect(describeAuthError(err, "login")).not.toContain("Incorrect email or password");
    expect(describeAuthError(err, "register")).toContain("problem creating your account");
  });

  test("a transport failure asks the user to check their connection", () => {
    const err = new TypeError("Failed to fetch");
    expect(describeAuthError(err, "login")).toContain("Can't reach the server");
  });

  test("a genuine credential rejection still says so", () => {
    const err = new NeonApiError("Invalid email or password", 401);
    expect(describeAuthError(err, "login")).toBe("Incorrect email or password.");
  });

  test("a duplicate account points the user at sign-in", () => {
    const err = new NeonApiError("An account with this email already exists", 409);
    expect(describeAuthError(err, "register")).toContain("already exists");
  });

  test("rate limiting tells the user to wait", () => {
    const err = new NeonApiError("Too many login attempts", 429);
    expect(describeAuthError(err, "login")).toContain("wait a minute");
  });
});
