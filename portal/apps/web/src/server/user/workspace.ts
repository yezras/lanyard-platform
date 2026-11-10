import { createServerFn } from '@tanstack/react-start'
import { authMiddleware } from '@lanyard/auth/middleware'

export const fetchWorkspace = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { prisma } = await import('@lanyard/db')
    const { user } = context

    const foldersPromise = user.isAdmin
      ? prisma.folder.findMany({
          where: { businessId: user.businessId },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        })
      : prisma.userFolderPermission
          .findMany({
            where: { userId: user.id },
            orderBy: { folder: { name: 'asc' } },
            select: { folder: { select: { id: true, name: true } } },
          })
          .then((permissions) => permissions.map(({ folder }) => folder))

    const [business, folders] = await Promise.all([
      prisma.business.findUniqueOrThrow({
        where: { id: user.businessId },
        select: {
          id: true,
          name: true,
          settings: {
            select: {
              defaultModelName: true,
              defaultModelProvider: {
                select: { id: true, name: true, slug: true },
              },
            },
          },
          _count: { select: { users: true } },
        },
      }),
      foldersPromise,
    ])

    return {
      user,
      business,
      folders,
    }
  })
