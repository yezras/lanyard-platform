import { apiFetch, resetCsrfToken } from "./client.js";

/** End the current session (clears BFF session cookie). */
export async function logout(): Promise<void> {
  const res = await apiFetch("/api/auth/logout", { method: "POST" });
  resetCsrfToken();
  if (!res.ok) {
    throw new Error(`Logout failed (${res.status})`);
  }
}
