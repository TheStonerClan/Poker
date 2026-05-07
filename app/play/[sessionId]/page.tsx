type PlayPageProps = {
  params: Promise<{ sessionId: string }>;
};

export default async function PlayPage({ params }: PlayPageProps) {
  const { sessionId } = await params;
  return (
    <main className="flex flex-1 items-center justify-center">
      <p className="text-label uppercase tracking-widest text-sm">
        TODO: /play/{sessionId} (player session view)
      </p>
    </main>
  );
}
