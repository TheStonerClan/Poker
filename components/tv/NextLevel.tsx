import { formatBlinds } from "@/lib/tv/format";
import type { BlindLevelEntry } from "@/lib/tv/types";

type Props = { next: BlindLevelEntry | null };

export default function NextLevel({ next }: Props) {
  return (
    <div className="flex flex-col items-end text-right">
      <span className="text-label uppercase tracking-[0.25em] text-xs">
        Next Level
      </span>
      <span className="font-mono text-value text-2xl tabular-nums mt-1">
        {next && !next.is_break
          ? formatBlinds(next.small, next.big, next.ante)
          : next?.is_break
            ? "Break"
            : "—"}
      </span>
    </div>
  );
}
