import { useEffect, useState, memo, useRef } from "react";
import { Headphones, Ticket, ExternalLink, X } from "lucide-react";
import { DOT_LAT_TOP, DOT_STEP, LAND_ROWS } from "@/lib/worldDots";
import { project, MAP_COLS, MAP_ROWS } from "@/lib/mapProjection";
import { ShowsMapOverlay, ShowCityGroup } from "./map/ShowsMapOverlay";

const CONFIG = {
  REFRESH_MS: 60000,
  AGGREGATE_WINDOW: 100,
  LAND_COLOR_SATURATION: 0.8,
  FLASH_DURATION_MS: 1500,
  FADE_TO_AGGREGATE_MS: 3000,
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
  flashColor?: string | null;
  compact?: boolean;
}

const COLS = MAP_COLS;
const ROWS = MAP_ROWS;

interface LandDotsProps {
  color: string;
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
        transitionDuration: isFlashing ? "0s" : `${CONFIG.FADE_TO_AGGREGATE_MS}ms`,
        transitionProperty: "fill",
      }}
    >
      {dots}
    </g>
  );
});

function formatShowDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function ListenerMap({ flashColor, compact }: ListenerMapProps) {
  const [data, setData] = useState<ListenersData | null>(null);
  const [aggregateColor, setAggregateColor] = useState<string>("hsl(0 0% 20%)");
  const [isFlashing, setIsFlashing] = useState(false);
  const [mode, setMode] = useState<"listeners" | "shows">("listeners");
  const [selectedCity, setSelectedCity] = useState<ShowCityGroup | null>(null);
  const [showsAvailable, setShowsAvailable] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

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
            source: "live",
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

  useEffect(() => {
    const fetchAggregate = async () => {
      try {
        const response = await fetch("/api/mood/city-aggregates");
        if (response.ok) {
          const result = await response.json();
          if (result.aggregateColor) {
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
    <div className={`bg-accent rounded-lg w-full flex flex-col ${compact ? "p-2 h-full" : "p-4"}`}>
      <div className={`flex items-center justify-between ${compact ? "mb-1" : "mb-3"}`}>
        <div className="flex items-center gap-2">
          {mode === "listeners" ? (
            <Headphones className={`${compact ? "h-3 w-3" : "h-4 w-4"} text-primary`} />
          ) : (
            <Ticket className={`${compact ? "h-3 w-3" : "h-4 w-4"} text-primary`} />
          )}
          <span className={`font-semibold text-foreground ${compact ? "text-[10px]" : "text-sm"}`}>
            {mode === "listeners" ? "Listening now" : "On tour"}
          </span>
        </div>

        {mode === "listeners" && (
          <div className="flex items-center gap-2">
            <span className={`${compact ? "h-1.5 w-1.5" : "h-2 w-2"} rounded-full bg-primary animate-pulse`} />
            <span className={`font-mono text-foreground tabular-nums ${compact ? "text-[10px]" : "text-sm"}`}>
              {data ? total.toLocaleString("en-US") : "--"}
            </span>
          </div>
        )}
      </div>

      <div className={`relative ${compact ? "flex-1 min-h-0 flex items-center justify-center" : ""}`}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${COLS} ${ROWS}`}
          className={`block ${compact ? "w-full h-full max-h-[160px] object-contain" : "w-full h-auto"}`}
          role="img"
          aria-label={mode === "listeners" ? `${total} people listening to OTW Radio right now` : "Upcoming shows map"}
        >
          <LandDots
            color={aggregateColor}
            isFlashing={isFlashing}
            flashColor={flashColor ? `hsl(${flashColor})` : aggregateColor}
          />

          {mode === "listeners" &&
            data?.spots.map((spot) => {
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

          <ShowsMapOverlay
            active={mode === "shows"}
            selectedCity={selectedCity?.city ?? null}
            onSelectCity={setSelectedCity}
            onData={(cities) => setShowsAvailable(cities.length > 0)}
          />
        </svg>

        {mode === "shows" && selectedCity && (
          <div className="absolute inset-x-2 bottom-2 z-10 max-h-[55%] overflow-y-auto rounded-md border border-border bg-card/95 backdrop-blur-sm shadow-xl">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-card/95">
              <span className="font-sora font-semibold text-sm text-foreground">{selectedCity.city}</span>
              <button onClick={() => setSelectedCity(null)} className="text-muted hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="divide-y divide-border">
              {selectedCity.shows.map((show) => (
                <div key={show.id} className="px-3 py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{show.artist_name}</p>
                    <p className="text-xs text-muted truncate">
                      {show.venue_name} · {formatShowDate(show.event_date)}
                      {show.price_min ? ` · $${show.price_min}+` : ""}
                    </p>
                  </div>
                  {show.ticket_url && (
                    <a
                      href={show.ticket_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                    >
                      Tickets <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {!compact && (
        <div className="mt-3 flex justify-center">
          <div className="inline-flex rounded-full bg-background/60 border border-border p-0.5">
            <button
              onClick={() => {
                setMode("listeners");
                setSelectedCity(null);
              }}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                mode === "listeners" ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              Listeners
            </button>
            <button
              onClick={() => setMode("shows")}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                mode === "shows" ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              Shows
            </button>
          </div>
        </div>
      )}
    </div>
  );
}