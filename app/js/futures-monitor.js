/**
 * Futures Monitor - Track basis between futures and spot prices
 */

const FuturesMonitor = {
    STORAGE_KEY: 'futuresMonitor_portfolio',

    // Configuration for futures contracts
    contracts: [
        {
            id: 'NQ',
            name: 'E-mini Nasdaq 100',
            futureTicker: 'NQ=F',
            spotTicker: '^NDX',
            // Quarterly expiry: 3rd Friday of Mar, Jun, Sep, Dec
            expiryMonths: [3, 6, 9, 12],
            spotMultiplier: 1,  // Direct comparison
        },
        {
            id: 'ZB',
            name: '20+ Year Treasury',
            futureTicker: 'ZB=F',
            spotTicker: '^TYX',  // 30-year Treasury yield
            expiryMonths: [3, 6, 9, 12],
            // ^TYX is yield - need to convert to price
            // Using bond pricing formula: Price ≈ Coupon / Yield
            // ZB futures assume 6% coupon
            isYield: true,
            couponRate: 6,  // 6% coupon for ZB conversion
        },
        {
            id: 'GC',
            name: 'Gold Futures',
            futureTicker: 'GC=F',
            spotTicker: 'GLD',
            expiryMonths: [2, 4, 6, 8, 10, 12],
            // GLD holds ~1/10.7 oz per share, GC is per oz
            // GLD price * 10.7 ≈ spot gold price
            spotMultiplier: 10.7,
        },
        {
            id: 'DX',
            name: 'US Dollar Index',
            futureTicker: 'DX=F',          // Futures contract
            spotTicker: 'DX-Y.NYB',        // Continuous contract as spot reference
            expiryMonths: [3, 6, 9, 12],
            spotMultiplier: 1,  // Direct comparison
        },
    ],
    
    // State
    data: {},
    positions: {},
    isLoading: false,
    lastUpdate: null,
    
    /**
     * Initialize the monitor
     */
    async init() {
        console.log('Initializing Futures Monitor...');

        this.loadPositionsFromStorage();
        
        // Check API health
        const isConnected = await API.checkHealth();
        this.updateApiStatus(isConnected);
        
        // Bind events
        this.bindEvents();
        
        // Load data
        await this.refreshData();
    },

    /**
     * Load saved monitor positions from localStorage
     */
    loadPositionsFromStorage() {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (!saved) return;

            const parsed = JSON.parse(saved);
            this.positions = parsed.positions || {};
        } catch (error) {
            console.warn('Failed to load futures monitor positions:', error);
            this.positions = {};
        }
    },

    /**
     * Save monitor positions and latest prices for backtest import
     */
    savePositionsToStorage() {
        try {
            const contracts = this.contracts.map(contract => {
                const shares = Math.max(0, Math.round(this.positions[contract.id] || 0));
                const latest = this.data[contract.id];
                return {
                    id: contract.id,
                    ticker: contract.futureTicker,
                    shares,
                    price: latest?.futuresPrice ?? null,
                    priceDate: latest?.lastUpdate ? latest.lastUpdate.toISOString() : null,
                    name: contract.name,
                };
            });

            localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
                positions: this.positions,
                contracts,
                updatedAt: new Date().toISOString(),
            }));
        } catch (error) {
            console.warn('Failed to save futures monitor positions:', error);
        }
    },

    /**
     * Update position shares for a contract
     * @param {string} id - Contract id
     * @param {string|number} value - Position size
     */
    updatePositionShares(id, value) {
        this.positions[id] = Math.max(0, Math.round(parseFloat(value) || 0));
        this.savePositionsToStorage();
    },

    /**
     * Sync stored position inputs into the UI
     */
    syncPositionInputs() {
        this.contracts.forEach(contract => {
            const input = document.getElementById(`${contract.id}-position-shares`);
            if (input) {
                input.value = Math.max(0, Math.round(this.positions[contract.id] || 0));
            }
        });
    },
    
    /**
     * Bind event listeners
     */
    bindEvents() {
        document.getElementById('refreshBtn').addEventListener('click', () => this.refreshData());
    },
    
    /**
     * Update API status indicator
     */
    updateApiStatus(connected) {
        const indicator = document.getElementById('apiStatus');
        if (indicator) {
            indicator.classList.toggle('connected', connected);
            indicator.classList.toggle('disconnected', !connected);
        }
    },
    
    /**
     * Set loading state
     */
    setLoading(loading) {
        this.isLoading = loading;
        
        const statusText = document.getElementById('statusText');
        const refreshBtn = document.getElementById('refreshBtn');
        
        if (loading) {
            statusText.textContent = 'Fetching latest prices...';
            refreshBtn.disabled = true;
            refreshBtn.innerHTML = '<span class="icon">⏳</span> Loading...';
            
            // Add loading class to all cards
            document.querySelectorAll('.futures-card').forEach(card => {
                card.classList.add('loading');
            });
        } else {
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = '<span class="icon">🔄</span> Refresh';
            
            // Remove loading class
            document.querySelectorAll('.futures-card').forEach(card => {
                card.classList.remove('loading');
            });
        }
    },
    
    /**
     * Refresh all futures data
     */
    async refreshData() {
        if (this.isLoading) return;
        
        this.setLoading(true);
        
        try {
            // Fetch all contracts in parallel
            const promises = this.contracts.map(contract => this.fetchContractData(contract));
            await Promise.all(promises);
            
            // Update last update time
            this.lastUpdate = new Date();
            this.updateLastUpdateTime();
            
            document.getElementById('statusText').textContent = 'Data updated successfully';
            this.savePositionsToStorage();
            
        } catch (error) {
            console.error('Error refreshing data:', error);
            document.getElementById('statusText').textContent = `Error: ${error.message}`;
        } finally {
            this.setLoading(false);
        }
    },
    
    /**
     * Fetch data for a single contract
     */
    async fetchContractData(contract) {
        const card = document.querySelector(`[data-future="${contract.id}"]`);
        
        try {
            // Fetch futures and spot prices
            const [futuresData, spotData] = await Promise.all([
                this.fetchLatestPrice(contract.futureTicker),
                this.fetchLatestPrice(contract.spotTicker),
            ]);
            
            if (!futuresData || !spotData) {
                throw new Error('Could not fetch price data');
            }
            
            // Calculate basis
            const futuresPrice = futuresData.price;
            let spotPrice;
            let spotDisplayValue = spotData.price;  // Original value for display
            
            // Handle special conversions
            if (contract.isYield) {
                // Convert yield to price using bond pricing approximation
                // Price ≈ Coupon / (Yield/100) for perpetuity approximation
                // For a more accurate estimate, use: Price ≈ Coupon / Yield * 100
                const yieldPercent = spotData.price;  // ^TYX gives yield in percent (e.g., 4.5)
                spotPrice = (contract.couponRate / yieldPercent) * 100;
                spotDisplayValue = yieldPercent;  // Show yield in display
            } else if (contract.spotMultiplier && contract.spotMultiplier !== 1) {
                // Apply multiplier (e.g., GLD * 10.7)
                spotPrice = spotData.price * contract.spotMultiplier;
            } else {
                spotPrice = spotData.price;
            }
            
            // Calculate percentage basis
            let basis = futuresPrice - spotPrice;
            let basisPercent = ((futuresPrice - spotPrice) / spotPrice) * 100;
            
            // Estimate days to expiry
            const daysToExpiry = this.estimateDaysToExpiry(contract.expiryMonths);
            
            // Calculate annualized basis
            let annualizedBasis = null;
            if (basisPercent !== null && daysToExpiry > 0) {
                annualizedBasis = basisPercent * (365 / daysToExpiry);
            }
            
            // Store data
            this.data[contract.id] = {
                futuresPrice,
                spotPrice,
                spotDisplayValue,  // For display purposes
                basis,
                basisPercent,
                annualizedBasis,
                daysToExpiry,
                lastUpdate: new Date(),
                isYield: contract.isYield,
            };
            
        // Update UI
        this.updateCard(contract.id, this.data[contract.id], contract);
        this.syncPositionInputs();
        card.classList.remove('error');
            
        } catch (error) {
            console.error(`Error fetching ${contract.name}:`, error);
            card.classList.add('error');
            this.updateCardError(contract.id, error.message);
        }
    },
    
    /**
     * Fetch latest price for a ticker
     */
    async fetchLatestPrice(ticker) {
        try {
            // First try to load data (this will cache it)
            await API.loadData(ticker, null, null, 'yfinance');
            
            // Get the price data
            const response = await API.getPrices(ticker);
            
            if (response && response.data && response.data.length > 0) {
                // Get the most recent price
                const latestData = response.data[response.data.length - 1];
                return {
                    price: latestData.adj_close || latestData.close,
                    date: latestData.date,
                };
            }
            
            return null;
        } catch (error) {
            console.error(`Error fetching ${ticker}:`, error);
            return null;
        }
    },
    
    /**
     * Estimate days to expiry based on contract months
     * Assumes 3rd Friday of expiry month
     */
    estimateDaysToExpiry(expiryMonths) {
        const today = new Date();
        const currentMonth = today.getMonth() + 1;
        const currentYear = today.getFullYear();
        
        // Find next expiry month
        let expiryMonth = expiryMonths.find(m => m > currentMonth);
        let expiryYear = currentYear;
        
        if (!expiryMonth) {
            // Next expiry is in next year
            expiryMonth = expiryMonths[0];
            expiryYear = currentYear + 1;
        }
        
        // Find 3rd Friday of expiry month
        const expiryDate = this.getThirdFriday(expiryYear, expiryMonth);
        
        // Calculate days difference
        const diffTime = expiryDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        return Math.max(1, diffDays);
    },
    
    /**
     * Get the 3rd Friday of a given month
     */
    getThirdFriday(year, month) {
        // Month is 1-indexed
        const firstDay = new Date(year, month - 1, 1);
        const dayOfWeek = firstDay.getDay();
        
        // Find first Friday
        let firstFriday = 1 + (5 - dayOfWeek + 7) % 7;
        if (firstFriday === 1 && dayOfWeek !== 5) {
            firstFriday += 7;
        }
        
        // Third Friday is 14 days after first Friday
        const thirdFriday = firstFriday + 14;
        
        return new Date(year, month - 1, thirdFriday);
    },
    
    /**
     * Update a futures card with data
     */
    updateCard(id, data, contract) {
        // Futures price
        document.getElementById(`${id}-futures-price`).textContent = 
            this.formatPrice(data.futuresPrice);
        
        // Spot price
        const spotPriceEl = document.getElementById(`${id}-spot-price`);
        if (data.isYield) {
            // For yield-based contracts, show yield and converted price
            spotPriceEl.innerHTML = `${this.formatPrice(data.spotPrice)} <small>(${data.spotDisplayValue.toFixed(2)}% yield)</small>`;
        } else if (contract.spotMultiplier && contract.spotMultiplier !== 1) {
            // Show calculated spot price
            spotPriceEl.textContent = this.formatPrice(data.spotPrice);
        } else {
            spotPriceEl.textContent = this.formatPrice(data.spotPrice);
        }
        
        // Basis
        const basisEl = document.getElementById(`${id}-basis`);
        if (data.basisPercent !== null && !isNaN(data.basisPercent)) {
            basisEl.textContent = `${data.basisPercent >= 0 ? '+' : ''}${data.basisPercent.toFixed(3)}%`;
            basisEl.className = `basis-value ${data.basisPercent >= 0 ? 'positive' : 'negative'}`;
        } else {
            basisEl.textContent = 'N/A';
            basisEl.className = 'basis-value';
        }
        
        // Annualized basis
        const annualizedEl = document.getElementById(`${id}-annualized`);
        if (data.annualizedBasis !== null && !isNaN(data.annualizedBasis)) {
            annualizedEl.textContent = `${data.annualizedBasis >= 0 ? '+' : ''}${data.annualizedBasis.toFixed(2)}%`;
            annualizedEl.className = `basis-value annualized ${data.annualizedBasis >= 0 ? 'positive' : 'negative'}`;
        } else {
            annualizedEl.textContent = 'N/A';
            annualizedEl.className = 'basis-value annualized';
        }
        
        // Expiry info
        const nextExpiry = this.getNextExpiryDate(contract.expiryMonths);
        document.getElementById(`${id}-expiry`).textContent = 
            `Expiry: ${nextExpiry.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        document.getElementById(`${id}-days-to-expiry`).textContent = 
            `${data.daysToExpiry} days`;
    },
    
    /**
     * Update card to show error state
     */
    updateCardError(id, message) {
        document.getElementById(`${id}-futures-price`).textContent = 'Error';
        document.getElementById(`${id}-spot-price`).textContent = 'Error';
        document.getElementById(`${id}-basis`).textContent = '--';
        document.getElementById(`${id}-annualized`).textContent = '--';
    },
    
    /**
     * Get next expiry date
     */
    getNextExpiryDate(expiryMonths) {
        const today = new Date();
        const currentMonth = today.getMonth() + 1;
        const currentYear = today.getFullYear();
        
        let expiryMonth = expiryMonths.find(m => m > currentMonth);
        let expiryYear = currentYear;
        
        if (!expiryMonth) {
            expiryMonth = expiryMonths[0];
            expiryYear = currentYear + 1;
        }
        
        return this.getThirdFriday(expiryYear, expiryMonth);
    },
    
    /**
     * Format price for display
     */
    formatPrice(price) {
        if (price === null || price === undefined || isNaN(price)) {
            return '--';
        }
        
        if (price >= 1000) {
            return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        } else if (price >= 100) {
            return price.toFixed(2);
        } else {
            return price.toFixed(4);
        }
    },
    
    /**
     * Update last update time display
     */
    updateLastUpdateTime() {
        const el = document.getElementById('lastUpdateTime');
        if (el && this.lastUpdate) {
            el.textContent = `Last updated: ${this.lastUpdate.toLocaleTimeString()}`;
        }
    },
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    FuturesMonitor.init();
});

// Export for use in other modules
window.FuturesMonitor = FuturesMonitor;
