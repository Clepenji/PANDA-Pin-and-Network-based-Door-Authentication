import React, { createContext, useContext, useState, useEffect } from 'react';
import { FacilitySpaceConfig, getRegisteredSpacesList } from '../config/spaces';
import { SpaceStatus } from '../types';
import { api } from '../services/api';
import { wsService } from '../services/websocket';

interface SpaceContextType {
  spaces: FacilitySpaceConfig[];
  selectedSpaceSlug: string;
  setSelectedSpaceSlug: (slug: string) => void;
  selectedSpace: FacilitySpaceConfig;
  statuses: Record<string, SpaceStatus>;
  refreshStatuses: () => Promise<void>;
}

const SpaceContext = createContext<SpaceContextType | undefined>(undefined);

export const SpaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [spaces, setSpaces] = useState<FacilitySpaceConfig[]>(getRegisteredSpacesList());
  const [selectedSpaceSlug, setSelectedSpaceSlug] = useState<string>(
    spaces.length > 0 ? spaces[0].slug : ''
  );
  const [statuses, setStatuses] = useState<Record<string, SpaceStatus>>({});

  const refreshStatuses = async () => {
    try {
      const data = await api.fetchSpacesStatus().catch(() => []);
      const statusMap: Record<string, SpaceStatus> = {};
      data.forEach((s) => {
        statusMap[s.slug] = s;
      });
      setStatuses(statusMap);

      const sps = await api.fetchSpaces().catch(() => []);
      if (sps && Array.isArray(sps)) {
        const mapped: FacilitySpaceConfig[] = sps.map((s) => ({
          slug: s.slug,
          name: s.name,
          esp32_deviceId: s.esp32_device_id || `ESP32_${s.slug.toUpperCase()}_DOOR`,
          isActive: s.is_active,
        }));
        setSpaces(mapped);
        setSelectedSpaceSlug((prev) => {
          if (mapped.length === 0) return '';
          if (!prev || !mapped.some((m) => m.slug === prev)) return mapped[0].slug;
          return prev;
        });
      }
    } catch (e) {
      console.warn('Failed to refresh space statuses:', e);
    }
  };

  useEffect(() => {
    refreshStatuses();
    const interval = setInterval(refreshStatuses, 10000);

    // Subscribe to global WebSocket for live updates
    const unsubscribe = wsService.subscribe('global', () => {
      refreshStatuses();
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, []);

  const selectedSpace =
    spaces.find((s) => s.slug === selectedSpaceSlug) ||
    spaces[0] || {
      slug: '',
      name: 'No Facility Space Configured',
      esp32_deviceId: '',
      isActive: false,
    };

  return (
    <SpaceContext.Provider
      value={{
        spaces,
        selectedSpaceSlug,
        setSelectedSpaceSlug,
        selectedSpace,
        statuses,
        refreshStatuses,
      }}
    >
      {children}
    </SpaceContext.Provider>
  );
};

export const useSpace = () => {
  const context = useContext(SpaceContext);
  if (!context) throw new Error('useSpace must be used within a SpaceProvider');
  return context;
};
