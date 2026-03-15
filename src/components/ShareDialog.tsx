import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Copy, Globe, Lock, Check, KeyRound, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { TravelProject } from "@/types/travel";
import { updateProjectSharing } from "@/lib/supabase-storage";

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: TravelProject | null;
  onProjectUpdate?: (project: TravelProject) => void;
}

// Password validation: 4-12 alphanumeric characters
const PASSWORD_REGEX = /^[a-zA-Z0-9]{4,12}$/;

export function ShareDialog({
  open,
  onOpenChange,
  project,
  onProjectUpdate,
}: ShareDialogProps) {
  const { t } = useTranslation();
  const [isPublic, setIsPublic] = useState(false);
  const [editPassword, setEditPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hasExistingPassword, setHasExistingPassword] = useState(false);

  useEffect(() => {
    if (open && project) {
      loadProjectSettings();
    }
  }, [open, project]);

  const loadProjectSettings = async () => {
    if (!project) return;
    
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase
      .from("travel_projects")
      .select("is_public, edit_password_hash")
      .eq("id", project.id)
      .single();
    
    if (data) {
      setIsPublic(data.is_public || false);
      setHasExistingPassword(!!data.edit_password_hash);
      setEditPassword("");
    }
  };

  const validatePassword = (pwd: string): boolean => {
    if (!pwd) return false;
    return PASSWORD_REGEX.test(pwd);
  };

  const handleTogglePublic = async (checked: boolean) => {
    if (!project) return;

    if (checked) {
      if (!hasExistingPassword && !editPassword) {
        toast.error(t("passwordRequired"));
        return;
      }
      
      if (editPassword && !validatePassword(editPassword)) {
        toast.error(t("passwordRequired"));
        return;
      }
    }

    setSaving(true);
    try {
      const updated = await updateProjectSharing(
        project.id,
        checked,
        checked && editPassword ? editPassword : undefined
      );
      
      if (updated) {
        setIsPublic(checked);
        if (checked && editPassword) {
          setHasExistingPassword(true);
          setEditPassword("");
        }
        onProjectUpdate?.(updated);
        toast.success(checked ? t("publicEnabled") : t("publicDisabled"));
      }
    } catch (error) {
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleSavePassword = async () => {
    if (!project) return;

    if (!validatePassword(editPassword)) {
      toast.error(t("passwordRequired"));
      return;
    }

    setSaving(true);
    try {
      const updated = await updateProjectSharing(project.id, isPublic, editPassword);
      if (updated) {
        setHasExistingPassword(true);
        setEditPassword("");
        onProjectUpdate?.(updated);
        toast.success(t("passwordUpdated"));
      }
    } catch (error) {
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleCopyLink = async () => {
    if (!project) return;

    // Always use production URL so links work everywhere (native app, preview, etc.)
    const PRODUCTION_URL = "https://peipeigotravel.lovable.app";
    const shareUrl = `${PRODUCTION_URL}/share/${project.id}`;
    
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success(t("linkCopied"));
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.info(`${t("share")}: ${shareUrl}`);
    }
  };

  if (!project) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("shareSettings")}</DialogTitle>
          <DialogDescription>
            {t("shareInfoPublic")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-4">
          {/* Public Toggle */}
          <div className="flex items-center justify-between p-4 bg-muted rounded-xl">
            <div className="flex items-center gap-3">
              {isPublic ? (
                <Globe className="w-5 h-5 text-primary" />
              ) : (
                <Lock className="w-5 h-5 text-muted-foreground" />
              )}
              <div>
                <p className="font-medium">
                  {isPublic ? t("publicProject") : t("sharePrivateLabel")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isPublic ? t("sharePublicDesc") : t("sharePrivateDesc")}
                </p>
              </div>
            </div>
            <Switch
              checked={isPublic}
              onCheckedChange={handleTogglePublic}
              disabled={saving}
            />
          </div>

          {/* Guidance when private */}
          {!isPublic && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
              <ArrowRight className="w-4 h-4 flex-shrink-0 text-primary" />
              <span>{t("sharePrivateHint")}</span>
            </div>
          )}

          {/* Password Section - Only shown for PUBLIC projects */}
          {isPublic && (
            <div className="space-y-3">
              <Label className="text-sm font-medium flex items-center gap-2">
                <KeyRound className="w-4 h-4" />
                {t("editPassword")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("sharePasswordDesc")}
              </p>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder={hasExistingPassword ? t("enterNewPassword") : t("setPasswordPlaceholder")}
                  maxLength={12}
                  autoComplete="new-password"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-form-type="other"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  name="share-edit-code"
                  id="share-edit-code"
                />
                <Button
                  onClick={handleSavePassword}
                  disabled={saving || !editPassword}
                  variant="outline"
                >
                  {hasExistingPassword ? t("updatePassword") : t("setPassword")}
                </Button>
              </div>
              {hasExistingPassword && editPassword === "" && (
                <p className="text-xs text-primary">✓ {t("passwordSet")}</p>
              )}
            </div>
          )}

          {/* Copy Link Button */}
          {isPublic && (
            <Button
              onClick={handleCopyLink}
              className="w-full gap-2"
              variant="default"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4" />
                  {t("linkCopied")}
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  {t("copyLink")}
                </>
              )}
            </Button>
          )}

          {/* Info text */}
          <div className="text-xs text-muted-foreground space-y-1 border-t pt-4">
            <p>• {t("shareInfoPrivate")}</p>
            <p>• {t("shareInfoPublic")}</p>
            <p>• 🔑 {t("shareInfoEdit")}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
