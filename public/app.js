const API_BASE = '/api/watchlist';

const symbolInput = document.getElementById('symbolInput');
const addBtn = document.getElementById('addBtn');
const messageDiv = document.getElementById('message');
const watchlistTableBody = document.querySelector('#watchlistTable tbody');
const historySection = document.getElementById('historySection');
const historyTitle = document.getElementById('historyTitle');
const historyTableBody = document.querySelector('#historyTable tbody');
const closeHistoryBtn = document.getElementById('closeHistoryBtn');

const dashboardBtn = document.getElementById('dashboardBtn');
const matrixSection = document.getElementById('matrixSection');
const matrixTable = document.getElementById('matrixTable');
const closeMatrixBtn = document.getElementById('closeMatrixBtn');
const watchlistSection = document.getElementById('watchlistSection');

// Search suggestion elements
let suggestionsDiv = null;

// Load watchlist on start
document.addEventListener('DOMContentLoaded', () => {
    fetchWatchlist();
    createSearchSuggestions();
});

addBtn.addEventListener('click', addStock);
closeHistoryBtn.addEventListener('click', () => {
    historySection.classList.add('hidden');
    watchlistSection.classList.remove('hidden');
});

dashboardBtn.addEventListener('click', loadMatrix);
closeMatrixBtn.addEventListener('click', () => {
    matrixSection.classList.add('hidden');
    watchlistSection.classList.remove('hidden');
});

// Allow Enter key to submit
symbolInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addStock();
});

// Search on input with debounce
let searchTimeout;
symbolInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    if (query.length < 2) {
        hideSuggestions();
        return;
    }
    searchTimeout = setTimeout(() => searchStocks(query), 300);
});

function createSearchSuggestions() {
    suggestionsDiv = document.createElement('div');
    suggestionsDiv.id = 'searchSuggestions';
    suggestionsDiv.className = 'search-suggestions hidden';
    suggestionsDiv.style.cssText = `
        position: absolute;
        background: white;
        border: 1px solid #ddd;
        border-radius: 4px;
        max-height: 300px;
        overflow-y: auto;
        z-index: 1000;
        min-width: 300px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    `;
    symbolInput.parentElement.style.position = 'relative';
    symbolInput.parentElement.appendChild(suggestionsDiv);
}

async function searchStocks(query) {
    try {
        const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        
        if (data.results && data.results.length > 0) {
            showSuggestions(data.results);
        } else {
            showMessage(`No stocks found for "${query}"`, 'info');
            hideSuggestions();
        }
    } catch (err) {
        console.error('Search failed:', err);
    }
}

function showSuggestions(results) {
    suggestionsDiv.innerHTML = '';
    results.forEach(result => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        item.style.cssText = `
            padding: 10px;
            border-bottom: 1px solid #eee;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        item.innerHTML = `
            <div>
                <strong>${result.symbol}</strong><br>
                <small style="color: #666;">${result.name || ''}</small>
            </div>
            <small style="color: #999;">${result.exch_seg}</small>
        `;
        item.addEventListener('click', () => {
            symbolInput.value = result.symbol;
            hideSuggestions();
            addStockWithToken(result.symbol, result.token, result.exch_seg);
        });
        item.addEventListener('mouseover', () => {
            item.style.backgroundColor = '#f0f0f0';
        });
        item.addEventListener('mouseout', () => {
            item.style.backgroundColor = 'white';
        });
        suggestionsDiv.appendChild(item);
    });
    suggestionsDiv.classList.remove('hidden');
}

function hideSuggestions() {
    suggestionsDiv.classList.add('hidden');
}

async function loadMatrix() {
    showMessage('Loading dashboard...', 'info');
    watchlistSection.classList.add('hidden');
    historySection.classList.add('hidden');
    matrixSection.classList.remove('hidden');
    
    try {
        const res = await fetch(`${API_BASE}/matrix`);
        const data = await res.json();
        renderMatrix(data);
        showMessage('');
    } catch (err) {
        showMessage('Failed to load dashboard', 'error');
    }
}

function renderMatrix(data) {
    const { dates, matrix } = data;
    const thead = matrixTable.querySelector('thead');
    const tbody = matrixTable.querySelector('tbody');
    
    // Build Headers
    let headerHTML = '<tr><th>Symbol</th>';
    dates.forEach(date => {
        // Format date: "Dec 06"
        const d = new Date(date);
        const fmt = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        headerHTML += `<th>${fmt}</th>`;
    });
    headerHTML += '</tr>';
    thead.innerHTML = headerHTML;

    // Build Rows
    tbody.innerHTML = '';
    matrix.forEach(row => {
        const tr = document.createElement('tr');
        let rowHTML = `<td><strong>${row.symbol}</strong></td>`;
        
        dates.forEach(date => {
            const val = row[date];
            rowHTML += `<td>${val !== '-' ? '₹' + parseFloat(val).toFixed(2) : '-'}</td>`;
        });
        
        tr.innerHTML = rowHTML;
        tbody.appendChild(tr);
    });
}

async function fetchWatchlist() {
    try {
        const res = await fetch(`${API_BASE}/list`);
        const data = await res.json();
        renderWatchlist(data.items);
    } catch (err) {
        showMessage('Failed to fetch watchlist', 'error');
    }
}

function renderWatchlist(items) {
    watchlistTableBody.innerHTML = '';
    if (!items || items.length === 0) {
        watchlistTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center">No stocks in watchlist</td></tr>';
        return;
    }

    items.forEach(item => {
        const tr = document.createElement('tr');
        
        const dateAdded = new Date(item.added_at).toLocaleDateString();
        
        tr.innerHTML = `
            <td><strong>${item.symbol}</strong></td>
            <td>${item.exchange || '-'}</td>
            <td>${dateAdded}</td>
            <td>
                <button class="info" onclick="viewHistory('${item.symbol}')">History</button>
                <button class="danger" onclick="removeStock('${item.symbol}')">Remove</button>
            </td>
        `;
        watchlistTableBody.appendChild(tr);
    });
}

async function addStock() {
    const symbol = symbolInput.value.trim().toUpperCase();
    if (!symbol) return;

    addBtn.disabled = true;
    addBtn.textContent = 'Adding...';
    showMessage('');

    try {
        const res = await fetch(`${API_BASE}/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol })
        });
        const data = await res.json();

        if (res.ok) {
            showMessage(`Added ${data.symbol || symbol} successfully`, 'success');
            symbolInput.value = '';
            hideSuggestions();
            fetchWatchlist();
        } else {
            showMessage(data.error || 'Failed to add stock', 'error');
        }
    } catch (err) {
        showMessage('Network error', 'error');
    } finally {
        addBtn.disabled = false;
        addBtn.textContent = 'Add Stock';
    }
}

