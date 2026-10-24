import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { cloudiePrisma?: PrismaClient };
export const prisma = globalForPrisma.cloudiePrisma ?? new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });
if (process.env.NODE_ENV !== "production") globalForPrisma.cloudiePrisma = prisma;
export * from "@prisma/client";
