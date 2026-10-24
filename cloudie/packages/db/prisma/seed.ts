import { PrismaClient, UserRole, WorkspaceType, VendorStatus } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.ADMIN_SEED_EMAIL ?? "admin@cloudie.dev";
  const password = process.env.ADMIN_SEED_PASSWORD ?? "password";
  if (process.env.NODE_ENV === "production" && password === "password") {
    throw new Error("Refusing to seed production with the default admin password. Set ADMIN_SEED_PASSWORD to a strong secret.");
  }
  const passwordHash = await hash(password, 12);
  const admin = await prisma.user.upsert({
    where: { email },
    update: { role: UserRole.ADMIN, passwordHash },
    create: { email, passwordHash, role: UserRole.ADMIN, referralCode: "cloudie-admin" },
  });
  const workspaceTypes: WorkspaceType[] = [WorkspaceType.PERSONAL, WorkspaceType.SHIPMENTS, WorkspaceType.TICKETING, WorkspaceType.BUSINESS, WorkspaceType.SERVICES];
  for (const type of workspaceTypes) await prisma.workspace.upsert({ where: { userId_type: { userId: admin.id, type } }, update: {}, create: { userId: admin.id, type } });

  if (process.env.SEED_DEMO_DATA !== "false") {
    const vendorUser = await prisma.user.upsert({ where: { email: "vendor@cloudie.dev" }, update: {}, create: { email: "vendor@cloudie.dev", passwordHash: await hash("ChangeMe123!", 12), role: UserRole.VENDOR, referralCode: "cloudie-demo-vendor" } });
    const vendor = await prisma.vendor.upsert({ where: { userId: vendorUser.id }, update: {}, create: { userId: vendorUser.id, businessName: "Cloudie Demo Marketplace", status: VendorStatus.VERIFIED } });
    await prisma.pointPackage.upsert({ where: { id: "cloudie-demo-package" }, update: {}, create: { id: "cloudie-demo-package", vendorId: vendor.id, name: "Demo 1,000 points", points: 1000, priceUsd: "10.00" } });
  }
  process.stdout.write(`Seeded admin ${email} (id ${admin.id}).\n`);
}

main().finally(async () => prisma.$disconnect()).catch((error: unknown) => { process.stderr.write(String(error) + "\n"); process.exitCode = 1; });
