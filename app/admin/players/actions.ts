"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

// ─── Roster-spot sign-in (table-admin claim) ────────────────────────────

const SetPlayerLoginSchema = z.object({
  playerId: z.uuid(),
  email: z.email("Enter a valid email address.").transform((v) => v.trim()),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(72)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type SetPlayerLoginResult =
  | { ok: true; email: string }
  | { ok: false; error: string };

/**
 * Attach (or update) a Supabase auth user to a roster spot. Once
 * linked, that user can sign in and act as the table admin for
 * whichever table their player is seated at in a running tournament.
 *
 * Two flows:
 *   1. Roster spot is unlinked + auth user with this email already
 *      exists → link them. Optionally reset their password if one
 *      was provided in the form.
 *   2. Otherwise → create a new auth user with the given email +
 *      password (auto-confirmed so they can sign in immediately),
 *      then write `players.auth_user_id`.
 *
 * Idempotent on email: re-running with the same player + email is
 * a no-op aside from an optional password reset. If a DIFFERENT
 * roster spot already owns this email, we surface an error rather
 * than silently swap the link.
 */
export async function setPlayerLogin(input: {
  playerId: string;
  email: string;
  password?: string;
}): Promise<SetPlayerLoginResult> {
  try {
    await requireAdmin();
    const { playerId, email, password } = SetPlayerLoginSchema.parse(input);

    const supabase = await createClient();
    const admin = createAdminClient();

    const { data: player } = await supabase
      .from("players")
      .select("id, name, auth_user_id")
      .eq("id", playerId)
      .maybeSingle();
    if (!player) return { ok: false, error: "Player not found." };

    // Block linking the same email to a DIFFERENT roster spot.
    const { data: otherClaim } = await supabase
      .from("players")
      .select("id, name, auth_user_id")
      .neq("id", playerId)
      .not("auth_user_id", "is", null);
    // We don't have the email per linked spot in one read; pull the
    // auth user list and cross-reference. listUsers is paginated, but
    // for a home-game roster this is well under the default page size.
    const { data: list, error: listErr } =
      await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (listErr) {
      return { ok: false, error: listErr.message };
    }
    const existingByEmail = list.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );

    if (existingByEmail) {
      const conflict = (otherClaim ?? []).find(
        (p) => p.auth_user_id === existingByEmail.id,
      );
      if (conflict) {
        return {
          ok: false,
          error: `Email already linked to ${conflict.name}. Clear that link first.`,
        };
      }

      // Optionally reset the password on the existing user (lets the
      // admin re-issue a forgotten one in the same step).
      if (password) {
        const { error: updErr } = await admin.auth.admin.updateUserById(
          existingByEmail.id,
          { password, email_confirm: true },
        );
        if (updErr) return { ok: false, error: updErr.message };
      }

      const { error: linkErr } = await supabase
        .from("players")
        .update({ auth_user_id: existingByEmail.id })
        .eq("id", playerId);
      if (linkErr) return { ok: false, error: linkErr.message };

      revalidatePath("/admin/players");
      return { ok: true, email };
    }

    if (!password) {
      return {
        ok: false,
        error: "No user found with that email — set a password to create one.",
      };
    }

    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { player_id: playerId, player_name: player.name },
      });
    if (createErr || !created.user) {
      return { ok: false, error: createErr?.message ?? "Could not create user." };
    }

    const { error: linkErr } = await supabase
      .from("players")
      .update({ auth_user_id: created.user.id })
      .eq("id", playerId);
    if (linkErr) {
      // Roll back the auth user so we don't leave an orphaned account
      // dangling. Best-effort — log + continue surfacing the link
      // error to the caller.
      await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
      return { ok: false, error: linkErr.message };
    }

    revalidatePath("/admin/players");
    return { ok: true, email };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return {
        ok: false,
        error: err.issues[0]?.message ?? "Invalid input.",
      };
    }
    const message = err instanceof Error ? err.message : "Unknown error.";
    return { ok: false, error: message };
  }
}

/**
 * Detach the auth-user link from a roster spot. The auth user is
 * left intact (in case they're being moved to a different roster
 * spot, or just to preserve their history); only the `auth_user_id`
 * pointer is cleared. Once cleared, the user can still sign in but
 * has no table-admin powers.
 */
export async function clearPlayerLogin(input: {
  playerId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireAdmin();
    const playerId = z.uuid().parse(input.playerId);
    const supabase = await createClient();
    const { error } = await supabase
      .from("players")
      .update({ auth_user_id: null })
      .eq("id", playerId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/admin/players");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    return { ok: false, error: message };
  }
}

/**
 * Return the email currently linked to each roster spot, for display
 * on /admin/players. Service-role read against `auth.users` since
 * regular RLS doesn't expose other users' emails.
 */
export async function loadPlayerLogins(): Promise<
  Map<string, string>
> {
  await requireAdmin();
  const admin = createAdminClient();
  const supabase = await createClient();

  const { data: linked } = await supabase
    .from("players")
    .select("id, auth_user_id")
    .not("auth_user_id", "is", null);
  if (!linked || linked.length === 0) return new Map();

  const { data: list, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (error || !list) return new Map();

  const byId = new Map(list.users.map((u) => [u.id, u.email ?? ""]));
  const out = new Map<string, string>();
  for (const row of linked) {
    if (!row.auth_user_id) continue;
    const email = byId.get(row.auth_user_id);
    if (email) out.set(row.id, email);
  }
  return out;
}
