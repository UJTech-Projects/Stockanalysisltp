document.addEventListener('DOMContentLoaded', () => {
    const symbolInput = document.getElementById('symbolInput');
    const searchResults = document.getElementById('searchResults');
    const refreshBtn = document.getElementById('refreshBtn');
    const matrixHeaderRow = document.getElementById('matrixHeaderRow');
    const matrixBody = document.getElementById('matrixBody');
    const minPriceInput = document.getElementById('minPriceInput');
    const clearMinPrice = document.getElementById('clearMinPrice');
    const nameFilterInput = document.getElementById('nameFilterInput');
    const clearNameFilter = document.getElementById('clearNameFilter');
    const exportBtn = document.getElementById('exportBtn');

    // Status Elements
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const reconnectBtn = document.getElementById('reconnectBtn');

    // Modal elements
    const historyModal = document.getElementById('historyModal');
    const closeModal = document.getElementById('closeModal');
    const modalTitle = document.getElementById('modalTitle');
    const historyBody = document.getElementById('historyBody');
    const deleteStockBtn = document.getElementById('deleteStockBtn');

    let currentSymbol = null; // Track which symbol is open in modal
    let chartInstance = null; // Chart.js instance for the modal

    // State for Data, Sorting, and Filtering
    let globalMatrixData = { dates: [], matrix: [] };
    let sortConfig = { column: 'symbol', direction: 'asc' }; // column: 'symbol' or date string
    let minPriceFilter = null;
    let nameFilter = '';

    // Initial Load
    fetchMatrix();
    pollStatus();
    setInterval(pollStatus, 7000); // Poll status every 7 seconds

    // Event Listeners
    refreshBtn.addEventListener('click', fetchMatrix);

    // Reconnect Listener
    if (reconnectBtn) {
        reconnectBtn.addEventListener('click', handleReconnect);
    }

    // Export Listener
    if (exportBtn) {
        exportBtn.addEventListener('click', exportToCSV);
    }

    symbolInput.addEventListener('input', debounce(handleSearch, 300));

    // Filter Input Listener
    minPriceInput.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        minPriceFilter = val ? parseFloat(val) : null;
        toggleClearBtn(clearMinPrice, val);
        renderMatrix();
    });

    if (clearMinPrice) {
        clearMinPrice.addEventListener('click', () => {
            minPriceInput.value = '';
            minPriceFilter = null;
            toggleClearBtn(clearMinPrice, '');
            renderMatrix();
        });
    }

    // Search Bar Behavior: show results only when meaningful; don't forcibly show placeholder on focus
    symbolInput.addEventListener('focus', () => {
        const val = symbolInput.value.trim();
        if (val.length >= 2 && searchResults.children.length > 0) {
            searchResults.classList.remove('hidden');
        }
    });

    // Filter Name Listener
    if (nameFilterInput) {
        nameFilterInput.addEventListener('input', (e) => {
            nameFilter = e.target.value.trim().toLowerCase();
            toggleClearBtn(clearNameFilter, nameFilter);
            renderMatrix();
        });

        if (clearNameFilter) {
            clearNameFilter.addEventListener('click', () => {
                nameFilterInput.value = '';
                nameFilter = '';
                toggleClearBtn(clearNameFilter, '');
                renderMatrix();
            });
        }
    }

    // Click / pointer outside to close search dropdown reliably
    // Use pointerdown so it fires before focus changes and other click handlers
    document.addEventListener('pointerdown', (e) => {
        const searchWrapper = symbolInput.closest('.search-input-wrapper');
        // Use composedPath for robust detection (works with Shadow DOM and some browsers)
        const path = (typeof e.composedPath === 'function') ? e.composedPath() : (e.path || []);

        const clickedInside = (searchWrapper && path.includes(searchWrapper)) || path.includes(searchResults) || (searchWrapper && searchWrapper.contains(e.target));

        if (!clickedInside) {
            hideSearchResults();
        }
    });

    // Close search on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchResults.classList.add('hidden');
            symbolInput.blur();
        }
    });

    closeModal.addEventListener('click', () => {
        historyModal.classList.add('hidden');
        currentSymbol = null;
    });

    deleteStockBtn.addEventListener('click', handleDeleteStock);


    // --- Functions ---

    async function fetchMatrix() {
        try {
            refreshBtn.querySelector('i').classList.add('fa-spin');
            const res = await fetch('/api/watchlist/matrix');
            const data = await res.json();

            // Store global data
            globalMatrixData = data;

            renderMatrix();
        } catch (err) {
            console.error('Failed to fetch matrix:', err);
        } finally {
            refreshBtn.querySelector('i').classList.remove('fa-spin');
        }
    }

    function renderMatrix() {
        const { dates, matrix } = globalMatrixData;
        if (!dates) return;

        // Filter out Weekends (Sat=6, Sun=0)
        const businessDates = dates.filter(d => {
            const day = new Date(d).getDay();
            return day !== 0 && day !== 6;
        });

        // 1. Filter Data

        let displayData = [...matrix];
        if (minPriceFilter !== null && !isNaN(minPriceFilter)) {
            // Filter based on the LATEST date (first date in dates array usually, or logic below)
            // Dates are typically returned sorted DESC (newest first) by the API.
            // Let's verify: app.js logic assumes dates[0] is newest? 
            // API: "dates" array from "SELECT DISTINCT date ... ORDER BY date DESC" -> Yes, dates[0] is newest.
            // Filter based on the LATEST date (first date in dates array usually, or logic below)
            // Dates are typically returned sorted DESC (newest first) by the API.
            // Let's verify: app.js logic assumes dates[0] is newest? 
            // API: "dates" array from "SELECT DISTINCT date ... ORDER BY date DESC" -> Yes, dates[0] is newest.
            const newestDate = businessDates[0];

            displayData = displayData.filter(row => {
                const val = row[newestDate];
                if (val === '-' || val === null) return false;
                return parseFloat(val) >= minPriceFilter;
            });
        }

        if (nameFilter) {
            displayData = displayData.filter(row => {
                return row.symbol.toLowerCase().includes(nameFilter);
            });
        }

        // 2. Sort Data
        displayData.sort((a, b) => {
            let valA, valB;

            if (sortConfig.column === 'symbol') {
                valA = a.symbol;
                valB = b.symbol;
            } else {
                // Sort by price on specific date
                valA = a[sortConfig.column];
                valB = b[sortConfig.column];

                // Handle '-' or missing
                valA = (valA === '-' || valA === null) ? -Infinity : parseFloat(valA);
                valB = (valB === '-' || valB === null) ? -Infinity : parseFloat(valB);
            }

            if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });

        // 3. Render Header
        // Clear existing headers
        matrixHeaderRow.innerHTML = '';

        // Symbol Header
        const symbolTh = document.createElement('th');
        symbolTh.textContent = 'Symbol';
        addSortIcon(symbolTh, 'symbol');
        symbolTh.style.cursor = 'pointer';
        symbolTh.addEventListener('click', () => handleSortClick('symbol'));
        matrixHeaderRow.appendChild(symbolTh);

        // Date Headers
        businessDates.forEach(date => {
            const th = document.createElement('th');
            th.textContent = formatDate(date);
            th.style.cursor = 'pointer';
            addSortIcon(th, date); // Pass raw date string as column key
            th.addEventListener('click', () => handleSortClick(date));
            matrixHeaderRow.appendChild(th);
        });

        // Set CSV Tooltip
        if (businessDates.length > 0) {
            const start = formatDate(businessDates[businessDates.length - 1]);
            const end = formatDate(businessDates[0]);
            exportBtn.title = `Export data from ${start} to ${end}`;
        }

        // 4. Render Body
        matrixBody.innerHTML = '';

        displayData.forEach(row => {
            const tr = document.createElement('tr');

            // Symbol Cell (Clickable)
            const symbolTd = document.createElement('td');
            symbolTd.textContent = row.symbol;
            symbolTd.addEventListener('click', () => openHistory(row.symbol));
            tr.appendChild(symbolTd);

            // Data Cells
            businessDates.forEach((date, index) => {
                const td = document.createElement('td');
                const val = row[date];
                // Fix: 2 decimals, no rupee symbol
                td.textContent = (val !== '-' && val !== null) ? parseFloat(val).toFixed(2) : '-';

                // Color Logic
                if (val !== '-') {
                    const dateObj = new Date(date);
                    const day = dateObj.getDay(); // 0 = Sun, 6 = Sat

                    if (day === 0 || day === 6) {
                        td.classList.add('text-neutral');
                    } else {
                        // Compare with previous day (next index in dates array since dates are DESC)
                        const prevDate = businessDates[index + 1];
                        const prevVal = prevDate ? row[prevDate] : null;

                        if (prevVal && prevVal !== '-') {
                            if (parseFloat(val) > parseFloat(prevVal)) {
                                td.classList.add('text-green');
                            } else if (parseFloat(val) < parseFloat(prevVal)) {
                                td.classList.add('text-red');
                            }
                        }
                    }
                }

                tr.appendChild(td);
            });

            matrixBody.appendChild(tr);
        });
    }

    function handleSortClick(column) {
        if (sortConfig.column === column) {
            // Toggle direction
            sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
        } else {
            // New column, default to desc for numbers (dates), asc for text (symbol)
            sortConfig.column = column;
            sortConfig.direction = column === 'symbol' ? 'asc' : 'desc';
        }
        renderMatrix();
    }

    function addSortIcon(thElement, columnKey) {
        if (sortConfig.column === columnKey) {
            const icon = document.createElement('i');
            icon.className = sortConfig.direction === 'asc' ? 'fa-solid fa-sort-up' : 'fa-solid fa-sort-down';
            icon.style.marginLeft = '0.5rem';
            thElement.appendChild(icon);
        }
    }

    async function handleSearch(e) {
        const query = e.target.value.trim();

        // If no query, hide results entirely (user cleared input)
        if (query.length === 0) {
            hideSearchResults();
            return;
        }

        // If query is short but non-empty, show gentle placeholder
        if (query.length < 2) {
            searchResults.innerHTML = '<div class="search-result-item" style="cursor:default; justify-content:center;">Type to search...</div>';
            searchResults.classList.remove('hidden');
            return;
        }

        try {
            const res = await fetch(`/api/watchlist/search?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            renderSearchResults(data.results);
        } catch (err) {
            console.error('Search failed:', err);
        }
    }

    function renderSearchResults(results) {
        searchResults.innerHTML = '';
        if (!results || results.length === 0) {
            searchResults.innerHTML = '<div class="search-result-item" style="cursor:default; justify-content:center;">No results found</div>';
        } else {
            results.forEach(item => {
                const div = document.createElement('div');
                div.className = 'search-result-item';
                div.innerHTML = `
                    <div class="symbol">${item.symbol}</div>
                    <div class="name">${item.name || item.exch_seg}</div>
                `;
                div.addEventListener('click', () => addStock(item));
                searchResults.appendChild(div);
            });
        }
        searchResults.classList.remove('hidden');
    }

    async function addStock(item) {
        symbolInput.value = '';
        searchResults.classList.add('hidden');

        try {
            const res = await fetch('/api/watchlist/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol: item.symbol,
                    exchange: item.exch_seg,
                    instrument_token: item.token
                })
            });
            const resp = await res.json();
            if (resp.ok) {
                // Refresh matrix
                fetchMatrix();
                showToast(`Stock ${item.symbol} added successfully`, 'success');
            } else {
                showToast('Failed to add stock: ' + resp.error, 'error');
            }
        } catch (err) {
            console.error('Add stock failed:', err);
            showToast('Error adding stock', 'error');
        }
    }

    async function openHistory(symbol) {
        currentSymbol = symbol;
        modalTitle.textContent = `${symbol} History`;
        historyModal.classList.remove('hidden');
        historyBody.innerHTML = '<tr><td colspan="2">Loading...</td></tr>';

        // Clear previous chart if exists
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }

        try {
            const res = await fetch(`/api/watchlist/history/${symbol}`);
            const data = await res.json();
            renderHistory(data.history, symbol);
        } catch (err) {
            historyBody.innerHTML = '<tr><td colspan="2">Error loading history</td></tr>';
        }
    }

    function renderHistory(history, symbol) {
        historyBody.innerHTML = '';
        if (!history || history.length === 0) {
            historyBody.innerHTML = '<tr><td colspan="2">No history available</td></tr>';
            return;
        }

        // Render Table
        history.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${formatDate(row.date)}</td>
                <td>${parseFloat(row.ltp).toFixed(2)}</td>
            `;
            historyBody.appendChild(tr);
        });

        // Render Chart
        renderStockChart(history, symbol);
    }

    function renderStockChart(history, symbol) {
        const ctx = document.getElementById('stockChart').getContext('2d');

        // History is DESC (Newest first). We need Oldest first for chart.
        // We also limit to last 30 points if the API returns more, though API limits to 10 currently.
        // Let's rely on what we have.
        const reversedHistory = [...history].reverse();

        const labels = reversedHistory.map(h => formatDate(h.date));
        const dataPoints = reversedHistory.map(h => parseFloat(h.ltp));

        // Determine Color: Green if Newest > Oldest, else Red
        // Newest is the last item in reversedHistory (or first in original history)
        const newestPrice = dataPoints[dataPoints.length - 1];
        const oldestPrice = dataPoints[0];

        const isBullish = newestPrice >= oldestPrice;
        const color = isBullish ? '#10b981' : '#ef4444'; // Success Green or Danger Red
        const bgColor = isBullish ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)';

        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Price (₹)',
                    data: dataPoints,
                    borderColor: color,
                    backgroundColor: bgColor,
                    borderWidth: 2,
                    pointRadius: 3,
                    pointBackgroundColor: color,
                    fill: true,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: (context) => `Price: ${parseFloat(context.raw).toFixed(2)}`
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#94a3b8', maxTicksLimit: 6 },
                        grid: { display: false }
                    },
                    y: {
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(255,255,255,0.05)' }
                    }
                }
            }
        });
    }

    async function handleDeleteStock() {
        if (!currentSymbol || !confirm(`Remove ${currentSymbol} from watchlist?`)) return;

        try {
            const res = await fetch('/api/watchlist/remove', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol: currentSymbol })
            });

            if (res.ok) {
                historyModal.classList.add('hidden');
                currentSymbol = null;
                fetchMatrix(); // Refresh dashboard
                showToast('Stock removed from watchlist', 'success');
            } else {
                showToast('Failed to delete stock', 'error');
            }
        } catch (err) {
            console.error('Delete failed:', err);
            showToast('Error deleting stock', 'error');
        }
    }

    // Utilities
    function hideSearchResults() {
        if (searchResults) {
            searchResults.classList.add('hidden');
            // clear content so the placeholder doesn't stick around
            searchResults.innerHTML = '';
        }
    }
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function formatDate(dateStr) {
        // Simple formatter: YYYY-MM-DD -> DD MMM
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    }

    async function pollStatus() {
        try {
            const res = await fetch('/api/status');
            const data = await res.json();
            if (data.ok && data.status) {
                updateStatusUI(data.status.running);
            }
        } catch (err) {
            console.error('Status poll failed:', err);
            updateStatusUI(false);
        }
    }

    function updateStatusUI(isRunning) {
        if (isRunning) {
            statusDot.style.backgroundColor = 'var(--success)';
            statusText.textContent = 'Connected';
            statusText.style.color = 'var(--success)';
            reconnectBtn.classList.add('hidden');
        } else {
            statusDot.style.backgroundColor = 'var(--danger)';
            statusText.textContent = 'Disconnected';
            statusText.style.color = 'var(--danger)';
            reconnectBtn.classList.remove('hidden');
        }
    }

    async function handleReconnect() {
        try {
            reconnectBtn.disabled = true;
            reconnectBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Connecting...';

            const res = await fetch('/jobs/resubscribe', { method: 'POST' });
            const data = await res.json();

            if (data.ok) {
                // Poll immediately to check status
                setTimeout(pollStatus, 1000);
                showToast('Reconnection initiated', 'success');
            } else {
                showToast('Connection failed: ' + (data.error || 'Unknown error'), 'error');
            }
        } catch (err) {
            showToast('Connection failed: ' + err.message, 'error');
        } finally {
            reconnectBtn.disabled = false;
            reconnectBtn.innerHTML = '<i class="fa-solid fa-plug"></i> Connect';
        }
    }

    function exportToCSV() {
        const { dates, matrix } = globalMatrixData;
        if (!matrix || matrix.length === 0) return;

        // Build CSV content
        // Header: Use DD/MM/YYYY format for CSV
        const headers = ['Symbol', ...dates.map(d => {
            const dateObj = new Date(d);
            if (isNaN(dateObj.getTime())) return d;
            return dateObj.toLocaleDateString('en-GB'); // DD/MM/YYYY
        })];
        const csvRows = [headers.join(',')];

        // Rows
        matrix.forEach(row => {
            const rowData = [row.symbol];
            dates.forEach(d => {
                rowData.push(row[d] !== '-' && row[d] !== null ? row[d] : '');
            });
            csvRows.push(rowData.join(','));
        });

        const csvString = csvRows.join('\n');
        const blob = new Blob([csvString], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.setAttribute('hidden', '');
        a.setAttribute('href', url);
        a.setAttribute('download', `stock_matrix_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    // Set Copyright Year
    const yearSpan = document.getElementById('copyrightYear');
    if (yearSpan) {
        yearSpan.textContent = new Date().getFullYear();
    }

    // Toast Notification System
    function showToast(message, type = 'success') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const iconClass = type === 'success' ? 'fa-circle-check' : 'fa-circle-xmark';

        toast.innerHTML = `
            <i class="fa-solid ${iconClass}"></i>
            <span>${message}</span>
        `;

        container.appendChild(toast);

        // Remove after 3 seconds
        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s ease-out forwards';
            toast.addEventListener('animationend', () => {
                toast.remove();
            });
        }, 3000);
    }
    function toggleClearBtn(btn, val) {
        if (!btn) return;
        if (val && val.length > 0) {
            btn.classList.remove('hidden');
        } else {
            btn.classList.add('hidden');
        }
    }
});
