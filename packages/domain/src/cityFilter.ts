const targetCities = new Set([
  "Chino",
  "Chino Hills",
  "Eastvale",
  "Corona",
  "Jurupa Valley",
]);

export function isTargetCity(city: string): boolean {
  return targetCities.has(city);
}
