import { Skeleton } from "@/components/ui/skeleton";

interface PageSkeletonProps {
  variant?: "index" | "detail" | "share";
}

export function PageSkeleton({ variant = "index" }: PageSkeletonProps) {
  if (variant === "detail" || variant === "share") {
    return (
      <div className="min-h-screen bg-background">
        {/* Header skeleton */}
        <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-lg border-b border-border/50 shadow-sm">
          <div className="container max-w-4xl py-4">
            <div className="flex items-center gap-3">
              <Skeleton className="w-10 h-10 rounded-xl" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          </div>
        </header>

        {/* Day tabs skeleton */}
        <div className="border-b border-border/50 bg-background/50">
          <div className="container max-w-4xl py-3">
            <div className="flex gap-2 overflow-x-auto">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 w-20 rounded-lg flex-shrink-0" />
              ))}
            </div>
          </div>
        </div>

        {/* Content skeleton */}
        <main className="container max-w-4xl py-6 space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-4 rounded-xl border border-border/50 bg-card space-y-3">
              <div className="flex justify-between items-start">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-5 w-48" />
                </div>
                <Skeleton className="h-8 w-8 rounded-lg" />
              </div>
            </div>
          ))}
        </main>
      </div>
    );
  }

  // Index variant
  return (
    <div className="min-h-screen bg-background">
      {/* Header skeleton */}
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-lg border-b border-border/50">
        <div className="container max-w-4xl py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="w-10 h-10 rounded-full" />
              <Skeleton className="h-6 w-24" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-9 rounded-lg" />
              <Skeleton className="h-9 w-20 rounded-lg" />
            </div>
          </div>
        </div>
      </header>

      {/* Hero skeleton */}
      <div className="bg-gradient-to-b from-primary/5 to-background py-8">
        <div className="container max-w-4xl text-center space-y-4">
          <Skeleton className="h-8 w-48 mx-auto" />
          <Skeleton className="h-4 w-64 mx-auto" />
        </div>
      </div>

      {/* Projects skeleton */}
      <main className="container max-w-4xl py-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl border border-border/50 bg-card overflow-hidden">
              <Skeleton className="h-32 w-full" />
              <div className="p-4 space-y-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
