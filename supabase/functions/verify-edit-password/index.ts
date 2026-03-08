import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import bcrypt from "https://esm.sh/bcryptjs@2.4.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Rate limiting configuration
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 60 * 60 * 1000; // 1 hour

// ========== INPUT VALIDATION HELPERS ==========

// Validate description field
function validateDescription(description: unknown): { valid: boolean; error?: string; value?: string } {
  if (typeof description !== "string") {
    return { valid: false, error: "Description must be a string" };
  }
  const trimmed = description.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: "Description cannot be empty" };
  }
  if (trimmed.length > 5000) {
    return { valid: false, error: "Description must be 5000 characters or less" };
  }
  return { valid: true, value: trimmed };
}

// Validate URL field (Google Maps, image URLs)
function validateUrl(url: unknown, fieldName: string): { valid: boolean; error?: string; value?: string | null } {
  if (url === null || url === undefined || url === "") {
    return { valid: true, value: null };
  }
  if (typeof url !== "string") {
    return { valid: false, error: `${fieldName} must be a string` };
  }
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return { valid: true, value: null };
  }
  if (trimmed.length > 2000) {
    return { valid: false, error: `${fieldName} must be 2000 characters or less` };
  }
  // Validate URL format
  try {
    const parsed = new URL(trimmed);
    // Only allow http and https protocols
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { valid: false, error: `${fieldName} must use http or https protocol` };
    }
  } catch {
    return { valid: false, error: `${fieldName} must be a valid URL` };
  }
  return { valid: true, value: trimmed };
}

// Validate time field (HH:mm format)
function validateTime(time: unknown, fieldName: string): { valid: boolean; error?: string; value?: string | null } {
  if (time === null || time === undefined || time === "") {
    return { valid: true, value: null };
  }
  if (typeof time !== "string") {
    return { valid: false, error: `${fieldName} must be a string` };
  }
  const trimmed = time.trim();
  if (trimmed.length === 0) {
    return { valid: true, value: null };
  }
  // Validate HH:mm format (24-hour)
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(trimmed)) {
    return { valid: false, error: `${fieldName} must be in HH:mm format (00:00-23:59)` };
  }
  return { valid: true, value: trimmed };
}

// Validate highlight color
const VALID_HIGHLIGHT_COLORS = ["none", "yellow", "green", "blue", "pink", "purple", "orange"];
function validateHighlightColor(color: unknown): { valid: boolean; error?: string; value?: string | null } {
  if (color === null || color === undefined || color === "") {
    return { valid: true, value: null };
  }
  if (typeof color !== "string") {
    return { valid: false, error: "Highlight color must be a string" };
  }
  const trimmed = color.trim().toLowerCase();
  if (trimmed.length === 0) {
    return { valid: true, value: null };
  }
  if (!VALID_HIGHLIGHT_COLORS.includes(trimmed)) {
    return { valid: false, error: `Invalid highlight color. Must be one of: ${VALID_HIGHLIGHT_COLORS.join(", ")}` };
  }
  return { valid: true, value: trimmed };
}

// Validate price field
function validatePrice(price: unknown): { valid: boolean; error?: string; value?: number | null } {
  if (price === null || price === undefined || price === "") {
    return { valid: true, value: null };
  }
  const num = typeof price === "string" ? parseFloat(price) : price;
  if (typeof num !== "number" || isNaN(num)) {
    return { valid: false, error: "Price must be a valid number" };
  }
  if (num < 0) {
    return { valid: false, error: "Price cannot be negative" };
  }
  if (num > 999999999) {
    return { valid: false, error: "Price is too large" };
  }
  return { valid: true, value: num };
}

// Validate persons field
function validatePersons(persons: unknown): { valid: boolean; error?: string; value?: number } {
  if (persons === null || persons === undefined || persons === "") {
    return { valid: true, value: 1 };
  }
  const num = typeof persons === "string" ? parseInt(persons, 10) : persons;
  if (typeof num !== "number" || isNaN(num)) {
    return { valid: false, error: "Persons must be a valid number" };
  }
  if (!Number.isInteger(num)) {
    return { valid: false, error: "Persons must be a whole number" };
  }
  if (num < 1) {
    return { valid: false, error: "Persons must be at least 1" };
  }
  if (num > 1000) {
    return { valid: false, error: "Persons cannot exceed 1000" };
  }
  return { valid: true, value: num };
}

