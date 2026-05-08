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
    href: "/admin",
    label: "Home",
    match: (p) => p === "/admin",
    icon: <Icon path="M3 11.5L12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  },
  {
    href: "/admin/tournaments",
    label: "Tournament",
    match: (p) => p.startsWith("/admin/tournaments"),
    icon: <Icon path="M5 4h14l-1 6a5 5 0 0 1-12 0zM10 16h4v3h2v2H8v-2h2z" />,
  },
  {
    href: "/admin/players",
    label: "Players",
    match: (p) => p.startsWith("/admin/players"),
    icon: <Icon path="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4m0 2c-3.3 0-8 1.6-8 5v3h16v-3c0-3.4-4.7-5-8-5" />,
  },
  {
    href: "/admin/history",
    label: "History",
    match: (p) => p.startsWith("/admin/history"),
    icon: <Icon path="M13 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7v3l4-4-4-4zm-1 5v6l5 3 1-1.7-4-2.3V8z" />,
  },
  {
    href: "/admin/settings",
    label: "Settings",
    match: (p) => p.startsWith("/admin/settings"),
    icon: <Icon path="M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-1.7-1L15 3H9l-.3 2.7a7.5 7.5 0 0 0-1.7 1l-2.4-1-2 3.4L4.6 11a7.5 7.5 0 0 0 0 2L2.6 14.6l2 3.4 2.4-1a7.5 7.5 0 0 0 1.7 1L9 21h6l.3-3a7.5 7.5 0 0 0 1.7-1l2.4 1 2-3.4zM12 15a3 3 0 1 1 3-3 3 3 0 0 1-3 3" />,
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

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Admin navigation"
      className="sticky bottom-0 z-30 grid grid-cols-5 border-t border-fg/10 bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/80"
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
              active ? "text-gold" : "text-fg/60 hover:text-fg"
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
