import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Crown, Sparkles, RotateCcw, Loader2, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePro } from "@/contexts/ProContext";
import { toast } from "sonner";
import { getProPackage, PURCHASE_CANCELLED, collectBillingDiagnostics } from "@/services/billingService";

interface UpgradeProDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: "project" | "day";
}

export function UpgradeProDialog({ open, onOpenChange, type }: UpgradeProDialogProps) {
  const { t } = useTranslation();
  const { completePurchase, restorePurchases } = usePro();
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [productLoading, setProductLoading] = useState(false);
  const [productPrice, setProductPrice] = useState<string | null>(null);
  const [productError, setProductError] = useState<string | null>(null);
  const [purchaseDiagnostic, setPurchaseDiagnostic] = useState<string | null>(null);

  // Load product info from RevenueCat when dialog opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setProductLoading(true);
    setProductError(null);
    setProductPrice(null);
    getProPackage()
      .then((pkg) => {
        if (cancelled) return;
        if (!pkg) {
          setProductError("找不到商品 pro_function，請確認 App Store Connect / Google Play Console 與 RevenueCat 設定一致");
        } else {
          setProductPrice(pkg.product?.priceString ?? null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setProductError(err?.message || "載入商品失敗");
      })
      .finally(() => {
        if (!cancelled) setProductLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handlePurchase = async () => {
    setPurchasing(true);
    setPurchaseDiagnostic(null);
    try {
      const success = await completePurchase();
      if (success) {
        toast.success(t("proEnabled"));
        onOpenChange(false);
      } else {
        const diag = await collectBillingDiagnostics();
        const detail = `購買未完成（沒有取得 entitlement="pro"）\n\n[診斷]\n${diag}`;
        setPurchaseDiagnostic(detail);
        toast.error("購買未完成 — 請查看下方診斷資訊", { duration: 8000 });
      }
    } catch (err: any) {
      if (err?.code === PURCHASE_CANCELLED) {
        toast.info("已取消購買");
      } else {
        const msg = err?.message || String(err) || t("error");
        console.error("[UpgradeProDialog] purchase error:", err);
        const diag = await collectBillingDiagnostics().catch(() => "(diagnostics unavailable)");
        setPurchaseDiagnostic(
          `❌ ${msg}\n\ncode: ${err?.code ?? "(none)"}\n\n[診斷]\n${diag}`
        );
        toast.error(msg, { duration: 10000 });
      }
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      const restored = await restorePurchases();
      if (restored) {
        toast.success(t("proEnabled"));
        onOpenChange(false);
      } else {
        toast.info(t("noRestorablepurchases") || "No purchases to restore");
      }
    } catch (err: any) {
      const msg = err?.message || String(err) || t("error");
      console.error("[UpgradeProDialog] restore error:", err);
      toast.error(msg, { duration: 8000 });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
              <Crown className="w-8 h-8 text-white" />
            </div>
          </div>
          <DialogTitle className="text-xl text-center">
            {t("upgradeToPro")}
          </DialogTitle>
          <DialogDescription className="text-center text-foreground/80">
            {type === "project" ? t("proProjectLimit") : t("proDayLimit")}
          </DialogDescription>
        </DialogHeader>
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-4 my-4">
          <h4 className="font-bold text-foreground flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-amber-500" />
            {t("proFeatures")}
          </h4>
          <ul className="space-y-2 text-sm text-foreground/80">
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              {t("unlimitedProjects")}
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              {t("unlimitedDays")}
            </li>
          </ul>
          <p className="text-sm text-foreground/60 mt-3 whitespace-pre-line">
            {t("unlimitedDaysNew")}
          </p>
          <p className="text-sm text-foreground/60 mt-1">
            {t("luckyTravel")}
          </p>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {productLoading && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              載入商品中…
            </div>
          )}
          {productError && (
            <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-lg p-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span className="break-words">{productError}</span>
            </div>
          )}
          {purchaseDiagnostic && (
            <div className="text-xs bg-destructive/10 text-destructive rounded-lg p-2 max-h-64 overflow-auto">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold">購買診斷</span>
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    try { navigator.clipboard?.writeText(purchaseDiagnostic); toast.success("已複製"); } catch {}
                  }}
                >複製</button>
              </div>
              <pre className="whitespace-pre-wrap break-all font-mono text-[10px] leading-snug">{purchaseDiagnostic}</pre>
            </div>
          )}
          {!productLoading && !productError && productPrice && (
            <div className="text-center text-sm text-muted-foreground">
              價格：<span className="font-semibold text-foreground">{productPrice}</span>
            </div>
          )}
          <Button
            onClick={handlePurchase}
            disabled={purchasing || restoring || productLoading || !!productError}
            className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl"
          >
            {purchasing ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Crown className="w-4 h-4 mr-2" />
            )}
            {t("upgradeToPro")}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleRestore}
            disabled={purchasing || restoring}
            className="w-full text-muted-foreground hover:text-foreground"
          >
            {restoring ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
            ) : (
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            )}
            {t("restorePurchases") || "Restore Purchases"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
