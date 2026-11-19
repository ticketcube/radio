import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@/integrations/supabase/client";

// In-memory cache to reduce Supabase query load
let cache: { data: any; timestamp: number } | null = null;
const CACHE_TTL = 60000; // 1 minute cache

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Return cached data if fresh
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json(cache.data);
  }

  const supabase = createClient();

  try {
    // Get the most recent mood submission per city (last 5 minutes)
    const { data, error } = await supabase
      .from("mood_changes")
      .select("city, mood_category, created_at")
      .not("city", "is", null)
      .neq("city", "Local")
      .gte("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[city-aggregates] Error fetching city moods:", error);
      return res.status(500).json({ error: "Failed to fetch city mood data" });
    }

    console.log(`[city-aggregates] Found ${data?.length || 0} mood changes in last 5 minutes`);

    // Get most recent mood per city
    const cityMap = new Map();
    data?.forEach((mood: any) => {
      if (!cityMap.has(mood.city)) {
        cityMap.set(mood.city, {
          city: mood.city,
          mood: mood.mood_category,
          timestamp: mood.created_at
        });
      }
    });

    const result = {
      cities: Array.from(cityMap.values()),
      total_changes: data?.length || 0
    };

    console.log(`[city-aggregates] Returning ${result.cities.length} unique cities with moods`);
    
    // Cache the result
    cache = { data: result, timestamp: Date.now() };

    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json(result);
  } catch (err) {
    console.error("[city-aggregates] Unexpected error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}