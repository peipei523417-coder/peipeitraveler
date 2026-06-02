import { useForceUpdate } from "@/hooks/useForceUpdate";
import { Button } from "@/components/ui/button";
import { Plane } from "lucide-react";

/**
 * Full-screen, non-dismissible force-update gate.
 * Renders nothing while loading or when an update is not required.
 * Fail-open: any error in the hook resolves to `required: false`.
 */
export function ForceUpdateGate({ children }: { children: React.ReactNode }) {
  const { required, loading, storeUrl, message } = useForceUpdate();

  if (loading || !required) return <>{children}</>;

  const openStore = async () => {
    if (!storeUrl) return;
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: storeUrl, presentationStyle: "fullscreen" });
    } catch {
      window.location.href = storeUrl;
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] bg-background flex flex-col items-center justify-center px-8 text-center"
      role="dialog"
      aria-modal="true"
    >
      <Plane className="w-16 h-16 text-primary mb-6" />
      <h1 className="text-2xl font-bold text-foreground mb-3">
        請更新到最新版本
      </h1>
      <p className="text-base text-muted-foreground mb-8 max-w-md whitespace-pre-line">
        {message || "目前版本需要更新，請更新至最新版後繼續使用。"}
      </p>
      <Button size="lg" className="rounded-xl w-full max-w-xs" onClick={openStore}>
        立即更新
      </Button>
    </div>
  );
}
