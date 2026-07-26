import TvPageBody from "@/components/tv/TvPageBody";

// The TV display reads live state (active tournament, headers for the QR
// origin); never prerender it at build time.
export const dynamic = "force-dynamic";

export default async function SandboxTvPage() {
  return <TvPageBody isSandbox={true} />;
}
