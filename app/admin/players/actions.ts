"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const PlayerSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Name is required.").max(80),
  signal_handle: z
    .string()
    .trim()
    .max(80)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  notes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
});

export type PlayerFormState = {
  status: "idle" | "ok" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
};

export async function upsertPlayer(
  _prev: PlayerFormState,
  formData: FormData,
): Promise<PlayerFormState> {
  await requireAdmin();
  const parsed = PlayerSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name") ?? "",
    signal_handle: formData.get("signal_handle") ?? "",
    notes: formData.get("notes") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString();
      if (key) fieldErrors[key] = issue.message;
    }
    return { status: "error", message: "Check the highlighted fields.", fieldErrors };
  }

  const supabase = await createClient();
  const data = parsed.data;

  if (data.id) {
    const { error } = await supabase
      .from("players")
      .update({
        name: data.name,
        signal_handle: data.signal_handle,
        notes: data.notes,
      })
      .eq("id", data.id);
    if (error) return { status: "error", message: error.message };
  } else {
    const { error } = await supabase.from("players").insert({
      name: data.name,
      signal_handle: data.signal_handle,
      notes: data.notes,
    });
    if (error) return { status: "error", message: error.message };
  }

  revalidatePath("/admin/players");
  return { status: "ok" };
}

export async function deletePlayer(id: string) {
  await requireAdmin();
  const validId = z.uuid().parse(id);
  const supabase = await createClient();
  const { error } = await supabase.from("players").delete().eq("id", validId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/players");
}
