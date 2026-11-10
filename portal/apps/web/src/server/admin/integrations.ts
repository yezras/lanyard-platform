import { createServerFn } from '@tanstack/react-start'
import { businessAdminMiddleware } from '@lanyard/auth/middleware'
import { NotFoundError } from '@lanyard/shared'
import { z } from 'zod'

export const listMemberIntegrations = createServerFn({ method: 'GET' })
  .middleware([businessAdminMiddleware])
  .handler(async ({ context }) => {
    const { prisma } = await import('@lanyard/db')
    return prisma.oAuthToken.findMany({
      where: { user: { businessId: context.user.businessId } },
      orderBy: [{ user: { email: 'asc' } }, { service: { name: 'asc' } }],
      select: {
        id: true,
        expiresAt: true,
        scopes: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, email: true } },
        service: { select: { id: true, slug: true, name: true } },
      },
    })
  })

export const disconnectMemberIntegration = createServerFn({ method: 'POST' })
  .middleware([businessAdminMiddleware])
  .validator(z.object({ oauthTokenId: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    const { prisma } = await import('@lanyard/db')
    await prisma.$transaction(async (tx) => {
      const token = await tx.oAuthToken.findFirst({
        where: {
          id: data.oauthTokenId,
          user: { businessId: context.user.businessId },
        },
        select: { id: true },
      })
      if (!token) throw new NotFoundError('Integration connection not found')
      await tx.oAuthToken.delete({ where: { id: token.id } })
    })
    return { oauthTokenId: data.oauthTokenId }
  })
