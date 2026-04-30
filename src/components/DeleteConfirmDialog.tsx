import { useTranslation } from "react-i18next";
import { TravelProject } from "@/types/travel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2, LogOut } from "lucide-react";

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: TravelProject | null;
  onConfirm: () => void;
  /** When true, this dialog is for a non-owner leaving a shared project (no real delete). */
  leaveMode?: boolean;
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  project,
  onConfirm,
  leaveMode = false,
}: DeleteConfirmDialogProps) {
  const { t } = useTranslation();

  const Icon = leaveMode ? LogOut : Trash2;
  const title = leaveMode ? t("leaveSharedTitle") : t("deleteConfirmTitle");
  const description = leaveMode ? t("leaveSharedDescription") : t("deleteConfirmDescription");
  const actionLabel = leaveMode ? t("leaveShared") : t("delete");

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="rounded-2xl">
        <AlertDialogHeader>
          <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-2">
            <Icon className="w-6 h-6 text-destructive" />
          </div>
          <AlertDialogTitle className="text-center">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            {description} - "{project?.name}"
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel className="rounded-xl">{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
