import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client.js'
export function createDatabase(connectionString: string) {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
    }),
  })
}
