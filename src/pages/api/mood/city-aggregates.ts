import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@/integrations/supabase/client";

// CONFIGURATION - Easy to tweak
const CONFIG = {
  AGGREGATE_WINDOW: 100, // Last N submissions for color calculation
  CACHE_TTL_MS: 60000, // 1 minute cache
};

// In-memory cache to reduce Supabase query load
let cache: { data: any; timestamp: number } | null = null;

// Mood color mapping (fetch from database on first request)
let moodColors: Map<string, string> | null = null;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Return cached data if fresh
  if (cache && Date.now() - cache.timestamp < CONFIG.CACHE_TTL_MS) {
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json(cache.data);
  }

  const supabase = createClient();

  try {
    // Load mood colors if not cached
    if (!moodColors) {
      const { data: moodCategories } = await supabase
        .from("mood_categories")
        .select("category_name, color_hsl")
        .eq("enabled", true);
      
      moodColors = new Map();
      moodCategories?.forEach((m: any) => {
        moodColors!.set(m.category_name, m.color_hsl);
      });
    }

    // Get the most recent mood submission per city (last 5 minutes)
    const { data: cityData, error: cityError } = await supabase
      .from("mood_changes")
      .select("city, mood_category, created_at")
      .not("city", "is", null)
      .neq("city", "Local")
      .gte("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false });

    if (cityError) {
      console.error("[city-aggregates] Error fetching city moods:", cityError);
      return res.status(500).json({ error: "Failed to fetch city mood data" });
    }

    // Get most recent mood per city
    const cityMap = new Map();
    cityData?.forEach((mood: any) => {
      if (!cityMap.has(mood.city)) {
        cityMap.set(mood.city, {
          city: mood.city,
          mood: mood.mood_category,
          timestamp: mood.created_at
        });
      }
    });

    // Get last N submissions for aggregate color calculation
    const { data: recentSubmissions, error: aggError } = await supabase
      .from("mood_changes")
      .select("mood_category")
      .order("created_at", { ascending: false })
      .limit(CONFIG.AGGREGATE_WINDOW);

    if (aggError) {
      console.error("[city-aggregates] Error fetching aggregate data:", aggError);
    }

    // Calculate aggregate color by counting votes
    const voteCounts: Map<string, number> = new Map();
    recentSubmissions?.forEach((s: any) => {
      const count = voteCounts.get(s.mood_category) || 0;
      voteCounts.set(s.mood_category, count + 1);
    });

    // Blend HSL colors weighted by vote count
    let aggregateColor = "hsl(0 0% 20%)"; // Default gray
    
    if (voteCounts.size > 0) {
      let totalH = 0, totalS = 0, totalL = 0, totalWeight = 0;
      
      for (const [mood, count] of voteCounts.entries()) {
        const colorHsl = moodColors?.get(mood);
        if (colorHsl) {
          const match = colorHsl.match(/(\d+)\s+(\d+)%\s+(\d+)%/);
          if (match) {
            const h = parseInt(match[1]);
            const s = parseInt(match[2]);
            const l = parseInt(match[3]);
            
            totalH += h * count;
            totalS += s * count;
            totalL += l * count;
            totalWeight += count;
          }
        }
      }
      
      if (totalWeight > 0) {
        const avgH = Math.round(totalH / totalWeight);
        const avgS = Math.round(totalS / totalWeight);
        const avgL = Math.round(totalL / totalWeight);
        aggregateColor = `hsl(${avgH} ${avgS}% ${avgL}%)`;
      }
    }

    const result = {
      cities: Array.from(cityMap.values()),
      total_changes: cityData?.length || 0,
      aggregateColor,
      aggregateWindow: CONFIG.AGGREGATE_WINDOW,
      voteCounts: Array.from(voteCounts.entries()).map(([mood, count]) => ({ mood, count }))
    };

    console.log(`[city-aggregates] Aggregate color: ${aggregateColor} from ${voteCounts.size} moods`);
    
    // Cache the result
    cache = { data: result, timestamp: Date.now() };

    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json(result);
  } catch (err) {
    console.error("[city-aggregates] Unexpected error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}