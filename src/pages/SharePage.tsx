import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { TravelProject, DayItinerary, ItineraryItem } from "@/types/travel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, MapPin, Lock, AlertCircle, Home, Edit2, Users, Eye, UserPlus, Loader2 } from "lucide-react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DayTabs } from "@/components/DayTabs";
import { ItineraryList } from "@/components/ItineraryList";
import { ItineraryItemDialog } from "@/components/ItineraryItemDialog";
import { SmartAppBanner } from "@/components/SmartAppBanner";
import { LoginDialog } from "@/components/LoginDialog";
import { differenceInDays, addDays } from "date-fns";
import { formatDate, formatShortDate } from "@/i18n/date-utils";
import { toast } from "sonner";
import dogTravelNew from "@/assets/dog-travel-new.png";
import { useSignedImageUrl } from "@/hooks/useSignedImageUrl";
import { useAuth } from "@/contexts/AuthContext";
import { joinProject } from "@/lib/join-project";

// Helper function to convert database rows to TravelProject
function dbRowToProject(row: any, items: any[] = []): TravelProject {
  const startDate = new Date(row.start_date);
  const endDate = new Date(row.end_date);
  const days = differenceInDays(endDate, startDate) + 1;
  
  const itemsByDay: Record<number, ItineraryItem[]> = {};
  items.forEach((item) => {
    const dayNum = item.day_number;
    if (!itemsByDay[dayNum]) {
      itemsByDay[dayNum] = [];
    }
    itemsByDay[dayNum].push({
      id: item.id,
      startTime: item.start_time || "",
      endTime: item.end_time || "",
      description: item.description,
      googleMapsUrl: item.google_maps_url || undefined,
      imageUrl: item.image_url || undefined,
      highlightColor: item.highlight_color || undefined,
      iconType: item.icon_type || 'default',
    });
  });
  
  const itinerary: DayItinerary[] = Array.from({ length: days }, (_, i) => ({
    dayNumber: i + 1,
    date: addDays(startDate, i),
    items: (itemsByDay[i + 1] || []).sort((a, b) => 
      a.startTime.localeCompare(b.startTime)
    ),
  }));
  
  return {
    id: row.id,
    name: row.name,
    startDate,
    endDate,
    coverImageUrl: row.cover_image_url || undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    itinerary,
  };
}

// Server-side password verification via edge function
async function verifyPassword(projectId: string, password: string): Promise<{ valid: boolean; error?: string; rateLimited?: boolean }> {
  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-edit-password`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ projectId, password, action: "verify" }),
      }
    );
    return await response.json();
  } catch {
    return { valid: false, error: "Verification failed" };
  }
}

// Edge function CRUD operations with password
async function edgeFunctionCrud(
  action: "add-item" | "update-item" | "delete-item",
  projectId: string,
  password: string,
  data: {
    itemId?: string;
    dayNumber?: number;
    itemData?: Omit<ItineraryItem, "id">;
  }
): Promise<{ success: boolean; error?: string; item?: any }> {
  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-edit-password`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          action,
          projectId,
          password,
          itemId: data.itemId,
          dayNumber: data.dayNumber,
          itemData: data.itemData,
        }),
      }
    );
    return await response.json();
  } catch {
    return { success: false, error: "Operation failed" };
  }
}

