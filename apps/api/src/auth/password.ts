import argon2 from 'argon2'
import { randomBytes } from 'node:crypto'
export const hashPassword = (password: string) =>
  argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  })
// Unknown accounts still perform a full Argon2 verification.
const dummyHash = hashPassword(randomBytes(32).toString('hex'))
export async function verifyPassword(password: string, hash?: string) {
  return argon2.verify(hash ?? (await dummyHash), password)
}
