import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Cpu,
  Key,
  RotateCcw,
  Upload,
  Download,
  Eye,
  EyeOff,
  FileCode,
  RefreshCw,
  Search,
  Clock,
  ShieldAlert,
  Sliders,
  Lock,
  Unlock,
  Plus,
  Trash2,
  Pencil,
} from 'lucide-react';
import { api } from '../services/api';
import { ESP32AdminDevice, ESP32FirmwareRelease } from '../types';
import { CopyButton } from './CopyButton';
import { formatTimeAgo } from '../utils/format';

interface ESP32HardwareManagerProps {
  spaces: Array<{ id: string; slug: string; name: string }>;
  showToast?: (message: string, type?: 'info' | 'success' | 'error') => void;
  onSpacesUpdated?: () => void;
}

interface TotpInfo {
  device_id?: string;
  space_id: string;
  pin: string;
  remaining_seconds: number;
  time_step: number;
  valid_till: number;
}

export const ESP32HardwareManager: React.FC<ESP32HardwareManagerProps> = ({
  spaces,
  showToast,
  onSpacesUpdated,
}) => {
  const [devices, setDevices] = useState<ESP32AdminDevice[]>([]);
  const [releases, setReleases] = useState<ESP32FirmwareRelease[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({});
  const [rotatingSpace, setRotatingSpace] = useState<string | null>(null);

  // Dynamic PIN Validity & Emergency TOTP Policy State (Default: 24h = 86400s)
  const [pinValiditySeconds, setPinValiditySeconds] = useState<number>(86400);
  const [selectedPresetSeconds, setSelectedPresetSeconds] = useState<number>(86400);
  const [customSecondsInput, setCustomSecondsInput] = useState<string>('86400');
  const [isSavingPolicy, setIsSavingPolicy] = useState<boolean>(false);
  const [totpData, setTotpData] = useState<Record<string, TotpInfo>>({});

  // Firmware Upload Form State
  const [firmwareVersion, setFirmwareVersion] = useState<string>('');
  const [targetSpaceId, setTargetSpaceId] = useState<string>('all');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);

  // Lock State Management (Disable / Re-enable / Unbind Hardware) & Extra Door Provisioning
  const [togglingLock, setTogglingLock] = useState<string | null>(null);
  const [unbindingLock, setUnbindingLock] = useState<string | null>(null);
  const [showAddDoorModal, setShowAddDoorModal] = useState<boolean>(false);
  const [doorForm, setDoorForm] = useState<{ device_id: string; name: string; space_id: string }>({
    device_id: '',
    name: 'Back Door',
    space_id: spaces[0]?.slug || '',
  });

  // Edit Door Lock Details
  const [editingDevice, setEditingDevice] = useState<ESP32AdminDevice | null>(null);
  const [editDoorForm, setEditDoorForm] = useState<{
    name: string;
    space_id: string;
    is_disabled: boolean;
    disabled_reason: string;
  }>({
    name: '',
    space_id: '',
    is_disabled: false,
    disabled_reason: '',
  });
  const [savingDoorEdit, setSavingDoorEdit] = useState<boolean>(false);

  // Hardware Devices Filters
  const [deviceSearch, setDeviceSearch] = useState<string>('');
  const [deviceSpaceFilter, setDeviceSpaceFilter] = useState<string>('all');
  const [deviceStatusFilter, setDeviceStatusFilter] = useState<string>('all');

  // Firmware Releases Filters
  const [releaseSearch, setReleaseSearch] = useState<string>('');
  const [releaseSpaceFilter, setReleaseSpaceFilter] = useState<string>('all');

  const filteredDevices = useMemo(() => {
    return devices.filter((dev) => {
      if (deviceSpaceFilter !== 'all' && dev.space_id !== deviceSpaceFilter) return false;
      if (deviceStatusFilter === 'online' && !dev.is_online) return false;
      if (deviceStatusFilter === 'offline' && dev.is_online) return false;
      if (deviceSearch.trim()) {
        const q = deviceSearch.toLowerCase().trim();
        const spaceObj = spaces.find((s) => s.slug === dev.space_id);
        const spaceName = (spaceObj?.name || '').toLowerCase();
        const matchesSpace =
          spaceName.includes(q) ||
          (dev.space_id ? dev.space_id.toLowerCase().includes(q) : false) ||
          (dev.name ? dev.name.toLowerCase().includes(q) : false) ||
          (dev.device_id ? dev.device_id.toLowerCase().includes(q) : false);
        const matchesIp = (dev.ip_address || '').toLowerCase().includes(q);
        const matchesMac = (dev.mac_address || '').toLowerCase().includes(q);
        const matchesFw = (dev.firmware_version || '').toLowerCase().includes(q);
        if (!matchesSpace && !matchesIp && !matchesMac && !matchesFw) return false;
      }
      return true;
    });
  }, [devices, spaces, deviceSpaceFilter, deviceStatusFilter, deviceSearch]);

  const filteredReleases = useMemo(() => {
    return releases.filter((rel) => {
      if (releaseSpaceFilter !== 'all') {
        if (releaseSpaceFilter === 'broadcast' && rel.target_space_id) return false;
        if (releaseSpaceFilter !== 'broadcast' && rel.target_space_id !== releaseSpaceFilter) return false;
      }
      if (releaseSearch.trim()) {
        const q = releaseSearch.toLowerCase().trim();
        const matchesVer = rel.version.toLowerCase().includes(q);
        const matchesSha = (rel.sha256_checksum || '').toLowerCase().includes(q);
        const matchesSpace = (rel.target_space_id || '').toLowerCase().includes(q);
        const matchesFile = (rel.filename || '').toLowerCase().includes(q);
        if (!matchesVer && !matchesSha && !matchesSpace && !matchesFile) return false;
      }
      return true;
    });
  }, [releases, releaseSpaceFilter, releaseSearch]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [devList, relList, validityData, liveTotp] = await Promise.all([
        api.fetchAdminEsp32Devices(),
        api.fetchAdminFirmwareReleases(),
        api.fetchPinValidity().catch(() => ({ pin_validity_seconds: 86400, pin_validity_minutes: 1440 })),
        api.fetchAdminEsp32Totp().catch(() => ({})),
      ]);
      setDevices(devList);
      setReleases(relList);
      setPinValiditySeconds(validityData.pin_validity_seconds);
      setSelectedPresetSeconds(validityData.pin_validity_seconds);
      setCustomSecondsInput(String(validityData.pin_validity_seconds));
      setTotpData(liveTotp);
    } catch (err: any) {
      showToast?.(err.message || 'Failed to load ESP32 device & firmware data', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Live countdown timer for Emergency Master TOTP PINs
  useEffect(() => {
    const interval = setInterval(() => {
      setTotpData((prev) => {
        let needsRefresh = false;
        const nowSec = Math.floor(Date.now() / 1000);
        const updated: Record<string, TotpInfo> = {};

        for (const [slug, data] of Object.entries(prev)) {
          const remaining = Math.max(0, data.valid_till - nowSec);
          if (remaining <= 0) {
            needsRefresh = true;
          }
          updated[slug] = {
            ...data,
            remaining_seconds: remaining,
          };
        }

        if (needsRefresh) {
          api.fetchAdminEsp32Totp().then((freshTotp) => {
            setTotpData(freshTotp);
          }).catch(console.error);
        }

        return updated;
      });
    }, 1000);
return () => clearInterval(interval);
  }, []);

  const handleSavePinValidity = async (secondsToSet: number) => {
    if (secondsToSet < 30 || secondsToSet > 86400) {
      showToast?.('PIN validity must be between 30 and 86400 seconds (30s to 24h)', 'error');
      return;
    }
    setIsSavingPolicy(true);
    try {
      const res = await api.updatePinValidity(secondsToSet);
      setPinValiditySeconds(res.pin_validity_seconds);
      setSelectedPresetSeconds(res.pin_validity_seconds);
      setCustomSecondsInput(String(res.pin_validity_seconds));
      const hoursText = res.pin_validity_seconds >= 3600
        ? `${(res.pin_validity_seconds / 3600).toFixed(res.pin_validity_seconds % 3600 === 0 ? 0 : 1)} hr`
        : `${res.pin_validity_minutes} min`;
      showToast?.(
        `User PIN validity updated to ${hoursText} (${res.pin_validity_seconds}s). Emergency Master TOTP remains fixed at 24 hr (86400s).`,
        'success'
      );
    } catch (err: any) {
      showToast?.(err.message || 'Failed to update PIN validity', 'error');
    } finally {
      setIsSavingPolicy(false);
    }
  };

  const toggleRevealSecret = (identifier: string) => {
    if (!identifier) return;
    setRevealedSecrets((prev) => ({
      ...prev,
      [identifier]: !prev[identifier],
    }));
  };

  const handleRotateSecret = async (identifier: string) => {
    if (!identifier) return;
    const devObj = devices.find((d) => d.device_id === identifier || d.space_id === identifier);
    const spaceObj = spaces.find((s) => s.slug === (devObj?.space_id || identifier));
    const targetName = devObj
      ? `${spaceObj ? spaceObj.name : devObj.space_id} — ${devObj.name || devObj.device_id}`
      : (spaceObj ? spaceObj.name : identifier);
    if (
      !window.confirm(
        `Rotate cryptographic secret for ${targetName}?\n\nWARNING: The existing ESP32 device will be disconnected and cannot authenticate until you re-flash it with the newly generated 32-character token.\n\nThe emergency offline TOTP master PIN for this door lock will also rotate immediately.`
      )
    ) {
      return;
    }

    setRotatingSpace(identifier);
    try {
      await api.rotateAdminEsp32Secret(identifier);
      showToast?.(
        `Secret rotated for ${targetName}! Remember to update the ESP32 firmware credentials.`,
        'success'
      );
      // Auto-reveal the newly rotated secret
      setRevealedSecrets((prev) => ({ ...prev, [identifier]: true }));
      await loadData();
    } catch (err: any) {
      showToast?.(err.message || `Failed to rotate secret for ${targetName}`, 'error');
    } finally {
      setRotatingSpace(null);
    }
  };

  const handleFirmwareUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firmwareVersion.trim()) {
      showToast?.('Please enter a firmware version string (e.g. 1.0.2)', 'error');
      return;
    }
    if (!selectedFile) {
      showToast?.('Please select a compiled ESP32 .bin firmware binary', 'error');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('version', firmwareVersion.trim());
      formData.append('target_space_id', targetSpaceId);
      formData.append('file', selectedFile);

      const res = await api.uploadAdminFirmware(formData);
      showToast?.(
        `Firmware v${res.version} uploaded successfully! OTA dispatch queued for target spaces.`,
        'success'
      );
      setFirmwareVersion('');
      setSelectedFile(null);
      // Reset HTML file input
      const fileInput = document.getElementById('firmware-file-input') as HTMLInputElement;
      if (fileInput) fileInput.value = '';

      await loadData();
    } catch (err: any) {
      showToast?.(err.message || 'Firmware upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleToggleLock = async (dev: ESP32AdminDevice) => {
    const idToUse = dev.device_id || dev.space_id;
    if (!idToUse) return;

    if (!dev.is_disabled) {
      const confirmDisable = window.confirm(
        `Are you sure you want to disable lock '${idToUse}'?\n\nWhen disabled, the lock accepts NO PINs except the Emergency Master TOTP PIN. Your email will be displayed on the door screen. People inside can still safely exit via the exit button.`
      );
      if (!confirmDisable) return;
    }

    setTogglingLock(idToUse);
    try {
      if (dev.is_disabled) {
        await api.enableLockDevice(idToUse);
        showToast?.(`Lock '${idToUse}' has been re-enabled.`, 'success');
      } else {
        await api.disableLockDevice(idToUse, 'Disabled by Root Administrator');
        showToast?.(`Lock '${idToUse}' is now disabled (Emergency TOTP only).`, 'success');
      }
      await loadData();
      await onSpacesUpdated?.();
    } catch (err: any) {
      showToast?.(err.message || 'Failed to update lock state', 'error');
    } finally {
      setTogglingLock(null);
    }
  };

  const handleCreateDoor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!doorForm.space_id) {
      showToast?.('Please select an existing Facility Space for this lock.', 'error');
      return;
    }
    if (!doorForm.device_id.trim()) {
      showToast?.('Please enter an ESP32 hardware device ID.', 'error');
      return;
    }
    try {
      await api.createLockDevice({
        device_id: doorForm.device_id.trim(),
        name: doorForm.name.trim() || 'Additional Door',
        space_id: doorForm.space_id,
      });
      showToast?.(`Door lock '${doorForm.device_id}' registered successfully!`, 'success');
      setShowAddDoorModal(false);
      setDoorForm({ device_id: '', name: 'Back Door', space_id: spaces[0]?.slug || '' });
      await loadData();
      await onSpacesUpdated?.();
    } catch (err: any) {
      showToast?.(err.message || 'Failed to register door lock', 'error');
    }
  };

  const handleUnbindHardware = async (dev: ESP32AdminDevice) => {
    const targetId = dev.device_id || dev.id;
    if (!targetId) return;
    if (
      !window.confirm(
        `Refresh hardware binding for '${dev.name || targetId}' (${targetId})?\n\nThis forgets the previously connected IP and MAC address and disconnects the old ESP32 board so replacement hardware can connect using the existing Device ID and Secret.`
      )
    ) {
      return;
    }
    setUnbindingLock(targetId);
    try {
      const res = await api.unbindLockDevice(targetId);
      showToast?.(res.message || `Hardware binding cleared for '${dev.name || targetId}'.`, 'success');
      await loadData();
      await onSpacesUpdated?.();
    } catch (err: any) {
      showToast?.(err.message || 'Failed to refresh hardware binding', 'error');
    } finally {
      setUnbindingLock(null);
    }
  };

  const handleDeleteLock = async (deviceId: string, name: string, spaceId?: string) => {
    if (!deviceId) return;
    const locksInSpace = spaceId ? devices.filter((d) => d.space_id === spaceId).length : 0;
    const spaceObj = spaceId ? spaces.find((s) => s.slug === spaceId) : undefined;
    const spaceDisplayName = spaceObj?.name || spaceId || 'this space';
    const isLastLock = Boolean(spaceId && locksInSpace <= 1);

    const confirmMsg = isLastLock
      ? `⚠️ WARNING: '${name}' (${deviceId}) is the LAST remaining door lock for Facility Space '${spaceDisplayName}'.\n\nDeleting this lock will permanently DELETE Facility Space '${spaceDisplayName}' and trigger a reset cascade for this zone:\n• SuperUsers who ONLY govern '${spaceDisplayName}' will have their accounts deleted.\n• Users registered to '${spaceDisplayName}' will lose that space tab so they can register elsewhere.\n• Active PINs and pending requests for '${spaceDisplayName}' will be purged.\n• Immutable audit logs will remain preserved.\n\nAre you sure you want to proceed?`
      : `Are you sure you want to permanently remove door lock '${name}' (${deviceId})?\n\nThis physical lock controller will be disconnected while remaining locks for '${spaceDisplayName}' stay active.`;

    if (!window.confirm(confirmMsg)) return;

    // Optimistically remove from local devices
    setDevices((prev) => prev.filter((d) => d.device_id !== deviceId));

    try {
      const res = await api.deleteLockDevice(deviceId);
      showToast?.(
        res.space_deleted
          ? `Last lock '${name}' and Facility Space '${spaceDisplayName}' deleted.`
          : `Door lock '${name}' (${deviceId}) removed successfully.`,
        'success'
      );
    } catch (err: any) {
      if (err.message && (err.message.includes('not found') || err.message.includes('404'))) {
        showToast?.(`Door lock '${name}' was already removed from the system.`, 'info');
      } else {
        showToast?.(err.message || 'Failed to remove door lock', 'error');
      }
    } finally {
      await loadData();
      await onSpacesUpdated?.();
    }
  };

  const handleOpenEditDevice = (dev: ESP32AdminDevice) => {
    setEditingDevice(dev);
    setEditDoorForm({
      name: dev.name || 'Door Lock',
      space_id: dev.space_id || (spaces[0]?.slug || ''),
      is_disabled: Boolean(dev.is_disabled),
      disabled_reason: dev.disabled_reason || '',
    });
  };

  const handleSaveDeviceEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDevice || !editingDevice.device_id) return;
    if (!editDoorForm.name.trim()) {
      showToast?.('Lock Name cannot be empty.', 'error');
      return;
    }
    setSavingDoorEdit(true);
    try {
      await api.updateLockDevice(editingDevice.device_id, {
        name: editDoorForm.name.trim(),
        space_id: editDoorForm.space_id,
        is_disabled: editDoorForm.is_disabled,
        disabled_reason: editDoorForm.is_disabled ? editDoorForm.disabled_reason : undefined,
      });
      showToast?.(`Lock '${editDoorForm.name}' updated successfully!`, 'success');
      setEditingDevice(null);
      await loadData();
      await onSpacesUpdated?.();
    } catch (err: any) {
      showToast?.(err.message || 'Failed to update lock details', 'error');
    } finally {
      setSavingDoorEdit(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Description */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-cyan-950 text-cyan-400 border border-cyan-800/80 shadow-md">
            <Cpu className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-black text-white flex items-center gap-2">
              ESP32 Hardware Security & OTA Deployment
            </h2>
            <p className="text-xs text-slate-400">
              Manage anti-spoofing cryptographic credentials, challenge-response secrets, and Over-The-Air firmware updates
            </p>
          </div>
        </div>

        <button
          onClick={loadData}
          disabled={loading}
          className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-semibold flex items-center gap-2 border border-slate-700 transition active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Reload Registry</span>
        </button>
      </div>

      {/* 0. User PIN Lifespan Policy Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-950 text-indigo-400 border border-indigo-800/80 shadow-md">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span>User PIN Validity Policy</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-900/60 text-indigo-300 border border-indigo-700/60">
                  Active: {pinValiditySeconds >= 3600 ? `${(pinValiditySeconds / 3600).toFixed(pinValiditySeconds % 3600 === 0 ? 0 : 1)} hr (${pinValiditySeconds}s)` : pinValiditySeconds >= 60 ? `${(pinValiditySeconds / 60).toFixed(pinValiditySeconds % 60 === 0 ? 0 : 1)} min (${pinValiditySeconds}s)` : `${pinValiditySeconds}s`}
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Root Admin control: Governs validity duration for user keypad access PINs. Emergency master TOTP codes always rotate on a fixed 24-hour (86400s) schedule.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
          {/* Preset Buttons */}
          <div className="md:col-span-2 space-y-2">
            <span className="text-[11px] uppercase font-bold tracking-wider text-slate-400">
              Quick Presets:
            </span>
            <div className="flex flex-wrap gap-2">
              {[
                { label: '2 Hours (7200s)', seconds: 7200 },
                { label: '8 Hours (28800s)', seconds: 28800 },
                { label: '12 Hours (43200s)', seconds: 43200 },
                { label: '24 Hours (86400s - Production)', seconds: 86400 },
              ].map((preset) => {
                const isSelected = selectedPresetSeconds === preset.seconds;
                const isCurrentActive = pinValiditySeconds === preset.seconds;
return (
                  <button
                    key={preset.seconds}
                    type="button"
                    onClick={() => {
                      setSelectedPresetSeconds(preset.seconds);
                      setCustomSecondsInput(String(preset.seconds));
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                      isSelected
                        ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-950/60'
                        : 'bg-slate-950/80 hover:bg-slate-800 text-slate-300 border-slate-800'
                    } flex items-center gap-1.5`}
                  >
                    <span>{preset.label}</span>
                    {isCurrentActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="Currently Active Policy" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom seconds input + Apply button */}
          <div className="space-y-2 bg-slate-950/70 border border-slate-800/90 rounded-xl p-3">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-300">
                Custom Duration (Seconds)
              </label>
              <span className="text-[10px] text-slate-500 font-mono">30s - 86400s (24h)</span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="number"
                min="30"
                max="86400"
                step="1"
                value={customSecondsInput}
                onChange={(e) => {
                  setCustomSecondsInput(e.target.value);
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) {
                    setSelectedPresetSeconds(val);
                  }
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                placeholder="e.g. 86400"
              />

              <button
                type="button"
                onClick={() => {
                  const val = parseInt(customSecondsInput, 10);
                  if (isNaN(val) || val < 30 || val > 86400) {
                    showToast?.('Please enter a valid lifespan between 30 and 86400 seconds (24h)', 'error');
                    return;
                  }
                  handleSavePinValidity(val);
                }}
                disabled={isSavingPolicy || parseInt(customSecondsInput, 10) === pinValiditySeconds}
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap shadow-md"
              >
                {isSavingPolicy ? (
                  <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sliders className="w-3.5 h-3.5" />
                )}
                <span>{isSavingPolicy ? 'Saving...' : 'Apply'}</span>
              </button>
            </div>

            <p className="text-[10px] text-slate-400">
              User PINs automatically reject any code matching active emergency master TOTP keys.
            </p>
          </div>
        </div>
      </div>

      {/* 1. Device Secrets & Flashing Credentials */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-slate-100">
              Provisioned Hardware Credentials & Emergency Access
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-slate-400">
              {filteredDevices.length} {filteredDevices.length === 1 ? 'Hardware Key' : 'Hardware Keys'}
            </span>
            <button
              onClick={() => {
                setDoorForm({
                  device_id: '',
                  name: 'Secondary Door',
                  space_id: spaces[0]?.slug || '',
                });
                setShowAddDoorModal(true);
              }}
              disabled={spaces.length === 0}
              className="px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 shadow-md"
              title={spaces.length === 0 ? 'Create a Facility Space first before adding door locks' : 'Attach a door lock to an existing space'}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Door Lock</span>
            </button>
          </div>
        </div>

        {/* Device Filter Toolbar */}
        <div className="flex flex-wrap items-center gap-2.5 p-3 bg-slate-950/60 border border-slate-800 rounded-xl">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search space name, slug, IP, FW..."
              value={deviceSearch}
              onChange={(e) => setDeviceSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <select
            value={deviceSpaceFilter}
            onChange={(e) => setDeviceSpaceFilter(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
          >
            <option value="all">All Spaces</option>
            {spaces.map((sp) => (
              <option key={sp.slug} value={sp.slug}>
                {sp.name}
              </option>
            ))}
          </select>

          <select
            value={deviceStatusFilter}
            onChange={(e) => setDeviceStatusFilter(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
          >
            <option value="all">All Statuses</option>
            <option value="online">Online</option>
            <option value="offline">Disconnected</option>
          </select>

          {(deviceSearch || deviceSpaceFilter !== 'all' || deviceStatusFilter !== 'all') && (
            <button
              onClick={() => {
                setDeviceSearch('');
                setDeviceSpaceFilter('all');
                setDeviceStatusFilter('all');
              }}
              className="text-xs text-slate-400 hover:text-white px-2 py-1 bg-slate-800 rounded border border-slate-700 transition"
            >
              Clear
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredDevices.map((dev) => {
            const devKey = dev.device_id || dev.space_id;
            const isRevealed = Boolean(revealedSecrets[devKey]);
            const isRotating = rotatingSpace === devKey || rotatingSpace === dev.space_id;
            const isUnbinding = unbindingLock === (dev.device_id || dev.id);
            const spaceObj = spaces.find((s) => s.slug === dev.space_id);
            const spaceName = spaceObj ? spaceObj.name : dev.space_id;

            // Live TOTP code & countdown per lock device (fixed 24h / 86400s window)
            const devTotp = dev.device_id ? totpData[dev.device_id] : undefined;
            const totp = devTotp || {
              device_id: dev.device_id,
              space_id: dev.space_id,
              pin: dev.totp_pin || totpData[dev.space_id]?.pin || '------',
              remaining_seconds: dev.totp_remaining_seconds ?? totpData[dev.space_id]?.remaining_seconds ?? 0,
              time_step: dev.totp_time_step || 86400,
              valid_till: dev.totp_valid_till || totpData[dev.space_id]?.valid_till || 0,
            };
            const timeStep = totp.time_step || 86400;
            const remaining = totp.remaining_seconds ?? 0;
            const progressPercent = Math.min(100, Math.max(0, (remaining / timeStep) * 100));

            return (
              <div
                key={dev.id || dev.space_id}
                className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-4 flex flex-col justify-between gap-4"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="space-y-0.5">
                        <h4 className="text-sm font-bold text-white flex items-center gap-2 flex-wrap">
                          <span>{spaceName}</span>
                          <span className="text-[10px] font-mono text-slate-400">({dev.space_id})</span>
                        </h4>
                        <div className="text-xs font-semibold text-cyan-300 font-mono flex items-center gap-1.5">
                          <span>{dev.name || 'Door Lock'}</span>
                          {dev.device_id && <span className="text-slate-500 font-normal">({dev.device_id})</span>}
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        {dev.is_online ? (
                          <span className="text-emerald-400 font-semibold">● Connected Online</span>
                        ) : (
                          <span className="text-slate-500">○ Disconnected</span>
                        )}
                        {dev.ip_address && dev.ip_address !== 'unknown' && ` • IP: ${dev.ip_address}`}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-1.5">
                        <span className="text-[10px] font-mono text-slate-300 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                          MAC: <span className="text-indigo-300 font-bold">{dev.mac_address || 'Not Reported'}</span>
                        </span>
                        {dev.device_id && (
                          <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                            ID: <span className="text-emerald-300">{dev.device_id}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-800">
                      FW: {dev.firmware_version || '1.0.0'}
                    </span>
                  </div>

                  {dev.is_disabled && (
                    <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs space-y-1">
                      <div className="flex items-center gap-1.5 font-bold text-rose-200">
                        <Lock className="w-3.5 h-3.5 text-rose-400" />
                        <span>LOCK DISABLED BY ROOT ADMIN</span>
                      </div>
                      <p className="text-[11px] text-rose-300/90">
                        Keypad PIN entry is blocked. Only Emergency Master TOTP PIN unlocks this door. Exit button remains active.
                      </p>
                      {dev.disabled_by_email && (
                        <p className="text-[10px] text-rose-400 font-mono">
                          Disabled by: {dev.disabled_by_email}
                        </p>
                      )}
                    </div>
                  )}

                  {/* EMERGENCY MASTER OFFLINE TOTP PIN CARD */}
                  <div className="bg-amber-950/25 border border-amber-600/40 rounded-xl p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <ShieldAlert className="w-4 h-4 text-amber-400" />
                        <span className="text-[11px] uppercase font-bold tracking-wider text-amber-300">
                          Emergency Master Offline TOTP
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-amber-400 font-bold px-2 py-0.5 rounded bg-amber-950/70 border border-amber-800/60">
                        {remaining}s left
                      </span>
                    </div>

                    <div className="flex items-center justify-between bg-slate-950/90 border border-amber-800/50 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-2xl font-black text-amber-400 tracking-[0.25em] select-all">
                          {totp.pin ? `${totp.pin.slice(0, 3)} ${totp.pin.slice(3)}` : '------'}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          6-DIGIT
                        </span>
                      </div>

                      <CopyButton textToCopy={totp.pin || ''} label="Copy PIN" />
                    </div>

                    {/* Countdown Progress Bar */}
                    <div className="space-y-1">
                      <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden border border-slate-800">
                        <div
                          className="bg-gradient-to-r from-amber-500 to-amber-400 h-full rounded-full transition-all duration-1000 ease-linear"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span>Rotates every {timeStep >= 3600 ? `${Math.round(timeStep / 3600)}h` : `${Math.round(timeStep / 60)}m`} ({timeStep}s)</span>
                        <span className="text-amber-400/90 font-medium">Root Admin Offline Keypad Pass</span>
                      </div>
                    </div>
                  </div>

                  {/* Secret Display (32-char Hex) */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                        Device Secret Token (32-char Hex)
                      </label>
                      <span className="text-[10px] text-slate-500 font-mono">128-bit Key</span>
                    </div>
                    <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-800 rounded-lg p-2 font-mono text-xs">
                      <span className="flex-1 truncate text-cyan-300 select-all">
                        {isRevealed
                          ? dev.device_secret
                          : '•'.repeat(24) + dev.device_secret.slice(-8)}
                      </span>

                      <button
                        type="button"
                        onClick={() => toggleRevealSecret(devKey)}
                        className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition"
                        title={isRevealed ? 'Hide secret' : 'Reveal full secret'}
                      >
                        {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>

                      <CopyButton textToCopy={dev.device_secret} label="Copy" />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-850/80 text-[11px] text-slate-400">
                  <span>
                    {dev.last_seen_at ? `Last seen ${formatTimeAgo(dev.last_seen_at)}` : 'Never seen'}
                  </span>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => handleToggleLock(dev)}
                      disabled={togglingLock === devKey}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 disabled:opacity-50 ${
                        dev.is_disabled
                          ? 'bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-800'
                          : 'bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800'
                      }`}
                      title={dev.is_disabled ? 'Enable lock to accept standard PINs' : 'Disable lock (Emergency TOTP only)'}
                    >
                      {dev.is_disabled ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                      <span>{dev.is_disabled ? 'Enable' : 'Disable'}</span>
                    </button>

                    <button
                      onClick={() => handleOpenEditDevice(dev)}
                      className="px-2.5 py-1 rounded-lg bg-indigo-950/70 hover:bg-indigo-900 text-indigo-300 border border-indigo-800 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95"
                      title="Edit lock details & space assignment"
                    >
                      <Pencil className="w-3 h-3" />
                      <span>Edit</span>
                    </button>

                    <button
                      onClick={() => handleUnbindHardware(dev)}
                      disabled={isUnbinding}
                      className="px-2.5 py-1 rounded-lg bg-amber-950/70 hover:bg-amber-900 text-amber-300 border border-amber-800 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 disabled:opacity-50"
                      title="Forget previously connected IP & MAC address so new ESP32 equipment can connect"
                    >
                      <RefreshCw className={`w-3 h-3 ${isUnbinding ? 'animate-spin' : ''}`} />
                      <span>{isUnbinding ? 'Clearing...' : 'Refresh HW'}</span>
                    </button>

                    <button
                      onClick={() => handleRotateSecret(dev.device_id || dev.space_id)}
                      disabled={isRotating}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 disabled:opacity-50"
                      title="Rotate cryptographic key and invalidate current device"
                    >
                      <RotateCcw className={`w-3 h-3 ${isRotating ? 'animate-spin' : ''}`} />
                      <span>{isRotating ? 'Rotating...' : 'Rotate'}</span>
                    </button>

                    {dev.device_id && (
                      <button
                        onClick={() => handleDeleteLock(dev.device_id!, dev.name || 'Door Lock', dev.space_id)}
                        className="px-2.5 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95"
                        title="Remove this door lock (deletes Facility Space if this is the last lock)"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Remove</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {filteredDevices.length === 0 && (
            <div className="col-span-full p-8 text-center text-slate-500 text-xs bg-slate-950/40 border border-slate-800 rounded-xl">
              No hardware devices match the filter criteria.
            </div>
          )}
        </div>
      </div>

      {/* 2. OTA Firmware Releases & Upload */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upload Form Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4 lg:col-span-1">
          <div className="border-b border-slate-800 pb-3 flex items-center gap-2">
            <Upload className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-100">
              Deploy OTA Firmware Release
            </h3>
          </div>

          <form onSubmit={handleFirmwareUpload} className="space-y-4 text-xs">
            <div>
              <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-400 mb-1.5">
                Firmware Version <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={firmwareVersion}
                onChange={(e) => setFirmwareVersion(e.target.value)}
                placeholder="e.g. 1.0.2 or 1.1.0"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 font-mono"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-400 mb-1.5">
                Target Facility Space
              </label>
              <select
                value={targetSpaceId}
                onChange={(e) => setTargetSpaceId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="all">All Registered Spaces (Broadcast)</option>
                {spaces.map((sp) => (
                  <option key={sp.slug} value={sp.slug}>
                    {sp.name} ({sp.slug})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-400 mb-1.5">
                Binary File (.bin) <span className="text-rose-400">*</span>
              </label>
              <input
                id="firmware-file-input"
                type="file"
                accept=".bin"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    setSelectedFile(e.target.files[0]);
                  }
                }}
                className="w-full text-slate-400 file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700 cursor-pointer"
                required
              />
              {selectedFile && (
                <p className="text-[11px] text-emerald-400 font-mono mt-1">
                  Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={uploading}
              className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 transition disabled:opacity-50"
            >
              <Upload className={`w-4 h-4 ${uploading ? 'animate-bounce' : ''}`} />
              <span>{uploading ? 'Uploading & Dispatching...' : 'Upload & Deploy OTA'}</span>
            </button>
          </form>
        </div>

        {/* Releases Ledger Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4 lg:col-span-2 flex flex-col">
          <div className="border-b border-slate-800 pb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileCode className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-slate-100">
                Firmware Release History
              </h3>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              {filteredReleases.length} {filteredReleases.length === 1 ? 'Release' : 'Releases'}
            </span>
          </div>

          {/* Release Filter Toolbar */}
          <div className="flex flex-wrap items-center gap-2.5 p-2.5 bg-slate-950/60 border border-slate-800 rounded-xl">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search version, checksum, file..."
                value={releaseSearch}
                onChange={(e) => setReleaseSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>

            <select
              value={releaseSpaceFilter}
              onChange={(e) => setReleaseSpaceFilter(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="all">All Targets</option>
              <option value="broadcast">Broadcast (All Spaces)</option>
              {spaces.map((sp) => (
                <option key={sp.slug} value={sp.slug}>
                  {sp.name}
                </option>
              ))}
            </select>

            {(releaseSearch || releaseSpaceFilter !== 'all') && (
              <button
                onClick={() => {
                  setReleaseSearch('');
                  setReleaseSpaceFilter('all');
                }}
                className="text-xs text-slate-400 hover:text-white px-2 py-1 bg-slate-800 rounded border border-slate-700 transition"
              >
                Clear
              </button>
            )}
          </div>

          {releases.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500">
              <FileCode className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-xs">No compiled firmware releases uploaded yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    <th className="py-2.5 px-3">Version</th>
                    <th className="py-2.5 px-3">Target Space</th>
                    <th className="py-2.5 px-3">SHA-256 Checksum</th>
                    <th className="py-2.5 px-3">Uploaded</th>
                    <th className="py-2.5 px-3 text-right">Download</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-sans">
                  {filteredReleases.map((rel) => (
                    <tr key={rel.id} className="hover:bg-slate-850/50 transition">
                      <td className="py-3 px-3 font-mono font-bold text-white">
                        v{rel.version}
                      </td>
                      <td className="py-3 px-3 text-slate-300">
                        {rel.target_space_id || 'All Spaces'}
                      </td>
                      <td className="py-3 px-3 font-mono text-[11px] text-slate-400">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate max-w-[120px]">{rel.sha256_checksum}</span>
                          <CopyButton textToCopy={rel.sha256_checksum} label="" />
                        </div>
                      </td>
                      <td className="py-3 px-3 text-slate-400 text-[11px]">
                        {formatTimeAgo(rel.created_at)}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <a
                          href={`/api/esp32/firmware/${rel.id}/download`}
                          download={rel.filename}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold border border-slate-700 transition"
                          title="Download compiled binary file"
                        >
                          <Download className="w-3 h-3 text-cyan-400" />
                          <span>.bin</span>
                        </a>
                      </td>
                    </tr>
                  ))}
                  {filteredReleases.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500 text-xs">
                        No firmware releases match the filter criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Add Additional Door Lock */}
      {showAddDoorModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl animate-in zoom-in-95 duration-150 max-h-[92dvh] overflow-y-auto my-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-cyan-600/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                  <Key className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Add Door Controller Lock</h3>
                  <p className="text-[11px] text-slate-400">Attach an additional physical lock to a Facility Space</p>
                </div>
              </div>
              <button
                onClick={() => setShowAddDoorModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateDoor} className="space-y-4 text-xs">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  ESP32 Hardware Device ID <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. ESP32_SANDBOXX_0_BACK_DOOR"
                  value={doorForm.device_id}
                  onChange={(e) => setDoorForm({ ...doorForm, device_id: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-750 rounded-xl px-3 py-2 text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Door Friendly Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Rear Exit Door"
                  value={doorForm.name}
                  onChange={(e) => setDoorForm({ ...doorForm, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-750 rounded-xl px-3 py-2 text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Assign to Facility Space
                </label>
                <select
                  value={doorForm.space_id}
                  onChange={(e) => setDoorForm({ ...doorForm, space_id: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-750 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                >
                  {spaces.map((sp) => (
                    <option key={sp.slug} value={sp.slug}>
                      {sp.name} ({sp.slug})
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  Multiple doors can control access for the same space. Both locks share active PIN authorizations.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddDoorModal(false)}
                  className="px-3 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold transition shadow-md"
                >
                  Register Door Lock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Door Lock Details Modal */}
      {editingDevice && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-750 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl animate-in zoom-in-95 duration-150 max-h-[92dvh] overflow-y-auto my-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                  <Pencil className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Edit Door Controller Lock</h3>
                  <p className="text-[11px] text-slate-400 font-mono">{editingDevice.device_id}</p>
                </div>
              </div>
              <button
                onClick={() => setEditingDevice(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveDeviceEdit} className="space-y-4 text-xs">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Door Friendly Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Main Glass Door"
                  value={editDoorForm.name}
                  onChange={(e) => setEditDoorForm({ ...editDoorForm, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-750 rounded-xl px-3 py-2 text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Assign to Facility Space
                </label>
                <select
                  value={editDoorForm.space_id}
                  onChange={(e) => setEditDoorForm({ ...editDoorForm, space_id: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-750 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                >
                  {spaces.map((sp) => (
                    <option key={sp.slug} value={sp.slug}>
                      {sp.name} ({sp.slug})
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  Reassigning shifts this physical lock hardware to control access for the selected space.
                </p>
              </div>

              <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editDoorForm.is_disabled}
                    onChange={(e) => setEditDoorForm({ ...editDoorForm, is_disabled: e.target.checked })}
                    className="rounded border-slate-700 bg-slate-900 text-rose-500 focus:ring-0"
                  />
                  <span className="text-xs font-semibold text-slate-200">Disable Door Lock</span>
                </label>
                <p className="text-[10px] text-slate-400">
                  When disabled, ordinary PINs are rejected at this door (Emergency TOTP remains active).
                </p>

                {editDoorForm.is_disabled && (
                  <div className="pt-2">
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                      Reason for Lockout
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Lock hardware maintenance"
                      value={editDoorForm.disabled_reason}
                      onChange={(e) => setEditDoorForm({ ...editDoorForm, disabled_reason: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingDevice(null)}
                  className="px-3 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingDoorEdit}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold transition shadow-md"
                >
                  {savingDoorEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ESP32HardwareManager;
