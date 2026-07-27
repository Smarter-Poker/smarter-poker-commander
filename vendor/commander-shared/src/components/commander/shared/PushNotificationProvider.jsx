/**
 * OneSignal Push Notification Provider
 * Updated for OneSignal Web SDK v16+
 * Dark industrial sci-fi gaming theme
 *
 * Usage - import with path alias (recommended):
 *   import PushNotificationProvider from '@/components/commander/shared/PushNotificationProvider';
 *
 * function MyApp({ Component, pageProps }) {
 *   return (
 *     <PushNotificationProvider>
 *       <Component {...pageProps} />
 *     </PushNotificationProvider>
 *   );
 * }
 */
import React, { useEffect, useState, createContext, useContext } from 'react';

const PushContext = createContext({
  isSupported: false,
  isSubscribed: false,
  permission: 'default',
  subscribe: () => { },
  unsubscribe: () => { },
});

export function usePushNotifications() {
  return useContext(PushContext);
}

export default function PushNotificationProvider({ children }) {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permission, setPermission] = useState('default');
  const [sdkReady, setSdkReady] = useState(false);

  useEffect(() => {
    // Check if OneSignal is configured
    const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
    if (!appId) {
      console.debug('OneSignal App ID not configured');
      return;
    }

    // Check if browser supports push
    if (typeof window === 'undefined' || !('Notification' in window)) {
      console.debug('Push notifications not supported');
      return;
    }

    setIsSupported(true);
    setPermission(Notification.permission);

    // Load OneSignal SDK v16+
    const loadOneSignal = async () => {
      try {
        // Guard: prevent double-initialization if another provider already init'd
        if (window.__oneSignalInitialized) {
          setSdkReady(true);
          return;
        }

        // Add OneSignal script if not already loaded
        if (!window.OneSignalDeferred) {
          window.OneSignalDeferred = window.OneSignalDeferred || [];

          const script = document.createElement('script');
          script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
          script.async = true;
          script.defer = true;
          document.head.appendChild(script);

          await new Promise((resolve, reject) => {
            script.onload = resolve;
            script.onerror = reject;
          });
        }

        // Initialize OneSignal with v16 API
        window.OneSignalDeferred.push(async function (OneSignal) {
          try {
            if (window.__oneSignalInitialized) {
              setSdkReady(true);
              return;
            }

            await OneSignal.init({
              appId: appId,
              safari_web_id: process.env.NEXT_PUBLIC_ONESIGNAL_SAFARI_WEB_ID,
              notifyButton: {
                enable: false, // We'll use our own UI
              },
              allowLocalhostAsSecureOrigin: process.env.NODE_ENV === 'development',
            });

            window.__oneSignalInitialized = true;

            // Check subscription status using v16 API
            const isPushEnabled = await OneSignal.Notifications.permission;
            const isOptedIn = await OneSignal.User.PushSubscription.optedIn;
            setIsSubscribed(isPushEnabled && isOptedIn);
            setPermission(isPushEnabled ? 'granted' : Notification.permission);

            // Listen for subscription changes (v16 API)
            OneSignal.User.PushSubscription.addEventListener('change', (event) => {
              setIsSubscribed(event.current.optedIn);
            });

            // Listen for permission changes
            OneSignal.Notifications.addEventListener('permissionChange', (permission) => {
              setPermission(permission ? 'granted' : 'denied');
            });

            setSdkReady(true);
          } catch (initError) {
              console.warn('[App] Handled exception:', initError?.message || initError);
              console.warn('OneSignal init error:', initError);
          }
        });
      } catch (err) {
        console.warn('Failed to load OneSignal:', err);
      }
    };

    loadOneSignal();
  }, []);

  const subscribe = async () => {
    if (!sdkReady || typeof window === 'undefined') return false;

    try {
      await new Promise((resolve, reject) => {
        window.OneSignalDeferred.push(async function (OneSignal) {
          try {
            // Request permission and opt in (v16 API)
            await OneSignal.Notifications.requestPermission();
            await OneSignal.User.PushSubscription.optIn();

            // Set external user ID if user is logged in
            const userId = localStorage.getItem('smarter-poker-user-id');
            if (userId) {
              await OneSignal.login(userId);
            }

            setIsSubscribed(true);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      return true;
    } catch (err) {
      console.warn('Subscribe error:', err);
      return false;
    }
  };

  const unsubscribe = async () => {
    if (!sdkReady || typeof window === 'undefined') return false;

    try {
      await new Promise((resolve, reject) => {
        window.OneSignalDeferred.push(async function (OneSignal) {
          try {
            // Opt out using v16 API
            await OneSignal.User.PushSubscription.optOut();
            setIsSubscribed(false);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      return true;
    } catch (err) {
      console.warn('Unsubscribe error:', err);
      return false;
    }
  };

  // Set external user ID when user logs in (v16 API uses login())
  const setUserId = (userId) => {
    if (!sdkReady || !userId || typeof window === 'undefined') return;

    window.OneSignalDeferred.push(async function (OneSignal) {
      try {
        await OneSignal.login(userId);
      } catch (err) {
        console.warn('Failed to set user ID:', err);
      }
    });
  };

  // Add tags for targeting (e.g., venue_id) - v16 API
  const addTags = (tags) => {
    if (!sdkReady || typeof window === 'undefined') return;

    window.OneSignalDeferred.push(async function (OneSignal) {
      try {
        await OneSignal.User.addTags(tags);
      } catch (err) {
        console.warn('Failed to add tags:', err);
      }
    });
  };

  return (
    <PushContext.Provider
      value={{
        isSupported,
        isSubscribed,
        permission,
        subscribe,
        unsubscribe,
        setUserId,
        addTags,
      }}
    >
      {children}
    </PushContext.Provider>
  );
}

/**
 * Push notification prompt button component
 */
export function PushNotificationButton({ className = '' }) {
  const { isSupported, isSubscribed, permission, subscribe, unsubscribe } = usePushNotifications();

  if (!isSupported) {
    return null;
  }

  if (permission === 'denied') {
    return (
      <div className={`text-sm text-[#4A5E78] ${className}`}>
        Notifications blocked. Enable in browser settings.
      </div>
    );
  }

  if (isSubscribed) {
    return (
      <button
        onClick={unsubscribe}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[#10B981]/10 text-[#10B981] ${className}`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        Notifications On
      </button>
    );
  }

  return (
    <button
      onClick={subscribe}
      className={`cmd-btn cmd-btn-primary flex items-center gap-2 px-4 py-2 text-sm ${className}`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
      Enable Notifications
    </button>
  );
}
