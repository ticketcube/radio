import { useEffect, useState, memo, useRef } from "react";
import { Headphones } from "lucide-react";
import { DOT_LAT_TOP, DOT_STEP, LAND_ROWS } from "@/lib/worldDots";
import { MapOverlayManager } from "./map/MapOverlayManager";
import { ShowsMapOverlay } from "./map/ShowsMapOverlay";

// CONFIGURATION - Easy to tweak
const CONFIG = {
  REFRESH_MS: 120000, // 2 minutes
  AGGREGATE_WINDOW: 100, // Last N submissions
  LAND_COLOR_SATURATION: 0.3, // 0-1, how vivid the land color is
  FLASH_DURATION_MS: 500,
  FADE_TO_AGGREGATE_MS: 2000,
};

interface ListenerSpot {
  lat: number;
  lon: number;
  count: number;
  label: string;
}

interface ListenersData {
  total: number;
  located: number;
  spots: ListenerSpot[];
  source: "live" | "demo" | "unconfigured" | "error";
}

interface ListenerMapProps {
  flashColor?: string | null; // HSL string for local flash
}

const COLS = LAND_ROWS[0].length;
const ROWS = LAND_ROWS.length;

const project = (lat: number, lon: number) => ({
  x: (lon + 180) / DOT_STEP,
  y: (DOT_LAT_TOP - lat) / DOT_STEP + 0.5,
});

interface LandDotsProps {
  color: string; // HSL color
  isFlashing: boolean;
  flashColor: string;
}

const LandDots = memo(function LandDots({ color, isFlashing, flashColor }: LandDotsProps) {
  const dots: JSX.Element[] = [];
  LAND_ROWS.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === "1") {
        dots.push(<circle key={`${x}-${y}`} cx={x + 0.5} cy={y + 0.5} r={0.3} />);
      }
    }
  });
  
  const displayColor = isFlashing ? flashColor : color;
  
  return (
    <g 
      className="transition-all"
      style={{
        fill: displayColor,
        transitionDuration: isFlashing ? '0s' : `${CONFIG.FADE_TO_AGGREGATE_MS}ms`,
        transitionProperty: 'fill'
      }}
    >
      {dots}
    </g>
  );
});

export function ListenerMap({ flashColor }: ListenerMapProps) {
  const [data, setData] = useState<ListenersData | null>(null);
  const [aggregateColor, setAggregateColor] = useState<string>("hsl(0 0% 20%)"); // Default gray
  const [isFlashing, setIsFlashing] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  // Fetch listeners data
  useEffect(() => {
    const fetchListeners = async () => {
      try {
        const response = await fetch("/api/listeners-map");
        if (response.ok) {
          const result = await response.json();
          setData({
            total: result.total,
            located: result.located,
            spots: result.spots,
            source: "live"
          });
        }
      } catch (error) {
        console.error("Failed to fetch listeners:", error);
      }
    };

    fetchListeners();
    const interval = setInterval(fetchListeners, CONFIG.REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  // Fetch aggregate vibe color
  useEffect(() => {
    const fetchAggregate = async () => {
      try {
        const response = await fetch("/api/mood/city-aggregates");
        if (response.ok) {
          const result = await response.json();
          
          // Calculate aggregate color from last N submissions
          if (result.aggregateColor) {
            // Apply saturation multiplier for subtle effect
            const hslMatch = result.aggregateColor.match(/hsl\((\d+)\s+(\d+)%\s+(\d+)%\)/);
            if (hslMatch) {
              const h = hslMatch[1];
              const s = Math.round(parseInt(hslMatch[2]) * CONFIG.LAND_COLOR_SATURATION);
              const l = hslMatch[3];
              setAggregateColor(`hsl(${h} ${s}% ${l}%)`);
            }
          }
        }
      } catch (error) {
        console.error("Failed to fetch aggregate:", error);
      }
    };

    fetchAggregate();
    const interval = setInterval(fetchAggregate, CONFIG.REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  // Handle flash from parent
  useEffect(() => {
    if (flashColor) {
      setIsFlashing(true);
      const timer = setTimeout(() => setIsFlashing(false), CONFIG.FLASH_DURATION_MS);
      return () => clearTimeout(timer);
    }
  }, [flashColor]);

  const maxCount = Math.max(1, ...(data?.spots.map((s) => s.count) ?? [1]));
  const total = data?.total ?? 0;

  return (
    <div className="bg-accent rounded-lg p-4 w-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Headphones className="h-4 w-4 text-primary" />
          <span className="font-semibold text-foreground text-sm">Listening now</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          <span className="font-mono text-sm text-foreground tabular-nums">
            {data ? total.toLocaleString("en-US") : "--"}
          </span>
        </div>
      </div>

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${COLS} ${ROWS}`}
          className="w-full h-auto block"
          role="img"
          aria-label={`${total} people listening to OTW Radio right now`}
        >
          <LandDots 
            color={aggregateColor} 
            isFlashing={isFlashing}
            flashColor={flashColor ? `hsl(${flashColor})` : aggregateColor}
          />

          {data?.spots.map((spot) => {
            const { x, y } = project(spot.lat, spot.lon);
            const r = 0.9 + 2.6 * Math.sqrt(spot.count / maxCount);
            return (
              <g key={`${spot.lat},${spot.lon}`}>
                <circle cx={x} cy={y} r={r} className="fill-primary/25">
                  <animate attributeName="r" values={`${r};${r * 1.8};${r}`} dur="3s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.6;0;0.6" dur="3s" repeatCount="indefinite" />
                </circle>
                <circle cx={x} cy={y} r={r * 0.55} className="fill-primary">
                  <title>{`${spot.label}: ${spot.count} listening`}</title>
                </circle>
              </g>
            );
          })}

          <MapOverlayManager width={COLS} height={ROWS}>
            <ShowsMapOverlay 
              width={COLS} 
              height={ROWS}
            />
          </MapOverlayManager>
        </svg>
      </div>
    </div>
  );
}