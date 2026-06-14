/**
 * Data Manager for Portfolio Calculator
 * Handles data freshness detection and auto-update
 */

const DataManager = {
    // =========================================================================
    // Trading Day Utilities
    // =========================================================================
    
    /**
     * Check if a date is a weekend
     * @param {Date} date - Date to check
     * @returns {boolean} True if weekend
     */
    isWeekend(date) {
        const day = date.getDay();
        return day === 0 || day === 6;
    },
    
    /**
     * Get the latest trading day (excluding weekends)
     * Note: Does not account for holidays
     * @returns {string} Date in YYYY-MM-DD format
     */
    getLatestTradingDay() {
        const now = new Date();
        const hour = now.getHours();
        
        // If before market close (4 PM ET), use previous day
        // Simplified: assume 9 PM local time as cutoff
        let date = new Date(now);
        if (hour < 21) {
            date.setDate(date.getDate() - 1);
        }
        
        // Skip weekends
        while (this.isWeekend(date)) {
            date.setDate(date.getDate() - 1);
        }
        
        return date.toISOString().split('T')[0];
    },
    
    /**
     * Parse date string to Date object
     * @param {string} dateStr - Date in YYYY-MM-DD format
     * @returns {Date} Date object
     */
    parseDate(dateStr) {
        const [year, month, day] = dateStr.split('-').map(Number);
        return new Date(year, month - 1, day);
    },

    /**
     * Find the latest row with a valid numeric price.
     * Some futures series have trailing rows with null/NaN close fields.
     * @param {Array} rows - API price rows sorted by date asc
     * @returns {Object|null} Latest valid row + normalized price
     */
    getLatestValidPriceRow(rows) {
        if (!Array.isArray(rows) || rows.length === 0) {
            return null;
        }

        for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows[i];
            const rawPrice = row?.adj_close ?? row?.close;
            const price = Number(rawPrice);
            if (Number.isFinite(price) && price > 0) {
                return { row, price };
            }
        }

        return null;
    },
    
    // =========================================================================
    // Data Freshness
    // =========================================================================
    
    /**
     * Check data freshness for all configured tickers
     * @returns {Promise<Object>} Freshness status for each ticker
     */
    async checkAllFreshness() {
        const tickers = CalculatorState.getTickers();
        const latestTradingDay = this.getLatestTradingDay();
        
        CalculatorState.dataStatus.lastChecked = new Date().toISOString();
        CalculatorState.dataStatus.tickerStatus = {};
        
        let allFresh = true;
        
        for (const ticker of tickers) {
            try {
                const range = await API.getDataRange(ticker);
                const lastDate = range.last_date;
                const isFresh = lastDate >= latestTradingDay;
                
                CalculatorState.dataStatus.tickerStatus[ticker] = {
                    lastDate,
                    isFresh,
                    latestTradingDay,
                };
                
                if (!isFresh) {
                    allFresh = false;
                }
            } catch (e) {
                // Ticker not in cache
                CalculatorState.dataStatus.tickerStatus[ticker] = {
                    lastDate: null,
                    isFresh: false,
                    latestTradingDay,
                    error: 'Not cached',
                };
                allFresh = false;
            }
        }
        
        CalculatorState.dataStatus.isFresh = allFresh && tickers.length > 0;
        CalculatorState.saveToStorage();
        return CalculatorState.dataStatus;
    },
    
    /**
     * Update data for all stale tickers
     * @param {Function} onProgress - Progress callback (ticker, current, total)
     * @returns {Promise<Object>} Update results
     */
    async updateStaleData(onProgress = null) {
        const tickers = CalculatorState.getTickers();
        const stale = tickers.filter(t => {
            const status = CalculatorState.dataStatus.tickerStatus[t];
            return !status || !status.isFresh;
        });
        
        if (stale.length === 0) {
            return { updated: 0, errors: [] };
        }
        
        CalculatorState.dataStatus.isUpdating = true;
        CalculatorState.saveToStorage();
        
        let updated = 0;
        const errors = [];
        
        for (let i = 0; i < stale.length; i++) {
            const ticker = stale[i];
            
            if (onProgress) {
                onProgress(ticker, i + 1, stale.length);
            }
            
            try {
                await API.loadData(ticker, null, null, 'yfinance');
                updated++;
            } catch (e) {
                errors.push({ ticker, error: e.message });
            }
        }
        
        CalculatorState.dataStatus.isUpdating = false;
        CalculatorState.saveToStorage();
        
        // Re-check freshness after update
        await this.checkAllFreshness();
        
        return { updated, errors };
    },
    
    // =========================================================================
    // Price Data
    // =========================================================================
    
    /**
     * Fetch latest prices for all configured tickers
     * @returns {Promise<Object>} Prices by ticker
     */
    async fetchLatestPrices() {
        const tickers = CalculatorState.getTickers();
        const prices = {};
        const endDate = this.getLatestTradingDay();
        const fallbackStartDate = new Date(endDate);
        fallbackStartDate.setDate(fallbackStartDate.getDate() - 45);
        const fallbackStartStr = fallbackStartDate.toISOString().split('T')[0];
        
        for (const ticker of tickers) {
            try {
                // Prefer bounded range queries for robustness (especially some futures symbols).
                // This avoids loading the entire cached history when we only need the latest row.
                const response = await API.getPrices(ticker, fallbackStartStr, endDate);
                if (response.data && response.data.length > 0) {
                    const latestValid = this.getLatestValidPriceRow(response.data);
                    if (latestValid) {
                        const { row: latest, price } = latestValid;
                        prices[ticker] = {
                            date: latest.date,
                            price,
                            open: latest.open,
                            high: latest.high,
                            low: latest.low,
                            close: latest.close,
                            adjClose: latest.adj_close,
                            volume: latest.volume,
                        };
                    }
                }
            } catch (e) {
                // Fallback: try unbounded query in case the ticker only has older cached data.
                try {
                    const response = await API.getPrices(ticker);
                    if (response.data && response.data.length > 0) {
                        const latestValid = this.getLatestValidPriceRow(response.data);
                        if (latestValid) {
                            const { row: latest, price } = latestValid;
                            prices[ticker] = {
                                date: latest.date,
                                price,
                                open: latest.open,
                                high: latest.high,
                                low: latest.low,
                                close: latest.close,
                                adjClose: latest.adj_close,
                                volume: latest.volume,
                            };
                        }
                    }
                } catch (fallbackError) {
                    console.warn(`Failed to fetch price for ${ticker}:`, fallbackError);
                }
            }
        }
        
        CalculatorState.setPrices(prices);
        return prices;
    },
    
    /**
     * Fetch historical prices for risk analysis
     * @param {number} days - Number of days of history
     * @returns {Promise<Object>} Historical prices by ticker
     */
    async fetchHistoricalPrices(days = 252) {
        const tickers = CalculatorState.getTickers();
        const history = {};
        
        // Calculate start date
        const endDate = this.getLatestTradingDay();
        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - Math.ceil(days * 1.5)); // Extra buffer for weekends/holidays
        const startStr = startDate.toISOString().split('T')[0];
        
        for (const ticker of tickers) {
            try {
                const response = await API.getPrices(ticker, startStr, endDate);
                if (response.data && response.data.length > 0) {
                    // Take the last N data points
                    history[ticker] = response.data.slice(-days).map(d => ({
                        date: d.date,
                        adjClose: d.adj_close || d.close,
                    }));
                }
            } catch (e) {
                console.warn(`Failed to fetch history for ${ticker}:`, e);
            }
        }
        
        return history;
    },
    
    /**
     * Fetch Fed Funds Rate for risk-free rate
     * @returns {Promise<number>} Annual rate as decimal
     */
    async fetchRiskFreeRate() {
        try {
            const response = await API.getFedRate(null, null, true);
            if (response.data && response.data.length > 0) {
                // Get the latest rate
                const latest = response.data[response.data.length - 1];
                // Convert from percentage to decimal
                const rate = latest.rate / 100;
                CalculatorState.setRiskFreeRate(rate);
                return rate;
            }
        } catch (e) {
            console.warn('Failed to fetch Fed rate:', e);
        }
        
        // Default fallback
        const defaultRate = 0.05;
        CalculatorState.setRiskFreeRate(defaultRate);
        return defaultRate;
    },
    
    // =========================================================================
    // Initialization
    // =========================================================================
    
    /**
     * Initialize data - check freshness and update if needed
     * @param {Function} onProgress - Progress callback
     * @returns {Promise<Object>} Status
     */
    async initialize(onProgress = null) {
        // First check freshness
        await this.checkAllFreshness();
        
        // Update stale data if any
        if (!CalculatorState.dataStatus.isFresh) {
            await this.updateStaleData(onProgress);
        }
        
        // Fetch latest prices
        await this.fetchLatestPrices();
        
        // Fetch risk-free rate
        await this.fetchRiskFreeRate();
        
        return CalculatorState.dataStatus;
    },
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DataManager;
}