async function addStockWithToken(symbol, token, exchange) {
    addBtn.disabled = true;
    addBtn.textContent = 'Adding...';
    showMessage('');

    try {
        const res = await fetch(`${API_BASE}/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol, instrument_token: token, exchange })
        });
        const data = await res.json();

        if (res.ok) {
            showMessage(`Added ${data.symbol || symbol} successfully`, 'success');
            symbolInput.value = '';
            hideSuggestions();
            fetchWatchlist();
        } else {
            showMessage(data.error || 'Failed to add stock', 'error');
        }
    } catch (err) {
        showMessage('Network error', 'error');
    } finally {
        addBtn.disabled = false;
        addBtn.textContent = 'Add Stock';
    }
}

async function removeStock(symbol) {
    if (!confirm(`Remove ${symbol} from watchlist?`)) return;

    try {
        const res = await fetch(`${API_BASE}/remove`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol })
        });
        
        if (res.ok) {
            fetchWatchlist();
        } else {
            const data = await res.json();
            showMessage(data.error || 'Failed to remove', 'error');
        }
    } catch (err) {
        showMessage('Network error', 'error');
    }
}

async function viewHistory(symbol) {
    historySection.classList.remove('hidden');
    historyTitle.textContent = `History: ${symbol}`;
    historyTableBody.innerHTML = '<tr><td colspan="2">Loading...</td></tr>';

    try {
        const res = await fetch(`${API_BASE}/history/${symbol}`);
        const data = await res.json();
        
        renderHistory(data.history);
    } catch (err) {
        historyTableBody.innerHTML = '<tr><td colspan="2">Failed to load history</td></tr>';
    }
}

function renderHistory(history) {
    historyTableBody.innerHTML = '';
    if (!history || history.length === 0) {
        historyTableBody.innerHTML = '<tr><td colspan="2">No history data available yet</td></tr>';
        return;
    }

    history.forEach(row => {
        const tr = document.createElement('tr');
        // Format date clearly
        const dateStr = new Date(row.date).toLocaleDateString();
        tr.innerHTML = `
            <td>${dateStr}</td>
            <td>₹${parseFloat(row.ltp).toFixed(2)}</td>
        `;
        historyTableBody.appendChild(tr);
    });
}

function showMessage(msg, type = 'success') {
    messageDiv.textContent = msg;
    messageDiv.className = `message ${type}`;
    setTimeout(() => {
        messageDiv.textContent = '';
        messageDiv.className = 'message';
    }, 5000);
}

// Global expose for onclick handlers
window.removeStock = removeStock;
window.viewHistory = viewHistory;
