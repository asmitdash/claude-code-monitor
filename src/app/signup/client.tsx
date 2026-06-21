"use client";

import { useEffect, useState, useTransition } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

type ValidateState =
  | { phase: "loading" }
  | { phase: "ready"; email: string; role: "admin" | "member" }
  | { phase: "invalid"; reason: string };

export function SignupClient() {
  const params = useSearchParams();
  const token = params.get("invite") ?? "";

  const [state, setState] = useState<ValidateState>({ phase: "loading" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState({ phase: "invalid", reason: "Missing invite link." });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/invites/validate?token=${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        const j = (await r.json()) as
          | { ok: true; email: string; role: "admin" | "member" }
          | { ok: false; error: string };
        if (cancelled) return;
        if (!j.ok) {
          const map: Record<string, string> = {
            not_found: "This invite link does not exist.",
            revoked: "This invite has been revoked.",
            already_used: "This invite has already been used.",
            expired: "This invite has expired.",
            missing_token: "Missing invite link.",
          };
          setState({
            phase: "invalid",
            reason: map[j.error] ?? `Invite is not valid (${j.error}).`,
          });
        } else {
          setState({ phase: "ready", email: j.email, role: j.role });
        }
      } catch {
        if (!cancelled) {
          setState({ phase: "invalid", reason: "Could not reach the server." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (state.phase !== "ready") return;
    if (password.length < 6) {
      setErr("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setErr("Passwords don't match.");
      return;
    }
    startTransition(async () => {
      const res = await signIn("credentials", {
        email: state.email,
        password,
        inviteToken: token,
        redirect: false,
      });
      if (res?.error) {
        setErr(
          "Sign-up failed. The invite may have just been used or revoked — ask your admin for a new one.",
        );
        return;
      }
      window.location.href = "/";
    });
  }

  if (state.phase === "loading") {
    return <div className="text-xs text-neutral-500">Checking invite…</div>;
  }
  if (state.phase === "invalid") {
    return (
      <div className="text-sm rounded-md border border-red-900/50 bg-red-950/40 text-red-300 px-3 py-3">
        <div className="font-medium mb-1">Cannot use this link</div>
        <div className="text-xs text-red-300/80">{state.reason}</div>
        <div className="text-xs text-neutral-400 mt-3">
          Ask your admin to send you a new invite, then come back here.
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="block text-xs text-neutral-400 mb-1">Email</label>
        <input
          type="email"
          value={state.email}
          readOnly
          className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm text-neutral-400 cursor-not-allowed"
        />
        <p className="text-[10px] text-neutral-500 mt-1">
          Locked to this email by the invite — your admin set it when sending the link.
        </p>
      </div>
      <div>
        <label className="block text-xs text-neutral-400 mb-1">Password</label>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm focus:outline-none focus:border-neutral-600"
          placeholder="At least 6 characters"
        />
      </div>
      <div>
        <label className="block text-xs text-neutral-400 mb-1">Confirm password</label>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm focus:outline-none focus:border-neutral-600"
        />
      </div>
      {err && <div className="text-xs text-red-400">{err}</div>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-white text-neutral-900 hover:bg-neutral-200 font-medium px-4 py-2.5 transition disabled:opacity-50"
      >
        {pending ? "Creating account…" : `Join as ${state.role}`}
      </button>
    </form>
  );
}
