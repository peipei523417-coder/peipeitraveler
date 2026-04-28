import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ExpiryWarningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  daysRemaining: number;
}

export function ExpiryWarningDialog({
  open,
  onOpenChange,
  daysRemaining,
}: ExpiryWarningDialogProps) {
  const { t } = useTranslation();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="rounded-2xl max-w-md">
        <AlertDialogHeader>
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-red-400 to-orange-500 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-white" />
            </div>
          </div>
          <AlertDialogTitle className="text-xl text-center">
            {t("expiryWarningTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center text-foreground/80 whitespace-pre-line">
            {t("expiryWarningDesc", { days: daysRemaining })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction className="w-full rounded-xl">
            {t("gotIt")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
