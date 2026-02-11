import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Crown, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

interface UpgradeProDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: "project" | "day";
}

export function UpgradeProDialog({ open, onOpenChange, type }: UpgradeProDialogProps) {
  const { t } = useTranslation();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="rounded-2xl max-w-md">
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
              {t("unlimitedDaysNew")}
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              {t("luckyTravel")}
            </li>
          </ul>
        </div>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogAction
            onClick={() => onOpenChange(false)}
            className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl"
          >
            {t("gotIt")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
