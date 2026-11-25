import { DOT_LAT_TOP, DOT_STEP, LAND_ROWS } from "@/lib/worldDots";

export const MAP_COLS = LAND_ROWS[0].length;
export const MAP_ROWS = LAND_ROWS.length;

export function project(lat: number, lon: number): { x: number; y: number } {
  return {
    x: (lon + 180) / DOT_STEP,
    y: (DOT_LAT_TOP - lat) / DOT_STEP + 0.5,
  };
}