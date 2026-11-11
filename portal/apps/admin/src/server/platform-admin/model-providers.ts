import { createServerFn } from "@tanstack/react-start";
import { platformAdminMiddleware } from "@lanyard/auth/middleware";
import { ConflictError, NotFoundError } from "@lanyard/shared";
import { z } from "zod";

const providerIdSchema = z.object({ modelProviderId: z.string().uuid() });
const providerFieldsSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/)
    .max(64),
  name: z.string().trim().min(1).max(120),
});

export const listModelProviders = createServerFn({ method: "GET" })
  .middleware([platformAdminMiddleware])
  .handler(async () => {
    const { prisma } = await import("@lanyard/db");
    return prisma.modelProvider.findMany({
      orderBy: { name: "asc" },
      select: { id: true, slug: true, name: true, createdAt: true },
    });
  });

export const createModelProvider = createServerFn({ method: "POST" })
  .middleware([platformAdminMiddleware])
  .validator(providerFieldsSchema)
  .handler(async ({ data }) => {
    const { prisma } = await import("@lanyard/db");
    return prisma.$transaction(async (tx) => {
      const existing = await tx.modelProvider.findUnique({
        where: { slug: data.slug },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictError("A model provider already uses that slug");
      }
      return tx.modelProvider.create({
        data,
        select: { id: true, slug: true, name: true, createdAt: true },
      });
    });
  });

export const updateModelProvider = createServerFn({ method: "POST" })
  .middleware([platformAdminMiddleware])
  .validator(providerIdSchema.extend(providerFieldsSchema.shape))
  .handler(async ({ data }) => {
    const { prisma } = await import("@lanyard/db");
    return prisma.$transaction(async (tx) => {
      const existingSlug = await tx.modelProvider.findFirst({
        where: { slug: data.slug, id: { not: data.modelProviderId } },
        select: { id: true },
      });
      if (existingSlug) {
        throw new ConflictError("A model provider already uses that slug");
      }
      const result = await tx.modelProvider.updateMany({
        where: { id: data.modelProviderId },
        data: { slug: data.slug, name: data.name },
      });
      if (result.count === 0) {
        throw new NotFoundError("Model provider not found");
      }
      return { id: data.modelProviderId, slug: data.slug, name: data.name };
    });
  });

export const deleteModelProvider = createServerFn({ method: "POST" })
  .middleware([platformAdminMiddleware])
  .validator(providerIdSchema)
  .handler(async ({ data }) => {
    const { prisma } = await import("@lanyard/db");
    await prisma.$transaction(async (tx) => {
      const provider = await tx.modelProvider.findUnique({
        where: { id: data.modelProviderId },
        select: { id: true },
      });
      if (!provider) throw new NotFoundError("Model provider not found");
      await tx.modelProvider.delete({ where: { id: provider.id } });
    });
    return { modelProviderId: data.modelProviderId };
  });
