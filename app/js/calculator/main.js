/**
 * Portfolio Calculator - Main Application
 * Orchestrates all calculator modules
 */

const Calculator = {
    // =========================================================================
    // Initialization
    // =========================================================================
    
    /**
     * Initialize the calculator application
     */
    async init() {
        console.log('Initializing Portfolio Calculator...');
        
        // Load saved state
        CalculatorState.loadFromStorage();
        
        // Initialize UI
        CalculatorUI.init();
        
        // Bind event listeners
        this.bindEvents();
        
        // Check and update data
        await this.initializeData();
        
        console.log('Portfolio Calculator initialized');
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
            CalculatorState.setTargetCash(parseFloat(e.target.value) || 100000);
            CalculatorUI.syncLeverageForShareMode();
        });
        
        document.getElementById('lookbackWindow')?.addEventListener('change', (e) => {
            CalculatorState.setLookbackWindow(parseInt(e.target.value) || 252);
        });
        
        document.getElementById('leverageRate')?.addEventListener('change', (e) => {
            if (CalculatorUI.getAllocationMode() === 'weight') {
                CalculatorState.setLeverageRate(parseFloat(e.target.value) || 1);
            } else {
                CalculatorUI.syncLeverageForShareMode();
            }
        });

        document.getElementById('allocationMode')?.addEventListener('change', (e) => {
            const mode = ['shares', 'value'].includes(e.target.value) ? e.target.value : 'weight';
            CalculatorState.setAllocationMode(mode);
            CalculatorUI.renderAssetsList();
            CalculatorUI.syncAllocationModeUI();
        });
        
        // Calculate button
        document.getElementById('calculateBtn')?.addEventListener('click', () => this.calculate());
    },
    
    /**
     * Initialize data - check freshness and update if needed
     */
    async initializeData() {
        const tickers = CalculatorState.getTickers();
        
        if (tickers.length === 0) {
            CalculatorUI.updateDataStatus('fresh', 'No assets configured');
            return;
        }
        
        CalculatorUI.updateDataStatus('updating', 'Checking data freshness...');
        
        try {
            // Check freshness
            await DataManager.checkAllFreshness();
            
            // Update if stale
            if (!CalculatorState.dataStatus.isFresh) {
                CalculatorUI.updateDataStatus('updating', 'Updating stale data...');
                
                await DataManager.updateStaleData((ticker, current, total) => {
                    CalculatorUI.updateDataStatus('updating', `Updating ${ticker} (${current}/${total})...`);
                });
            }
            
            // Fetch latest prices
            await DataManager.fetchLatestPrices();
            
            // Fetch risk-free rate
            await DataManager.fetchRiskFreeRate();
            
            // Update UI
            CalculatorUI.renderAssetsList();
            CalculatorUI.updateDataStatus('fresh', 'Data up to date');
            
        } catch (error) {
            console.error('Data initialization error:', error);
            CalculatorUI.updateDataStatus('stale', 'Data update failed');
            CalculatorUI.toast('Failed to update data: ' + error.message, 'error');
        }
    },
    
    // =========================================================================
    // Asset Management
    // =========================================================================
    
    /**
     * Add a new asset
     */
    async addAsset() {
        const { ticker, weight, targetShares, targetValue, mode } = CalculatorUI.getNewAssetInput();
        
        if (!ticker) {
            CalculatorUI.toast('Please enter a ticker symbol', 'error');
            return;
        }
        
        if (mode === 'shares') {
            if (targetShares <= 0) {
                CalculatorUI.toast('Please enter a valid target share count', 'error');
                return;
            }
        } else if (mode === 'value') {
            if (targetValue <= 0) {
                CalculatorUI.toast('Please enter a valid target value', 'error');
                return;
            }
        } else if (weight <= 0) {
            CalculatorUI.toast('Please enter a valid weight', 'error');
            return;
        }
        
        // Check if already exists
        if (CalculatorState.assets.find(a => a.ticker === ticker)) {
            CalculatorUI.toast(`${ticker} already added`, 'info');
            return;
        }
        
        // Add to state
        CalculatorState.addAsset(ticker, weight, 0, targetShares, targetValue);
        
        // Clear input
        CalculatorUI.clearNewAssetInput();
        
        // Render list
        CalculatorUI.renderAssetsList();
        
        // Load data for new ticker
        CalculatorUI.showLoading(`Loading data for ${ticker}...`);
        
        try {
            await API.loadData(ticker, null, null, 'yfinance');
            await DataManager.fetchLatestPrices();
            CalculatorUI.renderAssetsList();
            CalculatorUI.syncLeverageForShareMode();
            CalculatorUI.toast(`${ticker} added successfully`, 'success');
        } catch (error) {
            CalculatorUI.toast(`Failed to load data for ${ticker}: ${error.message}`, 'error');
        } finally {
            CalculatorUI.hideLoading();
        }
    },
    
    /**
     * Remove an asset
     * @param {string} ticker - Ticker symbol
     */
    removeAsset(ticker) {
        CalculatorState.removeAsset(ticker);
        CalculatorUI.renderAssetsList();
        CalculatorUI.syncLeverageForShareMode();
        CalculatorUI.toast(`${ticker} removed`, 'info');
    },
    
    /**
     * Handle weight change from input
     * @param {string} ticker - Ticker symbol
     * @param {string} value - New weight value (as percentage)
     */
    onWeightChange(ticker, value) {
        const weight = parseFloat(value) / 100;
        CalculatorState.updateWeight(ticker, weight);
        CalculatorUI.updateTotalWeight();
    },

    /**
     * Handle target shares change from input
     * @param {string} ticker - Ticker symbol
     * @param {string} value - New target shares value
     */
    onTargetSharesChange(ticker, value) {
        const shares = parseInt(value, 10) || 0;
        CalculatorState.updateTargetShares(ticker, shares);
        CalculatorUI.renderAssetsList();
        CalculatorUI.syncLeverageForShareMode();
    },

    /**
     * Handle target value change from input
     * @param {string} ticker - Ticker symbol
     * @param {string} value - New target value
     */
    onTargetValueChange(ticker, value) {
        const targetValue = parseFloat(value) || 0;
        CalculatorState.updateTargetValue(ticker, targetValue);
        CalculatorUI.renderAssetsList();
        CalculatorUI.syncLeverageForShareMode();
    },
    
    /**
     * Handle holding change from input
     * @param {string} ticker - Ticker symbol
     * @param {string} value - New shares value
     */
    onHoldingChange(ticker, value) {
        const shares = parseInt(value) || 0;
        CalculatorState.updateCurrentShares(ticker, shares);
    },
    
    /**
     * Import assets from the backtest viewer
     */
    async importFromViewer() {
        const success = CalculatorState.importFromViewer();
        
        if (success) {
            CalculatorUI.renderAssetsList();
            CalculatorUI.toast('Imported assets from Backtest viewer', 'success');
            
            // Initialize data for imported tickers
            await this.initializeData();
        } else {
            CalculatorUI.toast('No assets found in Backtest viewer', 'info');
        }
    },
    
    /**
     * Toggle collapsible section
     * @param {string} sectionId - Section element ID
     */
    toggleSection(sectionId) {
        CalculatorUI.toggleSection(sectionId);
    },
    
    // =========================================================================
    // Calculation
    // =========================================================================
    
    /**
     * Run all calculations
     */
    async calculate() {
        const tickers = CalculatorState.getTickers();
        
        if (tickers.length === 0) {
            CalculatorUI.toast('Add assets before calculating', 'error');
            return;
        }
        
        CalculatorUI.showLoading('Calculating positions...');
        CalculatorUI.updateStatus('Calculating...');
        
        try {
            // Update config from UI
            CalculatorState.setTargetCash(CalculatorUI.getTargetCash());
            CalculatorState.setLookbackWindow(CalculatorUI.getLookbackWindow());
            if (CalculatorUI.getAllocationMode() === 'weight') {
                CalculatorState.setLeverageRate(CalculatorUI.getLeverageRate());
            }
            
            // Ensure we have latest prices
            if (Object.keys(CalculatorState.prices).length === 0) {
                await DataManager.fetchLatestPrices();
            }

            let positionOptions = {};
            if (CalculatorUI.getAllocationMode() !== 'weight') {
                const shareMode = CalculatorState.getShareModePortfolio();
                if (shareMode.totalTargetValue <= 0) {
                    const message = CalculatorUI.getAllocationMode() === 'value'
                        ? 'Enter target values greater than 0 for at least one asset'
                        : 'Enter target shares greater than 0 for at least one asset';
                    CalculatorUI.toast(message, 'error');
                    return;
                }
                Object.entries(shareMode.weights).forEach(([ticker, weight]) => {
                    CalculatorState.updateWeight(ticker, weight);
                });
                CalculatorState.setLeverageRate(shareMode.leverageRate);
                CalculatorUI.syncLeverageForShareMode();
                positionOptions = {
                    weights: shareMode.weights,
                    leverageRate: shareMode.leverageRate,
                    effectiveBuyingPower: shareMode.totalTargetValue,
                    explicitTargetShares: shareMode.explicitTargetShares,
                };
            } else {
                // Check total weight for weight mode
                const totalWeight = CalculatorState.getTotalWeight();
                if (Math.abs(totalWeight - 1) > 0.01) {
                    CalculatorUI.toast('Weights should sum to 100%', 'error');
                    return;
                }
            }
            
            // Calculate positions
            CalculatorUI.showLoading('Calculating positions...');
            const { positions, orders } = PositionCalculator.calculate(positionOptions);
            
            // Render position results
            CalculatorUI.renderPositionSummary(positions);
            // Calculate risk metrics
            CalculatorUI.showLoading('Analyzing risk...');
            const riskMetrics = await RiskAnalysis.analyze();
            
            // Render risk metrics
            CalculatorUI.renderRiskMetrics(riskMetrics);
            
            // Calculate and render projection
            CalculatorUI.showLoading('Generating projection...');
            const projection = Projection.run();
            
            // Render projection summary
            CalculatorUI.renderProjectionSummary(projection);
            
            // Update status
            CalculatorUI.updateLastCalculated();
            CalculatorUI.updateStatus('Calculation complete');
            CalculatorUI.toast('Calculation complete', 'success');
            
        } catch (error) {
            console.error('Calculation error:', error);
            CalculatorUI.toast('Calculation failed: ' + error.message, 'error');
            CalculatorUI.updateStatus('Calculation failed');
        } finally {
            CalculatorUI.hideLoading();
        }
    },
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    Calculator.init();
});

// Export for global access
window.Calculator = Calculator;
