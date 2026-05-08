"use client";

import { useActionState } from "react";

import { updateTemplateBuyback } from "@/app/admin/templates/actions";
import type { TournamentTemplate } from "@/lib/admin/queries";

import { Field, Footer } from "./BasicsTab";

const INITIAL = { status: "idle" as const };

export function BuybackTab({ template }: { template: TournamentTemplate }) {
  const [state, action, pending] = useActionState(
    updateTemplateBuyback,
    INITIAL,
  );
  const cfg = template.buyback_config as {
    price?: number;
    rebuyChips?: number;
    rebuyAllowedThroughLevel?: number;
    addOnAtBreakLevel?: number;
    addOnChips?: number;
  };

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="templateId" value={template.id} />
      <p className="text-xs text-fg/60">
        Each player gets one buyback token. They can spend it as a rebuy
        (within the rebuy window) or as an add-on (at the break level).
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Buyback price"
          name="rebuy_price"
          type="number"
          inputMode="numeric"
          defaultValue={String(cfg.price ?? template.rebuy_price)}
          required
        />
        <Field
          label="Rebuy chips"
          name="rebuy_chips"
          type="number"
          inputMode="numeric"
          defaultValue={String(cfg.rebuyChips ?? template.rebuy_chips)}
          required
        />
        <Field
          label="Rebuy through level"
          name="rebuy_through_level"
          type="number"
          inputMode="numeric"
          defaultValue={String(cfg.rebuyAllowedThroughLevel ?? 0)}
          required
        />
        <Field
          label="Add-on break level"
          name="addon_break_level"
          type="number"
          inputMode="numeric"
          defaultValue={String(cfg.addOnAtBreakLevel ?? 0)}
          required
        />
        <Field
          label="Add-on chips"
          name="addon_chips"
          type="number"
          inputMode="numeric"
          defaultValue={String(cfg.addOnChips ?? 0)}
          required
        />
      </div>

      <Footer state={state} pending={pending} label="Save buyback" />
    </form>
  );
}
