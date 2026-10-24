import NextAuth, { type Provider } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { compare, hash } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma, UserRole } from "@cloudie/db";

const credentialsSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(256) });
const providers: Provider[] = [Credentials({ name: "Email and password", credentials: { email: { label: "Email", type: "email" }, password: { label: "Password", type: "password" } }, async authorize(raw) {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user || user.isSuspended || user.terminatedAt || !(await compare(parsed.data.password, user.passwordHash))) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}})];
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) providers.push(Google({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }));

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt", maxAge: 60 * 60, updateAge: 15 * 60 },
  pages: { signIn: "/signin" },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google" || !user.email) return true;
      const existing = await prisma.user.findUnique({ where: { email: user.email.toLowerCase() } });
      if (existing?.isSuspended || existing?.terminatedAt) return false;
      const record = existing ?? await prisma.user.create({ data: { email: user.email.toLowerCase(), name: user.name ?? null, passwordHash: await hash(randomUUID(), 12), role: UserRole.USER } });
      user.id = record.id;
      user.role = record.role;
      return true;
    },
    async jwt({ token, user }) {
      if (user) { token.sub = user.id; token.role = "role" in user ? user.role : "USER"; }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) { session.user.id = token.sub; session.user.role = typeof token.role === "string" ? token.role : "USER"; }
      return session;
    },
  },
});