// Upload image via edge function (for non-owner editors with password)
async function edgeFunctionUploadImage(
  projectId: string,
  password: string,
  file: File
): Promise<string | undefined> {
  try {
    const { compressImage } = await import("@/lib/image-compress");
    const { file: optimizedFile } = await compressImage(file);
    
    const buffer = await optimizedFile.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-edit-password`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          action: "upload-image",
          projectId,
          password,
          imageBase64: base64,
          imageFileName: optimizedFile.name,
        }),
      }
    );
    const result = await response.json();
    return result.success ? result.imageUrl : undefined;
  } catch (e) {
    console.error("Edge function image upload error:", e);
    return undefined;
  }
}

export default function SharePage() {
  const { shareCode } = useParams<{ shareCode: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<TravelProject | null>(null);
  const [activeDay, setActiveDay] = useState(1);
  const [showItinerary, setShowItinerary] = useState(false);
  
  // Edit mode state
  const [canEdit, setCanEdit] = useState(false);
  const [editPassword, setEditPassword] = useState<string | null>(null);
  const [hasEditPassword, setHasEditPassword] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  
  // Join state
  const [joining, setJoining] = useState(false);
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  
  // Edit dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ItineraryItem | null>(null);

  // Signed URL for cover image
  const signedCoverImage = useSignedImageUrl(project?.coverImageUrl);

  // Check for stored password on mount
  useEffect(() => {
    if (shareCode) {
      const storedPassword = sessionStorage.getItem(`edit-password-${shareCode}`);
      if (storedPassword) {
        setEditPassword(storedPassword);
        setCanEdit(true);
      }
      loadProject();
    }
  }, [shareCode]);

  const loadProject = async () => {
    if (!shareCode) return;
    
    setLoading(true);
    setError(null);

    try {
      // First try: use share_code to look up via RPC function
      const { data: sharedData } = await supabase
        .rpc("get_shared_project_by_code", { p_share_code: shareCode });

      let projectId: string | null = null;
      let projectName: string | null = null;
      let startDate: string | null = null;
      let endDate: string | null = null;
      let coverImageUrl: string | null = null;
      let requiresPassword = false;

      if (sharedData && sharedData.length > 0) {
        const row = sharedData[0];
        projectId = row.project_id;
        projectName = row.project_name;
        startDate = row.start_date;
        endDate = row.end_date;
        coverImageUrl = row.cover_image_url;
        requiresPassword = row.requires_password;
      } else {
        // Fallback: try shareCode as direct project ID
        const { data: publicData } = await supabase
          .from("public_travel_projects")
          .select("id, name, start_date, end_date, cover_image_url, is_public, has_edit_password, created_at, updated_at")
          .eq("id", shareCode)
          .maybeSingle();

        if (!publicData || !publicData.is_public) {
          setError(t("privateTrip"));
          setLoading(false);
          return;
        }

        projectId = publicData.id;
        projectName = publicData.name;
        startDate = publicData.start_date;
        endDate = publicData.end_date;
        coverImageUrl = publicData.cover_image_url;
        requiresPassword = publicData.has_edit_password || false;
      }

      if (!projectId) {
        setError(t("privateTrip"));
        setLoading(false);
        return;
      }

      setHasEditPassword(requiresPassword);

      // Fetch itinerary items from public view
      const { data: items } = await supabase
        .from("public_itinerary_items")
        .select("*")
        .eq("project_id", projectId);

      const projectRow = {
        id: projectId,
        name: projectName,
        start_date: startDate,
        end_date: endDate,
        cover_image_url: coverImageUrl,
        is_public: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const loadedProject = dbRowToProject(projectRow, items || []);
      setProject(loadedProject);
    } catch {
      setError(t("privateTrip"));
    }

    setLoading(false);
  };

  const handleUnlockEdit = async () => {
    if (!passwordInput || !project) return;
    
    setVerifying(true);
    const result = await verifyPassword(project.id, passwordInput);
    setVerifying(false);
    
    if (result.rateLimited) {
      toast.error(t("tooManyAttempts"));
      return;
    }
    
    if (result.valid) {
      setCanEdit(true);
      setEditPassword(passwordInput);
      sessionStorage.setItem(`edit-password-${shareCode}`, passwordInput);
      setShowPasswordPrompt(false);
      setPasswordInput("");
      toast.success(t("editUnlocked"));
    } else {
      toast.error(t("passwordIncorrect"));
    }
  };

  const handleJoinProject = async () => {
    if (!project) return;
    
    if (!user) {
      setShowLoginDialog(true);
      return;
    }

    setJoining(true);
    try {
      const result = await joinProject(project.id);
      
      if (result.alreadyOwner) {
        toast.info(t("alreadyOwner"));
        navigate(`/project/${project.id}`);
      } else if (result.alreadyJoined) {
        toast.info(t("alreadyJoined"));
        navigate(`/project/${project.id}`);
      } else if (result.success) {
        toast.success(t("joinSuccess"));
        navigate(`/project/${project.id}`);
      } else {
        toast.error(result.error || t("error"));
      }
    } catch {
      toast.error(t("error"));
    } finally {
      setJoining(false);
    }
  };

  // After login, auto-join
  useEffect(() => {
    if (user && showLoginDialog) {
      setShowLoginDialog(false);
      // Small delay to let auth settle
      setTimeout(() => handleJoinProject(), 500);
    }
  }, [user]);

  const handleAddItem = async (item: Omit<ItineraryItem, "id">, imageFile?: File) => {
    if (!project || !editPassword) return;
    
    let imageUrl = item.imageUrl;
    if (imageFile) {
      const uploadedUrl = await edgeFunctionUploadImage(project.id, editPassword, imageFile);
      if (uploadedUrl) imageUrl = uploadedUrl;
    }
    
    const result = await edgeFunctionCrud("add-item", project.id, editPassword, {
      dayNumber: activeDay,
      itemData: { ...item, imageUrl },
    });
    
    if (result.success) {
      await loadProject();
      toast.success(t("itemCreated"));
    } else {
      toast.error(result.error || t("error"));
    }
  };

  const handleEditItem = async (item: Omit<ItineraryItem, "id">, imageFile?: File) => {
    if (!project || !editingItem || !editPassword) return;
    
    let imageUrl = item.imageUrl;
    if (imageFile) {
      const uploadedUrl = await edgeFunctionUploadImage(project.id, editPassword, imageFile);
      if (uploadedUrl) imageUrl = uploadedUrl;
    }
    
    const result = await edgeFunctionCrud("update-item", project.id, editPassword, {
      itemId: editingItem.id,
      itemData: { ...item, imageUrl },
    });
    
    if (result.success) {
      await loadProject();
      setEditingItem(null);
      toast.success(t("itemUpdated"));
    } else {
      toast.error(result.error || t("error"));
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!project || !editPassword) return;
    
    const result = await edgeFunctionCrud("delete-item", project.id, editPassword, {
      itemId,
    });
    
    if (result.success) {
      await loadProject();
      toast.success(t("itemDeleted"));
    } else {
      toast.error(result.error || t("error"));
    }
  };

  // Show skeleton while loading
  if (loading) {
    return <PageSkeleton variant="share" />;
  }

  // Password prompt dialog
  if (showPasswordPrompt) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <Edit2 className="w-12 h-12 mx-auto text-primary mb-2" />
            <CardTitle>{t("enterEditPassword")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <input
              id="project_pin"
              type="text"
              inputMode="text"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder={t("passwordPlaceholder")}
              onKeyDown={(e) => e.key === "Enter" && handleUnlockEdit()}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-form-type="other"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              style={{ WebkitTextSecurity: 'disc' } as React.CSSProperties}
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowPasswordPrompt(false);
                  setPasswordInput("");
                }}
              >
                {t("cancel")}
              </Button>
              <Button
                className="flex-1"
                onClick={handleUnlockEdit}
                disabled={!passwordInput || verifying}
              >
                {verifying ? "..." : t("unlock")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-6">
            <AlertCircle className="w-12 h-12 mx-auto text-destructive mb-4" />
            <h2 className="text-lg font-bold mb-2">{t("privateTrip")}</h2>
            <p className="text-muted-foreground mb-4">{t("privateNoAccess")}</p>
            <Button onClick={() => navigate("/")} variant="outline">
              {t("back")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!project) return null;

  const currentDay = project.itinerary.find((d) => d.dayNumber === activeDay);
  const days = differenceInDays(project.endDate, project.startDate) + 1;
  const totalItems = project.itinerary.reduce((sum, day) => sum + day.items.length, 0);

  const getNextSuggestedTime = (): string | undefined => {
    if (!currentDay || currentDay.items.length === 0) return undefined;
    const lastItem = currentDay.items[currentDay.items.length - 1];
    const [hours, mins] = lastItem.endTime.split(":").map(Number);
    const totalMins = hours * 60 + mins;
    if (totalMins >= 23 * 60 + 50) return undefined;
    const newHours = Math.floor(totalMins / 60);
    const newMins = totalMins % 60;
    return `${newHours.toString().padStart(2, "0")}:${newMins.toString().padStart(2, "0")}`;
  };

  // Project overview / landing page
  if (!showItinerary) {
    return (
      <div className="min-h-screen bg-background">
        {/* Smart App Banner */}
        <SmartAppBanner projectId={project.id} />

        {/* Header */}
        <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-lg border-b border-border/50 shadow-sm">
          <div className="container max-w-4xl py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img 
                  src={dogTravelNew} 
                  alt="" 
                  className="w-8 h-8 object-contain"
                />
                <span className="font-bold text-foreground">PeiPeiGoTravel</span>
              </div>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => navigate("/")}
                className="gap-2"
              >
                <Home className="w-4 h-4" />
                {t("myProjects")}
              </Button>
            </div>
          </div>
        </header>

        {/* Project Overview */}
        <main className="container max-w-4xl py-8">
          <Card className="overflow-hidden">
            {signedCoverImage ? (
              <div className="h-48 md:h-64 overflow-hidden">
                <img 
                  src={signedCoverImage} 
                  alt={project.name}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <div className="h-48 md:h-64 bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                <MapPin className="w-16 h-16 text-primary/30" />
              </div>
            )}

            <CardContent className="p-6">
              <h1 className="text-2xl font-bold text-foreground mb-2">
                {project.name}
              </h1>

              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mb-6">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  <span>
                    {formatDate(project.startDate, i18n.language)} - {formatDate(project.endDate, i18n.language)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  <span>{days} {t("days")}</span>
                </div>
                <span className="text-primary font-medium">
                  {totalItems} {t("items")}
                </span>
              </div>

              {/* Join description */}
              <p className="text-sm text-muted-foreground mb-6 flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" />
                {t("joinAsCompanion")}
              </p>

              {/* Action Buttons */}
              <div className="flex flex-col gap-3">
                <Button 
                  onClick={handleJoinProject} 
                  className="w-full gap-2"
                  size="lg"
                  disabled={joining}
                >
                  {joining ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <UserPlus className="w-4 h-4" />
                  )}
                  {joining ? t("joiningProject") : t("joinProject")}
                </Button>

                <Button 
                  onClick={() => setShowItinerary(true)} 
                  variant="outline"
                  className="w-full gap-2"
                  size="lg"
                >
                  <Eye className="w-4 h-4" />
                  {t("viewOnly")}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Mode badge */}
          <p className="text-center text-xs text-muted-foreground mt-4">
            {canEdit ? (
              <span className="text-primary">✏️ {t("editMode")}</span>
            ) : (
              t("readOnlyMode")
            )}
          </p>

          {/* Edit unlock button */}
          {hasEditPassword && !canEdit && (
            <div className="text-center mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPasswordPrompt(true)}
                className="gap-2"
              >
                <Lock className="w-4 h-4" />
                {t("wantToEdit")}
              </Button>
            </div>
          )}

          {/* Login dialog hint */}
          {!user && (
            <p className="text-center text-xs text-muted-foreground mt-4">
              {t("loginToJoin")}
            </p>
          )}
        </main>

        {/* Footer */}
        <footer className="border-t border-border py-6 mt-8">
          <div className="container max-w-4xl text-center">
            <p className="text-sm text-muted-foreground mb-3">
              PeiPeiGoTravel
            </p>
            <Button onClick={() => navigate("/")} variant="default">
              {t("newProject")}
            </Button>
          </div>
        </footer>

        {/* Login Dialog */}
        <LoginDialog 
          open={showLoginDialog} 
          onOpenChange={setShowLoginDialog} 
        />
      </div>
    );
  }

  // Itinerary view
  return (
    <div className="min-h-screen bg-background">
      {/* Smart App Banner */}
      <SmartAppBanner projectId={project.id} />

      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-lg border-b border-border/50 shadow-sm">
        <div className="container max-w-4xl py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setShowItinerary(false)}
                className="gap-2"
              >
                ← {t("back")}
              </Button>
              <div>
                <h1 className="text-lg font-bold text-foreground line-clamp-1">
                  {project.name}
                </h1>
                <p className="text-xs text-muted-foreground">
                  {formatShortDate(project.startDate, i18n.language)} - {formatShortDate(project.endDate, i18n.language)}
                  <span className={`ml-2 ${canEdit ? "text-primary" : "text-muted-foreground"}`}>
                    • {canEdit ? t("editMode") : t("readOnlyMode")}
                  </span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {hasEditPassword && !canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPasswordPrompt(true)}
                  className="gap-1.5"
                >
                  <Lock className="w-4 h-4" />
                  <span className="hidden sm:inline">{t("unlock")}</span>
                </Button>
              )}
              {/* Join button in header */}
              {!canEdit && user && (
                <Button
                  size="sm"
                  onClick={handleJoinProject}
                  disabled={joining}
                  className="gap-1.5"
                >
                  <UserPlus className="w-4 h-4" />
                  <span className="hidden sm:inline">{t("joinProject")}</span>
                </Button>
              )}
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => navigate("/")}
                className="gap-2"
              >
                <Home className="w-4 h-4" />
                <span className="hidden sm:inline">{t("myProjects")}</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Day Tabs */}
      <DayTabs
        itinerary={project.itinerary}
        activeDay={activeDay}
        onDayChange={setActiveDay}
      />

      {/* Itinerary Content */}
      <main className="container max-w-4xl py-6">
        {currentDay && (
          <ItineraryList
            day={currentDay}
            onAddItem={() => canEdit && setDialogOpen(true)}
            onEditItem={(item) => canEdit && setEditingItem(item)}
            onDeleteItem={canEdit ? handleDeleteItem : () => {}}
            readOnly={!canEdit}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-6 mt-8">
        <div className="container max-w-4xl text-center">
          <p className="text-sm text-muted-foreground mb-3">
            PeiPeiGoTravel
          </p>
          <Button onClick={() => navigate("/")} variant="default">
            {t("newProject")}
          </Button>
        </div>
      </footer>

      {/* Add/Edit Dialog */}
      <ItineraryItemDialog
        open={dialogOpen || !!editingItem}
        onOpenChange={(open) => {
          if (!open) {
            setDialogOpen(false);
            setEditingItem(null);
          }
        }}
        onSubmit={editingItem ? handleEditItem : handleAddItem}
        initialData={editingItem || undefined}
        mode={editingItem ? "edit" : "create"}
        suggestedStartTime={getNextSuggestedTime()}
        existingItems={currentDay?.items || []}
      />

      {/* Login Dialog */}
      <LoginDialog 
        open={showLoginDialog} 
        onOpenChange={setShowLoginDialog} 
      />
    </div>
  );
}
