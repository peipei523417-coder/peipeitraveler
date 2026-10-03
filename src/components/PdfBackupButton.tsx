import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PdfBackupButtonProps {
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  exporting?: boolean;
  className?: string;
}

/** Entry point for the existing PDF export, presented as a "backup" action. */
export function PdfBackupButton({ onClick, disabled, exporting, className }: PdfBackupButtonProps) {
  const { t } = useTranslation();
  return (
    <Button
      onClick={onClick}
      disabled={disabled}
      variant="outline"
      className={cn("h-auto min-h-[44px] rounded-xl px-4 py-2 flex-col gap-0.5 touch-manipulation", className)}
    >
      <span className="inline-flex items-center gap-1.5 text-xs font-bold">
        <Download className="w-4 h-4 flex-shrink-0" />
        {exporting ? t("exportingPdf") : t("exportPdf")}
      </span>
      <span className="text-[10px] font-normal text-muted-foreground leading-tight">
        {t("exportPdfHint")}
      </span>
    </Button>
  );
}
