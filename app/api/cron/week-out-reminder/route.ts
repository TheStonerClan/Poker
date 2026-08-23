// Daily Vercel Cron: send the "1 week until poker night" reminder when
// the next tournament's effective date is exactly 7 days from today.
//
// Schedule lives in vercel.json. Daily firing is intentional even though
// most days will be a no-op — the resolver returns the next scheduled
// night and we compare to today+7 in the tournament's local timezone.
// Idempotency is enforced by the dispatch ledger's unique key, so a
// retry within the same calendar day is harmless.
//
// Auth: Vercel attaches `Authorization: Bearer <CRON_SECRET>` when it
// fires cron jobs. We refuse anything else. The same endpoint can also
// be POST'd from the admin test endpoint for dry-runs / forced re-fires.

import { NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { resolveNextNight } from "@/lib/schedule/server";
import { toIsoDate } from "@/lib/schedule/next-night";
import {
  isValidHhMm,
  isValidTimezone,
  localDateInTz,
  splitHhMm,
  zonedWallClockToUtc,
} from "@/lib/schedule/zoned-time";
import { dispatchMessage, type DispatchResult } from "@/lib/signal/dispatch";
import {
  buildWeekOutMessage,
  type WeekOutInput,
} from "@/scripts/signal-cli/messages/week-out";

const DAYS_BEFORE = 7;
const DEFAULT_TIMEZONE = "America/Chicago";
const DEFAULT_START_TIME = "19:00";

export const dynamic = "force-dynamic";

interface TemplateRow {
  id: string;
  name: string;
  recurrence_rule: string | null;
  location: string | null;
  start_time: string | null;
  start_timezone: string | null;
}

interface RunSummary {
  ranAt: string;
  considered: number;
  fired: Array<{
    templateId: string;
    templateName: string;
    effectiveDate: string;
    dispatch: DispatchResult;
  }>;
  skipped: Array<{
    templateId: string;
    templateName: string;
    reason: string;
  }>;
}

export async function GET(req: Request): Promise<NextResponse> {
  return runCron(req);
}

export async function POST(req: Request): Promise<NextResponse> {
  return runCron(req);
}

async function runCron(req: Request): Promise<NextResponse> {
  // ---- auth ----------------------------------------------------------
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on the server" },
      { status: 500 },
    );
  }
  const header = req.headers.get("authorization");
  if (header !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ---- query templates ----------------------------------------------
  const supabase = createServiceClient();
  const { data: templates, error } = await supabase
    .from("tournament_templates")
    .select("id, name, recurrence_rule, location, start_time, start_timezone");
  if (error) {
    return NextResponse.json(
      { error: `templates query failed: ${error.message}` },
      { status: 500 },
    );
  }

  // ---- decide + dispatch per template -------------------------------
  const now = new Date();
  const summary: RunSummary = {
    ranAt: now.toISOString(),
    considered: templates?.length ?? 0,
    fired: [],
    skipped: [],
  };

  for (const tpl of (templates ?? []) as TemplateRow[]) {
    const skip = (reason: string) =>
      summary.skipped.push({
        templateId: tpl.id,
        templateName: tpl.name,
        reason,
      });

    if (!tpl.recurrence_rule) {
      skip("no recurrence rule");
      continue;
    }

    const timezone = isValidTimezone(tpl.start_timezone)
      ? tpl.start_timezone
      : DEFAULT_TIMEZONE;

    let resolved;
    try {
      resolved = await resolveNextNight(supabase, tpl, now);
    } catch (err) {
      skip(
        `resolver threw: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (resolved.kind !== "ok") {
      skip(`resolver returned ${resolved.kind}`);
      continue;
    }

    // Calendar-date comparison in the tournament's timezone. Adding
    // 7 * 86400000 ms is safe across DST because we only care about the
    // resulting YYYY-MM-DD, not a precise wall-clock hour.
    const targetYmd = localDateInTz(
      new Date(now.getTime() + DAYS_BEFORE * 86_400_000),
      timezone,
    );
    // `effectiveDate` is a plain calendar date (local-midnight Date built
    // from Y/M/D components by the resolver, not a real zoned instant) —
    // pull the fields back out directly instead of running it through
    // localDateInTz, which would reinterpret it as a UTC instant and
    // roll it back a day for any zone west of UTC (e.g. Fri -> Thu in CT).
    const effectiveYmd = toIsoDate(resolved.next.effectiveDate);

    if (effectiveYmd !== targetYmd) {
      skip(`not week-out (next=${effectiveYmd}, target=${targetYmd})`);
      continue;
    }

    // ---- build message --------------------------------------------
    const startTimeStr = isValidHhMm(tpl.start_time)
      ? tpl.start_time
      : DEFAULT_START_TIME;
    const [hh, mm] = splitHhMm(startTimeStr);
    const [yy, mo, dd] = effectiveYmd.split("-").map(Number);
    const startInstant = zonedWallClockToUtc(yy, mo, dd, hh, mm, timezone);

    const input: WeekOutInput = {
      tournamentName: tpl.name,
      date: startInstant,
      timezone,
      ...(tpl.location ? { location: tpl.location } : {}),
    };
    const body = buildWeekOutMessage(input);

    // ---- dispatch -------------------------------------------------
    const dispatch = await dispatchMessage({
      kind: "week-out",
      key: `week-out:${tpl.id}:${effectiveYmd}`,
      body,
    });

    summary.fired.push({
      templateId: tpl.id,
      templateName: tpl.name,
      effectiveDate: effectiveYmd,
      dispatch,
    });
  }

  return NextResponse.json(summary);
}
