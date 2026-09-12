'use strict';

/**
 * Dock Remote tab — guest QR (hidden until Show) plus guest links by role.
 * OBS Dock Owner is listed and selectable, but not revokable from the dock.
 */
(function () {
    const OWNER_LABEL = 'OBS Dock Owner';
    const REMOTE_TITLE_BY_ROLE = {
        administrator: 'Administrator Control',
        trusted_operator: 'Trusted Operator Control',
        operator: 'Operator Control',
    };
    const REMOTE_TITLE_FALLBACK = 'Guest control';
    const REMOTE_HELP_BY_ROLE = {
        administrator:
            'As Administrator on this Dock Key, use Remote to hand off table control from a phone instead of the OBS machine. ' +
            'Share the default OBS Dock Owner link with someone who should have elevated remote access — scoring plus Stream and Share, and managing guest links. ' +
            'Create named guest links for helpers who only need scoring (no names, Stream, or Share). ' +
            'One device per link; QR and URL stay hidden until Show.',
        trusted_operator:
            'As Trusted Operator on this Dock Key, use Remote to run this table from a phone instead of the OBS machine. ' +
            'Use the default OBS Dock Owner link for someone who should have full remote control (scoring, Stream, Share, and guest-link management). ' +
            'Create named guest links for helpers who only need scoring — no names, Stream, or Share. ' +
            'One device per link; QR and URL stay hidden until Show.',
        operator:
            'As Operator on this Dock Key, this Remote tab lets you connect from a phone so you do not have to oversee the game from the OBS machine. ' +
            'Share the default OBS Dock Owner link for elevated remote control (scoring, Stream, and Share). ' +
            'Operator keys cannot create additional guest links. ' +
            'One device per link; QR and URL stay hidden until Show.',
    };
    const REMOTE_HELP_FALLBACK =
        'Share guest links for this table. The default OBS Dock Owner link is for elevated remote control (scoring, Stream, Share). ' +
        'Named guest links are for scorers only — no names, Stream, or Share. ' +
        'One device per link; QR and URL stay hidden until Show.';
    let refreshTimer = null;
    let selectedToken = '';
    let selectedUrl = '';
    let selectedLabel = '';
    let linkRevealed = false;
    let cachedLinks = [];

    function isRemoteTabAvailable() {
        if (!(window.cloudRelay && typeof window.cloudRelay.isEnabled === 'function' && window.cloudRelay.isEnabled())) {
            return false;
        }
        if (typeof window.cloudRelay.isUsableForTabs === 'function') {
            return !!window.cloudRelay.isUsableForTabs();
        }
        return !!(typeof window.cloudRelay.isConnected === 'function' && window.cloudRelay.isConnected());
    }

    function canManageExtraGuestLinks() {
        const perms = window.cloudRelay && typeof window.cloudRelay.getPermissions === 'function'
            ? window.cloudRelay.getPermissions()
            : null;
        return !!(perms && perms.canCreateGuestLinks);
    }

    function currentDockRole() {
        const role = window.cloudRelay && typeof window.cloudRelay.getRole === 'function'
            ? window.cloudRelay.getRole()
            : null;
        return role ? String(role) : '';
    }

    function updateRemoteSectionTitle() {
        const el = document.getElementById('cloudRemoteSectionHeader');
        if (!el) return;
        const role = currentDockRole();
        if (REMOTE_TITLE_BY_ROLE[role]) {
            el.textContent = REMOTE_TITLE_BY_ROLE[role];
            return;
        }
        if (canManageExtraGuestLinks()) {
            el.textContent = REMOTE_TITLE_BY_ROLE.trusted_operator;
            return;
        }
        if (isRemoteTabAvailable()) {
            el.textContent = REMOTE_TITLE_BY_ROLE.operator;
            return;
        }
        el.textContent = REMOTE_TITLE_FALLBACK;
    }

    function updateRemoteHelpCopy() {
        updateRemoteSectionTitle();
        const el = document.getElementById('cloudRemoteHelp');
        if (!el) return;
        const role = currentDockRole();
        if (REMOTE_HELP_BY_ROLE[role]) {
            el.textContent = REMOTE_HELP_BY_ROLE[role];
            return;
        }
        // Connected but role not yet known — still explain Owner vs named guests.
        if (canManageExtraGuestLinks()) {
            el.textContent = REMOTE_HELP_BY_ROLE.trusted_operator;
            return;
        }
        if (isRemoteTabAvailable()) {
            el.textContent = REMOTE_HELP_BY_ROLE.operator;
            return;
        }
        el.textContent = REMOTE_HELP_FALLBACK;
    }

    function cloudAuthHeaders(includeJsonContentType) {
        const headers = { Accept: 'application/json' };
        if (includeJsonContentType) headers['Content-Type'] = 'application/json';
        const token = window.cloudRelay && window.cloudRelay.getAccessToken
            ? window.cloudRelay.getAccessToken()
            : '';
        const apiKey = window.cloudRelay && window.cloudRelay.getApiKey
            ? window.cloudRelay.getApiKey()
            : '';
        if (token) headers.Authorization = 'Bearer ' + token;
        else if (apiKey) headers['X-Api-Key'] = apiKey;
        return headers;
    }

    function serverUrl() {
        const url = window.cloudRelay && window.cloudRelay.getServerUrl
            ? window.cloudRelay.getServerUrl()
            : '';
        return String(url || '').replace(/\/$/, '');
    }

    function roomId() {
        return window.cloudRelay && window.cloudRelay.getRoomId
            ? window.cloudRelay.getRoomId()
            : '';
    }

    function setStatus(text) {
        const el = document.getElementById('cloudRemoteStatus');
        if (el) el.textContent = text || '';
    }

    function guestUrl(link) {
        if (!link) return '';
        if (link.url) return link.url;
        if (link.path) {
            const origin = serverUrl() || (typeof location !== 'undefined' ? location.origin : '');
            return origin + link.path;
        }
        if (link.token) {
            const origin = serverUrl() || (typeof location !== 'undefined' ? location.origin : '');
            return origin + '/g/' + link.token;
        }
        return '';
    }

    function isOwnerLink(link) {
        return !!(link && link.label === OWNER_LABEL);
    }

    function updateRemoteTabAvailability() {
        const available = isRemoteTabAvailable();
        const tab = document.getElementById('remoteTab');
        if (tab) {
            tab.classList.toggle('tablinks-disabled', !available);
            tab.setAttribute('aria-disabled', available ? 'false' : 'true');
            if (available) {
                tab.removeAttribute('title');
            } else {
                tab.title = 'Connect CueSport Scoreboard Cloud in Settings to use Remote';
            }
        }
        if (!available) {
            const panel = document.getElementById('RemoteSettings');
            if (panel && panel.style.display === 'block' && typeof selectControlPanelTab === 'function') {
                selectControlPanelTab('GeneralSettings');
            }
            clearSelection();
            updateRemoteHelpCopy();
        } else {
            updateRemoteHelpCopy();
            const reconnecting = window.cloudRelay &&
                typeof window.cloudRelay.isReconnecting === 'function' &&
                window.cloudRelay.isReconnecting();
            if (reconnecting) {
                setStatus('Cloud reconnecting…');
            } else {
                refreshRemoteTab();
            }
        }
    }

    async function cloudFetch(path, options) {
        const base = serverUrl();
        if (!base) throw new Error('Cloud server URL is not set');
        const opts = Object.assign({}, options || {});
        const hasBody = opts.body != null && opts.body !== '';
        const headers = Object.assign(
            cloudAuthHeaders(hasBody || String(opts.method || 'GET').toUpperCase() === 'POST'),
            opts.headers || {}
        );
        opts.headers = headers;
        const res = await fetch(base + path, opts);
        const body = await res.json().catch(function () { return {}; });
        if (!res.ok) {
            throw new Error(body.error || body.message || ('HTTP ' + res.status));
        }
        return body;
    }

    function setLinkRevealed(revealed) {
        linkRevealed = !!revealed && !!selectedUrl;
        const wrap = document.getElementById('cloudRemoteQrWrap');
        const urlRow = document.getElementById('cloudRemoteUrlRow');
        const input = document.getElementById('cloudRemoteUrl');
        const qr = document.getElementById('cloudRemoteQr');
        const placeholder = document.getElementById('cloudRemoteQrPlaceholder');
        const revealBtn = document.getElementById('cloudRemoteRevealBtn');
        const copyBtn = document.getElementById('cloudRemoteCopyBtn');

        if (wrap) wrap.classList.toggle('is-obscured', !linkRevealed);
        if (urlRow) urlRow.classList.toggle('is-obscured', !linkRevealed);

        if (input) {
            if (linkRevealed) {
                input.value = selectedUrl;
                input.placeholder = '';
            } else {
                input.value = '';
                input.placeholder = selectedUrl ? 'Hidden — press Show' : '';
            }
        }

        if (qr) {
            if (linkRevealed && selectedUrl) {
                qr.src = serverUrl() + '/api/qr?size=220&margin=2&data=' + encodeURIComponent(selectedUrl);
                qr.classList.remove('noShow');
            } else {
                qr.removeAttribute('src');
                qr.classList.add('noShow');
            }
        }
        if (placeholder) placeholder.classList.toggle('noShow', linkRevealed && !!selectedUrl);

        if (revealBtn) {
            const canReveal = !!selectedUrl;
            revealBtn.textContent = linkRevealed ? 'Hide' : 'Show';
            revealBtn.title = linkRevealed ? 'Hide guest link' : 'Show guest link';
            revealBtn.classList.toggle('disabled', !canReveal);
            revealBtn.setAttribute('aria-disabled', canReveal ? 'false' : 'true');
        }
        if (copyBtn) copyBtn.classList.toggle('disabled', !linkRevealed);
    }

    function clearSelection() {
        selectedToken = '';
        selectedUrl = '';
        selectedLabel = '';
        cachedLinks = [];
        setLinkRevealed(false);
        setStatus('');
        const list = document.getElementById('cloudRemoteExtraList');
        if (list) list.innerHTML = '';
    }

    function selectLink(link, options) {
        const opts = options || {};
        const nextToken = link && link.token ? link.token : '';
        const tokenChanged = nextToken !== selectedToken;
        // Changing links always hides QR/URL so a previous reveal cannot leak on screen.
        const keepReveal = !tokenChanged && !!opts.keepReveal && linkRevealed;

        if (tokenChanged && linkRevealed) {
            setLinkRevealed(false);
        }

        selectedToken = nextToken;
        selectedUrl = guestUrl(link);
        selectedLabel = link && link.label ? link.label : '';
        if (!selectedUrl) {
            setLinkRevealed(false);
            setStatus('Waiting for the guest link…');
        } else {
            setLinkRevealed(keepReveal);
            setStatus(
                keepReveal
                    ? ((selectedLabel || 'Guest link') + ' — visible')
                    : ((selectedLabel || 'Guest link') + ' — hidden')
            );
        }
        const list = document.getElementById('cloudRemoteExtraList');
        if (!list) return;
        list.querySelectorAll('li').forEach(function (li) {
            li.classList.toggle('is-current', li.dataset.token === selectedToken);
        });
    }

    function renderLinkList(links) {
        const createRow = document.getElementById('cloudRemoteCreateRow');
        const list = document.getElementById('cloudRemoteExtraList');
        const canCreate = canManageExtraGuestLinks();
        if (createRow) createRow.classList.toggle('noShow', !canCreate);
        if (!list) return;
        list.innerHTML = '';
        const rows = links || [];
        if (!rows.length) {
            const empty = document.createElement('li');
            empty.className = 'cloud-remote-empty';
            empty.textContent = 'No guest links yet.';
            list.appendChild(empty);
            return;
        }
        rows.forEach(function (g) {
            const li = document.createElement('li');
            li.className = 'cloud-remote-link-item';
            li.dataset.token = g.token || '';
            if (isOwnerLink(g)) li.classList.add('is-owner');
            if (g.token === selectedToken) li.classList.add('is-current');

            const label = document.createElement('span');
            label.className = 'cloud-remote-link-label';
            const status = g.connected ? ' (in use)' : '';
            label.textContent = (g.label || 'Guest scorer') + status;

            li.appendChild(label);

            if (!isOwnerLink(g) && canCreate) {
                const revoke = document.createElement('div');
                revoke.className = 'hover obs28 button';
                revoke.textContent = 'Revoke';
                revoke.addEventListener('click', function (event) {
                    event.stopPropagation();
                    revokeGuest(g.token);
                });
                li.appendChild(revoke);
            } else if (isOwnerLink(g)) {
                const badge = document.createElement('span');
                badge.className = 'cloud-remote-owner-badge';
                badge.textContent = 'Default';
                li.appendChild(badge);
            }

            li.addEventListener('click', function () {
                selectLink(g);
            });
            list.appendChild(li);
        });
    }

    async function refreshRemoteTab(options) {
        const opts = options || {};
        const forceHide = !!opts.forceHide;
        updateRemoteHelpCopy();
        if (!isRemoteTabAvailable()) return;
        const rid = roomId();
        if (!rid) {
            clearSelection();
            setStatus('Connect CueSport Cloud to load guest links.');
            return;
        }
        try {
            const data = await cloudFetch('/api/rooms/' + encodeURIComponent(rid) + '/guest-links');
            const links = data.guest_links || [];
            cachedLinks = links;
            const owner = links.find(function (g) { return g.label === OWNER_LABEL; }) || null;
            let chosen = links.find(function (g) { return g.token === selectedToken; }) || null;
            if (!chosen) chosen = owner || links[0] || null;
            selectLink(chosen, { keepReveal: !forceHide });
            renderLinkList(links);
        } catch (err) {
            setStatus(err.message || 'Failed to load guest links');
        }
    }

    /** Hide QR/URL whenever the Remote tab (or page) is shown again. */
    function onRemoteTabShown() {
        linkRevealed = false;
        setLinkRevealed(false);
        updateRemoteHelpCopy();
        refreshRemoteTab({ forceHide: true });
    }

    function hideRemoteDetailsForPrivacy() {
        if (!selectedUrl && !linkRevealed) return;
        linkRevealed = false;
        setLinkRevealed(false);
        if (selectedLabel || selectedUrl) {
            setStatus((selectedLabel || 'Guest link') + ' — hidden');
        }
    }

    function isRemoteTabVisible() {
        const panel = document.getElementById('RemoteSettings');
        return !!(panel && panel.style.display === 'block');
    }

    async function createExtraLink() {
        if (!canManageExtraGuestLinks()) return;
        const rid = roomId();
        const input = document.getElementById('cloudRemoteExtraLabel');
        const label = String(input && input.value || '').trim();
        if (!label) {
            setStatus('Enter a name for this guest link.');
            if (input) input.focus();
            return;
        }
        try {
            const created = await cloudFetch('/api/rooms/' + encodeURIComponent(rid) + '/guest-link', {
                method: 'POST',
                body: JSON.stringify({ label: label }),
            });
            if (input) input.value = '';
            selectedToken = created && created.token ? created.token : '';
            linkRevealed = false;
            setStatus('Created guest link “' + label + '”');
            await refreshRemoteTab({ forceHide: true });
        } catch (err) {
            setStatus(err.message || 'Failed to create guest link');
        }
    }

    async function revokeGuest(token) {
        try {
            await cloudFetch('/api/guest-links/' + encodeURIComponent(token), { method: 'DELETE' });
            if (selectedToken === token) {
                selectedToken = '';
                linkRevealed = false;
            }
            await refreshRemoteTab({ forceHide: true });
        } catch (err) {
            setStatus(err.message || 'Failed to revoke guest link');
        }
    }

    function toggleReveal() {
        if (!selectedUrl) return;
        setLinkRevealed(!linkRevealed);
        if (linkRevealed) setStatus((selectedLabel || 'Guest link') + ' — visible');
        else setStatus((selectedLabel || 'Guest link') + ' — hidden');
    }

    async function copyRemoteUrl() {
        if (!linkRevealed || !selectedUrl) {
            setStatus('Press Show before copying the link.');
            return;
        }
        const input = document.getElementById('cloudRemoteUrl');
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(selectedUrl);
            } else if (input) {
                input.select();
                document.execCommand('copy');
            }
            setStatus('Copied guest link');
        } catch (err) {
            setStatus(err.message || 'Copy failed');
        }
    }

    function bindRemoteTab() {
        const copyBtn = document.getElementById('cloudRemoteCopyBtn');
        const createBtn = document.getElementById('cloudRemoteCreateBtn');
        const revealBtn = document.getElementById('cloudRemoteRevealBtn');
        if (copyBtn) copyBtn.addEventListener('click', copyRemoteUrl);
        if (createBtn) createBtn.addEventListener('click', createExtraLink);
        if (revealBtn) {
            revealBtn.addEventListener('click', toggleReveal);
            revealBtn.addEventListener('keydown', function (event) {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleReveal();
                }
            });
        }
        window.addEventListener('cloudRelayStateChange', function () {
            clearTimeout(refreshTimer);
            refreshTimer = setTimeout(updateRemoteTabAvailability, 50);
        });
        window.addEventListener('cloudRelayRoleChange', function () {
            updateRemoteHelpCopy();
            if (isRemoteTabAvailable()) refreshRemoteTab({ forceHide: false });
        });
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible' && isRemoteTabVisible()) {
                hideRemoteDetailsForPrivacy();
            }
        });
        window.addEventListener('pageshow', function () {
            if (isRemoteTabVisible()) hideRemoteDetailsForPrivacy();
        });
        setLinkRevealed(false);
        updateRemoteHelpCopy();
        updateRemoteTabAvailability();
    }

    window.isRemoteTabAvailable = isRemoteTabAvailable;
    window.updateRemoteTabAvailability = updateRemoteTabAvailability;
    window.refreshRemoteTab = refreshRemoteTab;
    window.onRemoteTabShown = onRemoteTabShown;
    window.hideRemoteDetailsForPrivacy = hideRemoteDetailsForPrivacy;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindRemoteTab);
    } else {
        bindRemoteTab();
    }
})();
