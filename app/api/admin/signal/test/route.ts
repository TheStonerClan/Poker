// Admin-only manual trigger for Signal dispatches. Two use cases:
//
//   1. Preview a message before its natural trigger fires
//      (POST with dryRun=true returns the rendered body without sending).
//   2. Force the dispatch path early (e.g. test the week-out flow before
//      the calendar trigger naturally fires, or re-send a recap that was
//      missed because the bridge was down during finalize).
//
// Idempotency follows the same key as the natural triggers, so a manual
// fire after the cron / finalize already dispatched will short-circuit
// to `skipped: already-dispatched` instead of double-sending.
//
// Request body:
//   { kind: 'week-out', templateId: <uuid>, dryRun?: boolean }
//   { kind: 'recap',   tournamentId: <uuid>, dryRun?: boolean }

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveNextNight } from "@/lib/schedule/server";
import { toIsoDate } from "@/lib/schedule/next-night";
import {
  isValidHhMm,
  isValidTimezone,
  splitHhMm,
  zonedWallClockToUtc,
} from "@/lib/schedule/zoned-time";
import { dispatchMessage, type DispatchResult } from "@/lib/signal/dispatch";
import { getTargetGroupId } from "@/lib/signal/group";
import {
  buildWeekOutMessage,
  type WeekOutInput,
} from "@/scripts/signal-cli/messages/week-out";
import {
  buildRecapMessage,
} from "@/scripts/signal-cli/messages/recap";
import { loadRecapForTournament } from "@/scripts/signal-cli/messages/load-last-recap";

const DEFAULT_TIMEZONE = "America/Chicago";
const DEFAULT_START_TIME = "19:00";

const WeekOutBody = z.object({
  kind: z.literal("week-out"),
  templateId: z.uuid(),
  dryRun: z.boolean().optional(),
});

const RecapBody = z.object({
  kind: z.literal("recap"),
  tournamentId: z.uuid(),
  dryRun: z.boolean().optional(),
});

const RequestBody = z.discriminatedUnion("kind", [WeekOutBody, RecapBody]);

interface PreviewResponse {
  status: "preview";
  groupId: string;
  body: string;
  /** What key the real dispatch would use, so the caller knows what they'd consume. */
  dispatchKey: string;
}

type ApiResponse =
  | PreviewResponse
  | { status: "dispatched"; dispatchKey: string; dispatch: DispatchResult };

export async function POST(req: Request): Promise<NextResponse> {
  await requireAdmin();

  let parsed: z.infer<typeof RequestBody>;
  try {
    const json = await req.json();
    parsed = RequestBody.parse(json);
  } catch (err) {
    return NextResponse.json(
      {
        error: "invalid request body",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }

  try {
    const body =
      parsed.kind === "week-out"
        ? await buildWeekOut(parsed.templateId)
        : await buildRecap(parsed.tournamentId);

    if (parsed.dryRun) {
      const result: ApiResponse = {
        status: "preview",
        groupId: getTargetGroupId(),
        body: body.body,
        dispatchKey: body.dispatchKey,
      };
      return NextResponse.json(result);
    }

    const dispatch = await dispatchMessage({
      kind: parsed.kind,
      key: body.dispatchKey,
      body: body.body,
    });

    const result: ApiResponse = {
      status: "dispatched",
      dispatchKey: body.dispatchKey,
      dispatch,
    };
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

interface PreparedDispatch {
  body: string;
  dispatchKey: string;
}

async function buildWeekOut(templateId: string): Promise<PreparedDispatch> {
  const supabase = createServiceClient();
  const { data: tpl, error } = await supabase
    .from("tournament_templates")
    .select("id, name, recurrence_rule, location, start_time, start_timezone")
    .eq("id", templateId)
    .maybeSingle();
  if (error) throw new Error(`template query failed: ${error.message}`);
  if (!tpl) throw new Error(`template ${templateId} not found`);

  const resolved = await resolveNextNight(supabase, tpl);
  if (resolved.kind !== "ok") {
    throw new Error(`resolver returned ${resolved.kind}`);
  }

  const timezone = isValidTimezone(tpl.start_timezone)
    ? tpl.start_timezone
    : DEFAULT_TIMEZONE;
  // `effectiveDate` is a plain calendar date, not a real zoned instant —
  // see the matching comment in the week-out-reminder cron route.
  const effectiveYmd = toIsoDate(resolved.next.effectiveDate);
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
  return {
    body: buildWeekOutMessage(input),
    dispatchKey: `week-out:${tpl.id}:${effectiveYmd}`,
  };
}

async function buildRecap(tournamentId: string): Promise<PreparedDispatch> {
  const supabase = createServiceClient();
  const recapInput = await loadRecapForTournament(tournamentId, {
    client: supabase,
  });
  return {
    body: buildRecapMessage(recapInput),
    dispatchKey: `recap:${tournamentId}`,
  };
}
