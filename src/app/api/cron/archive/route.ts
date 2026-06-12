import { NextRequest, NextResponse } from "next/server";
import { archiveOld } from "@/lib/cleanup";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  await archiveOld();
  return NextResponse.json({ ok: true });
}
