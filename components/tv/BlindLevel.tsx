import { formatBlinds } from "@/lib/tv/format";
import { formatLevelLabel } from "@/lib/tv/levels";
import type { BlindLevelEntry } from "@/lib/tv/types";

type Props = {
  level: BlindLevelEntry | null;
  /** Full level list — needed to derive "L4" / "B2" from `level.level_num`. */
  levels: BlindLevelEntry[];
  align?: "left" | "right";
};

export default function BlindLevel({ level, levels, align = "right" }: Props) {
  const alignClass = align === "right" ? "text-right items-end" : "text-left items-start";
  return (
    <div className={`flex flex-col ${alignClass}`}>
      <span className="text-gold uppercase tracking-[0.3em] text-sm font-semibold">
        Current blinds
      </span>
      <span className="font-mono text-value text-4xl tabular-nums mt-1">
        {level && !level.is_break
          ? formatBlinds(level.small, level.big, level.ante)
          : level?.is_break
            ? "BREAK"
            : "—"}
      </span>
      <span className="text-fg/50 uppercase tracking-[0.25em] text-[10px] mt-1">
        {level ? formatLevelLabel(levels, level.level_num) : "—"}
      </span>
    </div>
  );
}
