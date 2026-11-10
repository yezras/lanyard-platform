import { createServerFn } from '@tanstack/react-start'
import { getAuthClaims } from '@lanyard/auth/server'

/**
 * Used by route guards only. It reports whether a valid session exists; it does not authorize
 * anything, because `beforeLoad` also runs on the client during navigation.
 */
export const fetchClaims = createServerFn({ method: 'GET' }).handler(
  async () => {
    return getAuthClaims()
  },
)
