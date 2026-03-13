import { useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Crown, Sparkles, RotateCcw, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePro } from "@/contexts/ProContext";
import { toast } from "sonner";

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

  const handlePurchase = async () => {
    setPurchasing(true);
    try {
      const success = await completePurchase();
      if (success) {
        toast.success(t("proEnabled"));
        onOpenChange(false);
      } else {
        toast.error(t("error"));
      }
    } catch {
      toast.error(t("error"));
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
    } catch {
      toast.error(t("error"));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="rounded-2xl max-w-md relative">
        <AlertDialogCancel className="absolute right-3 top-3 border-0 shadow-none p-1 h-auto w-auto rounded-full hover:bg-muted">
          <X className="w-5 h-5 text-muted-foreground" />
        </AlertDialogCancel>
        <AlertDialogHeader>
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
              <Crown className="w-8 h-8 text-white" />
            </div>
          </div>
          <AlertDialogTitle className="text-xl text-center">
            {t("upgradeToPro")}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center text-foreground/80">
            {type === "project" ? t("proProjectLimit") : t("proDayLimit")}
          </AlertDialogDescription>
        </AlertDialogHeader>
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
          <p className="text-sm text-foreground/60 mt-3">
            {t("unlimitedDaysNew")}
          </p>
          <p className="text-sm text-foreground/60 mt-1">
            {t("luckyTravel")}
          </p>
        </div>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          {/* Purchase Button */}
          <Button
            onClick={handlePurchase}
            disabled={purchasing || restoring}
            className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl"
          >
            {purchasing ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Crown className="w-4 h-4 mr-2" />
            )}
            {t("upgradeToPro")}
          </Button>

          {/* Restore Purchases Button — REQUIRED for iOS review */}
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
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
