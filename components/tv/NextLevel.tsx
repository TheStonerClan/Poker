import { formatBlinds } from "@/lib/tv/format";
import { formatLevelLabel } from "@/lib/tv/levels";
import type { BlindLevelEntry } from "@/lib/tv/types";

type Props = {
  next: BlindLevelEntry | null;
  /** Full level list — used to render "B2" for an upcoming break. */
  levels: BlindLevelEntry[];
};

export default function NextLevel({ next, levels }: Props) {
  return (
    <div className="flex flex-col items-end text-right">
      <span className="text-label uppercase tracking-[0.25em] text-xs">
        Next Level
      </span>
      <span className="font-mono text-value text-2xl tabular-nums mt-1">
        {next && !next.is_break
          ? formatBlinds(next.small, next.big, next.ante)
          : next?.is_break
            ? formatLevelLabel(levels, next.level_num)
            : "—"}
      </span>
    </div>
  );
}
