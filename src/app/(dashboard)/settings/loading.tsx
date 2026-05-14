export default function SettingsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1180px] animate-pulse flex-col gap-8 pb-10">
      <div className="flex flex-col gap-5 pt-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-3">
          <div className="h-4 w-36 rounded-full bg-muted" />
          <div className="h-10 w-80 max-w-full rounded-2xl bg-muted" />
        </div>
        <div className="h-12 w-full rounded-2xl bg-muted sm:w-96" />
      </div>
      <div className="rounded-[2rem] border border-border/25 bg-card/58 p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-5">
            <div className="size-20 rounded-full bg-muted" />
            <div className="space-y-3">
              <div className="h-8 w-56 rounded-xl bg-muted" />
              <div className="h-4 w-72 rounded-full bg-muted" />
            </div>
          </div>
          <div className="h-10 w-60 rounded-xl bg-muted" />
        </div>
        <div className="mt-8 grid gap-6 border-y border-border/25 py-7 md:grid-cols-3">
          <div className="h-16 rounded-2xl bg-muted" />
          <div className="h-16 rounded-2xl bg-muted" />
          <div className="h-16 rounded-2xl bg-muted" />
        </div>
        <div className="mt-8 h-24 rounded-2xl bg-muted" />
      </div>
    </div>
  );
}
