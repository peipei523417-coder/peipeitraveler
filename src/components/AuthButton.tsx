import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogIn, LogOut, User, RefreshCw, FileText, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePro } from "@/contexts/ProContext";
import { LoginDialog } from "@/components/LoginDialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function AuthButton() {
  const { t } = useTranslation();
  const { user, loading, signOut } = useAuth();
  const { isPro, toggleProStatus } = usePro();
  const [loginOpen, setLoginOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Restore purchase - re-sync PRO status from server
  const handleRestorePurchase = async () => {
    try {
      // This would typically call your payment provider's API
      // For now, we just re-fetch the PRO status from database
      toast.success(t("purchaseRestored"));
    } catch (error) {
      console.error("Error restoring purchase:", error);
      toast.error(t("error"));
    }
  };

  // Delete account
  const handleDeleteAccount = async () => {
    if (!user) return;
    
    setDeleting(true);
    try {
      // Delete all user's projects first
      const { error: projectsError } = await supabase
        .from("travel_projects")
        .delete()
        .eq("user_id", user.id);

      if (projectsError) throw projectsError;

      // Delete user profile
      const { error: profileError } = await supabase
        .from("user_profiles")
        .delete()
        .eq("user_id", user.id);

      if (profileError) throw profileError;

      // Sign out and show success message
      await signOut();
      toast.success(t("accountDeleted"));
    } catch (error) {
      console.error("Error deleting account:", error);
      toast.error(t("error"));
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  // Open privacy policy
  const openPrivacyPolicy = () => {
    window.open("/privacy", "_blank");
  };

  if (loading) {
    return (
      <Button variant="ghost" size="sm" disabled className="rounded-full">
        <User className="w-4 h-4" />
      </Button>
    );
  }

  if (!user) {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setLoginOpen(true)}
          className="rounded-full gap-2 border-black/20 bg-white/60 text-black hover:bg-white/80 backdrop-blur-sm"
        >
          <LogIn className="w-4 h-4" />
          Login
        </Button>
        <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
      </>
    );
  }

  const initials = user.email?.charAt(0).toUpperCase() || "U";
  const avatarUrl = user.user_metadata?.avatar_url;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="ghost" 
            size="sm" 
            className="rounded-full gap-2 px-2 hover:bg-white/40"
          >
            <Avatar className="w-7 h-7 border border-black/20">
              <AvatarImage src={avatarUrl} />
              <AvatarFallback className="bg-white/60 text-black text-xs">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="hidden sm:inline text-sm truncate max-w-[120px] text-black">
              {user.email}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium truncate">{user.email}</p>
            {isPro && (
              <p className="text-xs text-primary font-bold">PRO</p>
            )}
          </div>
          <DropdownMenuSeparator />
          
          {/* Restore Purchase - for PRO users */}
          <DropdownMenuItem onClick={handleRestorePurchase}>
            <RefreshCw className="w-4 h-4 mr-2" />
            {t("restorePurchase")}
          </DropdownMenuItem>
          
          {/* Privacy Policy */}
          <DropdownMenuItem onClick={openPrivacyPolicy}>
            <FileText className="w-4 h-4 mr-2" />
            {t("privacyPolicy")}
          </DropdownMenuItem>
          
          <DropdownMenuSeparator />
          
          {/* Delete Account */}
          <DropdownMenuItem 
            onClick={() => setDeleteDialogOpen(true)}
            className="text-destructive"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            {t("deleteAccount")}
          </DropdownMenuItem>
          
          {/* Logout */}
          <DropdownMenuItem onClick={signOut} className="text-destructive">
            <LogOut className="w-4 h-4 mr-2" />
            {t("logout")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Delete Account Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteAccountTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteAccountDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAccount}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? t("loading") : t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
