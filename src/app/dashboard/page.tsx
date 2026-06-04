import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { DashboardClient } from "./client";

export default async function DashboardPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login");

  const me = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!me[0]) redirect("/login");

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Claude Code Monitor</h1>
          <p className="text-xs text-neutral-500">{me[0].email}</p>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button className="text-xs text-neutral-400 hover:text-neutral-200">
            Sign out
          </button>
        </form>
      </header>
      <DashboardClient apiToken={me[0].apiToken} myEmail={me[0].email} />
    </div>
  );
}
