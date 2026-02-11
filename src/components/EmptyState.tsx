import { Button } from "@/components/ui/button";
import { Plus, Plane } from "lucide-react";

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      {/* Simple plane icon */}
      <div className="mb-6">
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
          <Plane className="w-10 h-10 text-primary" />
        </div>
      </div>
      
      <h3 className="text-xl font-bold text-foreground mb-2 text-center">{title}</h3>
      <p className="text-base text-muted-foreground max-w-sm mb-8 text-center">{description}</p>
      
      {actionLabel && onAction && (
        <Button 
          onClick={onAction} 
          className="gap-2 rounded-xl"
        >
          <Plus className="w-4 h-4" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
