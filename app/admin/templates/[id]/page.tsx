import Link from "next/link";
import { notFound } from "next/navigation";

import { TopBar } from "@/components/admin/TopBar";
import {
  blindLevels,
  getBlindStructure,
  getTemplate,
} from "@/lib/admin/queries";

import { BasicsTab } from "./_tabs/BasicsTab";
import { BuybackTab } from "./_tabs/BuybackTab";
import { BlindsTab } from "./_tabs/BlindsTab";
import { PrizesTab } from "./_tabs/PrizesTab";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "basics", label: "Basics" },
  { id: "buyback", label: "Buyback" },
  { id: "blinds", label: "Blinds" },
  { id: "prizes", label: "Prizes" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function isTab(value: string | undefined): value is TabId {
  return TABS.some((t) => t.id === value);
}

export default async function TemplateEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const active: TabId = isTab(tab) ? tab : "basics";

  const template = await getTemplate(id);
  if (!template) notFound();
  const structure = await getBlindStructure(template.blind_structure_id);
  if (!structure) notFound();

  return (
    <>
      <TopBar
        title={template.name}
        subtitle="Edit template"
        back={{ href: "/admin/templates" }}
      />
      <nav
        aria-label="Template tabs"
        className="sticky top-[57px] z-10 flex gap-1 overflow-x-auto border-b border-fg/10 bg-bg/95 px-2 py-1 backdrop-blur supports-[backdrop-filter]:bg-bg/80"
      >
        {TABS.map((t) => {
          const isActive = t.id === active;
          return (
            <Link
              key={t.id}
              href={`/admin/templates/${template.id}?tab=${t.id}`}
              scroll={false}
              className={`flex h-11 min-h-[44px] items-center rounded-md px-4 text-xs font-semibold uppercase tracking-wider transition-colors ${
                isActive
                  ? "bg-gold/15 text-gold"
                  : "text-fg/60 hover:text-fg"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      <main className="flex flex-1 flex-col gap-4 px-4 py-4">
        {active === "basics" ? <BasicsTab template={template} /> : null}
        {active === "buyback" ? <BuybackTab template={template} /> : null}
        {active === "blinds" ? (
          <BlindsTab
            structureId={structure.id}
            levels={blindLevels(structure.levels)}
          />
        ) : null}
        {active === "prizes" ? <PrizesTab template={template} /> : null}
      </main>
    </>
  );
}
