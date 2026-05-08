import Link from "next/link";

export function TopBar({
  title,
  subtitle,
  back,
  action,
}: {
  title: string;
  subtitle?: string;
  back?: { href: string; label?: string };
  action?: React.ReactNode;
}) {
  return (
    <header
      className="sticky top-0 z-20 flex items-center gap-3 border-b border-fg/10 bg-bg/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-bg/80"
      style={{ paddingTop: "max(env(safe-area-inset-top, 0), 12px)" }}
    >
      {back ? (
        <Link
          href={back.href}
          className="-ml-2 flex h-11 min-h-[44px] w-11 items-center justify-center rounded-full text-fg/70 hover:text-fg"
          aria-label={back.label ?? "Back"}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M14.7 6.3a1 1 0 0 1 0 1.4L10.4 12l4.3 4.3a1 1 0 1 1-1.4 1.4l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 0 1 1.4 0" />
          </svg>
        </Link>
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold leading-tight text-fg">{title}</h1>
        {subtitle ? (
          <p className="truncate text-xs text-fg/60">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </header>
  );
}
