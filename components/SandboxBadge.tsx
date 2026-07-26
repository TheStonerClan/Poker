/**
 * Visual marker for anything backed by a sandbox (`is_sandbox = true`)
 * tournament. Deliberately a different hue from the app's gold accent so
 * it can't be mistaken for a normal in-progress state at a glance.
 */
export function SandboxBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-orange-500/50 bg-orange-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-orange-400 ${className}`}
    >
      Sandbox
    </span>
  );
}
