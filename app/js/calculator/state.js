/**
 * Calculator State Management
 * Manages the state for the portfolio calculator including assets, config, and results
 */

const CalculatorState = {
    // Storage key for persistence
    STORAGE_KEY: 'portfolioCalculator_state',
    STORAGE_VERSION: 2,
    
    // Shared storage key with viewer
    VIEWER_STORAGE_KEY: 'portfolioViewer_state',
    
    // Configuration
    config: {
        targetCash: 100000,
        lookbackWindow: 252,  // Trading days
        leverageRate: 1,      // Leverage/margin rate (1 = no leverage)
        allocationMode: 'weight', // 'weight', 'shares', or 'value'
        riskFreeRate: null,   // From Fed rate
    },
    
    // Assets list
    assets: [],
    
    // Current prices (fetched from API)
    prices: {},
    
    // Data freshness status
    dataStatus: {
        lastChecked: null,
        isUpdating: false,
        isFresh: false,
        tickerStatus: {},  // {ticker: {lastDate, isFresh}}
    },
    
    // Calculated results
    results: {
        positions: null,
        tradeOrders: null,
        riskMetrics: null,
        projection: null,
    },

    // Persisted UI/session state
    ui: {
        statusText: 'Ready',
        lastCalculatedAt: null,
        dataStatus: {
            status: 'checking',
            text: 'Checking data...',
        },
        projectionView: 'distribution',
    },
    
    // =========================================================================
    // Asset Management
    // =========================================================================
    
    /**
     * Add an asset to the portfolio
     * @param {string} ticker - Ticker symbol
     * @param {number} weight - Weight as decimal (0-1)
     * @param {number} currentShares - Current shares owned
     * @param {number} targetShares - Target shares (shares mode)
     * @param {number} targetValue - Target dollar value (value mode)
     */
    addAsset(ticker, weight, currentShares = 0, targetShares = 0, targetValue = 0) {
        ticker = ticker.toUpperCase().trim();
        
        // Check if already exists
        const existing = this.assets.find(a => a.ticker === ticker);
        if (existing) {
            existing.weight = weight;
            existing.currentShares = currentShares;
            existing.targetShares = Math.max(0, Math.round(targetShares || existing.targetShares || 0));
            existing.targetValue = Math.max(0, Number(targetValue ?? existing.targetValue ?? 0));
        } else {
            this.assets.push({
                ticker,
                weight,
                currentShares,
                targetShares: Math.max(0, Math.round(targetShares || 0)),
                targetValue: Math.max(0, Number(targetValue || 0)),
            });
        }
        
        this.saveToStorage();
        return true;
    },
    
    /**
     * Remove an asset from the portfolio
     * @param {string} ticker - Ticker symbol
     */
    removeAsset(ticker) {
        this.assets = this.assets.filter(a => a.ticker !== ticker);
        delete this.prices[ticker];
        this.saveToStorage();
    },
    
    /**
     * Update asset weight
     * @param {string} ticker - Ticker symbol
     * @param {number} weight - New weight as decimal (0-1)
     */
    updateWeight(ticker, weight) {
        const asset = this.assets.find(a => a.ticker === ticker);
        if (asset) {
            asset.weight = weight;
            this.saveToStorage();
        }
    },

    /**
     * Update target shares for an asset
     * @param {string} ticker - Ticker symbol
     * @param {number} shares - Target shares
     */
    updateTargetShares(ticker, shares) {
        const asset = this.assets.find(a => a.ticker === ticker);
        if (asset) {
            asset.targetShares = Math.max(0, Math.round(shares || 0));
            const price = this.prices?.[ticker]?.price;
            if (price && price > 0) {
                asset.targetValue = asset.targetShares * price;
            }
            this.saveToStorage();
        }
    },

    /**
     * Update target value for an asset
     * @param {string} ticker - Ticker symbol
     * @param {number} value - Target dollar value
     */
    updateTargetValue(ticker, value) {
        const asset = this.assets.find(a => a.ticker === ticker);
        if (asset) {
            asset.targetValue = Math.max(0, Number(value || 0));
            const price = this.prices?.[ticker]?.price;
            if (price && price > 0) {
                asset.targetShares = Math.max(0, Math.round(asset.targetValue / price));
                asset.targetValue = asset.targetShares * price;
            }
            this.saveToStorage();
        }
    },
    
    /**
     * Update current shares for an asset
     * @param {string} ticker - Ticker symbol
     * @param {number} shares - Current shares
     */
    updateCurrentShares(ticker, shares) {
        const asset = this.assets.find(a => a.ticker === ticker);
        if (asset) {
            asset.currentShares = shares;
            this.saveToStorage();
        }
    },
    
    /**
     * Get total weight of all assets
     * @returns {number} Total weight
     */
    getTotalWeight() {
        return this.assets.reduce((sum, a) => sum + a.weight, 0);
    },
    
    /**
     * Normalize all weights to sum to 1
     */
    normalizeWeights() {
        const total = this.getTotalWeight();
        if (total > 0) {
            this.assets.forEach(a => {
                a.weight = a.weight / total;
            });
            this.saveToStorage();
        }
    },
    
    /**
     * Get all ticker symbols
     * @returns {string[]} Array of tickers
     */
    getTickers() {
        return this.assets.map(a => a.ticker);
    },
    
    /**
     * Get weights as object
     * @returns {Object} {ticker: weight}
     */
    getWeights() {
        const weights = {};
        this.assets.forEach(a => {
            weights[a.ticker] = a.weight;
        });
        return weights;
    },
    
    /**
     * Get current holdings as object
     * @returns {Object} {ticker: shares}
     */
    getCurrentHoldings() {
        const holdings = {};
        this.assets.forEach(a => {
            holdings[a.ticker] = a.currentShares;
        });
        return holdings;
    },
    
    // =========================================================================
    // Configuration
    // =========================================================================
    
    /**
     * Update target cash
     * @param {number} value - Target cash value
     */
    setTargetCash(value) {
        this.config.targetCash = Math.max(0, value);
        this.saveToStorage();
    },
    
    /**
     * Update lookback window
     * @param {number} days - Number of trading days
     */
    setLookbackWindow(days) {
        this.config.lookbackWindow = Math.max(20, Math.min(1260, days));
        this.saveToStorage();
    },
    
    /**
     * Update leverage rate
     * @param {number} rate - Leverage rate (1 = no leverage, max 10)
     */
    setLeverageRate(rate) {
        this.config.leverageRate = Math.max(1, Math.min(10, rate));
        this.saveToStorage();
    },

    /**
     * Update allocation input mode
     * @param {string} mode - 'weight', 'shares', or 'value'
     */
    setAllocationMode(mode) {
        this.config.allocationMode = ['shares', 'value'].includes(mode) ? mode : 'weight';
        this.saveToStorage();
    },
    
    /**
     * Set risk-free rate from Fed data
     * @param {number} rate - Annual rate as decimal
     */
    setRiskFreeRate(rate) {
        this.config.riskFreeRate = rate;
        this.saveToStorage();
    },

    /**
     * Replace latest prices cache
     * @param {Object} prices - Latest prices keyed by ticker
     */
    setPrices(prices) {
        this.prices = prices || {};
        this.saveToStorage();
    },

    /**
     * Merge data freshness status
     * @param {Object} status - Partial data status
     */
    setDataStatus(status = {}) {
        this.dataStatus = {
            ...this.dataStatus,
            ...status,
            tickerStatus: status.tickerStatus || this.dataStatus.tickerStatus || {},
        };
        this.saveToStorage();
    },

    /**
     * Set a single calculated result bucket
     * @param {string} key - Result key
     * @param {*} value - Result payload
     */
    setResult(key, value) {
        if (!(key in this.results)) return;
        this.results[key] = value;
        this.saveToStorage();
    },

    /**
     * Merge persisted UI state
     * @param {Object} updates - Partial UI state
     */
    setUiState(updates = {}) {
        const nextDataStatus = updates.dataStatus
            ? { ...this.ui.dataStatus, ...updates.dataStatus }
            : this.ui.dataStatus;

        this.ui = {
            ...this.ui,
            ...updates,
            dataStatus: nextDataStatus,
        };
        this.saveToStorage();
    },
    
    // =========================================================================
    // Persistence
    // =========================================================================
    
    /**
     * Save state to localStorage
     */
    saveToStorage() {
        try {
            const state = {
                version: this.STORAGE_VERSION,
                config: this.config,
                assets: this.assets,
                prices: this.prices,
                dataStatus: this.dataStatus,
                results: this.results,
                ui: this.ui,
            };
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.warn('Failed to save calculator state:', e);
        }
    },
    
    /**
     * Load state from localStorage
     */
    loadFromStorage() {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (saved) {
                const state = JSON.parse(saved);
                this.config = { ...this.config, ...state.config };
                this.config.allocationMode = ['shares', 'value'].includes(this.config.allocationMode)
                    ? this.config.allocationMode
                    : 'weight';
                this.assets = (state.assets || []).map(asset => ({
                    ...asset,
                    currentShares: Math.max(0, Math.round(asset.currentShares || 0)),
                    targetShares: Math.max(0, Math.round(asset.targetShares || 0)),
                    targetValue: Math.max(0, Number(asset.targetValue || 0)),
                    weight: typeof asset.weight === 'number' ? asset.weight : 0,
                }));
                this.prices = state.prices || {};
                this.dataStatus = {
                    ...this.dataStatus,
                    ...(state.dataStatus || {}),
                    tickerStatus: state.dataStatus?.tickerStatus || {},
                };
                this.results = {
                    ...this.results,
                    ...(state.results || {}),
                };
                this.ui = {
                    ...this.ui,
                    ...(state.ui || {}),
                    dataStatus: {
                        ...this.ui.dataStatus,
                        ...(state.ui?.dataStatus || {}),
                    },
                    projectionView: state.ui?.projectionView === 'continuous' ? 'continuous' : 'distribution',
                };
                return true;
            }
        } catch (e) {
            console.warn('Failed to load calculator state:', e);
        }
        return false;
    },

    /**
     * Build weights and leverage from target shares and/or values and prices
     * @param {Object} prices - {ticker: {price, ...}}
     * @returns {Object} {weights, totalTargetValue, leverageRate, explicitTargetShares}
     */
    getShareModePortfolio(prices = this.prices) {
        const valueByTicker = {};
        const explicitTargetShares = {};
        let totalTargetValue = 0;
        const mode = this.config.allocationMode;

        this.assets.forEach(asset => {
            const price = prices?.[asset.ticker]?.price;
            if (mode === 'value' && (!price || price <= 0)) {
                const targetValue = Math.max(0, Number(asset.targetValue || 0));
                explicitTargetShares[asset.ticker] = 0;
                valueByTicker[asset.ticker] = targetValue;
                totalTargetValue += targetValue;
                return;
            }

            if (!price || price <= 0) {
                valueByTicker[asset.ticker] = 0;
                explicitTargetShares[asset.ticker] = 0;
                return;
            }

            const shares = mode === 'value'
                ? Math.max(
                    0,
                    Math.round(
                        (asset.targetShares || 0) > 0
                            ? asset.targetShares
                            : (asset.targetValue || 0) / price
                    )
                )
                : Math.max(0, Math.round(asset.targetShares || 0));
            const targetValue = shares * price;

            explicitTargetShares[asset.ticker] = shares;
            valueByTicker[asset.ticker] = targetValue;
            totalTargetValue += targetValue;
        });

        const weights = {};
        this.assets.forEach(asset => {
            const value = valueByTicker[asset.ticker] || 0;
            weights[asset.ticker] = totalTargetValue > 0 ? value / totalTargetValue : 0;
        });

        const targetCash = Math.max(this.config.targetCash || 0, 0);
        const leverageRate = totalTargetValue > 0 && targetCash > 0
            ? Math.max(1, totalTargetValue / targetCash)
            : 1;

        return { weights, totalTargetValue, leverageRate, explicitTargetShares };
    },
    
    /**
     * Import assets from the backtest viewer
     * @returns {boolean} Whether import was successful
     */
    importFromViewer() {
        try {
            const viewerState = localStorage.getItem(this.VIEWER_STORAGE_KEY);
            if (viewerState) {
                const parsed = JSON.parse(viewerState);
                const tickers = parsed.selectedTickers || [];
                const weights = parsed.weights || {};
                
                // Clear current assets
                this.assets = [];
                
                // Import each ticker with its weight
                tickers.forEach(ticker => {
                    const weight = weights[ticker] || (1 / tickers.length);
                    this.addAsset(ticker, weight, 0);
                });
                
                return tickers.length > 0;
            }
        } catch (e) {
            console.warn('Failed to import from viewer:', e);
        }
        return false;
    },
    
    /**
     * Reset all state
     */
    reset() {
        this.assets = [];
        this.prices = {};
        this.results = {
            positions: null,
            tradeOrders: null,
            riskMetrics: null,
            projection: null,
        };
        this.dataStatus = {
            lastChecked: null,
            isUpdating: false,
            isFresh: false,
            tickerStatus: {},
        };
        this.ui = {
            statusText: 'Ready',
            lastCalculatedAt: null,
            dataStatus: {
                status: 'checking',
                text: 'Checking data...',
            },
            projectionView: 'distribution',
        };
        this.saveToStorage();
    },
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CalculatorState;
}
