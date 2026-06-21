"use client";

import { useState, useTransition } from "react";
import { signIn } from "next-auth/react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    startTransition(async () => {
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (res?.error) {
        setErr("Wrong password, or email not on the team allowlist.");
        return;
      }
      window.location.href = "/";
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="block text-xs text-neutral-400 mb-1">Email</label>
        <input
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm focus:outline-none focus:border-neutral-600"
          placeholder="you@example.com"
        />
      </div>
      <div>
        <label className="block text-xs text-neutral-400 mb-1">Password</label>
        <input
          type="password"
          autoComplete="current-password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm focus:outline-none focus:border-neutral-600"
          placeholder="At least 6 characters"
        />
        <p className="text-[10px] text-neutral-500 mt-1">
          New teammate? Use the invite link your admin sent you.
        </p>
      </div>
      {err && <div className="text-xs text-red-400">{err}</div>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-white text-neutral-900 hover:bg-neutral-200 font-medium px-4 py-2.5 transition disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
