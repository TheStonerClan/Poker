import { formatBlinds } from "@/lib/tv/format";
import type { BlindLevelEntry } from "@/lib/tv/types";

type Props = {
  level: BlindLevelEntry | null;
  align?: "left" | "right";
};

export default function BlindLevel({ level, align = "right" }: Props) {
  const alignClass = align === "right" ? "text-right items-end" : "text-left items-start";
  return (
    <div className={`flex flex-col ${alignClass}`}>
      <span className="text-label uppercase tracking-[0.3em] text-sm">
        Level {level?.level_num ?? "—"}
      </span>
      <span className="font-mono text-value text-4xl tabular-nums mt-1">
        {level && !level.is_break
          ? formatBlinds(level.small, level.big, level.ante)
          : level?.is_break
            ? "BREAK"
            : "—"}
      </span>
    </div>
  );
}
