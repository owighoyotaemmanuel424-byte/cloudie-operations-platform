import { jwtVerify } from "jose";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

export type AccessIdentity = { userId: string; role: "USER" | "VENDOR" | "ADMIN"; email: string };
const claimsSchema = z.object({ sub: z.string().uuid(), role: z.enum(["USER", "VENDOR", "ADMIN"]), email: z.string() });
function secretBytes(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error("JWT_SECRET must contain at least 32 characters");
  return new TextEncoder().encode(secret);
}
export async function verifyAccessToken(token: string): Promise<AccessIdentity> {
  const verified = await jwtVerify(token, secretBytes(), { algorithms: ["HS256"], issuer: "cloudie-web", audience: "cloudie-api" });
  const claims = claimsSchema.parse(verified.payload);
  return { userId: claims.sub, role: claims.role, email: claims.email };
}
export async function requireIdentity(request: FastifyRequest, reply: FastifyReply): Promise<AccessIdentity | null> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) { await reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "A bearer session token is required." } }); return null; }
  try { return await verifyAccessToken(header.slice(7)); }
  catch { await reply.code(401).send({ error: { code: "INVALID_SESSION", message: "The session token is invalid or expired." } }); return null; }
}
export async function requireRole(request: FastifyRequest, reply: FastifyReply, allowed: AccessIdentity["role"][]): Promise<AccessIdentity | null> {
  const identity = await requireIdentity(request, reply);
  if (!identity) return null;
  if (!allowed.includes(identity.role)) { await reply.code(403).send({ error: { code: "FORBIDDEN", message: "Your role cannot perform this action." } }); return null; }
  return identity;
}
