import { createContext, useContext } from 'react'
import type { Identity } from '@jcb/contracts'
export type SessionContext = {
  user: Identity | null
  setUser: (user: Identity | null) => void
  token: string | null
  setToken: (token: string | null) => void
}
export const Session = createContext<SessionContext | null>(null)
export function useSession() {
  return useContext(Session)!
}
