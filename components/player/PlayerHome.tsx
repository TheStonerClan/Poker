"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { usePlayerClaim } from "@/lib/presence";

import { BustTab } from "./BustTab";
import { ColorUpTab } from "./ColorUpTab";
import { StatsTab } from "./StatsTab";
import { TabBar, type TabKey } from "./TabBar";

export type PlayerHomeProps = {
  sessionId: string;
  tournamentName: string;
  tournamentFinishedAt: string | null;
  player: {
    playerId: string;
    name: string;
    slug: string;
    currentChips: number;
    bustedAtTime: string | null;
    bustedAtLevel: number | null;
    finishingPosition: number | null;
    payoutAmount: number | null;
    buybackUsed: boolean;
    buybackUsedAs: string | null;
  };
  stats: {
    bigBlind: number | null;
    smallBlind: number | null;
    ante: number | null;
    currentLevelNum: number;
    isBreak: boolean;
    activeCount: number;
    myActiveRank: number | null;
    positionIfBust: number | null;
    payoutIfBust: number;
    prizePool: number;
  };
  colorUp: {
    chipDenominations: Array<{ color: string; value: number }>;
    currentColorUp: number[];
  };
};

export function PlayerHome(props: PlayerHomeProps) {
  const router = useRouter();
  const { sessionId, player, tournamentFinishedAt } = props;

  const [tab, setTab] = useState<TabKey>("stats");
  const [optimisticBusted, setOptimisticBusted] = useState<boolean>(
    Boolean(player.bustedAtTime),
  );
  const { status } = usePlayerClaim(sessionId, player.playerId);

  // If presence reports another tab beat us to this name, bounce back to the
  // picker so the human can re-pick (or pick someone else).
  useEffect(() => {
    if (status === "lost") {
      router.replace(`/play/${sessionId}`);
    }
  }, [status, router, sessionId]);

  const tournamentOver = Boolean(tournamentFinishedAt);
  const showAdminLockedTabs = !tournamentOver && !optimisticBusted;

  return (
    <main className="flex flex-1 flex-col">
      <header className="px-5 pb-4 pt-6">
        <p className="text-label text-xs uppercase tracking-widest">
          {props.tournamentName}
        </p>
        <h1 className="mt-1 text-3xl font-semibold">{player.name}</h1>
        <ClaimBadge status={status} />
      </header>

      <div className="flex-1 px-5 pb-32">
        {tab === "stats" && (
          <StatsTab
            player={player}
            stats={props.stats}
            optimisticBusted={optimisticBusted}
          />
        )}
        {tab === "color-up" && showAdminLockedTabs && (
          <ColorUpTab
            sessionId={sessionId}
            playerId={player.playerId}
            chipDenominations={props.colorUp.chipDenominations}
            currentColorUp={props.colorUp.currentColorUp}
            isBreak={props.stats.isBreak}
            currentLevelNum={props.stats.currentLevelNum}
            currentChips={player.currentChips}
          />
        )}
        {tab === "bust" && showAdminLockedTabs && (
          <BustTab
            sessionId={sessionId}
            playerId={player.playerId}
            playerName={player.name}
            onBusted={() => {
              setOptimisticBusted(true);
              setTab("stats");
              router.refresh();
            }}
          />
        )}
        {(tab === "color-up" || tab === "bust") && !showAdminLockedTabs && (
          <BustedOrFinishedNotice
            tournamentOver={tournamentOver}
            busted={optimisticBusted}
          />
        )}
      </div>

      <TabBar
        active={tab}
        onChange={setTab}
        disableActions={!showAdminLockedTabs}
      />
    </main>
  );
}

function ClaimBadge({
  status,
}: {
  status: ReturnType<typeof usePlayerClaim>["status"];
}) {
  const map: Record<typeof status, { label: string; tone: string }> = {
    idle: { label: "Connecting…", tone: "text-fg/40" },
    claimed: { label: "Seat held", tone: "text-success" },
    lost: { label: "Seat lost", tone: "text-danger" },
    error: { label: "Connection error", tone: "text-danger" },
  };
  const { label, tone } = map[status];
  return (
    <p className={`mt-2 text-xs uppercase tracking-widest ${tone}`}>{label}</p>
  );
}

function BustedOrFinishedNotice({
  busted,
  tournamentOver,
}: {
  busted: boolean;
  tournamentOver: boolean;
}) {
  return (
    <div className="rounded-2xl border border-fg/10 bg-bg/40 p-5 text-center text-fg/70">
      {tournamentOver
        ? "The tournament is finished."
        : busted
          ? "You're out. See the admin if you want to use a buyback."
          : "Action unavailable."}
    </div>
  );
}
