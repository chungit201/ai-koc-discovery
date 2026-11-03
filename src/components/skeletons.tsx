/**
 * Route-specific loading shells. Each mirrors its page's real layout (container, grid, card sizes)
 * so nothing jumps when the request-time data streams in.
 */
// Default radius only when the caller didn't pick one (two rounded-* classes would fight by CSS order)
const Box = ({ className = "" }: { className?: string }) => (
  <div className={`bg-zinc-200/70 ${/rounded-/.test(className) ? "" : "rounded-md"} ${className}`} />
);
const Shell = ({ children, wide }: { children: React.ReactNode; wide?: boolean }) => (
  <main className={`mx-auto w-full ${wide ? "max-w-[1760px]" : "max-w-[1440px]"} animate-pulse px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8 xl:px-10`} aria-busy="true" aria-label="Đang tải">
    {children}
  </main>
);

// ── /kocs ────────────────────────────────────────────────────────────────────
export function KocsSkeleton() {
  return (
    <Shell wide>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Box className="h-8 w-48" />
          <Box className="h-4 w-80" />
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Box className="h-10 w-64 rounded-xl" />
          <Box className="h-10 w-32 rounded-xl" />
          <Box className="h-10 w-32 rounded-xl" />
          <Box className="h-10 w-40 rounded-xl" />
          <Box className="h-10 w-40 rounded-xl" />
          <Box className="h-10 w-72 rounded-xl" />
        </div>
      </div>
      <div className="card mt-6 overflow-hidden">
        <div className="flex justify-between px-6 pb-3 pt-5">
          <Box className="h-5 w-56" />
          <Box className="h-4 w-40" />
        </div>
        <div className="px-3">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-center gap-6 border-b border-line/70 px-3 py-3.5 last:border-0">
              <Box className="h-4 w-5" />
              <div className="flex w-64 items-center gap-3">
                <Box className="h-9 w-9 rounded-[22%]" />
                <div className="flex-1 space-y-1.5">
                  <Box className="h-3.5 w-36" />
                  <Box className="h-3 w-24" />
                </div>
              </div>
              <Box className="h-4 w-20" />
              <Box className="h-4 w-12" />
              <Box className="h-4 w-14" />
              <Box className="hidden h-6 w-24 lg:block" />
              <Box className="h-4 w-14" />
              <Box className="hidden h-6 w-24 lg:block" />
              <Box className="h-4 w-16" />
              <Box className="h-5 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

// ── /kocs/[id] ───────────────────────────────────────────────────────────────
export function KocDetailSkeleton() {
  return (
    <Shell>
      <Box className="h-3.5 w-48" />
      <section className="card mt-4 overflow-hidden">
        <div className="grid grid-cols-1 gap-5 p-4 sm:p-6 lg:grid-cols-[1fr_300px]">
          <div className="flex items-center gap-4">
            <Box className="h-[92px] w-[92px] rounded-[22%]" />
            <div className="space-y-2">
              <Box className="h-7 w-64" />
              <Box className="h-4 w-32" />
              <Box className="h-3.5 w-80" />
            </div>
          </div>
          <div className="space-y-2 rounded-xl bg-slate-50 p-4 ring-1 ring-line">
            <Box className="h-3.5 w-28" />
            <Box className="h-3 w-full" />
            <Box className="mt-3 h-9 w-full rounded-lg" />
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-line sm:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-6 py-4">
              <Box className="h-9 w-9 rounded-xl" />
              <div className="space-y-1.5">
                <Box className="h-3 w-20" />
                <Box className="h-4 w-14" />
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="card mt-4 p-5">
        <Box className="h-5 w-40" />
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="card space-y-3 px-5 py-4">
              <Box className="h-3.5 w-24" />
              <Box className="h-7 w-20" />
            </div>
          ))}
        </div>
        <Box className="mt-5 h-[260px] w-full rounded-xl" />
      </section>
      <section className="card mt-4 p-5">
        <Box className="h-5 w-44" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-line py-3 last:border-0">
            <Box className="h-[72px] w-[54px] rounded-lg" />
            <div className="flex-1 space-y-2">
              <Box className="h-3.5 w-2/3" />
              <Box className="h-3 w-40" />
            </div>
            <Box className="h-4 w-16" />
            <Box className="h-4 w-12" />
          </div>
        ))}
      </section>
    </Shell>
  );
}
