import { db, schema } from "@/db";
import { dispatchWebhooks } from "@/lib/webhooks";

export type AuditAction =
  | "user.login"
  | "user.logout"
  | "slot.claimed"
  | "slot.released"
  | "slot.extended"
  | "slot.expired"
  | "slot.idle_ended"
  | "slot.force_ended"
  | "slot.handed_off"
  | "queue.joined"
  | "queue.cancelled"
  | "queue.fulfilled"
  | "queue.expired"
  | "queue.promoted"
  | "queue.removed_by_admin"
  | "queue.cleared_by_admin"
  | "queue.position_moved"
  | "approval.requested"
  | "approval.approved"
  | "approval.rejected"
  | "approval.expired"
  | "approval.consumed"
  | "kill.set"
  | "kill.cleared"
  | "user.paused"
  | "user.unpaused"
  | "user.banned"
  | "user.unbanned"
  | "user.cooldown_started"
  | "user.cooldown_cleared"
  | "user.state_reset"
  | "unauthorized.attempt"
  | "presence.idle"
  | "presence.returned"
  | "presence.session_ended"
  | "config.updated"
  | "broadcast.set"
  | "broadcast.cleared"
  | "member.added"
  | "member.removed"
  | "member.role_changed"
  | "token.rotated"
  | "impersonation.started"
  | "impersonation.ended"
  | "cron.cleanup_run"
  | "cron.archive_run";

export type Severity = "info" | "warn" | "alert";

export interface AuditEntry {
  action: AuditAction;
  severity?: Severity;
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  targetUserId?: string | null;
  targetEmail?: string | null;
  slotId?: string | null;
  queueId?: string | null;
  approvalId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function audit(entry: AuditEntry) {
  try {
    await db.insert(schema.auditLog).values({
      action: entry.action,
      severity: entry.severity ?? "info",
      actorUserId: entry.actorUserId ?? null,
      actorEmail: entry.actorEmail ?? null,
      actorRole: entry.actorRole ?? null,
      targetUserId: entry.targetUserId ?? null,
      targetEmail: entry.targetEmail ?? null,
      slotId: entry.slotId ?? null,
      queueId: entry.queueId ?? null,
      approvalId: entry.approvalId ?? null,
      metadata: entry.metadata ?? null,
    });
  } catch (e) {
    console.error("[audit] insert failed", entry.action, e);
  }
  dispatchWebhooks(entry).catch((e) =>
    console.error("[audit] webhook dispatch failed", e),
  );
}
