import { createServerFn } from "@tanstack/react-start";
import { businessAdminMiddleware } from "@lanyard/auth/middleware";
import { ConflictError, ForbiddenError, NotFoundError } from "@lanyard/shared";
import { z } from "zod";

const userIdSchema = z.object({ userId: z.string().uuid() });
const memberFieldsSchema = z.object({
  email: z.string().email().trim().toLowerCase(),
  isAdmin: z.boolean().default(false),
});

async function getBusinessUser(userId: string, businessId: string) {
  const { prisma } = await import("@lanyard/db");
  const user = await prisma.user.findFirst({
    where: { id: userId, businessId },
    select: { id: true, authUserId: true, email: true, isAdmin: true },
  });
  if (!user) throw new NotFoundError("User not found");
  return user;
}

export const listUsers = createServerFn({ method: "GET" })
  .middleware([businessAdminMiddleware])
  .handler(async ({ context }) => {
    const { prisma } = await import("@lanyard/db");
    return prisma.user.findMany({
      where: { businessId: context.user.businessId },
      orderBy: { email: "asc" },
      select: {
        id: true,
        email: true,
        isAdmin: true,
        createdAt: true,
        _count: { select: { folderPermissions: true, oauthTokens: true } },
      },
    });
  });

export const inviteUser = createServerFn({ method: "POST" })
  .middleware([businessAdminMiddleware])
  .validator(memberFieldsSchema)
  .handler(async ({ context, data }) => {
    const [{ prisma }, { createIdentityUser, deleteIdentityUser }] =
      await Promise.all([
        import("@lanyard/db"),
        import("@lanyard/auth/server"),
      ]);
    const existing = await prisma.user.findUnique({
      where: { email: data.email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError("A tenant user already has that email");
    }

    const identity = await createIdentityUser(data.email);

    try {
      return await prisma.$transaction(async (tx) => {
        const existingUser = await tx.user.findUnique({
          where: { email: data.email },
          select: { id: true },
        });
        if (existingUser) {
          throw new ConflictError("A tenant user already has that email");
        }

        return tx.user.create({
          data: {
            authUserId: identity.sub,
            email: data.email,
            businessId: context.user.businessId,
            isAdmin: data.isAdmin,
          },
          select: { id: true, email: true, isAdmin: true, createdAt: true },
        });
      });
    } catch (error) {
      await deleteIdentityUser(data.email);
      if (error instanceof ConflictError) throw error;
      throw new ConflictError("Unable to create this user");
    }
  });

export const updateUser = createServerFn({ method: "POST" })
  .middleware([businessAdminMiddleware])
  .validator(userIdSchema.extend(memberFieldsSchema.shape))
  .handler(async ({ context, data }) => {
    const user = await getBusinessUser(data.userId, context.user.businessId);
    if (user.id === context.user.id && !data.isAdmin) {
      throw new ForbiddenError(
        "You cannot remove your own administrator access",
      );
    }

    const [{ prisma }, { updateIdentityUserEmail }] = await Promise.all([
      import("@lanyard/db"),
      import("@lanyard/auth/server"),
    ]);
    const duplicate = await prisma.user.findFirst({
      where: { email: data.email, id: { not: user.id } },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictError("A tenant user already has that email");
    }

    if (user.email !== data.email) {
      await updateIdentityUserEmail(user.email, data.email);
    }

    return prisma.$transaction(async (tx) => {
      const [currentUser, currentDuplicate] = await Promise.all([
        tx.user.findFirst({
          where: { id: user.id, businessId: context.user.businessId },
          select: { id: true },
        }),
        tx.user.findFirst({
          where: { email: data.email, id: { not: user.id } },
          select: { id: true },
        }),
      ]);
      if (!currentUser) throw new NotFoundError("User not found");
      if (currentDuplicate) {
        throw new ConflictError("A tenant user already has that email");
      }

      return tx.user.update({
        where: { id: currentUser.id },
        data: { email: data.email, isAdmin: data.isAdmin },
        select: { id: true, email: true, isAdmin: true, updatedAt: true },
      });
    });
  });

export const removeUser = createServerFn({ method: "POST" })
  .middleware([businessAdminMiddleware])
  .validator(userIdSchema)
  .handler(async ({ context, data }) => {
    const user = await getBusinessUser(data.userId, context.user.businessId);
    if (user.id === context.user.id) {
      throw new ForbiddenError("You cannot remove your own account");
    }

    const [{ prisma }, { deleteIdentityUser }] = await Promise.all([
      import("@lanyard/db"),
      import("@lanyard/auth/server"),
    ]);
    await deleteIdentityUser(user.email);
    await prisma.user.delete({ where: { id: user.id } });
    return { userId: user.id };
  });
