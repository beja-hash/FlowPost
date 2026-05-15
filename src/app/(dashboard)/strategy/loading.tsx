import { Card, CardContent, CardHeader } from "@/components/ui/card";

function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-muted/35 ${className}`} />;
}

export default function StrategyLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-8">
      <header className="flex flex-col gap-3">
        <SkeletonBlock className="h-4 w-36" />
        <SkeletonBlock className="h-11 w-80" />
        <SkeletonBlock className="h-6 max-w-2xl" />
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(360px,0.55fr)]">
        <Card className="rounded-[2rem] border-border/35 bg-card/70">
          <CardHeader>
            <SkeletonBlock className="h-8 w-56" />
          </CardHeader>
          <CardContent className="grid gap-5">
            <SkeletonBlock className="h-12" />
            <div className="grid gap-4 md:grid-cols-2">
              <SkeletonBlock className="h-24" />
              <SkeletonBlock className="h-24" />
            </div>
            <SkeletonBlock className="h-44" />
            <SkeletonBlock className="h-32" />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="rounded-[2rem] border-border/35 bg-card/70">
            <CardContent className="grid gap-3 p-6">
              <SkeletonBlock className="h-6 w-40" />
              <div className="grid grid-cols-2 gap-3">
                <SkeletonBlock className="h-24" />
                <SkeletonBlock className="h-24" />
                <SkeletonBlock className="h-24" />
                <SkeletonBlock className="h-24" />
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-[2rem] border-border/35 bg-card/70">
            <CardContent className="grid gap-3 p-6">
              <SkeletonBlock className="h-6 w-44" />
              <SkeletonBlock className="h-20" />
              <SkeletonBlock className="h-20" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
