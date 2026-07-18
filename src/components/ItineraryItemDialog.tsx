import { useState, useEffect, useRef } from "react";
import { ItineraryItem, HighlightColor } from "@/types/travel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Clock, Image as ImageIcon, Palette, AlertCircle, MapPin, DollarSign, Users, Camera as CameraIcon, FileImage, Link as LinkIcon } from "lucide-react";
import { GoogleMapsInput } from "@/components/GoogleMapsInput";
import { SimpleTimePicker, getNextAvailableTime, isTimeBefore } from "@/components/SimpleTimePicker";
import { HighlightColorPicker } from "@/components/HighlightColorPicker";
import { hasTimeConflict, findOverlappingItem } from "@/lib/time-validation";
import { sanitizeMapUrl } from "@/utils/mapLink";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";


interface ItineraryItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (item: Omit<ItineraryItem, "id">, imageFile?: File) => void;
  initialData?: ItineraryItem;
  mode: "create" | "edit";
  suggestedStartTime?: string;
  existingItems?: ItineraryItem[]; // For overlap checking
}

export function ItineraryItemDialog({
  open,
  onOpenChange,
  onSubmit,
  initialData,
  mode,
  suggestedStartTime,
  existingItems = [],
}: ItineraryItemDialogProps) {
  const { t } = useTranslation();
  const [useTime, setUseTime] = useState(!!initialData?.startTime);
  const [startTime, setStartTime] = useState(initialData?.startTime || suggestedStartTime || "09:00");
  const [endTime, setEndTime] = useState(initialData?.endTime || "10:00");
  const [description, setDescription] = useState(initialData?.description || "");
  const [googleMapsUrl, setGoogleMapsUrl] = useState(initialData?.googleMapsUrl || "");
  const [relatedLink, setRelatedLink] = useState(initialData?.relatedLink || "");
  const [imageUrl, setImageUrl] = useState(initialData?.imageUrl || "");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [highlightColor, setHighlightColor] = useState<HighlightColor>(
    initialData?.highlightColor || "none"
  );
  const [price, setPrice] = useState<string>(initialData?.price?.toString() || "");
  const [persons, setPersons] = useState<string>(initialData?.persons?.toString() || "1");
  const [timeError, setTimeError] = useState<string | null>(null);
  const [mapUrlInvalid, setMapUrlInvalid] = useState(false);
  const [overlapWarningOpen, setOverlapWarningOpen] = useState(false);
  const [overlappingItemDesc, setOverlappingItemDesc] = useState<string>("");

  useEffect(() => {
    if (initialData) {
      setUseTime(!!initialData.startTime);
      setStartTime(initialData.startTime || "09:00");
      setEndTime(initialData.endTime || "10:00");
      setDescription(initialData.description);
      setGoogleMapsUrl(initialData.googleMapsUrl || "");
      setRelatedLink(initialData.relatedLink || "");
      setImageUrl(initialData.imageUrl || "");
      setHighlightColor(initialData.highlightColor || "none");
      setPrice(initialData.price?.toString() || "");
      setPersons(initialData.persons?.toString() || "1");
    } else {
      // Use suggested start time if available
      const defaultStart = suggestedStartTime || "09:00";
      setUseTime(true); // Default to time ON for new items
      setStartTime(defaultStart);
      setEndTime(getNextAvailableTime(defaultStart));
      setDescription("");
      setGoogleMapsUrl("");
      setRelatedLink("");
      setImageUrl("");
      setHighlightColor("none");
      setPrice("");
      setPersons("1");
    }
    setTimeError(null);
    setMapUrlInvalid(false);
  }, [initialData, open, suggestedStartTime]);

  // Validate time when start or end time changes
  useEffect(() => {
    if (useTime && (isTimeBefore(endTime, startTime) || endTime === startTime)) {
      setTimeError(t("endTimeError") || "結束時間必須晚於開始時間");
    } else {
      setTimeError(null);
    }
  }, [startTime, endTime, useTime, t]);

  // Auto-adjust end time when start time changes
  const handleStartTimeChange = (newStartTime: string) => {
    setStartTime(newStartTime);
    // If current end time is before or equal to new start time, auto-adjust
    if (isTimeBefore(endTime, newStartTime) || endTime === newStartTime) {
      setEndTime(getNextAvailableTime(newStartTime));
    }
  };

  // Calculate per-person cost
  const calculatePerPerson = (): number | null => {
    const priceNum = parseInt(price, 10);
    const personsNum = parseInt(persons, 10) || 1;
    if (isNaN(priceNum) || priceNum <= 0) return null;
    return Math.round(priceNum / personsNum);
  };

  const perPersonCost = calculatePerPerson();

  const handleSubmit = () => {
    if (!description.trim()) return;
    if (useTime && timeError) return;
    if (mapUrlInvalid) return;
    
    // Check for time overlap using array.some() - only if time is enabled
    if (useTime) {
      const excludeId = mode === "edit" ? initialData?.id : undefined;
      if (hasTimeConflict(existingItems, startTime, endTime, excludeId)) {
        const overlapping = findOverlappingItem(existingItems, startTime, endTime, excludeId);
        if (overlapping) {
          setOverlappingItemDesc(`${overlapping.startTime} - ${overlapping.endTime}: ${overlapping.description}`);
          setOverlapWarningOpen(true);
          return;
        }
      }
    }
    
    submitItem();
  };

  const submitItem = () => {
    const priceNum = parseInt(price, 10);
    const personsNum = parseInt(persons, 10) || 1;
    const cleanMapUrl = sanitizeMapUrl(googleMapsUrl);
    
    // If there's a new file, pass it along; don't store base64/blob URL in imageUrl
    // Use null (not undefined) when image is explicitly cleared, so the DB update happens
    let itemImageUrl: string | undefined | null;
    if (imageFile) {
      itemImageUrl = undefined; // will be replaced by uploaded URL
    } else if (imageUrl.trim()) {
      itemImageUrl = imageUrl.trim();
    } else {
      // Image was explicitly cleared — pass null so it gets written to DB
      itemImageUrl = null;
    }
    
    // Normalize related link — accept empty or a URL-like string; store trimmed.
    const trimmedRelated = relatedLink.trim();

    onSubmit({
      startTime: useTime ? startTime : "",
      endTime: useTime ? endTime : "",
      description: description.trim(),
      googleMapsUrl: cleanMapUrl || undefined,
      relatedLink: trimmedRelated || undefined,
      imageUrl: itemImageUrl as string | undefined,
      highlightColor: highlightColor,
      price: !isNaN(priceNum) && priceNum > 0 ? priceNum : undefined,
      persons: personsNum > 0 ? personsNum : 1,
    }, imageFile || undefined);
    
    // Reset form
    setUseTime(false);
    setStartTime("09:00");
    setEndTime("10:00");
    setDescription("");
    setGoogleMapsUrl("");
    setRelatedLink("");
    setImageUrl("");
    setImageFile(null);
    setHighlightColor("none");
    setPrice("");
    setPersons("1");
    onOpenChange(false);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Store the File object for later upload to Storage
    setImageFile(file);
    // Create a local preview URL (not stored in DB)
    const previewUrl = URL.createObjectURL(file);
    setImageUrl(previewUrl);
  };

  const isNative = () => !!(window as any).Capacitor?.isNativePlatform?.();

  const dataUrlToFile = async (dataUrl: string, filename: string): Promise<File> => {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return new File([blob], filename, { type: blob.type || "image/jpeg" });
  };

  const pickFromCameraNative = async () => {
    try {
      const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
      const photo = await Camera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
      });
      if (photo.dataUrl) {
        const file = await dataUrlToFile(photo.dataUrl, `item_${Date.now()}.jpg`);
        setImageFile(file);
        setImageUrl(photo.dataUrl);
      }
    } catch {
      // user cancelled — silent
    }
  };

  const pickFromLibraryNative = async () => {
    try {
      const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
      const photo = await Camera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Photos,
      });
      if (photo.dataUrl) {
        const file = await dataUrlToFile(photo.dataUrl, `item_${Date.now()}.jpg`);
        setImageFile(file);
        setImageUrl(photo.dataUrl);
      }
    } catch {
      // user cancelled — silent
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [imageSheetOpen, setImageSheetOpen] = useState(false);

  const handleTakePhoto = () => {
    setImageSheetOpen(false);
    if (isNative()) pickFromCameraNative();
    else cameraInputRef.current?.click();
  };

  const handlePickLibrary = () => {
    setImageSheetOpen(false);
    if (isNative()) pickFromLibraryNative();
    else fileInputRef.current?.click();
  };

  const handlePickFile = () => {
    setImageSheetOpen(false);
    fileInputRef.current?.click();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md rounded-2xl max-h-[92dvh] sm:max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0 touch-manipulation">
          <DialogHeader className="shrink-0 px-6 pt-4 pb-2 sm:pt-6 sm:pb-3 border-b border-border bg-background">
            <DialogTitle className="text-xl">
              {mode === "create" ? t("addItem") : t("editItem")}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-2 sm:py-3">
            <div className="space-y-2 sm:space-y-3">
            {/* Time Toggle and Range - First priority */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-bold flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  {t("timeOptional")}
                </Label>
                <Switch 
                  checked={useTime} 
                  onCheckedChange={setUseTime}
                />
              </div>
              
              {useTime && (
                <div className="flex items-center gap-3 mt-3">
                  <SimpleTimePicker value={startTime} onChange={handleStartTimeChange} />
                  <span className="text-foreground font-bold">-</span>
                  <SimpleTimePicker 
                    value={endTime} 
                    onChange={setEndTime}
                    minTime={getNextAvailableTime(startTime)}
                  />
                </div>
              )}
              
              {useTime && timeError && (
                <div className="flex items-center gap-1.5 text-destructive text-sm">
                  <AlertCircle className="w-4 h-4" />
                  <span>{timeError}</span>
                </div>
              )}
            </div>

            {/* Description - Second priority */}
            <div className="space-y-2">
              <Label htmlFor="description" className="text-sm font-bold">
                {t("description")}
              </Label>
              <Textarea
                id="description"
                placeholder="例如：一蘭拉麵本店"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="rounded-xl min-h-[80px] resize-none text-base"
              />
            </div>
            
            {/* Budget Section */}
            <div className="space-y-2">
              <Label className="text-sm font-bold flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                {t("price")} ({t("persons")}: <Users className="w-3 h-3 inline" />)
              </Label>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  placeholder={t("price")}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="rounded-xl w-28 text-base"
                  min="0"
                />
                <span className="text-foreground font-bold">/</span>
                <Input
                  type="number"
                  placeholder="1"
                  value={persons}
                  onChange={(e) => setPersons(e.target.value)}
                  className="rounded-xl w-16 text-base"
                  min="1"
                />
                <span className="text-sm text-muted-foreground">人</span>
                {perPersonCost !== null && (
                  <span className="text-sm text-muted-foreground">
                    = <span className="font-bold text-primary">${perPersonCost}</span> {t("perPerson")}
                  </span>
                )}
              </div>
            </div>
            
            {/* Highlight Color */}
            <div className="space-y-2">
              <Label className="text-sm font-bold flex items-center gap-2">
                <Palette className="w-4 h-4" />
                {t("highlightColor")}
              </Label>
              <HighlightColorPicker 
                value={highlightColor} 
                onChange={setHighlightColor} 
              />
            </div>
            
            {/* Google Maps - Dual Mode Input */}
            <div className="space-y-2">
              <Label className="text-sm font-bold flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                地點連結（選填）
              </Label>
              <GoogleMapsInput
                value={googleMapsUrl}
                onChange={setGoogleMapsUrl}
                onInvalidChange={setMapUrlInvalid}
              />
            </div>

            {/* Related Link (optional external URL like booking pages, articles) */}
            <div className="space-y-2">
              <Label htmlFor="related-link" className="text-sm font-bold flex items-center gap-2">
                <LinkIcon className="w-4 h-4" />
                相關連結（選填）
              </Label>
              <Input
                id="related-link"
                type="url"
                inputMode="url"
                placeholder="https://..."
                value={relatedLink}
                onChange={(e) => setRelatedLink(e.target.value)}
                className="rounded-xl text-base"
              />
            </div>
            
            
            {/* Image Upload */}
            <div className="space-y-2">
              <Label className="text-sm font-bold flex items-center gap-2">
                <ImageIcon className="w-4 h-4" />
                圖片 (選填)
              </Label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setImageSheetOpen(true)}
                  className="cursor-pointer touch-manipulation inline-flex items-center justify-center min-w-[120px] min-h-[44px] px-4 py-2 bg-white border border-gray-300 rounded-xl text-sm font-bold text-black hover:bg-gray-100 active:bg-gray-200 transition-colors shadow-sm"
                >
                  {t("chooseFile")}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </div>
              {imageUrl && (
                <div className="relative">
                  <img
                    src={imageUrl}
                    alt="Preview"
                    className="w-full h-32 object-cover rounded-xl border border-border"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    className="absolute top-2 right-2 rounded-lg min-h-[44px] min-w-[44px] touch-manipulation"
                    onClick={() => { setImageUrl(""); setImageFile(null); }}
                  >
                    {t("delete")}
                  </Button>
                </div>
              )}
            </div>
            </div>
          </div>
          

          <DialogFooter className="shrink-0 flex-row justify-end gap-2 px-6 py-3 border-t border-border bg-background">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="rounded-xl min-h-[44px] flex-1 sm:flex-none sm:min-w-[80px] touch-manipulation"
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!description.trim() || (useTime && !!timeError) || mapUrlInvalid}
              className="samoyed-button rounded-xl min-h-[44px] flex-1 sm:flex-none sm:min-w-[80px] touch-manipulation"
            >
              {mode === "create" ? t("add") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Overlap Warning Dialog */}
      <AlertDialog open={overlapWarningOpen} onOpenChange={setOverlapWarningOpen}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="w-5 h-5" />
              時間衝突
            </AlertDialogTitle>
            <AlertDialogDescription className="text-foreground">
              時間重複了，請重新檢查。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction 
              onClick={() => setOverlapWarningOpen(false)}
              className="samoyed-button rounded-xl"
            >
              {t("gotIt")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Image source selection sheet — Traditional Chinese, replaces native English picker */}
      <Sheet open={imageSheetOpen} onOpenChange={setImageSheetOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader>
            <SheetTitle className="text-center">{t("chooseFile")}</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-2 py-4">
            <Button variant="outline" className="w-full justify-center gap-2 h-12 rounded-xl" onClick={handlePickLibrary}>
              <ImageIcon className="w-5 h-5" />{t("choosePhotoLibrary")}
            </Button>
            <Button variant="outline" className="w-full justify-center gap-2 h-12 rounded-xl" onClick={handleTakePhoto}>
              <CameraIcon className="w-5 h-5" />{t("takePhoto")}
            </Button>
            <Button variant="outline" className="w-full justify-center gap-2 h-12 rounded-xl" onClick={handlePickFile}>
              <FileImage className="w-5 h-5" />{t("chooseFile")}
            </Button>
            <Button variant="ghost" className="w-full justify-center h-12 rounded-xl mt-1" onClick={() => setImageSheetOpen(false)}>
              {t("cancel")}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
