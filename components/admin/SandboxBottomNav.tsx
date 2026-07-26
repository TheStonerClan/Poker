"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  match: (pathname: string) => boolean;
  icon: React.ReactNode;
};

const ITEMS: NavItem[] = [
  {
    href: "/sandboxadmin",
    label: "Home",
    match: (p) => p === "/sandboxadmin",
    icon: <Icon path="M3 11.5L12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  },
  {
    href: "/sandboxadmin/tournaments",
    label: "Tournament",
    match: (p) =>
      p.startsWith("/sandboxadmin/tournaments") ||
      p.startsWith("/admin/tournaments"),
    icon: <Icon path="M5 4h14l-1 6a5 5 0 0 1-12 0zM10 16h4v3h2v2H8v-2h2z" />,
  },
  {
    href: "/sandboxadmin/history",
    label: "History",
    match: (p) => p.startsWith("/sandboxadmin/history"),
    icon: <Icon path="M13 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7v3l4-4-4-4zm-1 5v6l5 3 1-1.7-4-2.3V8z" />,
  },
  {
    href: "/admin",
    label: "Exit sandbox",
    match: () => false,
    icon: <Icon path="M10 17l5-5-5-5v3H3v4h7zM20 3h-8v2h8v14h-8v2h8a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2" />,
  },
];

function Icon({ path }: { path: string }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d={path} />
    </svg>
  );
}

export function SandboxBottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Sandbox admin navigation"
      className="sticky bottom-0 z-30 grid grid-cols-4 border-t border-orange-500/25 bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/80"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0)" }}
    >
      {ITEMS.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch
            className={`flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium tracking-wide transition-colors ${
              active ? "text-orange-400" : "text-fg/60 hover:text-fg"
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
