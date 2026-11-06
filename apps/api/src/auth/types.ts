import type { Identity } from '@jcb/contracts'
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Passport requires global Express.User augmentation.
  namespace Express {
    interface User {
      id: Identity['id']
      email: Identity['email']
      name: Identity['name']
      role: Identity['role']
    }
  }
}
declare module 'express-session' {
  interface SessionData {
    csrf?: string
    authenticatedAt?: number
  }
}
export {}
