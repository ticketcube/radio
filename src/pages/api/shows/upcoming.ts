import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@/integrations/supabase/client";
import { findCity } from "@/lib/cities";

interface ShowItem {
  id: string;
  artist_name: string;
  venue_name: string;
  event_date: string;
  ticket_url: string | null;
  price_min: number | null;
  price_max: number | null;
}

interface CityGroup {
  city: string;
  lat: number;
  lng: number;
  count: number;
  shows: ShowItem[];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = createClient();

  const { data: flags } = await supabase
    .from("feature_flags")
    .select("enabled")
    .eq("flag_name", "shows_map_enabled")
    .single();

  if (!flags?.enabled) {
    return res.status(503).json({ error: "Shows map is currently disabled" });
  }

  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("ticketmaster_events")
    .select(
      "id, event_name, artist_name, venue_name, venue_city, event_date, event_url, price_min, price_max"
    )
    .eq("is_active", true)
    .gte("event_date", today)
    .order("event_date", { ascending: true })
    .limit(500);

  if (error) {
    console.error("Error fetching ticketmaster events:", error);
    return res.status(500).json({ error: "Failed to fetch shows" });
  }

  const groups = new Map<string, CityGroup>();

  for (const event of data || []) {
    if (!event.venue_city) continue;
    const match = findCity(event.venue_city);
    if (!match) continue;

    const key = match.city;
    if (!groups.has(key)) {
      groups.set(key, {
        city: match.city,
        lat: match.lat,
        lng: match.lng,
        count: 0,
        shows: [],
      });
    }
    const group = groups.get(key) as CityGroup;
    group.count += 1;
    if (group.shows.length < 8) {
      group.shows.push({
        id: event.id,
        artist_name: event.artist_name || event.event_name || "TBA",
        venue_name: event.venue_name || "",
        event_date: event.event_date,
        ticket_url: event.event_url,
        price_min: event.price_min,
        price_max: event.price_max,
      });
    }
  }

  return res.status(200).json({ data: Array.from(groups.values()) });
}