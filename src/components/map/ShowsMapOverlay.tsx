import { useState, useEffect } from "react";
import { project } from "@/lib/mapProjection";

export interface ShowItem {
  id: string;
  artist_name: string;
  venue_name: string;
  event_date: string;
  ticket_url: string | null;
  price_min: number | null;
  price_max: number | null;
}

export interface ShowCityGroup {
  city: string;
  lat: number;
  lng: number;
  count: number;
  shows: ShowItem[];
}

interface ShowsMapOverlayProps {
  active: boolean;
  selectedCity: string | null;
  onSelectCity: (group: ShowCityGroup | null) => void;
  onData?: (cities: ShowCityGroup[]) => void;
}

const POLLING_INTERVAL_MS = 180000;

export function ShowsMapOverlay({
  active,
  selectedCity,
  onSelectCity,
  onData,
}: ShowsMapOverlayProps) {
  const [cities, setCities] = useState<ShowCityGroup[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const fetchShows = async () => {
      try {
        const response = await fetch("/api/shows/upcoming");
        if (!response.ok) return;
        const result = await response.json();
        const data: ShowCityGroup[] = result.data || [];
        setCities(data);
        onData?.(data);
      } catch (error) {
        console.error("Error fetching shows:", error);
      }
    };

    fetchShows();
    const interval = setInterval(fetchShows, POLLING_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!active || cities.length === 0) return null;

  const maxCount = Math.max(1, ...cities.map((c) => c.count));

  return (
    <g className="pointer-events-auto">
      {cities.map((group) => {
        const { x, y } = project(group.lat, group.lng);
        const r = 0.9 + 2.6 * Math.sqrt(group.count / maxCount);
        const isSelected = selectedCity === group.city;
        const isHovered = hovered === group.city;

        return (
          <g
            key={group.city}
            onMouseEnter={() => setHovered(group.city)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onSelectCity(isSelected ? null : group)}
            className="cursor-pointer"
          >
            <circle cx={x} cy={y} r={r} className="fill-primary/25">
              <animate
                attributeName="r"
                values={`${r};${r * 1.8};${r}`}
                dur="3s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0.6;0;0.6"
                dur="3s"
                repeatCount="indefinite"
              />
            </circle>
            <circle
              cx={x}
              cy={y}
              r={r * 0.55 * (isSelected || isHovered ? 1.3 : 1)}
              className="fill-primary transition-all"
            >
              <title>{`${group.city}: ${group.count} show${
                group.count > 1 ? "s" : ""
              }`}</title>
            </circle>
          </g>
        );
      })}
    </g>
  );
}