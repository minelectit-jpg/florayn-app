// Same-origin calls to the Medusa backend. The console is served by the backend
// at /console, so the admin session cookie works and no CORS is involved.

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90000)
  try {
    const response = await fetch(path, { credentials: "include", ...init, signal: controller.signal, headers: { "content-type": "application/json", ...init?.headers } })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new ApiError(data.message || `Request failed (${response.status}).`, response.status)
    return data
  } catch (error: any) {
    if (error.name === "AbortError") throw new Error("The server took too long. Refresh before retrying; the save may have completed.")
    throw error
  } finally { clearTimeout(timer) }
}

export const post = <T = any>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) })

export type User = { id: string; email: string; first_name?: string | null }

/** The signed-in admin user, or null when there is no session. */
export async function me(): Promise<User | null> {
  try { return (await api<{ user: User }>("/admin/users/me")).user } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

export async function login(email: string, password: string) {
  const auth = await fetch("/auth/user/emailpass", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) })
  const data = await auth.json().catch(() => ({}))
  if (!auth.ok || !data.token) throw new Error(auth.status === 401 ? "Wrong email or password." : data.message || "Could not sign in.")
  // swap the token for a cookie session, shared with the classic admin
  const session = await fetch("/auth/session", { method: "POST", credentials: "include", headers: { authorization: `Bearer ${data.token}` } })
  if (!session.ok) throw new Error("Signed in, but the session could not start. Try again.")
}

export async function logout() {
  await fetch("/auth/session", { method: "DELETE", credentials: "include" }).catch(() => undefined)
}
