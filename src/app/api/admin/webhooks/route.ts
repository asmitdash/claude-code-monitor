import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { requireTL } from "@/lib/session-helper";
import { invalidateWebhookCache } from "@/lib/webhooks";

export const runtime = "nodejs";

export async function GET() {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rows = await db.select().from(schema.webhooks);
  return NextResponse.json({ webhooks: rows });
}

export async function POST(req: NextRequest) {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const url = String(body.url ?? "");
  const label = String(body.label ?? "").slice(0, 60) || "webhook";
  const events = Array.isArray(body.events) ? body.events : ["*"];
  if (!/^https?:\/\//.test(url)) {
    return NextResponse.json({ error: "bad_url" }, { status: 400 });
  }
  const [created] = await db
    .insert(schema.webhooks)
    .values({ url, label, events, createdBy: me.realActorEmail })
    .returning();
  invalidateWebhookCache();
  return NextResponse.json({ ok: true, webhook: created });
}

export async function DELETE(req: NextRequest) {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  await db.delete(schema.webhooks).where(eq(schema.webhooks.id, id));
  invalidateWebhookCache();
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  await db
    .update(schema.webhooks)
    .set({
      active: body.active !== undefined ? Boolean(body.active) : undefined,
      events: body.events !== undefined ? body.events : undefined,
    })
    .where(eq(schema.webhooks.id, id));
  invalidateWebhookCache();
  return NextResponse.json({ ok: true });
}
