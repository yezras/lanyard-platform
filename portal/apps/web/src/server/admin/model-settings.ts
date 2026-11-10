import { createServerFn } from '@tanstack/react-start'
import { businessAdminMiddleware } from '@lanyard/auth/middleware'
import { NotFoundError, ValidationError } from '@lanyard/shared'
import { z } from 'zod'

const providerIdSchema = z.object({ modelProviderId: z.string().uuid() })

export const getModelSettings = createServerFn({ method: 'GET' })
  .middleware([businessAdminMiddleware])
  .handler(async ({ context }) => {
    const { prisma } = await import('@lanyard/db')
    const [settings, credentials] = await Promise.all([
      prisma.businessSettings.findUnique({
        where: { businessId: context.user.businessId },
        select: {
          defaultModelName: true,
          defaultModelProvider: {
            select: { id: true, slug: true, name: true },
          },
        },
      }),
      prisma.businessModelProviderToken.findMany({
        where: { businessId: context.user.businessId },
        orderBy: { modelProvider: { name: 'asc' } },
        select: {
          modelProvider: { select: { id: true, slug: true, name: true } },
          updatedAt: true,
        },
      }),
    ])

    return {
      defaultModelName: settings?.defaultModelName ?? null,
      defaultModelProvider: settings?.defaultModelProvider ?? null,
      credentials: credentials.map(({ modelProvider, updatedAt }) => ({
        modelProvider,
        updatedAt,
      })),
    }
  })

export const listAvailableModelProviders = createServerFn({ method: 'GET' })
  .middleware([businessAdminMiddleware])
  .handler(async () => {
    const { prisma } = await import('@lanyard/db')
    return prisma.modelProvider.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, slug: true, name: true },
    })
  })

export const saveModelProviderCredential = createServerFn({ method: 'POST' })
  .middleware([businessAdminMiddleware])
  .validator(
    providerIdSchema.extend({ apiToken: z.string().trim().min(1).max(4_000) }),
  )
  .handler(async ({ context, data }) => {
    const { prisma } = await import('@lanyard/db')
    await prisma.$transaction(async (tx) => {
      const provider = await tx.modelProvider.findUnique({
        where: { id: data.modelProviderId },
        select: { id: true },
      })
      if (!provider) throw new NotFoundError('Model provider not found')

      await tx.businessModelProviderToken.upsert({
        where: {
          businessId_modelProviderId: {
            businessId: context.user.businessId,
            modelProviderId: provider.id,
          },
        },
        create: {
          businessId: context.user.businessId,
          modelProviderId: provider.id,
          apiToken: data.apiToken,
        },
        update: { apiToken: data.apiToken },
      })
    })
    return { modelProviderId: data.modelProviderId }
  })

export const removeModelProviderCredential = createServerFn({ method: 'POST' })
  .middleware([businessAdminMiddleware])
  .validator(providerIdSchema)
  .handler(async ({ context, data }) => {
    const { prisma } = await import('@lanyard/db')
    await prisma.$transaction(async (tx) => {
      await tx.businessModelProviderToken.deleteMany({
        where: {
          businessId: context.user.businessId,
          modelProviderId: data.modelProviderId,
        },
      })

      await tx.businessSettings.updateMany({
        where: {
          businessId: context.user.businessId,
          defaultModelProviderId: data.modelProviderId,
        },
        data: { defaultModelProviderId: null, defaultModelName: null },
      })
    })
    return { modelProviderId: data.modelProviderId }
  })

export const setDefaultModel = createServerFn({ method: 'POST' })
  .middleware([businessAdminMiddleware])
  .validator(
    z.object({
      modelProviderId: z.string().uuid().nullable(),
      modelName: z.string().trim().min(1).max(200).nullable(),
    }),
  )
  .handler(async ({ context, data }) => {
    if ((data.modelProviderId === null) !== (data.modelName === null)) {
      throw new ValidationError(
        'A provider and model name must be set together',
      )
    }

    const { prisma } = await import('@lanyard/db')
    return prisma.$transaction(async (tx) => {
      if (data.modelProviderId) {
        const credential = await tx.businessModelProviderToken.findUnique({
          where: {
            businessId_modelProviderId: {
              businessId: context.user.businessId,
              modelProviderId: data.modelProviderId,
            },
          },
          select: { id: true },
        })
        if (!credential)
          throw new NotFoundError(
            'Configure a credential for this provider first',
          )
      }

      return tx.businessSettings.upsert({
        where: { businessId: context.user.businessId },
        create: {
          businessId: context.user.businessId,
          defaultModelProviderId: data.modelProviderId,
          defaultModelName: data.modelName,
        },
        update: {
          defaultModelProviderId: data.modelProviderId,
          defaultModelName: data.modelName,
        },
        select: {
          defaultModelName: true,
          defaultModelProvider: {
            select: { id: true, slug: true, name: true },
          },
        },
      })
    })
  })
