export type Coordinates = { lat: number; lon: number };

export interface WeatherBundle {
  coords: Coordinates;
  tempC: number;
  condition: string;
  generatedAt: string;
}
