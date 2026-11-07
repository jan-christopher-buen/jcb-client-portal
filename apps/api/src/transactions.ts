import type { PrismaClient, Prisma } from './generated/prisma/client.js'
import { HttpError } from './errors.js'
type Db = Prisma.TransactionClient
export async function serialTransaction<T>(
  db: PrismaClient,
  run: (tx: Db) => Promise<T>,
  isolationLevel: 'Serializable' | 'ReadCommitted' = 'Serializable',
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(run, {
        isolationLevel,
        maxWait: 5000,
        timeout: 10000,
      })
    } catch (error) {
      const details = error as {
        code?: unknown
        meta?: {
          code?: unknown
          driverAdapterError?: { cause?: { originalCode?: unknown } }
        }
      } | null
      const code = details?.code
      const sqlCode =
        details?.meta?.code ??
        details?.meta?.driverAdapterError?.cause?.originalCode
      if (
        code !== 'P2034' &&
        !(code === 'P2010' && (sqlCode === '40001' || sqlCode === '40P01'))
      )
        throw error
      if (attempt === 3)
        throw new HttpError(
          409,
          'RETRY_REQUIRED',
          'Another request changed this record. Refresh and try again.',
        )
    }
  }
}
