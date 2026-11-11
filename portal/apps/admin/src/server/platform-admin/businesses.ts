import { createServerFn } from "@tanstack/react-start";
import { platformAdminMiddleware } from "@lanyard/auth/middleware";
import { ConflictError, NotFoundError } from "@lanyard/shared";
import { z } from "zod";

const businessIdSchema = z.object({ businessId: z.string().uuid() });
const businessNameSchema = z.string().trim().min(1).max(120);

export const listBusinesses = createServerFn({ method: "GET" })
  .middleware([platformAdminMiddleware])
  .handler(async ({ context }) => {
    const { prisma } = await import("@lanyard/db");

    const businesses = await prisma.business.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        _count: { select: { users: true, folders: true } },
        settings: {
          select: {
            defaultModelName: true,
            defaultModelProvider: {
              select: { id: true, name: true, slug: true },
            },
          },
        },
      },
    });
    return { admin: context.admin, businesses };
  });

export const getBusiness = createServerFn({ method: "GET" })
  .middleware([platformAdminMiddleware])
  .validator(businessIdSchema)
  .handler(async ({ data }) => {
    const { prisma } = await import("@lanyard/db");
    const business = await prisma.business.findUnique({
      where: { id: data.businessId },
      select: {
        id: true,
        name: true,
        createdAt: true,
        users: {
          orderBy: { email: "asc" },
          select: { id: true, email: true, isAdmin: true, createdAt: true },
        },
        folders: {
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            _count: { select: { permissions: true } },
          },
        },
        settings: {
          select: {
            defaultModelName: true,
            defaultModelProvider: {
              select: { id: true, name: true, slug: true },
            },
          },
        },
      },
    });

    if (!business) throw new NotFoundError("Business not found");
    return business;
  });

export const createBusiness = createServerFn({ method: "POST" })
  .middleware([platformAdminMiddleware])
  .validator(z.object({ name: businessNameSchema }))
  .handler(async ({ data }) => {
    const { prisma } = await import("@lanyard/db");
    return prisma.business.create({
      data: { name: data.name, settings: { create: {} } },
      select: { id: true, name: true, createdAt: true },
    });
  });

export const inviteBusinessUser = createServerFn({ method: "POST" })
  .middleware([platformAdminMiddleware])
  .validator(
    z.object({
      businessId: z.string().uuid(),
      email: z.string().email().trim().toLowerCase(),
      isAdmin: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    const [{ prisma }, { createIdentityUser, deleteIdentityUser }] =
      await Promise.all([
        import("@lanyard/db"),
        import("@lanyard/auth/server"),
      ]);
    const [business, existingUser] = await Promise.all([
      prisma.business.findUnique({
        where: { id: data.businessId },
        select: { id: true },
      }),
      prisma.user.findUnique({
        where: { email: data.email },
        select: { id: true },
      }),
    ]);
    if (!business) throw new NotFoundError("Business not found");
    if (existingUser) {
      throw new ConflictError("A tenant user already has that email");
    }

    const identity = await createIdentityUser(data.email);

    try {
      return await prisma.$transaction(async (tx) => {
        const [currentBusiness, currentUser] = await Promise.all([
          tx.business.findUnique({
            where: { id: business.id },
            select: { id: true },
          }),
          tx.user.findUnique({
            where: { email: data.email },
            select: { id: true },
          }),
        ]);
        if (!currentBusiness) throw new NotFoundError("Business not found");
        if (currentUser) {
          throw new ConflictError("A tenant user already has that email");
        }

        return tx.user.create({
          data: {
            authUserId: identity.sub,
            email: data.email,
            businessId: currentBusiness.id,
            isAdmin: data.isAdmin,
          },
          select: { id: true, email: true, isAdmin: true, createdAt: true },
        });
      });
    } catch (error) {
      await deleteIdentityUser(data.email);
      if (
        error instanceof ConflictError ||
        error instanceof NotFoundError
      ) {
        throw error;
      }
      throw new ConflictError("Unable to create this user");
    }
  });

export const renameBusiness = createServerFn({ method: "POST" })
  .middleware([platformAdminMiddleware])
  .validator(
    z.object({ businessId: z.string().uuid(), name: businessNameSchema }),
  )
  .handler(async ({ data }) => {
    const { prisma } = await import("@lanyard/db");
    const result = await prisma.business.updateMany({
      where: { id: data.businessId },
      data: { name: data.name },
    });
    if (result.count === 0) throw new NotFoundError("Business not found");
    return { businessId: data.businessId, name: data.name };
  });

export const deleteBusiness = createServerFn({ method: "POST" })
  .middleware([platformAdminMiddleware])
  .validator(businessIdSchema)
  .handler(async ({ data }) => {
    const [{ prisma }, { deleteIdentityUser }] = await Promise.all([
      import("@lanyard/db"),
      import("@lanyard/auth/server"),
    ]);
    const emails = await prisma.$transaction(async (tx) => {
      const business = await tx.business.findUnique({
        where: { id: data.businessId },
        select: {
          id: true,
          users: { select: { email: true } },
        },
      });
      if (!business) throw new NotFoundError("Business not found");
      const userEmails = business.users.map((user) => user.email);
      await tx.business.delete({ where: { id: business.id } });
      return userEmails;
    });
    await Promise.all(emails.map((email) => deleteIdentityUser(email)));
    return { businessId: data.businessId };
  });
