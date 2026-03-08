import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Find projects where end_date + 30 days has passed
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    const cutoffStr = cutoffDate.toISOString().split("T")[0];

    const { data: expiredProjects, error: fetchError } = await supabase
      .from("travel_projects")
      .select("id")
      .lte("end_date", cutoffStr);

    if (fetchError) {
      console.error("Error fetching expired projects:", fetchError);
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!expiredProjects || expiredProjects.length === 0) {
      return new Response(
        JSON.stringify({ message: "No expired projects found", deleted: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let deletedCount = 0;

    for (const project of expiredProjects) {
      const pid = project.id;

      // 1. Delete storage files for this project
      const { data: files } = await supabase.storage
        .from("project-images")
        .list(pid);

      if (files && files.length > 0) {
        const filePaths = files.map((f) => `${pid}/${f.name}`);
        await supabase.storage.from("project-images").remove(filePaths);
      }

      // 2. Delete itinerary items (cascade would handle this, but be explicit)
      await supabase.from("itinerary_items").delete().eq("project_id", pid);

      // 3. Delete collaborators
      await supabase
        .from("project_collaborators")
        .delete()
        .eq("project_id", pid);

      // 4. Delete share links
      await supabase.from("share_links").delete().eq("project_id", pid);

      // 5. Delete password attempts
      await supabase.from("password_attempts").delete().eq("project_id", pid);

      // 6. Delete the project itself
      const { error: delError } = await supabase
        .from("travel_projects")
        .delete()
        .eq("id", pid);

      if (!delError) {
        deletedCount++;
        console.log(`[Cleanup] Deleted expired project: ${pid}`);
      } else {
        console.error(`[Cleanup] Failed to delete project ${pid}:`, delError);
      }
    }

    return new Response(
      JSON.stringify({
        message: `Cleanup complete`,
        deleted: deletedCount,
        total_expired: expiredProjects.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Cleanup] Unexpected error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
