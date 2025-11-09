(function () {
    const state = {
        accessToken: null,
        refreshToken: null,
        tokenExpiry: null,
        stats: [],
        global: null,
        searchTerm: '',
        statusFilter: 'all',
        isRefreshing: false
    };

    const selectors = {
        loginCard: document.getElementById('loginCard'),
        loginBtn: document.getElementById('loginBtn'),
        passwordInput: document.getElementById('adminPassword'),
        clearPasswordBtn: document.getElementById('clearPasswordBtn'),
        loginError: document.getElementById('loginError'),
        statsPanel: document.getElementById('statsPanel'),
        statsBody: document.getElementById('statsBody'),
        statsSummary: document.getElementById('statsSummary'),
        searchInput: document.getElementById('searchInput'),
        refreshBtn: document.getElementById('refreshBtn'),
        signOutBtn: document.getElementById('signOutBtn'),
        globalStats: document.getElementById('globalStats'),
        totalSessionsValue: document.getElementById('totalSessionsValue'),
        averageDurationValue: document.getElementById('averageDurationValue'),
        longestDurationValue: document.getElementById('longestDurationValue'),
        peakConcurrentValue: document.getElementById('peakConcurrentValue'),
        featureScoreValue: document.getElementById('featureScoreValue'),
        featureBallValue: document.getElementById('featureBallValue'),
        featureShotValue: document.getElementById('featureShotValue'),
        featureBreakingPlayerValue: document.getElementById('featureBreakingPlayerValue'),
        featureBallSetValue: document.getElementById('featureBallSetValue'),
        topSessionsKey: document.getElementById('topSessionsKey'),
        topSessionsValue: document.getElementById('topSessionsValue'),
        topDurationKey: document.getElementById('topDurationKey'),
        topDurationValue: document.getElementById('topDurationValue'),
        copyTopSessionsBtn: document.getElementById('copyTopSessions'),
        copyTopDurationBtn: document.getElementById('copyTopDuration'),
        sparklineContainer: document.getElementById('sparklineContainer'),
        sparklineCaption: document.getElementById('sparklineCaption'),
        clearSearchBtn: document.getElementById('clearSearchBtn'),
        statusFilterBar: document.getElementById('statusFilterBar')
    };

    const gameTypeLabels = {
        game1: '8-Ball',
        game2: '9-Ball',
        game3: '10-Ball',
        game4: 'Straight',
        game5: 'Bank',
        game6: 'One Pocket'
    };

    let searchDebounce = null;
    let refreshIntervalId = null;

    function stopAutoRefresh() {
        if (refreshIntervalId) {
            clearInterval(refreshIntervalId);
            refreshIntervalId = null;
        }
    }

    function updateSearchClearButton() {
        const button = selectors.clearSearchBtn;
        if (!button) {
            return;
        }

        const hasValue = Boolean(state.searchTerm);
        button.classList.toggle('hidden', !hasValue);
        button.disabled = !hasValue;
    }

    function parseDate(value) {
        if (!value) {
            return null;
        }

        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : value;
        }

        if (typeof value !== 'string') {
            return null;
        }

        let normalized = value.trim();
        if (!normalized) {
            return null;
        }

        if (!normalized.includes('T')) {
            normalized = normalized.replace(' ', 'T');
        }
        if (!/[zZ]$/.test(normalized)) {
            normalized += 'Z';
        }

        const date = new Date(normalized);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    const estFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
    });

    function formatDateTime(value) {
        const date = parseDate(value);
        if (!date) {
            return null;
        }

        return estFormatter.format(date);
    }

    async function copyToClipboard(text) {
        if (!text) {
            return false;
        }

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (error) {
            console.warn('Clipboard API write failed, falling back to execCommand.', error);
        }

        const tempInput = document.createElement('input');
        tempInput.type = 'text';
        tempInput.value = text;
        tempInput.setAttribute('readonly', 'readonly');
        tempInput.style.position = 'absolute';
        tempInput.style.left = '-9999px';
        document.body.appendChild(tempInput);
        tempInput.select();

        let success = false;
        try {
            success = document.execCommand('copy');
        } catch (error) {
            console.warn('document.execCommand copy failed.', error);
        }

        document.body.removeChild(tempInput);
        return success;
    }

    function flashButton(button, success) {
        if (!button) {
            return;
        }

        const originalText = button.textContent;
        button.textContent = success ? '✔' : '✖';
        button.classList.toggle('copy-success', success);
        button.classList.toggle('copy-failure', !success);

        setTimeout(() => {
            button.textContent = originalText;
            button.classList.remove('copy-success');
            button.classList.remove('copy-failure');
        }, 1500);
    }

    async function handleCopy(button, value) {
        if (!button || !value) {
            flashButton(button, false);
            window.alert('No API key available to copy yet.');
            return;
        }

        const success = await copyToClipboard(value);
        flashButton(button, success);

        if (!success) {
            window.alert('Unable to copy to clipboard automatically. Please copy the API key manually.');
        }
    }

    function setRefreshing(isRefreshing) {
        state.isRefreshing = isRefreshing;

        const button = selectors.refreshBtn;
        if (button) {
            if (isRefreshing) {
                button.disabled = true;
                button.classList.add('loading');
                button.textContent = 'Refreshing…';
            } else {
                button.disabled = false;
                button.classList.remove('loading');
                button.textContent = 'Refresh';
            }
        }
    }

    function formatPercent(value) {
        if (!value || value <= 0) {
            return '0%';
        }
        const rounded = Math.round(value * 10) / 10;
        return `${rounded}%`;
    }

    function renderSparkline(data, rangeHours) {
        const container = selectors.sparklineContainer;
        if (!container) {
            return;
        }

        if (!Array.isArray(data) || !data.length) {
            container.className = 'sparkline-empty';
            container.textContent = 'No activity yet.';
            if (selectors.sparklineCaption) {
                selectors.sparklineCaption.textContent = '';
            }
            return;
        }

        const maxSessions = data.reduce((max, point) => Math.max(max, point.sessionsStarted || 0), 0) || 1;
        const locale = navigator.language || 'en-US';

        container.className = '';
        container.classList.add('sparkline');
        container.innerHTML = data.map(point => {
            const sessions = point.sessionsStarted || 0;
            const heightPercent = Math.max(4, Math.round((sessions / maxSessions) * 100));
            let tooltip = `${sessions} session${sessions === 1 ? '' : 's'}`;
            if (point.timestamp) {
                const date = new Date(point.timestamp);
                if (!Number.isNaN(date.getTime())) {
                    const timeLabel = date.toLocaleTimeString(locale, { hour: 'numeric', hour12: true });
                    tooltip = `${timeLabel}: ${tooltip}`;
                }
            }
            return `<div class="bar" style="height:${heightPercent}%" data-tooltip="${tooltip}"></div>`;
        }).join('');

        if (selectors.sparklineCaption) {
            selectors.sparklineCaption.textContent = `Sessions started each hour (last ${rangeHours || 24} hours)`;
        }
    }

    function renderGlobalStats() {
        const container = selectors.globalStats;
        if (!container) {
            return;
        }

        const global = state.global;
        if (!global) {
            container.classList.add('hidden');
            renderSparkline([], 0);
            if (selectors.copyTopSessionsBtn) {
                selectors.copyTopSessionsBtn.disabled = true;
                selectors.copyTopSessionsBtn.classList.add('hidden');
            }
            if (selectors.copyTopDurationBtn) {
                selectors.copyTopDurationBtn.disabled = true;
                selectors.copyTopDurationBtn.classList.add('hidden');
            }
            return;
        }

        container.classList.remove('hidden');

        const totalSessions = global.totalSessions || 0;
        const averageSeconds = global.averageDurationSeconds || 0;
        const longestSeconds = global.longestDurationSeconds || 0;
        const peakConcurrent = global.peakConcurrentUsers || 0;

        if (selectors.totalSessionsValue) {
            selectors.totalSessionsValue.textContent = totalSessions.toLocaleString();
        }
        if (selectors.averageDurationValue) {
            selectors.averageDurationValue.textContent = formatDuration(averageSeconds);
        }
        if (selectors.longestDurationValue) {
            selectors.longestDurationValue.textContent = formatDuration(longestSeconds);
        }
        if (selectors.peakConcurrentValue) {
            selectors.peakConcurrentValue.textContent = peakConcurrent.toLocaleString();
        }

        const featureAdoption = global.featureAdoption || {};
        if (selectors.featureScoreValue) {
            const metric = featureAdoption.scoreDisplay || {};
            selectors.featureScoreValue.textContent = `${formatPercent(metric.percent)}${metric.count ? ` (${metric.count})` : ' (0)'}`;
        }
        if (selectors.featureBallValue) {
            const metric = featureAdoption.ballTracker || {};
            selectors.featureBallValue.textContent = `${formatPercent(metric.percent)}${metric.count ? ` (${metric.count})` : ' (0)'}`;
        }
        if (selectors.featureShotValue) {
            const metric = featureAdoption.shotClock || {};
            selectors.featureShotValue.textContent = `${formatPercent(metric.percent)}${metric.count ? ` (${metric.count})` : ' (0)'}`;
        }
        if (selectors.featureBreakingPlayerValue) {
            const metric = featureAdoption.breakingPlayer || {};
            selectors.featureBreakingPlayerValue.textContent = `${formatPercent(metric.percent)}${metric.count ? ` (${metric.count})` : ' (0)'}`;
        }
        if (selectors.featureBallSetValue) {
            const ballType = featureAdoption.ballType || { World: 0, International: 0 };
            const total = ballType.World + ballType.International;
            if (total > 0) {
                selectors.featureBallSetValue.textContent = `World ${ballType.World}, International ${ballType.International}`;
            } else {
                selectors.featureBallSetValue.textContent = '—';
            }
        }

        const topApiKeys = global.topApiKeys || {};
        const mostSessions = topApiKeys.mostSessions;
        if (selectors.topSessionsKey) {
            selectors.topSessionsKey.textContent = mostSessions && mostSessions.apiKey ? mostSessions.apiKey : '—';
        }
        if (selectors.topSessionsValue) {
            const value = mostSessions && mostSessions.totalConnections ? mostSessions.totalConnections : 0;
            selectors.topSessionsValue.textContent = `${value.toLocaleString()} session${value === 1 ? '' : 's'}`;
        }
        if (selectors.copyTopSessionsBtn) {
            const available = Boolean(mostSessions && mostSessions.apiKey);
            selectors.copyTopSessionsBtn.disabled = !available;
            selectors.copyTopSessionsBtn.classList.toggle('hidden', !available);
        }

        const longestDuration = topApiKeys.longestDuration;
        if (selectors.topDurationKey) {
            selectors.topDurationKey.textContent = longestDuration && longestDuration.apiKey ? longestDuration.apiKey : '—';
        }
        if (selectors.topDurationValue) {
            const durationValue = longestDuration && longestDuration.totalDurationSeconds ? longestDuration.totalDurationSeconds : 0;
            selectors.topDurationValue.textContent = formatDuration(durationValue);
        }
        if (selectors.copyTopDurationBtn) {
            const available = Boolean(longestDuration && longestDuration.apiKey);
            selectors.copyTopDurationBtn.disabled = !available;
            selectors.copyTopDurationBtn.classList.toggle('hidden', !available);
        }

        renderSparkline(global.sparkline || [], global.sparklineRangeHours);
    }

    function startAutoRefresh() {
        stopAutoRefresh();
        refreshIntervalId = setInterval(() => {
            if (state.accessToken) {
                fetchStats();
            }
        }, 60000);
    }

    function formatDuration(seconds) {
        if (!seconds || seconds <= 0) {
            return '0m 0s';
        }

        const totalSeconds = Math.floor(seconds);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const secs = totalSeconds % 60;

        if (hours > 0) {
            return `${hours}h ${minutes}m ${secs}s`;
        }
        if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        }
        return `${secs}s`;
    }

    function showLoginError(message) {
        selectors.loginError.textContent = message;
        selectors.loginError.classList.remove('hidden');
    }

    function clearLoginError() {
        selectors.loginError.textContent = '';
        selectors.loginError.classList.add('hidden');
    }

    function togglePanels(isAuthenticated) {
        if (isAuthenticated) {
            selectors.loginCard.classList.add('hidden');
            selectors.statsPanel.classList.remove('hidden');
        } else {
            selectors.statsPanel.classList.add('hidden');
            selectors.loginCard.classList.remove('hidden');
        }
    }

    // Token refresh helper
    async function refreshTokenIfNeeded(refreshToken) {
        if (!refreshToken) return false;
        
        try {
            const response = await fetch('/api/admin/refresh', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ refreshToken })
            });

            if (!response.ok) {
                return false;
            }

            const data = await response.json();
            state.accessToken = data.accessToken;
            state.tokenExpiry = Date.now() + (data.expiresIn * 1000);
            // Update sessionStorage
            if (state.refreshToken) {
                sessionStorage.setItem('adminRefreshToken', state.refreshToken);
            }
            return true;
        } catch (error) {
            return false;
        }
    }

    async function fetchStats() {
        // Don't fetch stats if not authenticated
        if (!state.accessToken) {
            // Try to refresh token from sessionStorage
            const refreshToken = sessionStorage.getItem('adminRefreshToken');
            if (refreshToken && await refreshTokenIfNeeded(refreshToken)) {
                state.refreshToken = refreshToken;
                // Token refreshed, continue
            } else {
                togglePanels(false);
                return;
            }
        }
        
        // Check if token expired
        if (state.tokenExpiry && Date.now() >= state.tokenExpiry) {
            const refreshed = await refreshTokenIfNeeded(state.refreshToken);
            if (!refreshed) {
                togglePanels(false);
                handleSignOut();
                return;
            }
        }

        const params = state.searchTerm ? `?search=${encodeURIComponent(state.searchTerm)}` : '';

        setRefreshing(true);

        try {
            if (!state.accessToken) {
                console.error('No access token available');
                togglePanels(false);
                return;
            }

            console.log('Fetching stats with token:', state.accessToken.substring(0, 20) + '...');
            const response = await fetch(`/api/admin/stats${params}`, {
                headers: {
                    'Authorization': `Bearer ${state.accessToken}`
                }
            });

            if (response.status === 401) {
                const errorData = await response.json().catch(() => ({}));
                console.error('401 Unauthorized:', errorData);
                // Token expired, try refresh
                const refreshed = await refreshTokenIfNeeded(state.refreshToken);
                if (refreshed) {
                    console.log('Token refreshed, retrying fetchStats');
                    return fetchStats(); // Retry with new token
                }
                // Refresh failed, logout
                console.error('Token refresh failed');
                handleSignOut();
                showLoginError(errorData.error || 'Session expired. Please log in again.');
                return;
            }

            if (response.status === 403) {
                const errorData = await response.json().catch(() => ({}));
                handleSignOut();
                togglePanels(false);
                showLoginError(errorData.error || 'Access denied: Your IP address is not whitelisted.');
                stopAutoRefresh();
                renderGlobalStats();
                return;
            }

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Failed to retrieve statistics');
            }

            const payload = await response.json();
            state.stats = Array.isArray(payload.stats) ? payload.stats : [];
            state.global = payload.global || null;
            renderGlobalStats();
            renderStats();
            setRefreshing(false);
        } catch (error) {
            console.error(error);
            // If we get an error and token is cleared (auth failed), hide panel
            if (!state.accessToken) {
                togglePanels(false);
            }
            selectors.statsSummary.textContent = 'Unable to load statistics. Please try again.';
            state.global = null;
            renderGlobalStats();
        } finally {
            setRefreshing(false);
        }
    }

