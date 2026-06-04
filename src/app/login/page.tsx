import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { LoginForm } from "./form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) {
    const role = (session.user as { role?: string }).role;
    redirect(role === "tl" ? "/admin" : "/dashboard");
  }
  const params = await searchParams;
  const error = params.error;

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-100 px-4">
      <div className="max-w-sm w-full space-y-6 border border-neutral-800 rounded-2xl p-8 bg-neutral-900/50">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Claude Code Monitor</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Sign in with your team email. First sign-in sets your password.
          </p>
        </div>
        {error && (
          <div className="text-sm rounded-md border border-red-900/50 bg-red-950/40 text-red-300 px-3 py-2">
            {error === "CredentialsSignin"
              ? "Wrong password, or email not on the team allowlist."
              : `Sign-in failed: ${error}`}
          </div>
        )}
        <LoginForm />
      </div>
    </div>
  );
}
