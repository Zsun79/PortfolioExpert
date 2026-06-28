/**
 * Portfolio Watcher - Main Application
 * Orchestrates all Portfolio Watcher modules
 */

const PortfolioWatcher = {
    // =========================================================================
    // Initialization
    // =========================================================================
    
    /**
     * Initialize the Portfolio Watcher application
     */
    async init() {
        console.log('Initializing Portfolio Watcher...');
        
        // Load saved state
        PortfolioWatcherState.loadFromStorage();
        
        // Initialize UI
        PortfolioWatcherUI.init();
        
        // Bind event listeners
        this.bindEvents();
        
        // Check and update data
        await this.initializeData();
        
        console.log('Portfolio Watcher initialized');
    },
    
    /**
     * Bind DOM event listeners
     */
    bindEvents() {
        // Add asset button
        document.getElementById('addAssetBtn')?.addEventListener('click', () => this.addAsset());
        
        // Asset input enter key
        document.getElementById('assetTickerInput')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addAsset();
        });
        
        // Import from viewer
        document.getElementById('importFromViewerBtn')?.addEventListener('click', () => this.importFromViewer());
        
        // Config inputs
        document.getElementById('targetCash')?.addEventListener('change', (e) => {
            PortfolioWatcherState.setTargetCash(parseFloat(e.target.value) || 100000);
            PortfolioWatcherUI.syncLeverageForShareMode();
        });
        
        document.getElementById('lookbackWindow')?.addEventListener('change', (e) => {
            PortfolioWatcherState.setLookbackWindow(parseInt(e.target.value) || 252);
        });
        
        document.getElementById('leverageRate')?.addEventListener('change', (e) => {
            if (PortfolioWatcherUI.getAllocationMode() === 'weight') {
                PortfolioWatcherState.setLeverageRate(parseFloat(e.target.value) || 1);
            } else {
                PortfolioWatcherUI.syncLeverageForShareMode();
            }
        });

        document.getElementById('allocationMode')?.addEventListener('change', (e) => {
            const mode = ['shares', 'value'].includes(e.target.value) ? e.target.value : 'weight';
            PortfolioWatcherState.setAllocationMode(mode);
            PortfolioWatcherUI.renderAssetsList();
            PortfolioWatcherUI.syncAllocationModeUI();
        });
        
        // Calculate button
        document.getElementById('calculateBtn')?.addEventListener('click', () => this.calculate());
    },
    
    /**
     * Initialize data - check freshness and update if needed
     */
    async initializeData() {
        const tickers = PortfolioWatcherState.getTickers();
        
        if (tickers.length === 0) {
            PortfolioWatcherUI.updateDataStatus('fresh', 'No assets configured');
            return;
        }
        
        PortfolioWatcherUI.updateDataStatus('updating', 'Checking data freshness...');
        
        try {
            // Check freshness
            await DataManager.checkAllFreshness();
            
            // Update if stale
            if (!PortfolioWatcherState.dataStatus.isFresh) {
                PortfolioWatcherUI.updateDataStatus('updating', 'Updating stale data...');
                
                await DataManager.updateStaleData((ticker, current, total) => {
                    PortfolioWatcherUI.updateDataStatus('updating', `Updating ${ticker} (${current}/${total})...`);
                });
            }
            
            // Fetch latest prices
            await DataManager.fetchLatestPrices();
            
            // Fetch risk-free rate
            await DataManager.fetchRiskFreeRate();
            
            // Update UI
            PortfolioWatcherUI.renderAssetsList();
            PortfolioWatcherUI.updateDataStatus('fresh', 'Data up to date');
            
        } catch (error) {
            console.error('Data initialization error:', error);
            PortfolioWatcherUI.updateDataStatus('stale', 'Data update failed');
            PortfolioWatcherUI.toast('Failed to update data: ' + error.message, 'error');
        }
    },
    
    // =========================================================================
    // Asset Management
    // =========================================================================
    
    /**
     * Add a new asset
     */
    async addAsset() {
        const { ticker, weight, targetShares, targetValue, mode } = PortfolioWatcherUI.getNewAssetInput();
        
        if (!ticker) {
            PortfolioWatcherUI.toast('Please enter a ticker symbol', 'error');
            return;
        }
        
        if (mode === 'shares') {
            if (targetShares <= 0) {
                PortfolioWatcherUI.toast('Please enter a valid target share count', 'error');
                return;
            }
        } else if (mode === 'value') {
            if (targetValue <= 0) {
                PortfolioWatcherUI.toast('Please enter a valid target value', 'error');
                return;
            }
        } else if (weight <= 0) {
            PortfolioWatcherUI.toast('Please enter a valid weight', 'error');
            return;
        }
        
        // Check if already exists
        if (PortfolioWatcherState.assets.find(a => a.ticker === ticker)) {
            PortfolioWatcherUI.toast(`${ticker} already added`, 'info');
            return;
        }
        
        // Add to state
        PortfolioWatcherState.addAsset(ticker, weight, 0, targetShares, targetValue);
        
        // Clear input
        PortfolioWatcherUI.clearNewAssetInput();
        
        // Render list
        PortfolioWatcherUI.renderAssetsList();
        
        // Load data for new ticker
        PortfolioWatcherUI.showLoading(`Loading data for ${ticker}...`);
        
        try {
            await API.loadData(ticker, null, null, 'yfinance');
            await DataManager.fetchLatestPrices();
            PortfolioWatcherUI.renderAssetsList();
            PortfolioWatcherUI.syncLeverageForShareMode();
            PortfolioWatcherUI.toast(`${ticker} added successfully`, 'success');
        } catch (error) {
            PortfolioWatcherUI.toast(`Failed to load data for ${ticker}: ${error.message}`, 'error');
        } finally {
            PortfolioWatcherUI.hideLoading();
        }
    },
    
    /**
     * Remove an asset
     * @param {string} ticker - Ticker symbol
     */
    removeAsset(ticker) {
        PortfolioWatcherState.removeAsset(ticker);
        PortfolioWatcherUI.renderAssetsList();
        PortfolioWatcherUI.syncLeverageForShareMode();
        PortfolioWatcherUI.toast(`${ticker} removed`, 'info');
    },
    
    /**
     * Handle weight change from input
     * @param {string} ticker - Ticker symbol
     * @param {string} value - New weight value (as percentage)
     */
    onWeightChange(ticker, value) {
        const weight = parseFloat(value) / 100;
        PortfolioWatcherState.updateWeight(ticker, weight);
        PortfolioWatcherUI.updateTotalWeight();
    },

    /**
     * Handle target shares change from input
     * @param {string} ticker - Ticker symbol
     * @param {string} value - New target shares value
     */
    onTargetSharesChange(ticker, value) {
        const shares = parseInt(value, 10) || 0;
        PortfolioWatcherState.updateTargetShares(ticker, shares);
        PortfolioWatcherUI.renderAssetsList();
        PortfolioWatcherUI.syncLeverageForShareMode();
    },

    /**
     * Handle target value change from input
     * @param {string} ticker - Ticker symbol
     * @param {string} value - New target value
     */
    onTargetValueChange(ticker, value) {
        const targetValue = parseFloat(value) || 0;
        PortfolioWatcherState.updateTargetValue(ticker, targetValue);
        PortfolioWatcherUI.renderAssetsList();
        PortfolioWatcherUI.syncLeverageForShareMode();
    },
    
    /**
     * Handle holding change from input
     * @param {string} ticker - Ticker symbol
     * @param {string} value - New shares value
     */
    onHoldingChange(ticker, value) {
        const shares = parseInt(value) || 0;
        PortfolioWatcherState.updateCurrentShares(ticker, shares);
    },
    
    /**
     * Import assets from the backtest viewer
     */
    async importFromViewer() {
        const success = PortfolioWatcherState.importFromViewer();
        
        if (success) {
            PortfolioWatcherUI.renderAssetsList();
            PortfolioWatcherUI.toast('Imported assets from Backtest viewer', 'success');
            
            // Initialize data for imported tickers
            await this.initializeData();
        } else {
            PortfolioWatcherUI.toast('No assets found in Backtest viewer', 'info');
        }
    },
    
    /**
     * Toggle collapsible section
     * @param {string} sectionId - Section element ID
     */
    toggleSection(sectionId) {
        PortfolioWatcherUI.toggleSection(sectionId);
    },
    
    // =========================================================================
    // Calculation
    // =========================================================================
    
    /**
     * Run all calculations
     */
    async calculate() {
        const tickers = PortfolioWatcherState.getTickers();
        
        if (tickers.length === 0) {
            PortfolioWatcherUI.toast('Add assets before calculating', 'error');
            return;
        }
        
        PortfolioWatcherUI.showLoading('Calculating positions...');
        PortfolioWatcherUI.updateStatus('Calculating...');
        
        try {
            // Update config from UI
            PortfolioWatcherState.setTargetCash(PortfolioWatcherUI.getTargetCash());
            PortfolioWatcherState.setLookbackWindow(PortfolioWatcherUI.getLookbackWindow());
            if (PortfolioWatcherUI.getAllocationMode() === 'weight') {
                PortfolioWatcherState.setLeverageRate(PortfolioWatcherUI.getLeverageRate());
            }
            
            // Ensure we have latest prices
            if (Object.keys(PortfolioWatcherState.prices).length === 0) {
                await DataManager.fetchLatestPrices();
            }

            let positionOptions = {};
            if (PortfolioWatcherUI.getAllocationMode() !== 'weight') {
                const shareMode = PortfolioWatcherState.getShareModePortfolio();
                if (shareMode.totalTargetValue <= 0) {
                    const message = PortfolioWatcherUI.getAllocationMode() === 'value'
                        ? 'Enter target values greater than 0 for at least one asset'
                        : 'Enter target shares greater than 0 for at least one asset';
                    PortfolioWatcherUI.toast(message, 'error');
                    return;
                }
                Object.entries(shareMode.weights).forEach(([ticker, weight]) => {
                    PortfolioWatcherState.updateWeight(ticker, weight);
                });
                PortfolioWatcherState.setLeverageRate(shareMode.leverageRate);
                PortfolioWatcherUI.syncLeverageForShareMode();
                positionOptions = {
                    weights: shareMode.weights,
                    leverageRate: shareMode.leverageRate,
                    effectiveBuyingPower: shareMode.totalTargetValue,
                    explicitTargetShares: shareMode.explicitTargetShares,
                };
            } else {
                // Check total weight for weight mode
                const totalWeight = PortfolioWatcherState.getTotalWeight();
                if (Math.abs(totalWeight - 1) > 0.01) {
                    PortfolioWatcherUI.toast('Weights should sum to 100%', 'error');
                    return;
                }
            }
            
            // Calculate positions
            PortfolioWatcherUI.showLoading('Calculating positions...');
            const { positions, orders } = PositionSizer.calculate(positionOptions);
            
            // Render position results
            PortfolioWatcherUI.renderPositionSummary(positions);
            // Calculate risk metrics
            PortfolioWatcherUI.showLoading('Analyzing risk...');
            const riskMetrics = await RiskAnalysis.analyze();
            
            // Render risk metrics
            PortfolioWatcherUI.renderRiskMetrics(riskMetrics);
            
            // Calculate and render projection
            PortfolioWatcherUI.showLoading('Generating projection...');
            const projection = Projection.run();
            
            // Render projection summary
            PortfolioWatcherUI.renderProjectionSummary(projection);
            
            // Update status
            PortfolioWatcherUI.updateLastCalculated();
            PortfolioWatcherUI.updateStatus('Calculation complete');
            PortfolioWatcherUI.toast('Calculation complete', 'success');
            
        } catch (error) {
            console.error('Calculation error:', error);
            PortfolioWatcherUI.toast('Calculation failed: ' + error.message, 'error');
            PortfolioWatcherUI.updateStatus('Calculation failed');
        } finally {
            PortfolioWatcherUI.hideLoading();
        }
    },
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    PortfolioWatcher.init();
});

// Export for global access
window.PortfolioWatcher = PortfolioWatcher;
