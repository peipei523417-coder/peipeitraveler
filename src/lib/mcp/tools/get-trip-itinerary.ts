import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "get_trip_itinerary",
  title: "Get trip itinerary",
  description: "Get the itinerary items for one of the signed-in user's trips, ordered by day and time.",
  inputSchema: {
    trip_id: z.string().uuid().describe("The travel project id (UUID)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ trip_id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data: project, error: projErr } = await supabase
      .from("travel_projects")
      .select("id,name,start_date,end_date")
      .eq("id", trip_id)
      .maybeSingle();
    if (projErr) return { content: [{ type: "text", text: projErr.message }], isError: true };
    if (!project) return { content: [{ type: "text", text: "Trip not found" }], isError: true };

    const { data: items, error } = await supabase
      .from("itinerary_items")
      .select("id,day_number,start_time,end_time,description,google_maps_url,price,persons,icon_type,sort_order")
      .eq("project_id", trip_id)
      .order("day_number", { ascending: true })
      .order("start_time", { ascending: true, nullsFirst: false })
      .order("sort_order", { ascending: true });
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const payload = { trip: project, items: items ?? [] };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
