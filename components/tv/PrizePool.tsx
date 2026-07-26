import { formatMoney } from "@/lib/tv/format";
import { ordinal, type PayoutLine } from "@/lib/tv/prize";

type Bounty = {
  amount: number;
  targetName: string | null;
  collectedByName: string | null;
};

type Props = {
  totalPool: number;
  payouts: PayoutLine[];
  bounty?: Bounty | null;
};

export default function PrizePool({ totalPool, payouts, bounty }: Props) {
  return (
    <div className="flex flex-col items-end text-right w-full">
      <span className="text-label uppercase tracking-[0.3em] text-sm">
        Total Prize Pool
      </span>
      <span className="font-mono text-value text-5xl tabular-nums mt-1">
        {formatMoney(totalPool)}
      </span>
      <ul className="mt-4 w-full max-w-[18rem] space-y-1">
        {payouts.map((p) => (
          <li key={p.position} className="flex items-baseline">
            <span className="text-label text-sm uppercase tracking-wider whitespace-nowrap">
              {ordinal(p.position)}
            </span>
            <span
              aria-hidden
              className="mx-2 flex-1 border-b border-dotted border-gold/40 translate-y-[-3px]"
            />
            <span className="font-mono text-value tabular-nums">
              {formatMoney(p.amount)}
            </span>
          </li>
        ))}
      </ul>
      {bounty && bounty.targetName ? (
        <div className="mt-3 rounded-md border border-gold/50 px-3 py-1.5 w-full max-w-[18rem]">
          {bounty.collectedByName ? (
            <p className="text-[clamp(0.7rem,0.9vw,0.85rem)]">
              <span className="text-gold-bright">
                {formatMoney(bounty.amount)} bounty
              </span>{" "}
              won by{" "}
              <span className="text-value">{bounty.collectedByName}</span>
            </p>
          ) : (
            <p className="text-[clamp(0.7rem,0.9vw,0.85rem)]">
              <span className="text-gold-bright">
                {formatMoney(bounty.amount)} bounty
              </span>{" "}
              on <span className="text-value">{bounty.targetName}</span>
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
