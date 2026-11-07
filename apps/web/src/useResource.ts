import { useEffect, useState } from 'react'
import { api, errorMessage } from './api.js'
export function useResource<T>(
  path: string,
  {
    retainDataOnReload = false,
    retentionKey = path,
  }: {
    retainDataOnReload?: boolean
    // Opt-in scope for paginated reads; callers must include full ownership path.
    retentionKey?: string
  } = {},
) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{
    path: string
    retentionKey: string
    data: T | null
    error: string
    loading: boolean
  }>({ path, retentionKey, data: null, error: '', loading: true })
  useEffect(() => {
    let live = true
    api<T>(path)
      .then((data) => {
        if (live)
          setState({ path, retentionKey, data, error: '', loading: false })
      })
      .catch((error) => {
        if (live)
          setState((previous) => ({
            path,
            retentionKey,
            data:
              retainDataOnReload && previous.retentionKey === retentionKey
                ? previous.data
                : null,
            error: errorMessage(error),
            loading: false,
          }))
      })
    return () => {
      live = false
    }
  }, [path, attempt, retainDataOnReload, retentionKey])
  return {
    data:
      state.path === path ||
      (retainDataOnReload && state.retentionKey === retentionKey)
        ? state.data
        : null,
    error: state.path === path ? state.error : '',
    loading: state.path !== path || state.loading,
    reload() {
      setState((v) => ({ ...v, loading: true }))
      setAttempt((v) => v + 1)
    },
  }
}
