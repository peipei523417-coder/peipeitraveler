import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ProjectFormData } from "@/types/travel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { CalendarIcon, Plane, Upload, X, Lock, Globe, Eye, EyeOff, Image as ImageIcon, Camera, FileImage } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { zhTW } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { DateRange } from "react-day-picker";
import pencilIcon from "@/assets/pencil-icon.png";
import { saveDraft, getDraft, clearDraft, ProjectDraft } from "@/lib/draft-storage";

interface ProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: ProjectFormData, coverFile?: File) => void;
  initialData?: ProjectFormData;
  mode: "create" | "edit";
  projectId?: string;
}

export function ProjectDialog({
  open,
  onOpenChange,
  onSubmit,
  initialData,
  mode,
  projectId,
}: ProjectDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [coverPreview, setCoverPreview] = useState<string | undefined>(undefined);
  const [coverFile, setCoverFile] = useState<File | undefined>();
  const [isPublic, setIsPublic] = useState(true);
  const [editPassword, setEditPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [showPublicConfirm, setShowPublicConfirm] = useState(false);
  const [showDraftAlert, setShowDraftAlert] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<ProjectDraft | null>(null);
  const [coverSheetOpen, setCoverSheetOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const hasInitialized = useRef(false);

  // Password validation: 4-12 alphanumeric characters
  const validatePassword = (password: string): boolean => {
    const regex = /^[a-zA-Z0-9]{4,12}$/;
    return regex.test(password);
  };

  // Initialize form when dialog opens or initialData changes
  useEffect(() => {
    if (open) {
      // Check for draft on first open
      if (!hasInitialized.current) {
        const draft = getDraft();
        if (draft) {
          // Check if draft matches current context
          const matchesContext = mode === "edit" 
            ? draft.projectId === projectId 
            : draft.projectId === undefined;
          
          if (matchesContext) {
            setPendingDraft(draft);
            setShowDraftAlert(true);
            hasInitialized.current = true;
            return;
          }
        }
        hasInitialized.current = true;
      }
      
      // Initialize with provided data
      if (initialData) {
        setName(initialData.name || "");
        setDateRange(
          initialData.startDate && initialData.endDate
            ? { from: initialData.startDate, to: initialData.endDate }
            : undefined
        );
        setCoverPreview(initialData.coverImageUrl);
        setIsPublic(initialData.isPublic || false);
        setEditPassword("");
      } else {
        resetForm();
      }
    } else {
      hasInitialized.current = false;
    }
  }, [open, initialData, mode, projectId]);

  // Auto-save draft when form changes
  const saveDraftDebounced = useCallback(() => {
    if (!open || !name.trim() || !dateRange?.from || !dateRange?.to) return;
    
    saveDraft({
      projectId: mode === "edit" ? projectId : undefined,
      name,
      startDate: dateRange.from.toISOString(),
      endDate: dateRange.to.toISOString(),
      coverImageUrl: coverPreview,
    });
  }, [open, name, dateRange, coverPreview, mode, projectId]);

  // Debounce draft saving
  useEffect(() => {
    const timer = setTimeout(saveDraftDebounced, 1000);
    return () => clearTimeout(timer);
  }, [saveDraftDebounced]);

  const resetForm = () => {
    setName("");
    setDateRange(undefined);
    setCoverPreview(undefined);
    setCoverFile(undefined);
    setIsPublic(true);
    setEditPassword("");
    setPasswordError("");
  };

  const handleRestoreDraft = () => {
    if (pendingDraft) {
      setName(pendingDraft.name);
      setDateRange({
        from: new Date(pendingDraft.startDate),
        to: new Date(pendingDraft.endDate),
      });
      setCoverPreview(pendingDraft.coverImageUrl);
    }
    setShowDraftAlert(false);
    setPendingDraft(null);
  };

  const handleDiscardDraft = () => {
    clearDraft();
    setShowDraftAlert(false);
    setPendingDraft(null);
    
    // Initialize with provided data after discarding
    if (initialData) {
      setName(initialData.name || "");
      setDateRange(
        initialData.startDate && initialData.endDate
          ? { from: initialData.startDate, to: initialData.endDate }
          : undefined
      );
      setCoverPreview(initialData.coverImageUrl);
      setIsPublic(initialData.isPublic || false);
    }
  };

  const handlePublicToggle = (checked: boolean) => {
    if (checked) {
      // Show confirmation dialog before enabling public
      setShowPublicConfirm(true);
    } else {
      // Can switch back to private without confirmation
      setIsPublic(false);
      setEditPassword("");
      setPasswordError("");
    }
  };

  const confirmPublic = () => {
    setIsPublic(true);
    setShowPublicConfirm(false);
  };

  const cancelPublic = () => {
    setShowPublicConfirm(false);
  };

  const handleSubmit = () => {
    if (!name.trim() || !dateRange?.from || !dateRange?.to) return;
    
    // Clear draft on successful submit
    clearDraft();
    
    onSubmit({
      name: name.trim(),
      startDate: dateRange.from,
      endDate: dateRange.to,
      coverImageUrl: coverPreview,
      isPublic,
    }, coverFile);
    
    resetForm();
    onOpenChange(false);
  };

  const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setCoverFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setCoverPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const removeCover = () => {
    setCoverPreview(undefined);
    setCoverFile(undefined);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const days = dateRange?.from && dateRange?.to 
    ? differenceInDays(dateRange.to, dateRange.from) + 1 
    : 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-xl flex items-center justify-center gap-2">
              <img src={pencilIcon} alt="" className="w-8 h-8 object-contain" />
              {mode === "create" ? t("createProject") : t("editProject")}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-5 py-4">
            {/* Cover Image Upload */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("projectCover")}</Label>
              <div className="relative">
                <div className="h-32 rounded-xl overflow-hidden bg-secondary border-2 border-dashed border-border">
                  {coverPreview ? (
                    <img
                      src={coverPreview}
                      alt={t("coverPreview")}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCoverSheetOpen(true)}
                      className="w-full h-full flex flex-col items-center justify-center bg-muted gap-2 text-muted-foreground"
                    >
                      <ImageIcon className="w-8 h-8" />
                      <span className="text-xs">{t("noCoverYet")}</span>
                    </button>
                  )}
                  {coverPreview && (
                    <button
                      type="button"
                      onClick={removeCover}
                      className="absolute top-2 right-2 p-1 bg-destructive text-destructive-foreground rounded-full hover:bg-destructive/90"
                      aria-label={t("delete")}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleCoverUpload}
                  className="hidden"
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleCoverUpload}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="absolute bottom-2 right-2 rounded-lg gap-1.5"
                  onClick={() => setCoverSheetOpen(true)}
                >
                  <Upload className="w-4 h-4" />
                  {t("uploadCover")}
                </Button>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm font-medium">
                {t("projectName")}
              </Label>
              <Input
                id="name"
                placeholder={t("projectNamePlaceholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-xl h-11"
              />
            </div>
            
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("travelDate")}</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal h-11 rounded-xl",
                      !dateRange && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateRange?.from ? (
                      dateRange.to ? (
                        <>
                          {format(dateRange.from, "yyyy/MM/dd", { locale: zhTW })} -{" "}
                          {format(dateRange.to, "yyyy/MM/dd", { locale: zhTW })}
                        </>
                      ) : (
                        format(dateRange.from, "yyyy/MM/dd", { locale: zhTW })
                      )
                    ) : (
                      <span>{t("selectDateRange")}</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    initialFocus
                    mode="range"
                    defaultMonth={dateRange?.from}
                    selected={dateRange}
                    onSelect={setDateRange}
                    numberOfMonths={2}
                    locale={zhTW}
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              
              {days > 0 && (
                <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Plane className="w-4 h-4" />
                  {days} {t("dayTrip")}
                </p>
              )}
            </div>

            {/* Project Visibility Toggle */}
            <div className="space-y-3 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {isPublic ? (
                    <Globe className="w-5 h-5 text-primary" />
                  ) : (
                    <Lock className="w-5 h-5 text-muted-foreground" />
                  )}
                  <div>
                    <Label className="text-sm font-medium">
                      {t("projectVisibility")}
                    </Label>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn("text-xs font-medium", !isPublic ? "text-foreground" : "text-muted-foreground")}>
                    {t("private")}
                  </span>
                  <Switch
                    checked={isPublic}
                    onCheckedChange={handlePublicToggle}
                  />
                  <span className={cn("text-xs font-medium", isPublic ? "text-foreground" : "text-muted-foreground")}>
                    {t("public")}
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground pl-8">
                {isPublic ? t("publicDescription") : t("privateDescription")}
              </p>
            </div>
          </div>
          
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="rounded-xl"
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!name.trim() || !dateRange?.from || !dateRange?.to}
              className="samoyed-button rounded-xl"
            >
              {mode === "create" ? t("createProjectBtn") : t("saveChanges")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Public confirmation dialog */}
      <AlertDialog open={showPublicConfirm} onOpenChange={setShowPublicConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmPublicTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmPublicDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelPublic}>
              {t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmPublic}>
              {t("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Draft restore alert */}
      <AlertDialog open={showDraftAlert} onOpenChange={setShowDraftAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("draftFound")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("draftFoundDescription")}
              {pendingDraft && (
                <span className="block mt-2 text-foreground font-medium">
                  {t("projectName")}：{pendingDraft.name}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDiscardDraft}>
              {t("discardDraft")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleRestoreDraft}>
              {t("restoreDraft")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
