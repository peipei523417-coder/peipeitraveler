import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listTripsTool from "./tools/list-trips";
import getTripItineraryTool from "./tools/get-trip-itinerary";

// The OAuth issuer MUST be the direct Supabase host (see cloud-auth-oauth-server).
// VITE_SUPABASE_PROJECT_ID is inlined by Vite at build time, keeping this entry
// import-safe (no runtime env reads at module top level).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "peitravel-mcp",
  title: "PeiTravel MCP",
  version: "0.1.0",
  instructions:
    "Tools for the signed-in PeiTravel user. Use `list_trips` to enumerate their travel projects, and `get_trip_itinerary` to read the day-by-day items of one trip.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listTripsTool, getTripItineraryTool],
});
