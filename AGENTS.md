# Agent rules

- Itinerary ordering lives only in `src/lib/itinerary-order.ts`; every loader/view (ProjectDetail, SharePage, join-project, TripOverview, PDF) must use it — keeps all screens in the same order.
- A day is Hybrid only when its number is in `travel_projects.hybrid_days`; never infer the mode from `sort_order` values — legacy data has arbitrary non-zero ranks.
- In Hybrid days the DB trigger `itinerary_hybrid_rank` is the authority for timed/inserted/moved item ranks; the client only mirrors it optimistically — keeps share-page edits (edge functions) consistent.
- Legacy → Hybrid initialization and rank re-spacing go through the single RPC `apply_hybrid_day_order` — ranks and marker must change in one transaction.
