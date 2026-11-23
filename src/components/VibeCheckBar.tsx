import { useState, useEffect } from "react";
import { toast } from "sonner";
import { createClient } from "@/integrations/supabase/client";

// CONFIGURATION - Easy to tweak
const CONFIG = {
  RATE_LIMIT_SECONDS: 15,
  FLASH_DURATION_MS: 500,
  HAPTIC_DURATION_MS: 50,
  POLL_INTERVAL_MS: 120000,
};

interface VibeCheckBarProps {
  nowPlaying?: {
    title: string;
    artist: string;
    id?: string;
  };
  onVibeSubmit?: (vibe: string, color: string) => void;
  compact?: boolean;
}

type Vibe = {
  id: string;
  category_name: string;
  emoji: string;
  label: string;
  color_hsl: string;
};

export function VibeCheckBar({ nowPlaying, onVibeSubmit, compact }: VibeCheckBarProps) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [vibes, setVibes] = useState<Vibe[]>([]);
  const [tappedEmoji, setTappedEmoji] = useState<string | null>(null);
  const [lastSubmit, setLastSubmit] = useState<number>(0);
  const [supabase] = useState(() => createClient());
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        const now = Date.now();
        const cachedFlag = sessionStorage.getItem('vibe_flag_cache');
        const cachedFlagTime = sessionStorage.getItem('vibe_flag_cache_time');
        const cachedVibes = sessionStorage.getItem('vibe_categories_cache');
        const cachedVibesTime = sessionStorage.getItem('vibe_categories_cache_time');
        
        let isEnabled = false;
        
        if (cachedFlag && cachedFlagTime && (now - parseInt(cachedFlagTime)) < 300000) {
          isEnabled = cachedFlag === 'true';
        } else {
          const flagResponse = await fetch("/api/feature-flags-cached");
          const flagData = await flagResponse.json();
          const vibeFlag = flagData.data?.find((f: any) => f.flag_name === "mood_tracker_enabled");
          isEnabled = vibeFlag?.enabled === true;
          
          sessionStorage.setItem('vibe_flag_cache', String(isEnabled));
          sessionStorage.setItem('vibe_flag_cache_time', String(now));
        }
        
        setEnabled(isEnabled);

        if (isEnabled) {
          if (cachedVibes && cachedVibesTime && (now - parseInt(cachedVibesTime)) < 300000) {
            setVibes(JSON.parse(cachedVibes));
          } else {
            const { data: vibeData } = await supabase
              .from("mood_categories")
              .select("id, category_name, emoji, label, color_hsl")
              .eq("enabled", true)
              .order("display_order");

            if (vibeData) {
              setVibes(vibeData);
              sessionStorage.setItem('vibe_categories_cache', JSON.stringify(vibeData));
              sessionStorage.setItem('vibe_categories_cache_time', String(now));
            }
          }
        }
      } catch (error) {
        console.error("Failed to fetch vibe config:", error);
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [supabase]);

  const handleVibeTap = async (vibe: Vibe) => {
    console.log('🎯 VIBE TAP:', vibe.emoji, vibe.label);
    
    // IMMEDIATE visual feedback - this MUST happen first, synchronously
    setTappedEmoji(vibe.emoji);
    
    // Haptic feedback on mobile
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(CONFIG.HAPTIC_DURATION_MS);
      console.log('📳 Haptic fired');
    }
    
    // Flash timer
    const flashTimer = setTimeout(() => {
      setTappedEmoji(null);
      console.log('⏰ Flash timer cleared');
    }, CONFIG.FLASH_DURATION_MS);

    // Notify parent for map flash
    if (onVibeSubmit) {
      console.log('🗺️ Calling onVibeSubmit with color:', vibe.color_hsl);
      onVibeSubmit(vibe.category_name, vibe.color_hsl);
    }

    // Check client-side rate limit
    const now = Date.now();
    const timeSince = (now - lastSubmit) / 1000;
    
    if (timeSince < CONFIG.RATE_LIMIT_SECONDS) {
      console.log('⏱️ Rate limited (client-side):', timeSince, 'seconds since last');
      // Visual feedback still happened, just don't submit
      return;
    }

    try {
      // Lazy anonymous auth
      if (!sessionReady) {
        console.log('🔐 Initializing anonymous session...');
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          await supabase.auth.signInAnonymously();
          console.log('✅ Anonymous session created');
        }
        setSessionReady(true);
      }
      
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        console.error("❌ No user session");
        return;
      }

      console.log('👤 User ID:', user.id);

      // Check rate limit via database
      const { data: recentVibe } = await supabase
        .from("mood_changes")
        .select("created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentVibe?.created_at) {
        const lastSubmission = new Date(recentVibe.created_at).getTime();
        const timeSinceLastSubmission = (Date.now() - lastSubmission) / 1000;

        if (timeSinceLastSubmission < CONFIG.RATE_LIMIT_SECONDS) {
          console.log('⏱️ Rate limited (database):', timeSinceLastSubmission, 'seconds since last');
          return; // Silent rate limit
        }
      }

      // Get city from IP
      console.log('🌍 Fetching city from IP...');
      const cityResponse = await fetch("/api/mood/get-city");
      const cityData = await cityResponse.json();
      const city = cityData.city || "Unknown";
      console.log('📍 City:', city);

      // Insert vibe
      console.log('💾 Inserting vibe to database...');
      const { error: insertError } = await supabase
        .from("mood_changes")
        .insert({
          user_id: user.id,
          city,
          mood_category: vibe.category_name,
          mood_value: 0,
          song_title: nowPlaying?.title || "Unknown",
          song_artist: nowPlaying?.artist || "Unknown",
          song_id: nowPlaying?.id
        });

      if (insertError) {
        console.error('❌ Insert error:', insertError);
        throw insertError;
      }

      console.log('✅ Vibe submitted successfully');
      setLastSubmit(now);
      toast.success(`${vibe.emoji} ${vibe.label}`, {
        duration: 2000
      });
    } catch (err) {
      console.error("❌ Vibe submission error:", err);
    } finally {
      clearTimeout(flashTimer);
    }
  };

  if (loading || !enabled || vibes.length === 0) {
    return null;
  }

  return (
    <div className="w-full">
      {/* Mobile: Full width, large targets */}
      <div className={`flex items-center justify-center ${compact ? 'gap-2 px-2 py-1.5' : 'gap-3 px-4 py-3'} bg-accent/50 backdrop-blur-sm rounded-lg border border-primary/10 sm:hidden`}>
        {!compact && <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Vibe Check</span>}
        <div className="flex items-center gap-2 flex-1 justify-center">
          {vibes.map(vibe => (
            <button
              key={vibe.id}
              onClick={() => handleVibeTap(vibe)}
              className={`
                transition-all duration-200 hover:scale-110 active:scale-95
                flex items-center justify-center rounded-lg
                ${compact ? 'text-2xl min-w-[44px] min-h-[44px]' : 'text-4xl min-w-[60px] min-h-[60px]'}
                ${tappedEmoji === vibe.emoji ? "scale-125" : ""}
              `}
              title={vibe.label}
              aria-label={vibe.label}
              style={{
                backgroundColor: tappedEmoji === vibe.emoji ? `hsl(${vibe.color_hsl} / 0.2)` : 'transparent',
                filter: tappedEmoji === vibe.emoji 
                  ? `drop-shadow(0 0 12px hsl(${vibe.color_hsl}))` 
                  : undefined
              }}
            >
              {vibe.emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Desktop: Centered, compact */}
      <div className={`hidden sm:flex items-center justify-center ${compact ? 'gap-2 px-4 py-1.5' : 'gap-3 px-6 py-2'} bg-accent/50 backdrop-blur-sm rounded-full border border-primary/10 mx-auto max-w-md`}>
        {!compact && <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Vibe Check</span>}
        {vibes.map(vibe => (
          <button
            key={vibe.id}
            onClick={() => handleVibeTap(vibe)}
            className={`
              transition-all duration-200 hover:scale-125 active:scale-95
              ${compact ? 'text-2xl min-w-[40px] min-h-[40px]' : 'text-3xl'}
              ${tappedEmoji === vibe.emoji ? "scale-150" : ""}
            `}
            title={vibe.label}
            aria-label={vibe.label}
            style={{
              filter: tappedEmoji === vibe.emoji 
                ? `drop-shadow(0 0 10px hsl(${vibe.color_hsl}))` 
                : undefined
            }}
          >
            {vibe.emoji}
          </button>
        ))}
      </div>
    </div>
  );
}