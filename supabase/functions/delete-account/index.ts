import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify the user's JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Create a client with the user's JWT to identify them
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = user.id;

    // Use service role client for privileged operations
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Delete user's itinerary items (via projects)
    const { data: projects } = await adminClient
      .from("travel_projects")
      .select("id")
      .eq("user_id", userId);

    if (projects && projects.length > 0) {
      const projectIds = projects.map((p: any) => p.id);
      await adminClient
        .from("itinerary_items")
        .delete()
        .in("project_id", projectIds);
      
      // Delete share links
      await adminClient
        .from("share_links")
        .delete()
        .in("project_id", projectIds);

      // Delete project collaborators
      await adminClient
        .from("project_collaborators")
        .delete()
        .in("project_id", projectIds);

      // Delete password attempts
      await adminClient
        .from("password_attempts")
        .delete()
        .in("project_id", projectIds);
    }

    // 2. Delete user's travel projects
    await adminClient
      .from("travel_projects")
      .delete()
      .eq("user_id", userId);

    // 3. Delete user's collaborator records (where they were invited)
    const userEmail = user.email;
    if (userEmail) {
      await adminClient
        .from("project_collaborators")
        .delete()
        .eq("email", userEmail);

      await adminClient
        .from("frequent_collaborators")
        .delete()
        .eq("user_id", userId);
    }

    // 4. Delete travel groups
    const { data: groups } = await adminClient
      .from("travel_groups")
      .select("id")
      .eq("user_id", userId);

    if (groups && groups.length > 0) {
      const groupIds = groups.map((g: any) => g.id);
      await adminClient
        .from("travel_group_members")
        .delete()
        .in("group_id", groupIds);
    }

    await adminClient
      .from("travel_groups")
      .delete()
      .eq("user_id", userId);

    // 5. Delete user profile
    await adminClient
      .from("user_profiles")
      .delete()
      .eq("user_id", userId);

    // 6. Delete the auth user (CRITICAL for App Store / Google Play compliance)
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error("Failed to delete auth user:", deleteError);
      return new Response(
        JSON.stringify({ error: "Failed to delete account" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Delete account error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
