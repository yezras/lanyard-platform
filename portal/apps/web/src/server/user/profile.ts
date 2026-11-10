import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@lanyard/auth/middleware";
import { ConflictError } from "@lanyard/shared";
import { z } from "zod";

const emailSchema = z.object({ email: z.string().email().trim().toLowerCase() });

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => ({
    id: context.user.id,
    email: context.user.email,
    isAdmin: context.user.isAdmin,
  }));

/** Updates Cognito (when configured) and the product-db email in one step. */
export const updateMyEmail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(emailSchema)
  .handler(async ({ context, data }) => {
    if (data.email === context.user.email) {
      return { email: context.user.email, pendingEmail: null };
    }

    const [{ prisma }, { updateIdentityUserEmail }] = await Promise.all([
      import("@lanyard/db"),
      import("@lanyard/auth/server"),
    ]);
    const duplicate = await prisma.user.findFirst({
      where: { email: data.email, id: { not: context.user.id } },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictError("A tenant user already has that email");
    }

    await updateIdentityUserEmail(context.user.email, data.email);

    await prisma.$transaction(async (tx) => {
      const currentDuplicate = await tx.user.findFirst({
        where: { email: data.email, id: { not: context.user.id } },
        select: { id: true },
      });
      if (currentDuplicate) {
        throw new ConflictError("A tenant user already has that email");
      }

      await tx.user.update({
        where: { id: context.user.id },
        data: { email: data.email },
      });
    });
    return { email: data.email, pendingEmail: null };
  });
