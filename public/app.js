document.addEventListener('DOMContentLoaded', () => {
    const symbolInput = document.getElementById('symbolInput');
    const searchResults = document.getElementById('searchResults');
    const refreshBtn = document.getElementById('refreshBtn');
    const matrixHeaderRow = document.getElementById('matrixHeaderRow');
    const matrixBody = document.getElementById('matrixBody');
    const minPriceInput = document.getElementById('minPriceInput');
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
        renderMatrix(); // Re-render with new filter
    });
    
    // Search Bar Behavior: Open on focus, don't close on click outside
    symbolInput.addEventListener('focus', () => {
        searchResults.classList.remove('hidden');
        if (symbolInput.value.trim().length < 2 && searchResults.children.length === 0) {
             searchResults.innerHTML = '<div class="search-result-item" style="cursor:default; justify-content:center;">Type to search...</div>';
        }
    });

    // Removed the "click outside" listener as requested.
    // document.addEventListener('click', (e) => { ... });

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

        // 1. Filter Data
        let displayData = [...matrix];
        if (minPriceFilter !== null && !isNaN(minPriceFilter)) {
            // Filter based on the LATEST date (first date in dates array usually, or logic below)
            // Dates are typically returned sorted DESC (newest first) by the API.
            // Let's verify: app.js logic assumes dates[0] is newest? 
            // API: "dates" array from "SELECT DISTINCT date ... ORDER BY date DESC" -> Yes, dates[0] is newest.
            const newestDate = dates[0];
            
            displayData = displayData.filter(row => {
                const val = row[newestDate];
                if (val === '-' || val === null) return false;
                return parseFloat(val) >= minPriceFilter;
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
        dates.forEach(date => {
            const th = document.createElement('th');
            th.textContent = formatDate(date);
            th.style.cursor = 'pointer';
            addSortIcon(th, date); // Pass raw date string as column key
            th.addEventListener('click', () => handleSortClick(date));
            matrixHeaderRow.appendChild(th);
        });

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
            dates.forEach((date, index) => {
                const td = document.createElement('td');
                const val = row[date];
                td.textContent = val !== '-' ? `₹${val}` : '-';

                // Color Logic
                if (val !== '-') {
                    const dateObj = new Date(date);
                    const day = dateObj.getDay(); // 0 = Sun, 6 = Sat

                    if (day === 0 || day === 6) {
                        td.classList.add('text-neutral');
                    } else {
                        // Compare with previous day (next index in dates array since dates are DESC)
                        const prevDate = dates[index + 1];
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
        
        // Modified behavior: Don't hide if short, just show placeholder
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
            } else {
                alert('Failed to add stock: ' + resp.error);
            }
        } catch (err) {
            console.error('Add stock failed:', err);
            alert('Error adding stock');
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
                <td>₹${row.ltp}</td>
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
                            label: (context) => `Price: ₹${context.raw}`
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
            } else {
                alert('Failed to delete stock');
            }
        } catch (err) {
            console.error('Delete failed:', err);
        }
    }

    // Utilities
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
            } else {
                alert('Connection failed: ' + (data.error || 'Unknown error'));
            }
        } catch (err) {
            alert('Connection failed: ' + err.message);
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
});
