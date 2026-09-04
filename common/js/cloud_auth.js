'use strict';

/**
 * CueSport Cloud — dock OAuth and connection settings helpers.
 */
(function () {
    const CONNECTION_MODE_KEY = 'connectionMode';

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
        return 'https://cuesports.macleod.systems';
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
        if (config && config.supabaseUrl && config.supabaseAnonKey) {
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
        setStored('accessToken', data.access_token || '');
        setStored('roomId', data.room?.id || '');
        setStored('signedInEmail', data.account?.email || '');
        // Managed OAuth uses access token; drop self-host key so toggle uses the session.
        setStored('apiKey', '');
        if (data.api_key) setStored('apiKey', data.api_key);
        window.cloudRelay.updateCloudUI();
        closeCloudConnectionModal();
        alert(`Signed in as ${data.account?.email || 'user'}. Enable CueSport Cloud to connect.`);
    }

    function signOutCloud(options) {
        const silent = !!(options && options.silent);
        if (!silent && !window.confirm('Sign out of CueSport Cloud on this dock?')) return;
        if (window.cloudRelay) {
            window.cloudRelay.setEnabled(false);
            window.cloudRelay.clearSession();
            window.cloudRelay.updateCloudUI();
        }
        const emailEl = document.getElementById('cloudSignedInEmail');
        if (emailEl) emailEl.textContent = '';
        const toggle = document.getElementById('cloudRelayToggle');
        if (toggle) toggle.checked = false;
    }

    function syncConnectionPaneUI(mode) {
        const managed = document.getElementById('cloudManagedPane');
        const selfHost = document.getElementById('cloudSelfHostPane');
        const saveBtn = document.getElementById('cloudConnectionSaveBtn');
        const isSelfHost = mode === 'selfhost';
        if (managed) managed.classList.toggle('noShow', isSelfHost);
        if (selfHost) selfHost.classList.toggle('noShow', !isSelfHost);
        if (saveBtn) saveBtn.classList.toggle('noShow', !isSelfHost);
    }

    function showCloudManagedPane() {
        setConnectionMode('managed');
        const managedUrl = 'https://cuesports.macleod.systems';
        setStored('serverUrl', managedUrl);
        if (window.cloudRelay) {
            window.cloudRelay.setCredentials({ serverUrl: managedUrl });
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

    function openCloudConnectionModal() {
        const modal = document.getElementById('cloudConnectionModal');
        if (!modal) return;
        const serverUrl = document.getElementById('cloudServerUrlModal');
        const apiKey = document.getElementById('cloudApiKeyModal');
        if (serverUrl) serverUrl.value = getStored('serverUrl') || 'http://localhost:3000';
        if (apiKey) apiKey.value = getStored('apiKey');
        const mode = getConnectionMode();
        syncConnectionPaneUI(mode);
        modal.style.display = 'block';
    }

    function closeCloudConnectionModal() {
        const modal = document.getElementById('cloudConnectionModal');
        if (modal) modal.style.display = 'none';
    }

    /** @deprecated Use openCloudConnectionModal */
    function openCloudSelfHostModal() {
        openCloudConnectionModal();
        showCloudSelfHostPane();
    }

    /** @deprecated Use closeCloudConnectionModal */
    function closeCloudSelfHostModal() {
        closeCloudConnectionModal();
    }

    function saveCloudSelfHostSettings() {
        if (!window.cloudRelay) return;
        const serverUrl = document.getElementById('cloudServerUrlModal')?.value?.trim();
        const apiKey = document.getElementById('cloudApiKeyModal')?.value?.trim();
        if (!apiKey) {
            alert('Enter an OBS Dock Key from your dashboard.');
            return;
        }
        setConnectionMode('selfhost');
        // Self-host uses dock key; clear managed session token so join uses the key.
        window.cloudRelay.setCredentials({
            serverUrl: serverUrl || undefined,
            apiKey: apiKey || undefined,
            accessToken: '',
            roomId: '',
        });
        setStored('signedInEmail', '');
        closeCloudConnectionModal();
        window.cloudRelay.updateCloudUI();
        alert('Settings saved. Enable CueSport Cloud to connect — your table room is created automatically from the OBS instance (?instance=).');
    }

    function toggleCloudRelay() {
        const toggle = document.getElementById('cloudRelayToggle');
        if (!toggle || !window.cloudRelay) return;
        if (toggle.checked) {
            if (!window.cloudRelay.hasCredentials()) {
                toggle.checked = false;
                openCloudConnectionModal();
                alert('Sign in with Google or open Self-hosting to add your Server URL and OBS Dock Key, then enable CueSport Cloud.');
                return;
            }
            window.cloudRelay.setEnabled(true);
            if (window.streamSharing) {
                window.streamSharing.sendUpdate();
            }
            return;
        }
        // Toggle off signs out and disconnects (replaces the old Sign out button).
        signOutCloud({ silent: true });
    }

    window.signInWithGoogle = signInWithGoogle;
    window.signOutCloud = signOutCloud;
    window.openCloudConnectionModal = openCloudConnectionModal;
    window.closeCloudConnectionModal = closeCloudConnectionModal;
    window.openCloudSelfHostModal = openCloudSelfHostModal;
    window.closeCloudSelfHostModal = closeCloudSelfHostModal;
    window.showCloudManagedPane = showCloudManagedPane;
    window.showCloudSelfHostPane = showCloudSelfHostPane;
    window.saveCloudSelfHostSettings = saveCloudSelfHostSettings;
    window.toggleCloudRelay = toggleCloudRelay;
    window.applyCloudLoginResult = applyLoginResult;

    window.addEventListener('message', function (event) {
        if (event.data && event.data.type === 'cuesport_auth' && event.data.payload) {
            applyLoginResult(event.data.payload);
        }
    });
})();
