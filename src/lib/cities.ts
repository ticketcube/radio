// Major world cities for mood map plotting
// Used when listener count is too low for the listener map to show city-level detail
export interface CityCoords {
  city: string;
  country: string;
  lat: number;
  lng: number;
}

export const MAJOR_CITIES: CityCoords[] = [
  // United States
  { city: "Los Angeles", country: "United States", lat: 34.05, lng: -118.24 },
  { city: "New York", country: "United States", lat: 40.71, lng: -74.01 },
  { city: "Chicago", country: "United States", lat: 41.88, lng: -87.63 },
  { city: "Houston", country: "United States", lat: 29.76, lng: -95.37 },
  { city: "Phoenix", country: "United States", lat: 33.45, lng: -112.07 },
  { city: "Philadelphia", country: "United States", lat: 39.95, lng: -75.17 },
  { city: "San Antonio", country: "United States", lat: 29.42, lng: -98.49 },
  { city: "San Diego", country: "United States", lat: 32.72, lng: -117.16 },
  { city: "Dallas", country: "United States", lat: 32.78, lng: -96.80 },
  { city: "San Jose", country: "United States", lat: 37.34, lng: -121.89 },
  { city: "Austin", country: "United States", lat: 30.27, lng: -97.74 },
  { city: "Jacksonville", country: "United States", lat: 30.33, lng: -81.66 },
  { city: "San Francisco", country: "United States", lat: 37.77, lng: -122.42 },
  { city: "Columbus", country: "United States", lat: 39.96, lng: -82.99 },
  { city: "Fort Worth", country: "United States", lat: 32.76, lng: -97.33 },
  { city: "Indianapolis", country: "United States", lat: 39.77, lng: -86.16 },
  { city: "Charlotte", country: "United States", lat: 35.23, lng: -80.84 },
  { city: "Seattle", country: "United States", lat: 47.61, lng: -122.33 },
  { city: "Denver", country: "United States", lat: 39.74, lng: -104.99 },
  { city: "Washington", country: "United States", lat: 38.91, lng: -77.04 },
  { city: "Boston", country: "United States", lat: 42.36, lng: -71.06 },
  { city: "Nashville", country: "United States", lat: 36.16, lng: -86.78 },
  { city: "Detroit", country: "United States", lat: 42.33, lng: -83.05 },
  { city: "Portland", country: "United States", lat: 45.52, lng: -122.68 },
  { city: "Las Vegas", country: "United States", lat: 36.17, lng: -115.14 },
  { city: "Memphis", country: "United States", lat: 35.15, lng: -90.05 },
  { city: "Atlanta", country: "United States", lat: 33.75, lng: -84.39 },
  { city: "Miami", country: "United States", lat: 25.76, lng: -80.19 },
  
  // Canada
  { city: "Toronto", country: "Canada", lat: 43.65, lng: -79.38 },
  { city: "Montreal", country: "Canada", lat: 45.50, lng: -73.57 },
  { city: "Vancouver", country: "Canada", lat: 49.28, lng: -123.12 },
  { city: "Calgary", country: "Canada", lat: 51.05, lng: -114.07 },
  { city: "Ottawa", country: "Canada", lat: 45.42, lng: -75.69 },
  
  // Mexico
  { city: "Mexico City", country: "Mexico", lat: 19.43, lng: -99.13 },
  { city: "Guadalajara", country: "Mexico", lat: 20.67, lng: -103.35 },
  { city: "Monterrey", country: "Mexico", lat: 25.67, lng: -100.31 },
  
  // United Kingdom
  { city: "London", country: "United Kingdom", lat: 51.51, lng: -0.13 },
  { city: "Manchester", country: "United Kingdom", lat: 53.48, lng: -2.24 },
  { city: "Birmingham", country: "United Kingdom", lat: 52.48, lng: -1.90 },
  { city: "Leeds", country: "United Kingdom", lat: 53.80, lng: -1.55 },
  { city: "Glasgow", country: "United Kingdom", lat: 55.86, lng: -4.26 },
  
  // France
  { city: "Paris", country: "France", lat: 48.86, lng: 2.35 },
  { city: "Marseille", country: "France", lat: 43.30, lng: 5.37 },
  { city: "Lyon", country: "France", lat: 45.76, lng: 4.84 },
  
  // Germany
  { city: "Berlin", country: "Germany", lat: 52.52, lng: 13.41 },
  { city: "Munich", country: "Germany", lat: 48.14, lng: 11.58 },
  { city: "Hamburg", country: "Germany", lat: 53.55, lng: 9.99 },
  { city: "Frankfurt", country: "Germany", lat: 50.11, lng: 8.68 },
  
  // Spain
  { city: "Madrid", country: "Spain", lat: 40.42, lng: -3.70 },
  { city: "Barcelona", country: "Spain", lat: 41.39, lng: 2.16 },
  
  // Italy
  { city: "Rome", country: "Italy", lat: 41.90, lng: 12.50 },
  { city: "Milan", country: "Italy", lat: 45.46, lng: 9.19 },
  
  // Netherlands
  { city: "Amsterdam", country: "Netherlands", lat: 52.37, lng: 4.89 },
  
  // Belgium
  { city: "Brussels", country: "Belgium", lat: 50.85, lng: 4.35 },
  
  // Australia
  { city: "Sydney", country: "Australia", lat: -33.87, lng: 151.21 },
  { city: "Melbourne", country: "Australia", lat: -37.81, lng: 144.96 },
  { city: "Brisbane", country: "Australia", lat: -27.47, lng: 153.03 },
  
  // Japan
  { city: "Tokyo", country: "Japan", lat: 35.68, lng: 139.65 },
  { city: "Osaka", country: "Japan", lat: 34.69, lng: 135.50 },
  
  // Brazil
  { city: "São Paulo", country: "Brazil", lat: -23.55, lng: -46.63 },
  { city: "Rio de Janeiro", country: "Brazil", lat: -22.91, lng: -43.17 },

  // More United States
  { city: "Cincinnati", country: "United States", lat: 39.10, lng: -84.51 },
  { city: "Milwaukee", country: "United States", lat: 43.04, lng: -87.91 },
  { city: "Minneapolis", country: "United States", lat: 44.98, lng: -93.27 },
  { city: "Pittsburgh", country: "United States", lat: 40.44, lng: -79.99 },
  { city: "Cleveland", country: "United States", lat: 41.50, lng: -81.69 },
  { city: "Orlando", country: "United States", lat: 28.54, lng: -81.38 },
  { city: "Tampa", country: "United States", lat: 27.95, lng: -82.46 },
  { city: "Raleigh", country: "United States", lat: 35.78, lng: -78.64 },
  { city: "Kansas City", country: "United States", lat: 39.10, lng: -94.58 },
  { city: "St. Louis", country: "United States", lat: 38.63, lng: -90.20 },
  { city: "Salt Lake City", country: "United States", lat: 40.76, lng: -111.89 },
  { city: "Sacramento", country: "United States", lat: 38.58, lng: -121.49 },
  { city: "Oklahoma City", country: "United States", lat: 35.47, lng: -97.52 },
  { city: "Buffalo", country: "United States", lat: 42.89, lng: -78.88 },
  { city: "Hartford", country: "United States", lat: 41.76, lng: -72.69 },
  { city: "Providence", country: "United States", lat: 41.82, lng: -71.41 },
  { city: "Richmond", country: "United States", lat: 37.54, lng: -77.44 },
  { city: "New Orleans", country: "United States", lat: 29.95, lng: -90.07 },
  { city: "Baltimore", country: "United States", lat: 39.29, lng: -76.61 },

  // More Canada
  { city: "Edmonton", country: "Canada", lat: 53.55, lng: -113.49 },
  { city: "Winnipeg", country: "Canada", lat: 49.90, lng: -97.14 },
  { city: "Quebec City", country: "Canada", lat: 46.81, lng: -71.21 },

  // More UK & Ireland
  { city: "Belfast", country: "United Kingdom", lat: 54.60, lng: -5.93 },
  { city: "Liverpool", country: "United Kingdom", lat: 53.41, lng: -2.98 },
  { city: "Bristol", country: "United Kingdom", lat: 51.45, lng: -2.59 },
  { city: "Cardiff", country: "United Kingdom", lat: 51.48, lng: -3.18 },
  { city: "Newcastle", country: "United Kingdom", lat: 54.98, lng: -1.61 },
  { city: "Sheffield", country: "United Kingdom", lat: 53.38, lng: -1.47 },
  { city: "Brighton", country: "United Kingdom", lat: 50.82, lng: -0.14 },
  { city: "Edinburgh", country: "United Kingdom", lat: 55.95, lng: -3.19 },
  { city: "Dublin", country: "Ireland", lat: 53.35, lng: -6.26 },

  // Oceania
  { city: "Christchurch", country: "New Zealand", lat: -43.53, lng: 172.64 },
  { city: "Auckland", country: "New Zealand", lat: -36.85, lng: 174.76 },
  { city: "Wellington", country: "New Zealand", lat: -41.29, lng: 174.78 },
  { city: "Perth", country: "Australia", lat: -31.95, lng: 115.86 },
  { city: "Adelaide", country: "Australia", lat: -34.93, lng: 138.60 },

  // Scandinavia & Europe
  { city: "Oslo", country: "Norway", lat: 59.91, lng: 10.75 },
  { city: "Stockholm", country: "Sweden", lat: 59.33, lng: 18.07 },
  { city: "Copenhagen", country: "Denmark", lat: 55.68, lng: 12.57 },
  { city: "Zurich", country: "Switzerland", lat: 47.38, lng: 8.54 },
  { city: "Vienna", country: "Austria", lat: 48.21, lng: 16.37 },
  { city: "Warsaw", country: "Poland", lat: 52.23, lng: 21.01 },
  { city: "Prague", country: "Czech Republic", lat: 50.08, lng: 14.44 },
  { city: "Lisbon", country: "Portugal", lat: 38.72, lng: -9.14 },
];

// Case-insensitive city lookup
export function findCity(cityName: string): CityCoords | undefined {
  const normalized = cityName.toLowerCase().trim();
  return MAJOR_CITIES.find(c => c.city.toLowerCase() === normalized);
}