import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { auth } from "@/auth";

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.role) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) return NextResponse.json({ error: { code: "SERVER_CONFIGURATION", message: "API token signing is not configured." } }, { status: 503 });
  const token = await new SignJWT({ role: user.role, email: user.email ?? "" }).setProtectedHeader({ alg: "HS256" }).setSubject(user.id).setIssuedAt().setExpirationTime("5m").setIssuer("cloudie-web").setAudience("cloudie-api").sign(new TextEncoder().encode(secret));
  return NextResponse.json({ data: { token, expiresIn: 300 } }, { headers: { "Cache-Control": "no-store, private" } });
}
