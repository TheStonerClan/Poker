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
    rebuysPerPlayer?: number;
    addOnsPerPlayer?: number;
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
        Rebuy and add-on are independent budgets — a player can use both.
        Each defaults to 1 per player.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Rebuys per player"
          name="rebuys_per_player"
          type="number"
          inputMode="numeric"
          min="1"
          max="5"
          defaultValue={String(cfg.rebuysPerPlayer ?? 1)}
          required
        />
        <Field
          label="Add-ons per player"
          name="addons_per_player"
          type="number"
          inputMode="numeric"
          min="1"
          max="5"
          defaultValue={String(cfg.addOnsPerPlayer ?? 1)}
          required
        />
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