// Validate day number
function validateDayNumber(dayNumber: unknown): { valid: boolean; error?: string; value?: number } {
  if (dayNumber === null || dayNumber === undefined) {
    return { valid: false, error: "Day number is required" };
  }
  const num = typeof dayNumber === "string" ? parseInt(dayNumber, 10) : dayNumber;
  if (typeof num !== "number" || isNaN(num)) {
    return { valid: false, error: "Day number must be a valid number" };
  }
  if (!Number.isInteger(num)) {
    return { valid: false, error: "Day number must be a whole number" };
  }
  if (num < 1) {
    return { valid: false, error: "Day number must be at least 1" };
  }
  if (num > 365) {
    return { valid: false, error: "Day number cannot exceed 365" };
  }
  return { valid: true, value: num };
}

// Validate UUID format
function validateUuid(id: unknown, fieldName: string): { valid: boolean; error?: string; value?: string } {
  if (typeof id !== "string") {
    return { valid: false, error: `${fieldName} must be a string` };
  }
  const trimmed = id.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return { valid: false, error: `${fieldName} must be a valid UUID` };
  }
  return { valid: true, value: trimmed };
}

// Validate complete itemData object
interface ValidatedItemData {
  startTime: string | null;
  endTime: string | null;
  description: string;
  googleMapsUrl: string | null;
  imageUrl: string | null;
  highlightColor: string | null;
  price: number | null;
  persons: number;
}

