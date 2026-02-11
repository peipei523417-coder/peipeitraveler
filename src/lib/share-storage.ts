import { supabase } from "@/integrations/supabase/client";

// Generate a random share code
function generateShareCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Hash password server-side using edge function (bcrypt)
async function hashPasswordServerSide(password: string): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-edit-password`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ action: 'hash-share-password', password }),
    }
  );

  if (!response.ok) {
    console.error('Failed to hash password server-side');
    return null;
  }

  const data = await response.json();
  return data.hash || null;
}

export async function createShareLink(
  projectId: string,
  expiresAt?: Date,
  password?: string
): Promise<{ id: string; share_code: string; expires_at: string | null; password_hash: string | null } | null> {
  const shareCode = generateShareCode();
  
  // Hash password server-side using bcrypt
  let passwordHash: string | null = null;
  if (password) {
    passwordHash = await hashPasswordServerSide(password);
    if (!passwordHash) {
      console.error("Failed to hash share link password");
      return null;
    }
  }

  const { data, error } = await supabase
    .from("share_links")
    .insert({
      project_id: projectId,
      share_code: shareCode,
      expires_at: expiresAt?.toISOString() || null,
      password_hash: passwordHash,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating share link:", error);
    return null;
  }

  return data;
}

export async function getShareLinks(projectId: string): Promise<Array<{
  id: string;
  share_code: string;
  expires_at: string | null;
  password_hash: string | null;
}>> {
  const { data, error } = await supabase
    .from("share_links")
    .select("*")
    .eq("project_id", projectId);

  if (error) {
    console.error("Error fetching share links:", error);
    return [];
  }

  return data || [];
}

export async function deleteShareLink(linkId: string): Promise<boolean> {
  const { error } = await supabase
    .from("share_links")
    .delete()
    .eq("id", linkId);

  if (error) {
    console.error("Error deleting share link:", error);
    return false;
  }
  return true;
}

// Verify share link password server-side using edge function
export async function verifyShareLink(shareCode: string, password?: string): Promise<{
  valid: boolean;
  projectId?: string;
  requiresPassword?: boolean;
}> {
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-edit-password`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ action: 'verify-share-password', shareCode, password }),
    }
  );

  if (!response.ok) {
    return { valid: false };
  }

  return await response.json();
}

export async function addCollaborator(
  projectId: string,
  email: string
): Promise<{ id: string; email: string } | null> {
  const { data, error } = await supabase
    .from("project_collaborators")
    .insert({
      project_id: projectId,
      email: email.toLowerCase(),
    })
    .select()
    .single();

  if (error) {
    console.error("Error adding collaborator:", error);
    return null;
  }

  return data;
}

export async function getCollaborators(projectId: string): Promise<Array<{
  id: string;
  email: string;
}>> {
  const { data, error } = await supabase
    .from("project_collaborators")
    .select("*")
    .eq("project_id", projectId);

  if (error) {
    console.error("Error fetching collaborators:", error);
    return [];
  }

  return data || [];
}

export async function removeCollaborator(collaboratorId: string): Promise<boolean> {
  const { error } = await supabase
    .from("project_collaborators")
    .delete()
    .eq("id", collaboratorId);

  if (error) {
    console.error("Error removing collaborator:", error);
    return false;
  }
  return true;
}
