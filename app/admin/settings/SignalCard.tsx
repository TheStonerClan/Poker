export function SignalCard({
  configured,
  groupId,
}: {
  configured: boolean;
  groupId: string | null;
}) {
  return (
    <section className="rounded-lg border border-fg/10 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
          Signal · [PokerBot]
        </h2>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${
            configured
              ? "bg-success/15 text-success"
              : "bg-fg/10 text-fg/60"
          }`}
        >
          {configured ? "Connected" : "Not configured"}
        </span>
      </div>
      <p className="mt-2 text-sm text-fg/70">
        {configured
          ? "Bridge URL is set. Recap and reminder messages will go out when the cron is enabled — they'll fire against the next poker night below, honoring any one-off move."
          : "Run the signal-cli bridge on the Mac Mini and set SIGNAL_BRIDGE_URL + SIGNAL_BRIDGE_SECRET in Vercel."}
      </p>
      <dl className="mt-3 grid grid-cols-1 gap-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-fg/60">Group ID</dt>
          <dd className="truncate font-mono text-xs text-fg">
            {groupId ?? "—"}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-fg/50">
        Group ID and bridge secret live in environment variables for now (see
        Track H). A future release will surface editable fields here.
      </p>
    </section>
  );
}
