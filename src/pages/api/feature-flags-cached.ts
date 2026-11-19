import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@/integrations/supabase/client";

// In-memory cache - 5 minute TTL to reduce Supabase queries
let cache: { data: any[]; timestamp: number } | null = null;
const CACHE_TTL = 300000; // 5 minutes

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Return cached data if fresh
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ data: cache.data });
  }

  const supabase = createClient();

  try {
    const { data, error } = await supabase
      .from("feature_flags")
      .select("*")
      .order("flag_name", { ascending: true });

    if (error) {
      console.error("[feature-flags-cached] Error:", error);
      return res.status(500).json({ error: "Failed to fetch feature flags" });
    }

    // Cache the result
    cache = { data: data || [], timestamp: Date.now() };

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ data: data || [] });
  } catch (err) {
    console.error("[feature-flags-cached] Unexpected error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}