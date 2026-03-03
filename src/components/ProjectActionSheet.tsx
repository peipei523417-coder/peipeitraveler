import { useTranslation } from "react-i18next";
import { TravelProject } from "@/types/travel";
import { Share2, Copy, Pencil, Trash2 } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";

interface ProjectActionSheetProps {
  project: TravelProject | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShare: (project: TravelProject) => void;
  onDuplicate: (project: TravelProject) => void;
  onEdit: (project: TravelProject) => void;
  onDelete: (project: TravelProject) => void;
}

export function ProjectActionSheet({
  project,
  open,
  onOpenChange,
  onShare,
  onDuplicate,
  onEdit,
  onDelete,
}: ProjectActionSheetProps) {
  const { t } = useTranslation();

  if (!project) return null;

  const actions = [
    { icon: Share2, label: t("share"), onClick: () => { onShare(project); onOpenChange(false); } },
    { icon: Copy, label: t("duplicate"), onClick: () => { onDuplicate(project); onOpenChange(false); } },
    { icon: Pencil, label: t("edit"), onClick: () => { onEdit(project); onOpenChange(false); } },
    { icon: Trash2, label: t("delete"), onClick: () => { onDelete(project); onOpenChange(false); }, destructive: true },
  ];

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="text-left line-clamp-1">{project.name}</DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-6 flex flex-col gap-1">
          {actions.map((action) => (
            <Button
              key={action.label}
              variant="ghost"
              className={`w-full justify-start gap-3 h-12 text-base ${action.destructive ? "text-destructive hover:text-destructive" : ""}`}
              onClick={action.onClick}
            >
              <action.icon className="w-5 h-5" />
              {action.label}
            </Button>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
