---
title: Ticket Link-Out Management
status: in_progress
priority: high
type: feature
tags: [tickets, admin, shows, map]
created_by: agent
created_at: 2026-11-25T04:14:00Z
position: 11
---

## Notes
Scope locked with user: ticket sales stay external link-out (no Stripe/native checkout/inventory). This task covers giving admins a real way to manage `upcoming_shows` rows (currently no admin UI exists — the table is only read by `/api/shows/upcoming` for the `ShowsMapOverlay`) and polishing the listener-facing popup.

`upcoming_shows` columns: artist_name, venue_name, city, lat, lng, show_date, ticket_url, ticket_status (available / few left / resale only), image_url. RLS: public read, admin-only write (checks `raw_user_meta_data->>'role' = 'admin'`).

## Checklist
- [x] Admin page `/admin/shows.tsx`: table of all shows (past + upcoming), Add/Edit dialog with fields artist_name, venue_name, city, lat, lng, show_date, ticket_url, ticket_status select, image_url; delete with confirm
- [x] Link "Shows & Tickets" card into `/admin/index.tsx` dashboard (admin-only)
- [x] Show `image_url` (when present) in the `ShowsMapOverlay` popup for a richer listener-facing card
- [ ] Verify end-to-end: add a show as admin, confirm it appears on the map popup with working "Get Tickets" link

## Acceptance
- An admin can create, edit, and delete a show from `/admin/shows` without touching SQL.
- The map popup for a show with an image shows that image above the artist name.