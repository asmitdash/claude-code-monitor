// Admins are the team's privileged operators — they need unrestricted access to
// Claude Code so they can do their jobs without queueing, hitting quotas, or
// being auto-ended. Every enforcement gate in the system funnels through this
// helper so the bypass policy lives in exactly one place.

export function isAdminBypass(role: string | null | undefined): boolean {
  return role === "admin";
}
