import dogTravelNew from "@/assets/dog-travel-new.png";

export function SamoyedLoader() {
  return (
    <div className="flex flex-col items-center justify-center gap-4">
      <div className="relative">
        <img 
          src={dogTravelNew} 
          alt="Loading..." 
          className="w-24 h-24 object-contain animate-bounce-soft"
        />
      </div>
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
        <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
        <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
      </div>
      <p className="text-sm text-muted-foreground font-medium">載入中...</p>
    </div>
  );
}
