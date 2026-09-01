'use strict';

/**
 * CueSport Cloud — dock OAuth and self-host settings helpers.
 */
(function () {
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
        const prefix = 'cloudRelay_';
        const instanceId = new URLSearchParams(window.location.search).get('instance') || '';
        function set(k, v) {
            const key = instanceId ? `${instanceId}_${prefix}${k}` : `${prefix}${k}`;
            localStorage.setItem(key, v);
        }
        set('accessToken', data.access_token || '');
        set('roomId', data.room?.id || '');
        set('signedInEmail', data.account?.email || '');
        if (data.api_key) set('apiKey', data.api_key);
        window.cloudRelay.updateCloudUI();
        alert(`Signed in as ${data.account?.email || 'user'}. Enable CueSport Cloud to connect.`);
    }

    function signOutCloud() {
        if (window.cloudRelay) window.cloudRelay.clearSession();
        const emailEl = document.getElementById('cloudSignedInEmail');
        if (emailEl) emailEl.textContent = '';
    }

    function openCloudSelfHostModal() {
        const modal = document.getElementById('cloudSelfHostModal');
        if (!modal) return;
        const serverUrl = document.getElementById('cloudServerUrlModal');
        const apiKey = document.getElementById('cloudApiKeyModal');
        const prefix = 'cloudRelay_';
        const instanceId = new URLSearchParams(window.location.search).get('instance') || '';
        function get(k) {
            const key = instanceId ? `${instanceId}_${prefix}${k}` : `${prefix}${k}`;
            return localStorage.getItem(key) || '';
        }
        if (serverUrl) serverUrl.value = get('serverUrl') || 'http://localhost:3000';
        if (apiKey) apiKey.value = get('apiKey');
        modal.style.display = 'block';
    }

    function closeCloudSelfHostModal() {
        const modal = document.getElementById('cloudSelfHostModal');
        if (modal) modal.style.display = 'none';
    }

    function saveCloudSelfHostSettings() {
        if (!window.cloudRelay) return;
        const serverUrl = document.getElementById('cloudServerUrlModal')?.value?.trim();
        const apiKey = document.getElementById('cloudApiKeyModal')?.value?.trim();
        window.cloudRelay.setCredentials({
            serverUrl: serverUrl || undefined,
            apiKey: apiKey || undefined,
        });
        closeCloudSelfHostModal();
        window.cloudRelay.updateCloudUI();
        alert('Settings saved. Enable CueSport Cloud to connect — your table room is created automatically from the OBS instance (?instance=).');
    }

    function toggleCloudRelay() {
        const toggle = document.getElementById('cloudRelayToggle');
        if (!toggle || !window.cloudRelay) return;
        if (toggle.checked) {
            if (!window.cloudRelay.hasCredentials()) {
                toggle.checked = false;
                openCloudSelfHostModal();
                alert('Sign in or configure server URL + API key (from your dashboard). Room/table is assigned automatically from your OBS instance.');
                return;
            }
        }
        window.cloudRelay.setEnabled(toggle.checked);
        if (toggle.checked && window.streamSharing) {
            window.streamSharing.sendUpdate();
        }
    }

    window.signInWithGoogle = signInWithGoogle;
    window.signOutCloud = signOutCloud;
    window.openCloudSelfHostModal = openCloudSelfHostModal;
    window.closeCloudSelfHostModal = closeCloudSelfHostModal;
    window.saveCloudSelfHostSettings = saveCloudSelfHostSettings;
    window.toggleCloudRelay = toggleCloudRelay;
    window.applyCloudLoginResult = applyLoginResult;

    window.addEventListener('message', function (event) {
        if (event.data && event.data.type === 'cuesport_auth' && event.data.payload) {
            applyLoginResult(event.data.payload);
        }
    });
})();
