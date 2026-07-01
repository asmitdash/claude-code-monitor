// M3 presence peek: passive read-only view of who else is active. No pinging,
// no interaction — just visibility. Auto-refreshes every 15s.
import { requireUser } from "@/lib/session-helper";
import { redirect } from "next/navigation";
import { TeamClient } from "./client";

export default async function TeamPage() {
  const me = await requireUser();
  if (!me) redirect("/login");
  return <TeamClient meId={me.id} />;
}
