/**
 * Central Facility Space Registry (Frontend).
 *
 * Single source of truth for Facility Spaces matching backend/app/config/spaces.py.
 * Rules:
 * 1. Strictly use terminology "Facility Space" (never "Primary Floor").
 * 2. Floor descriptions are eliminated from UI metadata.
 * 3. All UI selectors, WebSocket subscriptions, and tabs iterate dynamically
 *    over registered spaces.
 * 4. Only sandboxx_0 exists by default; root admin registers new spaces via portal.
 */

export interface FacilitySpaceConfig {
  slug: string;
  name: string;
  esp32_deviceId: string;
  isActive: boolean;
  description?: string;
}

export const REGISTERED_SPACES: Record<string, FacilitySpaceConfig> = {};

export const getRegisteredSpacesList = (): FacilitySpaceConfig[] => {
  return Object.values(REGISTERED_SPACES);
};

export const getSpaceBySlug = (slug: string): FacilitySpaceConfig | undefined => {
  return REGISTERED_SPACES[slug];
};
