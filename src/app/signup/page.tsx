import { Suspense } from "react";
import { SignupClient } from "./client";

export default function SignupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-100 px-4">
      <div className="max-w-sm w-full space-y-6 border border-neutral-800 rounded-2xl p-8 bg-neutral-900/50">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Claude Code Monitor</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Set your password to finish joining your team.
          </p>
        </div>
        <Suspense fallback={<div className="text-xs text-neutral-500">Loading…</div>}>
          <SignupClient />
        </Suspense>
      </div>
    </div>
  );
}
