import { createServerFn } from '@tanstack/react-start'
import { businessAdminMiddleware } from '@lanyard/auth/middleware'
import { ConflictError, NotFoundError } from '@lanyard/shared'
import { z } from 'zod'

const folderIdSchema = z.object({ folderId: z.string().uuid() })
const folderNameSchema = z.string().trim().min(1).max(120)
const grantSchema = z.object({
  folderId: z.string().uuid(),
  userId: z.string().uuid(),
})

export const listFolders = createServerFn({ method: 'GET' })
  .middleware([businessAdminMiddleware])
  .handler(async ({ context }) => {
    const { prisma } = await import('@lanyard/db')
    return prisma.folder.findMany({
      where: { businessId: context.user.businessId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        createdAt: true,
        _count: { select: { permissions: true } },
      },
    })
  })

export const createFolder = createServerFn({ method: 'POST' })
  .middleware([businessAdminMiddleware])
  .validator(z.object({ name: folderNameSchema }))
  .handler(async ({ context, data }) => {
    const { prisma } = await import('@lanyard/db')
    return prisma.$transaction(async (tx) => {
      const existing = await tx.folder.findFirst({
        where: { businessId: context.user.businessId, name: data.name },
        select: { id: true },
      })
      if (existing) throw new ConflictError('A folder already uses that name')
      return tx.folder.create({
        data: { businessId: context.user.businessId, name: data.name },
        select: { id: true, name: true, createdAt: true },
      })
    })
  })

export const renameFolder = createServerFn({ method: 'POST' })
  .middleware([businessAdminMiddleware])
  .validator(z.object({ folderId: z.string().uuid(), name: folderNameSchema }))
  .handler(async ({ context, data }) => {
    const { prisma } = await import('@lanyard/db')
    return prisma.$transaction(async (tx) => {
      const existing = await tx.folder.findFirst({
        where: {
          businessId: context.user.businessId,
          name: data.name,
          id: { not: data.folderId },
        },
        select: { id: true },
      })
      if (existing) throw new ConflictError('A folder already uses that name')
      const result = await tx.folder.updateMany({
        where: { id: data.folderId, businessId: context.user.businessId },
        data: { name: data.name },
      })
      if (result.count === 0) throw new NotFoundError('Folder not found')
      return { folderId: data.folderId, name: data.name }
    })
  })

export const deleteFolder = createServerFn({ method: 'POST' })
  .middleware([businessAdminMiddleware])
  .validator(folderIdSchema)
  .handler(async ({ context, data }) => {
    const { prisma } = await import('@lanyard/db')
    const result = await prisma.folder.deleteMany({
      where: { id: data.folderId, businessId: context.user.businessId },
    })
    if (result.count === 0) throw new NotFoundError('Folder not found')
    return { folderId: data.folderId }
  })

export const listFolderAccess = createServerFn({ method: 'GET' })
  .middleware([businessAdminMiddleware])
  .validator(folderIdSchema)
  .handler(async ({ context, data }) => {
    const { prisma } = await import('@lanyard/db')
    const folder = await prisma.folder.findFirst({
      where: { id: data.folderId, businessId: context.user.businessId },
      select: {
        permissions: {
          orderBy: { user: { email: 'asc' } },
          select: {
            id: true,
            user: { select: { id: true, email: true, isAdmin: true } },
          },
        },
      },
    })
    if (!folder) throw new NotFoundError('Folder not found')
    return folder.permissions
  })

export const grantFolderAccess = createServerFn({ method: 'POST' })
  .middleware([businessAdminMiddleware])
  .validator(grantSchema)
  .handler(async ({ context, data }) => {
    const { prisma } = await import('@lanyard/db')
    return prisma.$transaction(async (tx) => {
      const [folder, user] = await Promise.all([
        tx.folder.findFirst({
          where: { id: data.folderId, businessId: context.user.businessId },
          select: { id: true },
        }),
        tx.user.findFirst({
          where: { id: data.userId, businessId: context.user.businessId },
          select: { id: true },
        }),
      ])
      if (!folder) throw new NotFoundError('Folder not found')
      if (!user) throw new NotFoundError('User not found')

      return tx.userFolderPermission.upsert({
        where: { userId_folderId: { userId: user.id, folderId: folder.id } },
        create: { userId: user.id, folderId: folder.id },
        update: {},
        select: { id: true, userId: true, folderId: true },
      })
    })
  })

export const revokeFolderAccess = createServerFn({ method: 'POST' })
  .middleware([businessAdminMiddleware])
  .validator(grantSchema)
  .handler(async ({ context, data }) => {
    const { prisma } = await import('@lanyard/db')
    await prisma.$transaction(async (tx) => {
      const permission = await tx.userFolderPermission.findFirst({
        where: {
          userId: data.userId,
          folderId: data.folderId,
          user: { businessId: context.user.businessId },
          folder: { businessId: context.user.businessId },
        },
        select: { id: true },
      })
      if (!permission) throw new NotFoundError('Folder access grant not found')
      await tx.userFolderPermission.delete({ where: { id: permission.id } })
    })
    return { folderId: data.folderId, userId: data.userId }
  })
