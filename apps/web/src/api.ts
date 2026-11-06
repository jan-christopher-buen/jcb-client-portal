export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}
let pendingCsrf: Promise<string> | undefined
function csrfToken() {
  pendingCsrf ??= (async () => {
    const response = await fetch('/api/auth/csrf', {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok)
      throw new ApiFailure(
        response.status,
        'CONNECTION_ERROR',
        'Unable to prepare a secure request. Refresh and try again.',
      )
    const data = (await response.json()) as { token: string }
    return data.token
  })().finally(() => {
    pendingCsrf = undefined
  })
  return pendingCsrf
}
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  try {
    const headers: Record<string, string> = {}
    if (method !== 'GET') {
      headers['X-CSRF-Token'] = await csrfToken()
      headers['Content-Type'] = 'application/json'
    }
    const response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    if (response.status === 204) return undefined as T
    const data = await response.json()
    if (!response.ok)
      throw new ApiFailure(
        response.status,
        data.error?.code ?? 'REQUEST_FAILED',
        data.error?.message ?? 'Request failed. Try again.',
      )
    return data as T
  } catch (error) {
    if (error instanceof ApiFailure) {
      if (error.status === 401 && path !== '/auth/login' && path !== '/auth/me')
        window.dispatchEvent(new Event('jcb:session-ended'))
      throw error
    }
    throw new ApiFailure(
      0,
      'CONNECTION_ERROR',
      'Unable to reach the portal. Check your connection and try again.',
    )
  }
}
export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Try again.'
}