function renderStats() {
    const { stats } = state;
    const filteredStats = stats.filter(matchesStatusFilter);
    updateStatusFilterButtons();

    const totalKeys = stats.length;
    const filteredCount = filteredStats.length;
    const omittedCount = totalKeys - filteredCount;

    if (!filteredStats.length) {
            selectors.statsBody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: 32px; color: rgba(255, 255, 255, 0.6);">
                        No statistics available for the current filters.
                    </td>
                </tr>
            `;
            const omittedText = omittedCount > 0 ? `, ${omittedCount} omitted by filter` : '';
            selectors.statsSummary.textContent = `No API keys found${omittedText}.`;
            return;
        }

        const omittedText = omittedCount > 0 ? `, ${omittedCount} omitted by filter` : '';
        selectors.statsSummary.textContent = `Showing ${filteredCount} API key${filteredCount !== 1 ? 's' : ''}${omittedText}.`;

        selectors.statsBody.innerHTML = filteredStats.map((item) => {
            const lastDurationLabel = item.lastConnectionActive
                ? 'In progress'
                : (typeof item.lastDurationSeconds === 'number' && item.lastDurationSeconds >= 0)
                    ? formatDuration(item.lastDurationSeconds)
                    : '—';

            const liveDurationSeconds = (() => {
                if (item.isLive && item.liveSince) {
                    const start = parseDate(item.liveSince);
                    if (start) {
                        const diff = Math.max(0, (Date.now() - start.getTime()) / 1000);
                        return diff;
                    }
                }
                return null;
            })();

            const lastDurationDisplay = liveDurationSeconds !== null
                ? formatDuration(liveDurationSeconds)
                : lastDurationLabel;

            const durationContent = item.totalConnections > 0
                ? `<div>Longest: ${formatDuration(item.longestSeconds)}</div>
                   <div>Average: ${formatDuration(item.averageSeconds)}</div>
                   <div>${item.isLive ? 'Live duration' : 'Last'}: ${lastDurationDisplay}</div>`
                : `<div>No completed sessions</div>
                   <div>${item.isLive ? 'Live duration' : 'Last'}: ${lastDurationDisplay}</div>`;

            const lastStreamUpdate = formatDateTime(item.lastStreamUpdatedAt);
            const liveSince = formatDateTime(item.liveSince);

            let statusBadge = '';
            if (item.isBlocked) {
                const reasonText = item.blockedReason ? `Blocked: ${item.blockedReason}` : 'Blocked by administrator';
                statusBadge = `<span class="badge status-blocked" title="${reasonText}">Blocked</span>`;
            } else if (item.isLive || item.isStreaming) {
                const tooltip = item.isLive && liveSince ? `Live since ${liveSince}` : (lastStreamUpdate ? `Last active ${lastStreamUpdate}` : 'Currently active');
                statusBadge = `<span class="badge status-live" title="${tooltip}">Live</span>`;
            } else {
                const tooltip = lastStreamUpdate ? `Last update ${lastStreamUpdate}` : 'No recent updates';
                statusBadge = `<span class="badge status-inactive" title="${tooltip}">Inactive</span>`;
            }

            const gameTypes = Object.entries(item.gameTypes || {}).map(([gameType, count]) => {
                const label = gameTypeLabels[gameType] || gameType;
                return `<span>${label}: ${count}</span>`;
            }).join('') || '<span>No data</span>';

            const totalSessions = item.totalConnections || 0;
            const featureUsage = item.featureUsage || {};
            const ballType = featureUsage.ballType || { World: 0, International: 0 };
            const totalBallType = ballType.World + ballType.International;

            const featureLines = [
                `<span>Score Display: ${featureUsage.scoreDisplaySessions || 0}${totalSessions ? ` / ${totalSessions}` : ''}</span>`,
                `<span>Ball Tracker: ${featureUsage.ballTrackerSessions || 0}${totalSessions ? ` / ${totalSessions}` : ''}</span>`,
                `<span>Shot Clock: ${featureUsage.shotClockSessions || 0}${totalSessions ? ` / ${totalSessions}` : ''}</span>`,
                `<span>Breaking Player: ${featureUsage.breakingPlayerSessions || 0}${totalSessions ? ` / ${totalSessions}` : ''}</span>`,
                `<span>Ball Type: World ${ballType.World || 0}, International ${ballType.International || 0}${totalBallType > 0 ? ` (${totalBallType} total)` : ''}</span>`
            ].join('');

            const latestStreamContent = item.latestStreamUrl
                ? `<a href="${item.latestStreamUrl}" target="_blank" rel="noopener noreferrer">${item.latestStreamUrl}</a>`
                : '<span>—</span>';

            const blockedInfo = item.isBlocked
                ? (() => {
                    let text = '';
                    if (item.blockedAt) {
                        text = `Blocked at ${item.blockedAt}`;
                    } else {
                        text = 'Blocked';
                    }
                    if (item.blockedReason) {
                        text += `: ${item.blockedReason}`;
                    }
                    return `<div style="font-size: 0.8rem; color: rgba(255, 255, 255, 0.6); margin-top: 4px;">${text}</div>`;
                })()
                : '';

            let lastUpdateInfo = '';
            if (item.isLive && liveSince) {
                lastUpdateInfo = `<div style="font-size: 0.8rem; color: rgba(255, 255, 255, 0.6); margin-top: 4px;">Live since ${liveSince}</div>`;
            } else if (lastStreamUpdate) {
                lastUpdateInfo = `<div style="font-size: 0.8rem; color: rgba(255, 255, 255, 0.6); margin-top: 4px;">Last live: ${lastStreamUpdate}</div>`;
            }

            return `
                <tr data-api-key="${item.apiKey}">
                    <td style="max-width: 220px;">
                        <code>${item.apiKey}</code>
                        <div style="margin-top: 6px; display:flex; flex-direction: column; gap:6px;">
                            <div class="badge-group">${statusBadge}</div>
                            ${blockedInfo}
                            ${lastUpdateInfo}
                        </div>
                    </td>
                    <td>
                        <div>Total: ${item.totalConnections}</div>
                    </td>
                    <td>${durationContent}</td>
                    <td><div class="game-type-list">${gameTypes}</div></td>
                    <td><div class="feature-list">${featureLines}</div></td>
                    <td>${latestStreamContent}</td>
                    <td>
                        <div style="display:flex; flex-direction:column; gap:8px;">
                            <button class="secondary" data-action="clear" data-api-key="${item.apiKey}">Clear Stats</button>
                            <div style="display:flex; gap:8px;">
                                <button class="${item.isBlocked ? '' : 'warning'}" data-action="${item.isBlocked ? 'unblock' : 'block'}" data-api-key="${item.apiKey}" style="flex: 1;">
                                    ${item.isBlocked ? 'Unblock' : 'Block'}
                                </button>
                                <button class="danger" data-action="delete" data-api-key="${item.apiKey}" style="flex: 1;">Delete</button>
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    async function handleLogin() {
        const password = selectors.passwordInput.value.trim();
        if (!password) {
            showLoginError('Please enter the admin password.');
            return;
        }

        clearLoginError();
        
        try {
            const response = await fetch('/api/admin/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ password })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('Login failed:', response.status, errorData);
                showLoginError(errorData.error || 'Authentication failed.');
                return;
            }

            const data = await response.json();
            console.log('Login successful, tokens received');
            state.accessToken = data.accessToken;
            state.refreshToken = data.refreshToken;
            state.tokenExpiry = Date.now() + (data.expiresIn * 1000);
            
            // Store refresh token in sessionStorage (not localStorage for security)
            sessionStorage.setItem('adminRefreshToken', data.refreshToken);
            
            togglePanels(true);
            selectors.searchInput.focus();
            await fetchStats();
            startAutoRefresh();
        } catch (error) {
            showLoginError('Failed to authenticate. Please try again.');
            togglePanels(false);
        }
    }

    function handleSignOut() {
        // Revoke token on server
        if (state.accessToken) {
            fetch('/api/admin/logout', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${state.accessToken}`
                }
            }).catch(() => {
                // Ignore errors on logout
            });
        }
        
        state.accessToken = null;
        state.refreshToken = null;
        state.tokenExpiry = null;
        state.stats = [];
        state.global = null;
        state.searchTerm = '';
        state.statusFilter = 'all';
        setRefreshing(false);
        selectors.passwordInput.value = '';
        selectors.searchInput.value = '';
        sessionStorage.removeItem('adminRefreshToken');
        stopAutoRefresh();
        togglePanels(false);
        renderGlobalStats();
        updateSearchClearButton();
        if (selectors.statusFilter) {
            selectors.statusFilter.value = 'all';
        }
    }

    function setSearchTerm(value) {
        state.searchTerm = value.trim();
        if (searchDebounce) {
            clearTimeout(searchDebounce);
        }
        updateSearchClearButton();
        searchDebounce = setTimeout(() => {
            fetchStats();
        }, 350);
    }

    function setStatusFilter(value) {
        if (value === state.statusFilter) {
            return; // No change needed
        }
        state.statusFilter = value;
        updateStatusFilterButtons();
        renderStats();
    }

    function updateStatusFilterButtons() {
        if (!selectors.statusFilterBar) {
            return;
        }

        const buttons = Array.from(selectors.statusFilterBar.querySelectorAll('.status-filter-button'));
        buttons.forEach(button => {
            const value = button.getAttribute('data-filter');
            button.classList.toggle('active', value === state.statusFilter);
        });
    }

    function matchesStatusFilter(item) {
        switch (state.statusFilter) {
            case 'live':
                return (!!item.isLive || !!item.isStreaming) && !item.isBlocked;
            case 'inactive':
                return !item.isLive && !item.isStreaming && !item.isBlocked;
            case 'blocked':
                return !!item.isBlocked;
            default:
                return true;
        }
    }

    async function postAdminAction(endpoint, body) {
        if (!state.accessToken) {
            throw new Error('Not authenticated');
        }

        // Check if token expired and refresh if needed
        if (state.tokenExpiry && Date.now() >= state.tokenExpiry) {
            const refreshed = await refreshTokenIfNeeded(state.refreshToken);
            if (!refreshed) {
                handleSignOut();
                throw new Error('Session expired');
            }
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.accessToken}`
            },
            body: JSON.stringify(body)
        });

        if (response.status === 401) {
            // Token expired, try refresh
            const refreshed = await refreshTokenIfNeeded(state.refreshToken);
            if (refreshed) {
                // Retry with new token
                return postAdminAction(endpoint, body);
            }
            handleSignOut();
            togglePanels(false);
            showLoginError('Session expired. Please re-authenticate.');
            renderGlobalStats();
            throw new Error('Unauthorized');
        }

        if (!response.ok) {
            const payload = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(payload.error || 'Request failed');
        }

        return response.json().catch(() => ({}));
    }

    async function handleRowAction(action, apiKey) {
        if (!apiKey) {
            return;
        }

        try {
            if (action === 'block') {
                const reason = window.prompt('Enter a reason for blocking this API key (optional):');
                await postAdminAction('/api/admin/block', { apiKey, reason: reason || null });
            } else if (action === 'unblock') {
                await postAdminAction('/api/admin/unblock', { apiKey });
            } else if (action === 'clear') {
                const confirmed = window.confirm('Clear all statistics for this API key? This cannot be undone.');
                if (!confirmed) {
                    return;
                }
                await postAdminAction('/api/admin/clear', { apiKey });
            } else if (action === 'delete') {
                const confirmed = window.confirm('Delete this API key and all associated data? This cannot be undone.');
                if (!confirmed) {
                    return;
                }
                await postAdminAction('/api/admin/delete', { apiKey });
            }

            await fetchStats();
        } catch (error) {
            alert(error.message || 'Action failed');
        }
    }

    function attachEventHandlers() {
        selectors.loginBtn.addEventListener('click', handleLogin);
        selectors.passwordInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                handleLogin();
            }
        });

        selectors.clearPasswordBtn.addEventListener('click', () => {
            selectors.passwordInput.value = '';
            selectors.passwordInput.focus();
        });

        selectors.signOutBtn.addEventListener('click', handleSignOut);

        selectors.searchInput.addEventListener('input', (event) => {
            setSearchTerm(event.target.value);
        });

        if (selectors.clearSearchBtn) {
            selectors.clearSearchBtn.addEventListener('click', () => {
                selectors.searchInput.value = '';
                state.searchTerm = '';
                updateSearchClearButton();
                fetchStats();
            });
        }

    selectors.refreshBtn.addEventListener('click', () => {
        fetchStats();
    });

    if (selectors.statusFilterBar) {
        // Attach event listeners directly to each button
        const buttons = selectors.statusFilterBar.querySelectorAll('.status-filter-button');
        buttons.forEach(button => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                const filter = button.getAttribute('data-filter');
                if (!filter) {
                    return;
                }
                setStatusFilter(filter);
            });
        });
    }

        if (selectors.copyTopSessionsBtn) {
            selectors.copyTopSessionsBtn.addEventListener('click', () => {
                const apiKey = selectors.topSessionsKey ? selectors.topSessionsKey.textContent.trim() : '';
                handleCopy(selectors.copyTopSessionsBtn, apiKey && apiKey !== '—' ? apiKey : '');
            });
        }

        if (selectors.copyTopDurationBtn) {
            selectors.copyTopDurationBtn.addEventListener('click', () => {
                const apiKey = selectors.topDurationKey ? selectors.topDurationKey.textContent.trim() : '';
                handleCopy(selectors.copyTopDurationBtn, apiKey && apiKey !== '—' ? apiKey : '');
            });
        }

        selectors.statsBody.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }

            const action = target.getAttribute('data-action');
            if (!action) {
                return;
            }

            const apiKey = target.getAttribute('data-api-key');
            handleRowAction(action, apiKey);
        });
    }

    updateSearchClearButton();
    attachEventHandlers();
})();

