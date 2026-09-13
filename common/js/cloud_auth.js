'use strict';

/**
 * CueSport Cloud — dock OAuth and connection settings helpers.
 */
(function () {
    const CONNECTION_MODE_KEY = 'connectionMode';
    const MANAGED_SERVER_URL = 'https://cuesports.macleod.systems';

    function storageKey(k) {
        const prefix = 'cloudRelay_';
        const instanceId = new URLSearchParams(window.location.search).get('instance') || '';
        return instanceId ? `${instanceId}_${prefix}${k}` : `${prefix}${k}`;
    }

    function getStored(k) {
        return localStorage.getItem(storageKey(k)) || '';
    }

    function setStored(k, v) {
        localStorage.setItem(storageKey(k), v == null ? '' : String(v));
    }

    function getConnectionMode() {
        const mode = getStored(CONNECTION_MODE_KEY);
        return mode === 'selfhost' ? 'selfhost' : 'managed';
    }

    function setConnectionMode(mode) {
        setStored(CONNECTION_MODE_KEY, mode === 'selfhost' ? 'selfhost' : 'managed');
    }

    function getCloudServerUrl() {
        if (window.cloudRelay) return window.cloudRelay.getServerUrl();
        return MANAGED_SERVER_URL;
    }

    async function fetchPublicConfig() {
        const base = getCloudServerUrl().replace(/\/$/, '');
        try {
            const res = await fetch(`${base}/api/config/public`);
            if (!res.ok) return null;
            return res.json();
        } catch {
            return null;
        }
    }

    async function devLogin(secret) {
        const base = getCloudServerUrl().replace(/\/$/, '');
        const res = await fetch(`${base}/api/auth/dev-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            const msg = err.error || err.message ||
                (res.status === 401 ? 'Invalid dev auth secret' : 'Dev login failed');
            throw new Error(msg);
        }
        return res.json();
    }

    async function signInWithGoogle() {
        setConnectionMode('managed');
        const config = await fetchPublicConfig();
        if (config && config.supabaseUrl && config.supabasePublishableKey) {
            const redirect = encodeURIComponent(`${config.publicUrl}/web/dashboard/?dock=1`);
            window.open(
                `${config.supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${redirect}`,
                'cuesport_oauth',
                'width=500,height=700'
            );
            return;
        }
        const secret = prompt('Dev login — enter your server dev auth secret:', '');
        if (!secret) return;
        try {
            const data = await devLogin(secret.trim());
            applyLoginResult(data);
        } catch (err) {
            alert(err.message || 'Dev login failed');
        }
    }

    function applyLoginResult(data) {
        if (!window.cloudRelay || !data) return;
        setConnectionMode('managed');
        setStored('signedInEmail', data.account?.email || '');
        // Keep any existing dock key; Google/dev login is for account identity only.
        const existingKey = getStored('apiKey') ||
            (typeof window.cloudRelay.getApiKey === 'function' ? window.cloudRelay.getApiKey() : '') ||
            '';
        window.cloudRelay.setCredentials({
            serverUrl: MANAGED_SERVER_URL,
            accessToken: data.access_token || '',
            roomId: data.room?.id || '',
            apiKey: data.api_key || existingKey || '',
        });
        const managedKey = document.getElementById('cloudManagedApiKeyModal');
        if (managedKey && (data.api_key || existingKey)) {
            managedKey.value = data.api_key || existingKey;
        }
        window.cloudRelay.updateCloudUI();
        closeCloudConnectionModal();
        if (data.api_key || existingKey) {
            alert(`Signed in as ${data.account?.email || 'user'}. Enable CueSport Cloud to connect.`);
        } else {
            alert(
                `Signed in as ${data.account?.email || 'user'}. ` +
                'Create an OBS Dock Key in the dashboard (Account), paste it under Connection settings, then enable CueSport Cloud.'
            );
            openCloudConnectionModal();
            showCloudManagedPane();
        }
    }

    function signOutCloud(options) {
        const silent = !!(options && options.silent);
        if (!silent && !window.confirm('Clear the OBS Dock Key and sign out of CueSport Cloud on this dock?')) return;
        if (window.cloudRelay) {
            window.cloudRelay.setEnabled(false);
            window.cloudRelay.clearSession();
            window.cloudRelay.updateCloudUI();
        }
        const emailEl = document.getElementById('cloudSignedInEmail');
        if (emailEl) emailEl.textContent = '';
        const toggle = document.getElementById('cloudRelayToggle');
        if (toggle) toggle.checked = false;
        const managedKey = document.getElementById('cloudManagedApiKeyModal');
        if (managedKey) managedKey.value = '';
        const selfHostKey = document.getElementById('cloudApiKeyModal');
        if (selfHostKey) selfHostKey.value = '';
        if (!silent) closeCloudConnectionModal();
    }

    function syncConnectionPaneUI(mode) {
        const managed = document.getElementById('cloudManagedPane');
        const selfHost = document.getElementById('cloudSelfHostPane');
        const isSelfHost = mode === 'selfhost';
        if (managed) managed.classList.toggle('noShow', isSelfHost);
        if (selfHost) selfHost.classList.toggle('noShow', !isSelfHost);
    }

    function showCloudManagedPane() {
        setConnectionMode('managed');
        setStored('serverUrl', MANAGED_SERVER_URL);
        if (window.cloudRelay) {
            window.cloudRelay.setCredentials({ serverUrl: MANAGED_SERVER_URL });
        }
        const managedKey = document.getElementById('cloudManagedApiKeyModal');
        if (managedKey && !managedKey.value) {
            managedKey.value = getStored('apiKey');
        }
        syncConnectionPaneUI('managed');
    }

    function showCloudSelfHostPane() {
        setConnectionMode('selfhost');
        syncConnectionPaneUI('selfhost');
        const serverUrl = document.getElementById('cloudServerUrlModal');
        const apiKey = document.getElementById('cloudApiKeyModal');
        if (serverUrl && !serverUrl.value) {
            serverUrl.value = getStored('serverUrl') || 'http://localhost:3000';
        }
        if (apiKey && !apiKey.value) {
            apiKey.value = getStored('apiKey');
        }
    }

    function syncManagedPublicUrlLink() {
        const el = document.getElementById('cloudManagedPublicUrl');
        if (!el) return;
        const url = MANAGED_SERVER_URL.replace(/\/$/, '');
        el.href = url;
        el.textContent = url;
    }

    function openCloudConnectionModal() {
        const modal = document.getElementById('cloudConnectionModal');
        if (!modal) return;
        const serverUrl = document.getElementById('cloudServerUrlModal');
        const apiKey = document.getElementById('cloudApiKeyModal');
        const managedKey = document.getElementById('cloudManagedApiKeyModal');
        if (serverUrl) serverUrl.value = getStored('serverUrl') || 'http://localhost:3000';
        if (apiKey) apiKey.value = getStored('apiKey');
        if (managedKey) managedKey.value = getStored('apiKey');
        syncManagedPublicUrlLink();
        const mode = getConnectionMode();
        syncConnectionPaneUI(mode);
        modal.style.display = 'block';
    }

    function closeCloudConnectionModal() {
        const modal = document.getElementById('cloudConnectionModal');
        if (modal) modal.style.display = 'none';
    }

    function saveCloudConnectionSettings(options) {
        if (!window.cloudRelay) return false;
        const connect = !!(options && options.connect);
        const mode = getConnectionMode();
        if (mode === 'selfhost') {
            const serverUrl = document.getElementById('cloudServerUrlModal')?.value?.trim();
            const apiKey = document.getElementById('cloudApiKeyModal')?.value?.trim();
            if (!apiKey) {
                alert('Enter an OBS Dock Key from your dashboard.');
                return false;
            }
            setConnectionMode('selfhost');
            window.cloudRelay.setCredentials({
                serverUrl: serverUrl || undefined,
                apiKey: apiKey,
                accessToken: '',
                roomId: '',
            });
            setStored('signedInEmail', '');
        } else {
            const apiKey = document.getElementById('cloudManagedApiKeyModal')?.value?.trim();
            if (!apiKey) {
                alert('Enter an OBS Dock Key from your dashboard (Account → OBS Dock Keys).');
                return false;
            }
            setConnectionMode('managed');
            window.cloudRelay.setCredentials({
                serverUrl: MANAGED_SERVER_URL,
                apiKey: apiKey,
            });
        }
        closeCloudConnectionModal();
        if (connect) {
            const toggle = document.getElementById('cloudRelayToggle');
            if (toggle) toggle.checked = true;
            window.cloudRelay.setEnabled(true);
            if (window.streamSharing) {
                window.streamSharing.sendUpdate();
            }
        } else {
            window.cloudRelay.updateCloudUI();
            alert('Settings saved. Enable CueSport Cloud to connect — your table room is created automatically from the OBS instance (?instance=).');
        }
        return true;
    }

    function saveCloudConnectionSettingsAndConnect() {
        saveCloudConnectionSettings({ connect: true });
    }

    function toggleCloudRelay() {
        const toggle = document.getElementById('cloudRelayToggle');
        if (!toggle || !window.cloudRelay) return;
        if (toggle.checked) {
            if (!window.cloudRelay.hasCredentials()) {
                toggle.checked = false;
                openCloudConnectionModal();
                alert('Paste an OBS Dock Key from your dashboard (Account → OBS Dock Keys), then enable CueSport Cloud.');
                return;
            }
            window.cloudRelay.setEnabled(true);
            if (window.streamSharing) {
                window.streamSharing.sendUpdate();
            }
            return;
        }
        // Disconnect only — keep dock key / room so Cloud can resume later.
        window.cloudRelay.setEnabled(false);
    }

    window.signInWithGoogle = signInWithGoogle;
    window.signOutCloud = signOutCloud;
    window.openCloudConnectionModal = openCloudConnectionModal;
    window.closeCloudConnectionModal = closeCloudConnectionModal;
    window.showCloudManagedPane = showCloudManagedPane;
    window.showCloudSelfHostPane = showCloudSelfHostPane;
    window.saveCloudConnectionSettings = saveCloudConnectionSettings;
    window.saveCloudConnectionSettingsAndConnect = saveCloudConnectionSettingsAndConnect;
    window.toggleCloudRelay = toggleCloudRelay;
    window.applyCloudLoginResult = applyLoginResult;

    window.addEventListener('message', function (event) {
        if (event.data && event.data.type === 'cuesport_auth' && event.data.payload) {
            applyLoginResult(event.data.payload);
        }
    });
})();
