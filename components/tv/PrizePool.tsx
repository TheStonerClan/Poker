import { formatMoney } from "@/lib/tv/format";
import { ordinal, type PayoutLine } from "@/lib/tv/prize";

type Props = {
  totalPool: number;
  payouts: PayoutLine[];
};

export default function PrizePool({ totalPool, payouts }: Props) {
  return (
    <div className="flex flex-col items-end text-right">
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
    </div>
  );
}
