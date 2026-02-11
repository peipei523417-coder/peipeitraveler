import { useTranslation } from "react-i18next";
import { TravelProject } from "@/types/travel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, Pencil, Trash2, MapPin, Copy, Share2, Lock, Globe } from "lucide-react";
import { differenceInDays } from "date-fns";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatShortDate } from "@/i18n/date-utils";
import { useSignedImageUrl } from "@/hooks/useSignedImageUrl";
interface ProjectCardProps {
  project: TravelProject;
  onEdit: (project: TravelProject) => void;
  onDelete: (project: TravelProject) => void;
  onClick: (project: TravelProject) => void;
  onDuplicate?: (project: TravelProject) => void;
  onShare?: (project: TravelProject) => void;
}

// Visibility icon component
const VisibilityIcon = ({ isPublic }: { isPublic?: boolean }) => {
  const { t } = useTranslation();
  const iconClass = "w-4 h-4 text-slate-500";
  
  if (isPublic) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Globe className={iconClass} />
        </TooltipTrigger>
        <TooltipContent>{t("public")}</TooltipContent>
      </Tooltip>
    );
  }
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Lock className={iconClass} />
      </TooltipTrigger>
      <TooltipContent>{t("private")}</TooltipContent>
    </Tooltip>
  );
};

export function ProjectCard({ 
  project, 
  onEdit, 
  onDelete, 
  onClick, 
  onDuplicate,
  onShare 
}: ProjectCardProps) {
  const { t, i18n } = useTranslation();
  const days = differenceInDays(project.endDate, project.startDate) + 1;
  const totalItems = project.itinerary.reduce((sum, day) => sum + day.items.length, 0);
  const signedCoverImage = useSignedImageUrl(project.coverImageUrl);
  
  // Calculate total budget per person across all days
  const totalBudget = project.itinerary.reduce((total, day) => {
    return total + day.items.reduce((dayTotal, item) => {
      if (!item.price || item.price <= 0) return dayTotal;
      return dayTotal + Math.round(item.price / (item.persons || 1));
    }, 0);
  }, 0);
  
  return (
    <Card 
      className="cursor-pointer group overflow-hidden bg-card rounded-2xl border-2 border-stone-200/80 hover:border-stone-300 transition-all duration-300 hover:shadow-lg hover:-translate-y-1"
      onClick={() => onClick(project)}
    >
      {/* Cover Image or Gradient */}
      <div className="relative h-32 overflow-hidden bg-gradient-to-br from-stone-100 to-stone-200">
        {signedCoverImage ? (
          <img 
            src={signedCoverImage} 
            alt={project.name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <MapPin className="w-10 h-10 text-stone-400" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
        
        {/* Visibility icon - top left */}
        <div className="absolute top-2 left-2 bg-white/90 rounded-full p-1.5 shadow-sm">
          <VisibilityIcon isPublic={project.isPublic} />
        </div>
        
        {/* Action buttons overlay */}
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onShare && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 rounded-lg bg-white shadow-md hover:bg-stone-100 border border-stone-200"
              onClick={(e) => {
                e.stopPropagation();
                onShare(project);
              }}
            >
              <Share2 className="w-4 h-4 text-stone-800" />
            </Button>
          )}
          {onDuplicate && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 rounded-lg bg-white shadow-md hover:bg-stone-100 border border-stone-200"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate(project);
              }}
            >
              <Copy className="w-4 h-4 text-stone-800" />
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 rounded-lg bg-white shadow-md hover:bg-stone-100 border border-stone-200"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(project);
            }}
          >
            <Pencil className="w-4 h-4 text-stone-800" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 rounded-lg bg-white shadow-md hover:bg-destructive/10 border border-stone-200"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(project);
            }}
          >
            <Trash2 className="w-4 h-4 text-destructive" />
          </Button>
        </div>
      </div>
      
      <CardContent className="p-4">
        {/* Row 1: Project Name - auto-wrap */}
        <h3 className="font-bold text-lg text-foreground mb-2 group-hover:text-primary transition-colors" style={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>
          {project.name}
        </h3>
        
        {/* Row 2: Date Range */}
        <div className="flex items-center gap-2 text-sm text-foreground font-bold mb-2">
          <Calendar className="w-4 h-4 flex-shrink-0" />
          <span>
            {formatShortDate(project.startDate, i18n.language)} - {formatShortDate(project.endDate, i18n.language)}
          </span>
        </div>
        
        {/* Row 3: Total Budget per person */}
        <div className="flex items-center gap-4 text-xs">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary/10 text-primary rounded-full font-bold">
            <MapPin className="w-3 h-3" />
            {days} {t("days")}
          </span>
          <span className="text-foreground font-bold">
            {totalItems} {t("items")}
          </span>
          {totalBudget > 0 && (
            <span className="text-primary font-bold">
              ({t("totalBudget")}: ${totalBudget.toLocaleString()})
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
