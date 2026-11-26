/**
 * Browser Web Push API, Service Worker Registration, and PWA Helper.
 */

import { api } from './api';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export const pushService = {
  isSecureContext(): boolean {
    if (typeof window === 'undefined') return false;
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return true;
    }
    return Boolean(window.isSecureContext);
  },

  isPushSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  },

  isIOS(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
  },

  isStandalone(): boolean {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true
    );
  },

  async registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) return null;
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
      });
      return registration;
    } catch (err) {
      console.warn('Service worker registration failed:', err);
      return null;
    }
  },

  async getExistingSubscription(): Promise<PushSubscription | null> {
    if (!this.isPushSupported()) return null;
    try {
      await this.registerServiceWorker();
      const registration = await navigator.serviceWorker.ready;
      return registration.pushManager.getSubscription();
    } catch {
      return null;
    }
  },

  async subscribeUser(): Promise<boolean> {
    // Check Secure Context
    if (!this.isSecureContext()) {
      throw new Error(
        'Push notifications require a secure connection (HTTPS or localhost). Mobile browsers block Web Push over plain HTTP on IP addresses.'
      );
    }

    // Check iOS requirement
    if (this.isIOS() && !this.isStandalone()) {
      throw new Error(
        'On iOS / iPhone, Apple requires installing the web app first: Tap Share ⎋ -> "Add to Home Screen" ⊞, then open the PANDA app from your home screen to enable alerts.'
      );
    }

    if (!this.isPushSupported()) {
      throw new Error('Web Push notifications are not supported by this browser.');
    }

    // 1. Request notification permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error('Notification permission was denied. Please allow notifications in browser settings.');
    }

    // 2. Ready registration
    await this.registerServiceWorker();
    const registration = await navigator.serviceWorker.ready;

    // 3. Fetch VAPID public key from backend
    const vapidPublicKey = await api.fetchVapidPublicKey();
    const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);

    // 4. Subscribe with PushManager
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: convertedVapidKey,
    });

    // 5. Serialize and send to backend
    const subJson = subscription.toJSON();
    if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
      throw new Error('Invalid push subscription keys returned by browser.');
    }

    await api.subscribePush({
      endpoint: subJson.endpoint,
      keys: {
        p256dh: subJson.keys.p256dh,
        auth: subJson.keys.auth,
      },
    });

    return true;
  },

  async sendTestAlert(): Promise<{ delivered_count: number; message: string }> {
    return api.sendPushTestAlert();
  },

  async unsubscribeUser(): Promise<void> {
    if (this.isPushSupported()) {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      } catch {}
    }
    await api.unsubscribePush();
  },

  async setAlertsEnabled(enabled: boolean): Promise<{ pushSynced: boolean; pushError?: string }> {
    localStorage.setItem('panda_su_sound_enabled', String(enabled));
    window.dispatchEvent(new CustomEvent('panda-su-sound-changed', { detail: enabled }));
    if (enabled) {
      if (this.isPushSupported() && this.isSecureContext()) {
        try {
          await this.subscribeUser();
          return { pushSynced: true };
        } catch (err: any) {
          return { pushSynced: false, pushError: err?.message };
        }
      }
      return { pushSynced: false };
    } else {
      await this.unsubscribeUser().catch(() => {});
      return { pushSynced: true };
    }
  },
};
