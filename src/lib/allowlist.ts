const TL_EMAILS = (process.env.TL_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const MEMBER_EMAILS = (process.env.MEMBER_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const ALLOWED_EMAILS = new Set([...TL_EMAILS, ...MEMBER_EMAILS]);

export function isAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  return ALLOWED_EMAILS.has(email.toLowerCase());
}

export function roleFor(email: string | null | undefined): "tl" | "member" {
  if (!email) return "member";
  return TL_EMAILS.includes(email.toLowerCase()) ? "tl" : "member";
}
