import { NextRequest, NextResponse } from "next/server";
import { runSweep } from "@/lib/cleanup";
import { fulfillQueueIfCapacity } from "@/lib/engine";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const report = await runSweep();
  await fulfillQueueIfCapacity();
  await audit({
    action: "cron.cleanup_run",
    actorEmail: "cron",
    metadata: report,
  });
  return NextResponse.json({ ok: true, report });
}
