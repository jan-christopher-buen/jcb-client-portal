import { useEffect, useState } from 'react'
import { api, errorMessage } from './api.js'
export function useResource<T>(
  path: string,
  { retainDataOnReload = false }: { retainDataOnReload?: boolean } = {},
) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{
    path: string
    data: T | null
    error: string
    loading: boolean
  }>({ path, data: null, error: '', loading: true })
  useEffect(() => {
    let live = true
    api<T>(path)
      .then((data) => {
        if (live) setState({ path, data, error: '', loading: false })
      })
      .catch((error) => {
        if (live)
          setState((previous) => ({
            path,
            data:
              retainDataOnReload && previous.path === path
                ? previous.data
                : null,
            error: errorMessage(error),
            loading: false,
          }))
      })
    return () => {
      live = false
    }
  }, [path, attempt, retainDataOnReload])
  return {
    data: state.path === path ? state.data : null,
    error: state.path === path ? state.error : '',
    loading: state.path !== path || state.loading,
    reload() {
      setState((v) => ({ ...v, loading: true }))
      setAttempt((v) => v + 1)
    },
  }
}
