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

    async function devLogin(email) {
        const base = getCloudServerUrl().replace(/\/$/, '');
        const res = await fetch(`${base}/api/auth/dev-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Login failed');
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
        const email = prompt('Dev login — enter your email:', '');
        if (!email) return;
        const data = await devLogin(email.trim());
        applyLoginResult(data);
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
        const roomId = document.getElementById('cloudRoomIdModal');
        const apiKey = document.getElementById('cloudApiKeyModal');
        const prefix = 'cloudRelay_';
        const instanceId = new URLSearchParams(window.location.search).get('instance') || '';
        function get(k) {
            const key = instanceId ? `${instanceId}_${prefix}${k}` : `${prefix}${k}`;
            return localStorage.getItem(key) || '';
        }
        if (serverUrl) serverUrl.value = get('serverUrl') || 'http://localhost:3000';
        if (roomId) roomId.value = get('roomId');
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
        const roomId = document.getElementById('cloudRoomIdModal')?.value?.trim();
        const apiKey = document.getElementById('cloudApiKeyModal')?.value?.trim();
        window.cloudRelay.setCredentials({
            serverUrl: serverUrl || undefined,
            roomId: roomId || undefined,
            apiKey: apiKey || undefined,
        });
        closeCloudSelfHostModal();
        window.cloudRelay.updateCloudUI();
        alert('Self-host settings saved. Enable the CueSport Cloud toggle to connect.');
    }

    function toggleCloudRelay() {
        const toggle = document.getElementById('cloudRelayToggle');
        if (!toggle || !window.cloudRelay) return;
        if (toggle.checked) {
            if (!window.cloudRelay.hasCredentials()) {
                toggle.checked = false;
                openCloudSelfHostModal();
                alert('Configure server URL, Room ID, and API key (from the same server you logged into). Or use Dev sign-in in the dock.');
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