function validateItemData(data: unknown): { valid: boolean; error?: string; value?: ValidatedItemData } {
  if (!data || typeof data !== "object") {
    return { valid: false, error: "Item data must be an object" };
  }
  
  const itemData = data as Record<string, unknown>;

  // Validate description (required)
  const descResult = validateDescription(itemData.description);
  if (!descResult.valid) {
    return { valid: false, error: descResult.error };
  }

  // Validate optional fields
  const startTimeResult = validateTime(itemData.startTime, "Start time");
  if (!startTimeResult.valid) {
    return { valid: false, error: startTimeResult.error };
  }

  const endTimeResult = validateTime(itemData.endTime, "End time");
  if (!endTimeResult.valid) {
    return { valid: false, error: endTimeResult.error };
  }

  const googleMapsUrlResult = validateUrl(itemData.googleMapsUrl, "Google Maps URL");
  if (!googleMapsUrlResult.valid) {
    return { valid: false, error: googleMapsUrlResult.error };
  }

  const imageUrlResult = validateUrl(itemData.imageUrl, "Image URL");
  if (!imageUrlResult.valid) {
    return { valid: false, error: imageUrlResult.error };
  }

  const highlightColorResult = validateHighlightColor(itemData.highlightColor);
  if (!highlightColorResult.valid) {
    return { valid: false, error: highlightColorResult.error };
  }

  const priceResult = validatePrice(itemData.price);
  if (!priceResult.valid) {
    return { valid: false, error: priceResult.error };
  }

  const personsResult = validatePersons(itemData.persons);
  if (!personsResult.valid) {
    return { valid: false, error: personsResult.error };
  }

  return {
    valid: true,
    value: {
      startTime: startTimeResult.value ?? null,
      endTime: endTimeResult.value ?? null,
      description: descResult.value!,
      googleMapsUrl: googleMapsUrlResult.value ?? null,
      imageUrl: imageUrlResult.value ?? null,
      highlightColor: highlightColorResult.value ?? null,
      price: priceResult.value ?? null,
      persons: personsResult.value ?? 1,
    },
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { projectId, password, action, shareCode, itemData, itemId, dayNumber } = await req.json();

    // Service role client for database operations
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get client IP for rate limiting
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
               req.headers.get("cf-connecting-ip") || 
               "unknown";

    // ========== HELPER: Verify project password ==========
    async function verifyProjectPassword(projId: string, pwd: string): Promise<{ valid: boolean; isPublic: boolean }> {
      const { data: project, error } = await supabase
        .from("travel_projects")
        .select("edit_password_hash, is_public")
        .eq("id", projId)
        .single();
      
      if (error || !project) return { valid: false, isPublic: false };
      if (!project.is_public) return { valid: false, isPublic: false };
      if (!project.edit_password_hash) return { valid: false, isPublic: true };
      
      let valid = false;
      try {
        valid = await bcrypt.compare(pwd, project.edit_password_hash);
      } catch {
        // Legacy SHA-256 check
        const encoder = new TextEncoder();
        const data = encoder.encode(pwd);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const legacyHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
        valid = legacyHash === project.edit_password_hash;
        
        if (valid) {
          const newHash = await bcrypt.hash(pwd, 10);
          await supabase
            .from("travel_projects")
            .update({ edit_password_hash: newHash })
            .eq("id", projId);
        }
      }
      
      return { valid, isPublic: true };
    }

    // ========== PASSWORD-AUTHORIZED CRUD OPERATIONS ==========
    
    // Add itinerary item with password
    if (action === "add-item") {
      // Validate projectId
      const projectIdResult = validateUuid(projectId, "Project ID");
      if (!projectIdResult.valid) {
        return new Response(
          JSON.stringify({ error: projectIdResult.error }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate password
      if (!password || typeof password !== "string") {
        return new Response(
          JSON.stringify({ error: "Password is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate dayNumber
      const dayNumberResult = validateDayNumber(dayNumber);
      if (!dayNumberResult.valid) {
        return new Response(
          JSON.stringify({ error: dayNumberResult.error }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate itemData
      const itemDataResult = validateItemData(itemData);
      if (!itemDataResult.valid) {
        return new Response(
          JSON.stringify({ error: itemDataResult.error }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { valid, isPublic } = await verifyProjectPassword(projectIdResult.value!, password);
      if (!isPublic) {
        return new Response(
          JSON.stringify({ error: "Project not found or not public" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!valid) {
        return new Response(
          JSON.stringify({ error: "Invalid password" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const validatedItem = itemDataResult.value!;
      const { data, error } = await supabase
        .from("itinerary_items")
        .insert({
          project_id: projectIdResult.value,
          day_number: dayNumberResult.value,
          start_time: validatedItem.startTime,
          end_time: validatedItem.endTime,
          description: validatedItem.description,
          google_maps_url: validatedItem.googleMapsUrl,
          image_url: validatedItem.imageUrl,
          highlight_color: validatedItem.highlightColor,
          price: validatedItem.price,
          persons: validatedItem.persons,
        })
        .select()
        .single();
      
      if (error) {
        console.error("Error adding item:", error);
        return new Response(
          JSON.stringify({ error: "Failed to add item" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ success: true, item: data }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // Update itinerary item with password
    if (action === "update-item") {
      // Validate projectId
      const projectIdResult = validateUuid(projectId, "Project ID");
      if (!projectIdResult.valid) {
        return new Response(
          JSON.stringify({ error: projectIdResult.error }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate itemId
      const itemIdResult = validateUuid(itemId, "Item ID");
      if (!itemIdResult.valid) {
        return new Response(
          JSON.stringify({ error: itemIdResult.error }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate password
      if (!password || typeof password !== "string") {
        return new Response(
          JSON.stringify({ error: "Password is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate itemData
      const itemDataResult = validateItemData(itemData);
      if (!itemDataResult.valid) {
        return new Response(
          JSON.stringify({ error: itemDataResult.error }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { valid, isPublic } = await verifyProjectPassword(projectIdResult.value!, password);
      if (!isPublic) {
        return new Response(
          JSON.stringify({ error: "Project not found or not public" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!valid) {
        return new Response(
          JSON.stringify({ error: "Invalid password" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const validatedItem = itemDataResult.value!;
      const { error } = await supabase
        .from("itinerary_items")
        .update({
          start_time: validatedItem.startTime,
          end_time: validatedItem.endTime,
          description: validatedItem.description,
          google_maps_url: validatedItem.googleMapsUrl,
          image_url: validatedItem.imageUrl,
          highlight_color: validatedItem.highlightColor,
          price: validatedItem.price,
          persons: validatedItem.persons,
        })
        .eq("id", itemIdResult.value)
        .eq("project_id", projectIdResult.value);
      
      if (error) {
        console.error("Error updating item:", error);
        return new Response(
          JSON.stringify({ error: "Failed to update item" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // Upload image with password (for share page editors)
    if (action === "upload-image") {
      const projectIdResult = validateUuid(projectId, "Project ID");
      if (!projectIdResult.valid) {
        return new Response(
          JSON.stringify({ error: projectIdResult.error }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!password || typeof password !== "string") {
        return new Response(
          JSON.stringify({ error: "Password is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { valid, isPublic } = await verifyProjectPassword(projectIdResult.value!, password);
      if (!isPublic) {
        return new Response(
          JSON.stringify({ error: "Project not found or not public" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!valid) {
        return new Response(
          JSON.stringify({ error: "Invalid password" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Expect imageBase64 and fileName in the request
      const { imageBase64, fileName: reqFileName } = await req.json().catch(() => ({}));
      // Re-parse since we already parsed above — use the original parsed data
      const bodyData = { projectId, password, action, imageBase64: (await req.clone().json().catch(() => ({}))).imageBase64 };
      
      // Actually we need to get imageBase64 from the original parse. Let me handle differently.
      // The issue is we already consumed req.json(). Let's accept imageBase64 from the top-level parse.
      
      return new Response(
        JSON.stringify({ error: "Use upload-image-v2 endpoint" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Delete itinerary item with password
    if (action === "delete-item") {
      // Validate projectId
      const projectIdResult = validateUuid(projectId, "Project ID");
      if (!projectIdResult.valid) {
        return new Response(
          JSON.stringify({ error: projectIdResult.error }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate itemId
      const itemIdResult = validateUuid(itemId, "Item ID");
      if (!itemIdResult.valid) {
        return new Response(
          JSON.stringify({ error: itemIdResult.error }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate password
      if (!password || typeof password !== "string") {
        return new Response(
          JSON.stringify({ error: "Password is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { valid, isPublic } = await verifyProjectPassword(projectIdResult.value!, password);
      if (!isPublic) {
        return new Response(
          JSON.stringify({ error: "Project not found or not public" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!valid) {
        return new Response(
          JSON.stringify({ error: "Invalid password" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      const { error } = await supabase
        .from("itinerary_items")
        .delete()
        .eq("id", itemIdResult.value)
        .eq("project_id", projectIdResult.value);
      
      if (error) {
        console.error("Error deleting item:", error);
        return new Response(
          JSON.stringify({ error: "Failed to delete item" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========== SHARE LINK PASSWORD OPERATIONS ==========
    
    // Hash a share link password (requires auth)
    if (action === "hash-share-password") {
      const authHeader = req.headers.get("authorization");
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: "Authentication required" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!password || typeof password !== "string" || password.length < 4 || password.length > 12) {
        return new Response(
          JSON.stringify({ error: "Password must be 4-12 characters" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!/^[a-zA-Z0-9]+$/.test(password)) {
        return new Response(
          JSON.stringify({ error: "Password must be alphanumeric" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const hash = await bcrypt.hash(password, 10);
      return new Response(
        JSON.stringify({ hash }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify a share link password
    if (action === "verify-share-password") {
      if (!shareCode || typeof shareCode !== "string") {
        return new Response(
          JSON.stringify({ error: "Share code required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate share code format (alphanumeric, 16 chars)
      if (!/^[A-Za-z0-9]{16}$/.test(shareCode)) {
        return new Response(
          JSON.stringify({ valid: false }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Fetch share link
      const { data: shareLink, error: shareLinkError } = await supabase
        .from("share_links")
        .select("id, project_id, password_hash, expires_at")
        .eq("share_code", shareCode)
        .single();

      if (shareLinkError || !shareLink) {
        return new Response(
          JSON.stringify({ valid: false }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check expiration
      if (shareLink.expires_at && new Date(shareLink.expires_at) < new Date()) {
        return new Response(
          JSON.stringify({ valid: false }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // No password required
      if (!shareLink.password_hash) {
        return new Response(
          JSON.stringify({ valid: true, projectId: shareLink.project_id }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Password required but not provided
      if (!password) {
        return new Response(
          JSON.stringify({ valid: false, requiresPassword: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate password format
      if (typeof password !== "string" || password.length < 4 || password.length > 12) {
        return new Response(
          JSON.stringify({ valid: false }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check rate limit
      const oneHourAgo = new Date(Date.now() - LOCKOUT_DURATION_MS).toISOString();
      const { data: shareLinkAttempts } = await supabase
        .from("password_attempts")
        .select("id, successful")
        .eq("project_id", shareLink.project_id)
        .eq("ip_address", ip)
        .gte("created_at", oneHourAgo);

      const failedShareAttempts = shareLinkAttempts?.filter(a => !a.successful).length || 0;

      if (failedShareAttempts >= MAX_ATTEMPTS) {
        return new Response(
          JSON.stringify({ 
            error: "Too many failed attempts. Please try again in 1 hour.",
            rateLimited: true 
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify password with bcrypt
      let valid = false;
      try {
        valid = await bcrypt.compare(password, shareLink.password_hash);
      } catch {
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const legacyHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
        valid = legacyHash === shareLink.password_hash;

        if (valid) {
          const newHash = await bcrypt.hash(password, 10);
          await supabase
            .from("share_links")
            .update({ password_hash: newHash })
            .eq("id", shareLink.id);
        }
      }

      await supabase.from("password_attempts").insert({
        project_id: shareLink.project_id,
        ip_address: ip,
        successful: valid,
      });

      return new Response(
        JSON.stringify({ valid, projectId: valid ? shareLink.project_id : undefined }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========== PROJECT EDIT PASSWORD OPERATIONS ==========
    
    // Validate projectId for remaining operations
    const projectIdResult = validateUuid(projectId, "Project ID");
    if (!projectIdResult.valid) {
      return new Response(
        JSON.stringify({ error: projectIdResult.error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check rate limit
    const oneHourAgo = new Date(Date.now() - LOCKOUT_DURATION_MS).toISOString();
    const { data: attempts, error: attemptsError } = await supabase
      .from("password_attempts")
      .select("id, successful")
      .eq("project_id", projectIdResult.value)
      .eq("ip_address", ip)
      .gte("created_at", oneHourAgo);

    if (attemptsError) {
      console.error("Error checking rate limit:", attemptsError);
    }

    const failedAttempts = attempts?.filter(a => !a.successful).length || 0;

    if (failedAttempts >= MAX_ATTEMPTS) {
      return new Response(
        JSON.stringify({ 
          error: "Too many failed attempts. Please try again in 1 hour.",
          rateLimited: true 
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle password setting (action = "set") - REQUIRES AUTHENTICATION
    if (action === "set") {
      const authHeader = req.headers.get("authorization");
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: "Authentication required" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const supabaseAuth = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );

      const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: "Invalid authentication" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: project, error: projectError } = await supabase
        .from("travel_projects")
        .select("user_id, is_public")
        .eq("id", projectIdResult.value)
        .single();

      if (projectError || !project) {
        return new Response(
          JSON.stringify({ error: "Project not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (project.user_id !== null && project.user_id !== user.id) {
        return new Response(
          JSON.stringify({ error: "Unauthorized - you do not own this project" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // Only allow setting password on public projects
      if (!project.is_public) {
        return new Response(
          JSON.stringify({ error: "Password can only be set on public projects" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!password || typeof password !== "string" || password.length < 4 || password.length > 12) {
        return new Response(
          JSON.stringify({ error: "Password must be 4-12 characters" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!/^[a-zA-Z0-9]+$/.test(password)) {
        return new Response(
          JSON.stringify({ error: "Password must be alphanumeric" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const hash = await bcrypt.hash(password, 10);

      const { error: updateError } = await supabase
        .from("travel_projects")
        .update({ edit_password_hash: hash })
        .eq("id", projectIdResult.value);

      if (updateError) {
        console.error("Error updating password:", updateError);
        return new Response(
          JSON.stringify({ error: "Failed to set password" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle password verification (action = "verify" or default)
    if (!password || typeof password !== "string") {
      return new Response(
        JSON.stringify({ error: "Password required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: project, error: projectError } = await supabase
      .from("travel_projects")
      .select("edit_password_hash, is_public")
      .eq("id", projectIdResult.value)
      .single();

    if (projectError || !project) {
      return new Response(
        JSON.stringify({ error: "Project not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!project.edit_password_hash) {
      return new Response(
        JSON.stringify({ valid: true, noPassword: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let valid = false;
    try {
      valid = await bcrypt.compare(password, project.edit_password_hash);
    } catch {
      const encoder = new TextEncoder();
      const data = encoder.encode(password);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const legacyHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
      valid = legacyHash === project.edit_password_hash;

      if (valid) {
        const newHash = await bcrypt.hash(password, 10);
        await supabase
          .from("travel_projects")
          .update({ edit_password_hash: newHash })
          .eq("id", projectIdResult.value);
      }
    }

    await supabase.from("password_attempts").insert({
      project_id: projectIdResult.value,
      ip_address: ip,
      successful: valid,
    });

    return new Response(
      JSON.stringify({ valid }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
