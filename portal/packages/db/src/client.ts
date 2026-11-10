import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.ts";

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Point it at Postgres database portal_app (not CONTROL_PLANE_DATABASE_URL).",
    );
  }

  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

const globalForPrisma = globalThis as { __lanyardPrisma?: PrismaClient };

export const prisma = globalForPrisma.__lanyardPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__lanyardPrisma = prisma;
}
