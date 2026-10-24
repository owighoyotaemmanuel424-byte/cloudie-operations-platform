import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { z } from "zod";
import { prisma, WorkspaceType } from "@cloudie/db";

const registrationSchema = z.object({ email: z.string().email().max(254), password: z.string().min(12).max(128), name: z.string().trim().min(1).max(100).optional(), referralCode: z.string().trim().min(1).max(100).optional() });
export async function POST(request: Request): Promise<NextResponse> {
  const parsed = registrationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Enter a valid email and a password of at least 12 characters.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  const email = parsed.data.email.toLowerCase();
  const exists = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (exists) return NextResponse.json({ error: { code: "EMAIL_EXISTS", message: "An account already exists for this email." } }, { status: 409 });
  let referredBy: string | undefined;
  if (parsed.data.referralCode) {
    const referrer = await prisma.user.findUnique({ where: { referralCode: parsed.data.referralCode }, select: { id: true } });
    if (referrer) referredBy = referrer.id;
  }
  const passwordHash = await hash(parsed.data.password, 12);
  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { email, passwordHash, name: parsed.data.name, ...(referredBy ? { referredBy } : {}) } });
      await tx.workspace.createMany({ data: [WorkspaceType.PERSONAL, WorkspaceType.SHIPMENTS, WorkspaceType.TICKETING, WorkspaceType.BUSINESS, WorkspaceType.SERVICES].map((type) => ({ userId: created.id, type })) });
      return created;
    });
    return NextResponse.json({ data: { id: user.id, email: user.email }, message: "Account created. Sign in to continue." }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) return NextResponse.json({ error: { code: "EMAIL_EXISTS", message: "An account already exists for this email." } }, { status: 409 });
    return NextResponse.json({ error: { code: "REGISTRATION_FAILED", message: "Could not create the account." } }, { status: 500 });
  }
}
