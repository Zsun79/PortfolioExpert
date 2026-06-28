/**
 * Main application logic for Portfolio Viewer
 */

const App = {
    // Application state
    state: {
        selectedTickers: [],
        weights: {},
        margin: 1.0,             // Margin/leverage ratio (1.0 = no leverage)
        dateRange: { start: null, end: null },
        subPeriods: [],
        backtestResult: null,
        isLoading: false,
        // Macro indicator data from FRED
        fedRateData: [],         // Fed Funds Rate data
        unemploymentData: [],    // Unemployment Rate data
        cpiYoyData: [],          // CPI Year-over-Year data
        // Toggle states for macro indicators
        showFedRate: true,
        showUnemployment: false,
        showCpi: false,
    },
    
    // Date picker instances
    datePickers: {
        start: null,
        end: null,
    },
    
    // LocalStorage key
    STORAGE_KEY: 'portfolioViewer_state',
    MONITOR_STORAGE_KEY: 'futuresMonitor_portfolio',
    PORTFOLIO_WATCHER_STORAGE_KEY: 'portfolioCalculator_state',
    
    /**
     * Initialize the application
     */
    async init() {
        console.log('Initializing Portfolio Viewer...');
        
        // Initialize chart
        Chart.init();
        
        // Set up date pickers
        this.initDatePickers();
        
        // Bind event listeners
        this.bindEvents();
        
        // Initialize drag-and-drop for subsections
        this.initDraggableSections();
        
        // Check API connectivity
        await this.checkApiConnection();
        
        // Load saved state from localStorage
        this.loadStateFromStorage();
        
        // If no saved state, set defaults
        if (!this.state.dateRange.start) {
            this.setDefaultDateRange();
        }
        
        // Render UI from loaded state
        this.renderTickers();
        this.renderWeights();
        this.updateBacktestButton();
        this.updateMarginInfo();  // Ensure margin info is always displayed
        
        // Load all macro indicator data (background, don't block init)
        this.loadMacroData();
        
        // Apply saved section order
        this.applySectionOrder();
        
        Utils.setStatus('Ready');
        console.log('Initialization complete');
    },
    
    /**
     * Save state to localStorage
     */
    saveStateToStorage() {
        try {
            const stateToSave = {
                selectedTickers: this.state.selectedTickers,
                weights: this.state.weights,
                margin: this.state.margin,
                dateRange: this.state.dateRange,
                subPeriods: this.state.subPeriods,
            };
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(stateToSave));
        } catch (e) {
            console.warn('Failed to save state to localStorage:', e);
        }
    },
    
    /**
     * Load state from localStorage
     */
    loadStateFromStorage() {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                this.state.selectedTickers = parsed.selectedTickers || [];
                this.state.weights = parsed.weights || {};
                this.state.margin = parsed.margin || 1.0;
                this.state.dateRange = parsed.dateRange || { start: null, end: null };
                this.state.subPeriods = parsed.subPeriods || [];
                
                // Update margin input
                const marginInput = document.getElementById('marginInput');
                if (marginInput) {
                    marginInput.value = this.state.margin;
                }
                this.updateMarginInfo();
                
                // Update date pickers
                if (this.state.dateRange.start) {
                    this.datePickers.start.setDate(this.state.dateRange.start);
                }
                if (this.state.dateRange.end) {
                    this.datePickers.end.setDate(this.state.dateRange.end);
                }
                
                console.log('Loaded saved state:', this.state.selectedTickers);
                Utils.toast(`Restored ${this.state.selectedTickers.length} tickers from last session`, 'info');
            }
        } catch (e) {
            console.warn('Failed to load state from localStorage:', e);
        }
    },
    
    /**
     * Clear saved state
     */
    clearSavedState() {
        localStorage.removeItem(this.STORAGE_KEY);
        Utils.toast('Saved state cleared', 'info');
    },
    
    /**
     * Initialize Flatpickr date pickers
     */
    initDatePickers() {
        const config = {
            dateFormat: 'Y-m-d',
            theme: 'dark',
            disableMobile: true,
        };
        
        this.datePickers.start = flatpickr('#startDate', {
            ...config,
            onChange: (dates, dateStr) => {
                this.state.dateRange.start = dateStr;
                this.updateBacktestButton();
                this.saveStateToStorage();
            },
        });
        
        this.datePickers.end = flatpickr('#endDate', {
            ...config,
            onChange: (dates, dateStr) => {
                this.state.dateRange.end = dateStr;
                this.updateBacktestButton();
                this.saveStateToStorage();
            },
        });
    },
    
    /**
     * Bind DOM event listeners
     */
    bindEvents() {
        // Ticker input
        const tickerInput = document.getElementById('tickerInput');
        const addTickerBtn = document.getElementById('addTickerBtn');
        
        addTickerBtn.addEventListener('click', () => this.addTicker());
        tickerInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addTicker();
        });
        
        // Data buttons
        document.getElementById('loadDataBtn').addEventListener('click', () => this.loadAllData());
        document.getElementById('updateAllBtn').addEventListener('click', () => this.updateAllData());
        document.getElementById('importPortfolioWatcherBtn')?.addEventListener('click', () => this.importFromPortfolioWatcher());
        
        // Backtest button
        document.getElementById('runBacktestBtn').addEventListener('click', () => this.runBacktest());
        
        // Chart buttons
        document.getElementById('toggleFedRateBtn').addEventListener('click', () => this.toggleMacroIndicator('fedRate'));
        document.getElementById('toggleUnemploymentBtn').addEventListener('click', () => this.toggleMacroIndicator('unemployment'));
        document.getElementById('toggleCpiBtn').addEventListener('click', () => this.toggleMacroIndicator('cpi'));
        document.getElementById('resetToFullRangeBtn').addEventListener('click', () => this.resetToFullRange());
        document.getElementById('exportChartBtn').addEventListener('click', () => Chart.exportImage());
        document.getElementById('resetZoomBtn').addEventListener('click', () => Chart.resetZoom());
        
        // Analyze range button (add selected range as sub-period)
        document.getElementById('analyzeRangeBtn')?.addEventListener('click', () => this.addSelectedRangeAsSubPeriod());
        
        // Sub-period selection mode
        document.getElementById('selectPeriodBtn').addEventListener('click', () => Chart.toggleSelectionMode());
        document.getElementById('cancelSelectionMode')?.addEventListener('click', () => Chart.deactivateSelectionMode());
        
        // Sub-period buttons
        document.getElementById('addSubPeriodBtn').addEventListener('click', () => this.addSubPeriod());
        document.getElementById('clearSubPeriodsBtn').addEventListener('click', () => this.clearAllSubPeriods());
        document.getElementById('updateWithSubPeriodsBtn').addEventListener('click', () => this.runSubperiodBacktest());
        
        // Auto-normalize toggle
        document.getElementById('autoNormalize').addEventListener('change', () => this.updateWeightsDisplay());
        
        // Strategy save/load buttons
        document.getElementById('saveStrategyBtn').addEventListener('click', () => this.openSaveModal());
        document.getElementById('loadStrategyBtn').addEventListener('click', () => this.openLoadModal());
    },
    
    /**
     * Check API connection status
     */
    async checkApiConnection() {
        const connected = await API.checkHealth();
        if (!connected) {
            Utils.toast('Cannot connect to backend. Start the server with: uvicorn main:app --reload', 'error');
        }
        return connected;
    },
    
    /**
     * Load cached tickers from backend
     */
    async loadCachedTickers() {
        try {
            const response = await API.getTickers();
            if (response.tickers && response.tickers.length > 0) {
                Utils.setStatus(`Found ${response.tickers.length} cached tickers`);
            }
        } catch (error) {
            console.log('No cached tickers found');
        }
    },
    
    /**
     * Set default date range (last 5 years)
     */
    setDefaultDateRange() {
        const end = Utils.today();
        const start = Utils.yearsAgo(5);
        
        this.state.dateRange = { start, end };
        this.datePickers.start.setDate(start);
        this.datePickers.end.setDate(end);
    },
    
    // =========================================================================
    // Ticker Management
    // =========================================================================
    
    /**
     * Add a ticker to the selection
     */
    addTicker() {
        const input = document.getElementById('tickerInput');
        const rawInput = input.value.trim();
        
        if (!rawInput) return;
        
        // Split by comma, trim whitespace, convert to uppercase, filter empty
        const tickers = rawInput
            .split(',')
            .map(t => t.trim().toUpperCase())
            .filter(t => t.length > 0);
        
        if (tickers.length === 0) return;
        
        const added = [];
        const skipped = [];
        
        for (const ticker of tickers) {
            if (this.state.selectedTickers.includes(ticker)) {
                skipped.push(ticker);
            } else {
                this.state.selectedTickers.push(ticker);
                this.state.weights[ticker] = 0;
                added.push(ticker);
            }
        }
        
        if (added.length > 0) {
            // Distribute weights equally
            this.equalizeWeights();
            
            input.value = '';
            this.renderTickers();
            this.renderWeights();
            this.updateBacktestButton();
            this.saveStateToStorage();
            
            Utils.toast(`Added: ${added.join(', ')}`, 'success');
        }
        
        if (skipped.length > 0) {
            Utils.toast(`Already added: ${skipped.join(', ')}`, 'info');
        }
    },

    /**
     * Import futures monitor portfolio using fixed shares and latest monitor prices
     */
    importFromMonitor() {
        try {
            const saved = localStorage.getItem(this.MONITOR_STORAGE_KEY);
            if (!saved) {
                Utils.toast('No monitor portfolio found', 'info');
                return;
            }

            const parsed = JSON.parse(saved);
            const contracts = (parsed.contracts || []).filter(contract => {
                return contract.ticker && Number.isFinite(contract.price) && contract.price > 0 &&
                    Number.isFinite(contract.shares) && contract.shares > 0;
            });

            if (contracts.length === 0) {
                Utils.toast('No monitor positions with shares and prices found', 'info');
                return;
            }

            const values = contracts.map(contract => ({
                ticker: contract.ticker,
                value: contract.shares * contract.price,
            }));
            const totalValue = values.reduce((sum, item) => sum + item.value, 0);

            if (!(totalValue > 0)) {
                Utils.toast('Monitor portfolio total value is zero', 'error');
                return;
            }

            this.state.selectedTickers = values.map(item => item.ticker);
            this.state.weights = values.reduce((acc, item) => {
                acc[item.ticker] = item.value / totalValue;
                return acc;
            }, {});

            this.renderTickers();
            this.renderWeights();
            this.updateBacktestButton();
            this.saveStateToStorage();

            Utils.toast(`Imported ${values.length} monitor positions by share`, 'success');
        } catch (error) {
            console.error('Failed to import monitor portfolio:', error);
            Utils.toast('Failed to import monitor portfolio', 'error');
        }
    },

    /**
     * Import portfolio using fixed shares and latest portfolio prices
     */
    importFromPortfolioWatcher() {
        try {
            const saved = localStorage.getItem(this.PORTFOLIO_WATCHER_STORAGE_KEY);
            if (!saved) {
                Utils.toast('No portfolio found', 'info');
                return;
            }

            const parsed = JSON.parse(saved);
            const assets = parsed.assets || [];
            const prices = parsed.prices || {};
            const positions = assets
                .map(asset => {
                    const shares = Math.max(
                        0,
                        Math.round(
                            (asset.targetShares || 0) > 0
                                ? asset.targetShares
                                : (asset.currentShares || 0)
                        )
                    );
                    const price = prices?.[asset.ticker]?.price;
                    return {
                        ticker: asset.ticker,
                        shares,
                        price,
                        value: Number.isFinite(price) && price > 0 ? shares * price : 0,
                    };
                })
                .filter(position => position.ticker && position.shares > 0 && position.value > 0);

            if (positions.length === 0) {
                Utils.toast('No portfolio positions with shares and prices found', 'info');
                return;
            }

            const totalValue = positions.reduce((sum, position) => sum + position.value, 0);
            if (!(totalValue > 0)) {
                Utils.toast('Portfolio total value is zero', 'error');
                return;
            }

            this.state.selectedTickers = positions.map(position => position.ticker);
            this.state.weights = positions.reduce((acc, position) => {
                acc[position.ticker] = position.value / totalValue;
                return acc;
            }, {});

            this.renderTickers();
            this.renderWeights();
            this.updateBacktestButton();
            this.saveStateToStorage();

            Utils.toast(`Imported ${positions.length} portfolio positions by share`, 'success');
        } catch (error) {
            console.error('Failed to import portfolio:', error);
            Utils.toast('Failed to import portfolio', 'error');
        }
    },
    
    /**
     * Remove a ticker from the selection
     * @param {string} ticker - Ticker to remove
     */
    removeTicker(ticker) {
        this.state.selectedTickers = this.state.selectedTickers.filter(t => t !== ticker);
        delete this.state.weights[ticker];
        
        // Redistribute weights
        if (this.state.selectedTickers.length > 0) {
            this.equalizeWeights();
        }
        
        this.renderTickers();
        this.renderWeights();
        this.updateBacktestButton();
        this.saveStateToStorage();
    },
    
    /**
     * Set equal weights for all tickers
     */
    equalizeWeights() {
        const n = this.state.selectedTickers.length;
        if (n === 0) return;
        
        const weight = 1 / n;
        this.state.selectedTickers.forEach(ticker => {
            this.state.weights[ticker] = weight;
        });
    },
    
    /**
     * Render ticker chips
     */
    renderTickers() {
        const container = document.getElementById('selectedTickers');
        
        if (this.state.selectedTickers.length === 0) {
            container.innerHTML = '<p class="empty-state">No tickers selected</p>';
            return;
        }
        
        container.innerHTML = this.state.selectedTickers.map(ticker => `
            <span class="ticker-chip">
                ${ticker}
                <button class="remove-btn" onclick="App.removeTicker('${ticker}')">&times;</button>
            </span>
        `).join('');
    },
    
    // =========================================================================
    // Weight Management
    // =========================================================================
    
    /**
     * Render weight inputs (slider + direct input)
     */
    renderWeights() {
        const container = document.getElementById('weightsContainer');
        
        if (this.state.selectedTickers.length === 0) {
            container.innerHTML = '<p class="empty-state">Add tickers to set weights</p>';
            this.updateWeightsTotal();
            return;
        }
        
        container.innerHTML = this.state.selectedTickers.map(ticker => `
            <div class="weight-row">
                <span class="ticker-label">${ticker}</span>
                <input 
                    type="range" 
                    id="weightSlider_${ticker}" 
                    class="weight-slider"
                    min="0" 
                    max="100" 
                    value="${Math.round(this.state.weights[ticker] * 100)}"
                    oninput="App.updateWeightFromSlider('${ticker}', this.value)"
                >
                <div class="weight-input-group">
                    <input 
                        type="number" 
                        id="weightInput_${ticker}" 
                        class="weight-input"
                        min="0" 
                        max="100" 
                        step="1"
                        value="${Math.round(this.state.weights[ticker] * 100)}"
                        onchange="App.updateWeightFromInput('${ticker}', this.value)"
                        onkeyup="App.updateWeightFromInput('${ticker}', this.value)"
                    >
                    <span class="weight-percent">%</span>
                </div>
            </div>
        `).join('');
        
        this.updateWeightsTotal();
    },
    
    /**
     * Update weight from slider
     * @param {string} ticker - Ticker symbol
     * @param {number} value - Weight value (0-100)
     */
    updateWeightFromSlider(ticker, value) {
        const numValue = parseInt(value) || 0;
        this.state.weights[ticker] = numValue / 100;
        
        // Sync the input field
        const inputEl = document.getElementById(`weightInput_${ticker}`);
        if (inputEl) {
            inputEl.value = numValue;
        }
        
        this.updateWeightsTotal();
        this.saveStateToStorage();
    },
    
    /**
     * Update weight from direct input
     * @param {string} ticker - Ticker symbol
     * @param {number} value - Weight value (0-100)
     */
    updateWeightFromInput(ticker, value) {
        let numValue = parseInt(value) || 0;
        numValue = Math.max(0, Math.min(100, numValue)); // Clamp 0-100
        
        this.state.weights[ticker] = numValue / 100;
        
        // Sync the slider
        const sliderEl = document.getElementById(`weightSlider_${ticker}`);
        if (sliderEl) {
            sliderEl.value = numValue;
        }
        
        this.updateWeightsTotal();
        this.saveStateToStorage();
    },
    
    /**
     * Update weight for a ticker (legacy support)
     * @param {string} ticker - Ticker symbol
     * @param {number} value - Weight value (0-100)
     */
    updateWeight(ticker, value) {
        this.updateWeightFromSlider(ticker, value);
    },
    
    /**
     * Update weights total display
     */
    updateWeightsTotal() {
        const total = Object.values(this.state.weights).reduce((sum, w) => sum + w, 0);
        const totalEl = document.getElementById('weightsTotal');
        
        if (totalEl) {
            const percentage = Math.round(total * 100);
            totalEl.textContent = `${percentage}%`;
            totalEl.className = `total-value ${Math.abs(total - 1) > 0.01 ? 'invalid' : ''}`;
        }
    },
    
    /**
     * Update weights display (for auto-normalize toggle)
     */
    updateWeightsDisplay() {
        const autoNormalize = document.getElementById('autoNormalize').checked;
        if (autoNormalize && this.state.selectedTickers.length > 0) {
            this.state.weights = Utils.normalizeWeights(this.state.weights);
            this.renderWeights();
        }
    },
    
    // =========================================================================
    // Data Loading
    // =========================================================================
    
    /**
     * Load data for all selected tickers
     */
    async loadAllData() {
        if (this.state.selectedTickers.length === 0) {
            Utils.toast('No tickers selected', 'info');
            return;
        }
        
        Utils.showLoading('Loading data...');
        
        try {
            let loaded = 0;
            for (const ticker of this.state.selectedTickers) {
                Utils.showLoading(`Loading ${ticker}...`);
                
                const result = await API.loadData(
                    ticker,
                    this.state.dateRange.start,
                    this.state.dateRange.end
                );
                
                if (result.status === 'success') {
                    loaded++;
                }
            }
            
            Utils.toast(`Loaded data for ${loaded} tickers`, 'success');
        } catch (error) {
            Utils.toast(`Error: ${error.message}`, 'error');
        } finally {
            Utils.hideLoading();
        }
    },
    
    /**
     * Update data for all selected tickers
     */
    async updateAllData() {
        if (this.state.selectedTickers.length === 0) {
            Utils.toast('No tickers selected', 'info');
            return;
        }
        
        Utils.showLoading('Updating data...');
        
        try {
            let updated = 0;
            for (const ticker of this.state.selectedTickers) {
                Utils.showLoading(`Updating ${ticker}...`);
                
                const result = await API.updateData(ticker);
                if (result.rows_added > 0) {
                    updated++;
                }
            }
            
            Utils.toast(`Updated ${updated} tickers`, 'success');
        } catch (error) {
            Utils.toast(`Error: ${error.message}`, 'error');
        } finally {
            Utils.hideLoading();
        }
    },
    
    // =========================================================================
    // Backtesting
    // =========================================================================
    
    /**
     * Update backtest button state
     */
    updateBacktestButton() {
        const btn = document.getElementById('runBacktestBtn');
        const canRun = this.state.selectedTickers.length > 0 &&
                       this.state.dateRange.start &&
                       this.state.dateRange.end;
        btn.disabled = !canRun;
    },
    
    /**
     * Run backtest with current configuration
     */
    async runBacktest() {
        if (this.state.selectedTickers.length === 0) {
            Utils.toast('No tickers selected', 'error');
            return;
        }
        
        // Normalize weights if needed
        const autoNormalize = document.getElementById('autoNormalize').checked;
        let weights = { ...this.state.weights };
        if (autoNormalize) {
            weights = Utils.normalizeWeights(weights);
        }
        
        Utils.showLoading('Running backtest...');
        
        try {
            console.log('Starting backtest with config:', {
                tickers: this.state.selectedTickers,
                weights: weights,
                start: this.state.dateRange.start,
                end: this.state.dateRange.end,
                margin: this.state.margin,
            });
            
            const result = await API.runBacktest({
                tickers: this.state.selectedTickers,
                weights: weights,
                start: this.state.dateRange.start,
                end: this.state.dateRange.end,
                margin: this.state.margin,
            });
            
            console.log('Backtest result received:', result);
            console.log('Equity curve length:', result?.equity_curve?.length);
            console.log('Metrics:', result?.metrics);
            
            if (!result || !result.equity_curve || result.equity_curve.length === 0) {
                throw new Error('Backtest returned empty results');
            }
            
            this.state.backtestResult = result;
            
            // Update chart with Fed rate overlay
            console.log('Updating chart...');
            this.updateChartWithFedRate();
            
            // Update metrics
            console.log('Displaying metrics...');
            this.displayMetrics(result.metrics);
            
            // Show sub-period section
            document.getElementById('subPeriodSection').style.display = 'block';
            
            // Show weight allocation (constant weights for regular backtest)
            console.log('Displaying weight allocation...');
            this.displayWeightAllocation([{
                date: this.state.dateRange.start,
                weights: weights,
            }]);
            
            // Show asset prices chart
            console.log('Displaying asset prices...');
            this.displayAssetPrices();
            
            Utils.toast('Backtest complete', 'success');
        } catch (error) {
            console.error('Backtest error:', error);
            Utils.toast(`Error: ${error.message}`, 'error');
        } finally {
            Utils.hideLoading();
        }
    },
    
    /**
     * Display performance metrics
     * @param {Object} metrics - Performance metrics
     */
    displayMetrics(metrics) {
        console.log('displayMetrics called with:', metrics);
        
        const container = document.getElementById('metricsContainer');
        if (!container) {
            console.error('Metrics container not found!');
            return;
        }
        
        container.style.display = 'block';
        console.log('Metrics container shown');
        
        try {
            document.getElementById('metricTotalReturn').textContent = 
                Utils.formatPercent(metrics.total_return);
            
            document.getElementById('metricCAGR').textContent = 
                Utils.formatPercent(metrics.cagr);
            
            document.getElementById('metricVolatility').textContent = 
                Utils.formatPercent(metrics.volatility);
            
            document.getElementById('metricSharpe').textContent = 
                Utils.formatNumber(metrics.sharpe_ratio);
            
            document.getElementById('metricMaxDD').textContent = 
                Utils.formatPercent(metrics.max_drawdown);
            
            document.getElementById('metricPeriod').textContent = 
                Utils.formatDateRange(metrics.start_date, metrics.end_date);
            
            console.log('All metrics populated');
        } catch (error) {
            console.error('Error populating metrics:', error);
        }
        
        // Calculate and display drawdown periods
        if (this.state.backtestResult && this.state.backtestResult.equity_curve) {
            this.displayDrawdownPeriods(this.state.backtestResult.equity_curve);
        }
    },
    
    /**
     * Calculate and display top drawdown periods
     * @param {Array} equityCurve - Equity curve data [{date, value}, ...]
     */
    displayDrawdownPeriods(equityCurve) {
        const drawdownList = document.getElementById('drawdownList');
        if (!drawdownList || !equityCurve || equityCurve.length < 2) {
            return;
        }
        
        // Calculate drawdowns
        const drawdowns = this.calculateDrawdowns(equityCurve);
        
        // Get top 5 drawdowns
        const topDrawdowns = drawdowns
            .sort((a, b) => a.drawdown - b.drawdown) // Most negative first
            .slice(0, 5);
        
        if (topDrawdowns.length === 0) {
            drawdownList.innerHTML = '<p class="empty-state">No significant drawdowns</p>';
            return;
        }
        
        drawdownList.innerHTML = topDrawdowns.map((dd, index) => `
            <div class="drawdown-item ${index === 0 ? 'worst' : ''}">
                <div class="drawdown-rank">#${index + 1}</div>
                <div class="drawdown-details">
                    <div class="drawdown-value">${Utils.formatPercent(dd.drawdown)}</div>
                    <div class="drawdown-dates">
                        <span class="drawdown-label">Peak:</span> ${dd.peakDate}
                        <span class="drawdown-arrow">→</span>
                        <span class="drawdown-label">Trough:</span> ${dd.troughDate}
                    </div>
                    <div class="drawdown-duration">
                        Duration: ${dd.duration} days
                        ${dd.recoveryDate ? ` • Recovered: ${dd.recoveryDate}` : ' • Not recovered'}
                    </div>
                </div>
            </div>
        `).join('');
    },
    
    /**
     * Calculate drawdown periods from equity curve
     * @param {Array} equityCurve - Equity curve data
     * @returns {Array} Array of drawdown objects
     */
    calculateDrawdowns(equityCurve) {
        const drawdowns = [];
        let peak = equityCurve[0].value;
        let peakDate = equityCurve[0].date;
        let inDrawdown = false;
        let currentDrawdown = null;
        
        for (let i = 1; i < equityCurve.length; i++) {
            const point = equityCurve[i];
            const value = point.value;
            const date = point.date;
            
            if (value > peak) {
                // New peak - close any open drawdown
                if (inDrawdown && currentDrawdown) {
                    currentDrawdown.recoveryDate = date;
                    drawdowns.push(currentDrawdown);
                    currentDrawdown = null;
                    inDrawdown = false;
                }
                peak = value;
                peakDate = date;
            } else {
                const dd = (value - peak) / peak;
                
                if (!inDrawdown && dd < -0.01) { // Start drawdown if > 1%
                    inDrawdown = true;
                    currentDrawdown = {
                        peakDate: peakDate,
                        peakValue: peak,
                        troughDate: date,
                        troughValue: value,
                        drawdown: dd,
                        duration: 0,
                        recoveryDate: null,
                    };
                } else if (inDrawdown) {
                    // Update trough if this is lower
                    if (dd < currentDrawdown.drawdown) {
                        currentDrawdown.troughDate = date;
                        currentDrawdown.troughValue = value;
                        currentDrawdown.drawdown = dd;
                    }
                }
            }
        }
        
        // Add any open drawdown
        if (inDrawdown && currentDrawdown) {
            drawdowns.push(currentDrawdown);
        }
        
        // Calculate durations
        drawdowns.forEach(dd => {
            const peakTime = new Date(dd.peakDate).getTime();
            const troughTime = new Date(dd.troughDate).getTime();
            dd.duration = Math.round((troughTime - peakTime) / (1000 * 60 * 60 * 24));
        });
        
        return drawdowns;
    },
    
    // =========================================================================
    // Sub-Period Management
    // =========================================================================
    
    /**
     * Handle chart range selection
     * @param {string} start - Start date
     * @param {string} end - End date
     */
    onChartRangeSelect(start, end) {
        // Prevent recursive updates - use longer timeout for async relayout events
        if (this._isSyncing) return;
        this._isSyncing = true;
        
        // Store selected range for analysis
        this._selectedRange = { start, end };
        
        const rangeInfo = document.getElementById('chartRangeInfo');
        const selectedRange = document.getElementById('selectedRange');
        
        if (rangeInfo) rangeInfo.style.display = 'flex';
        if (selectedRange) selectedRange.textContent = `${start} to ${end}`;
        
        // DON'T call highlightPeriod here - it causes relayout loops
        // The selection highlight is already visible from Plotly's zoom
        
        // Sync sub-charts to the same range (don't await, just fire and forget)
        this.syncChartRanges(start, end);
        
        // Calculate and display metrics for selected period
        this.analyzeSelectedRange(start, end);
        
        // Keep syncing flag set longer to catch async events
        setTimeout(() => {
            this._isSyncing = false;
        }, 200);
    },
    
    /**
     * Analyze the selected range and display metrics
     * @param {string} start - Start date
     * @param {string} end - End date
     */
    analyzeSelectedRange(start, end) {
        try {
            if (!this.state.backtestResult || !this.state.backtestResult.equity_curve) {
                return;
            }
            
            const equityCurve = this.state.backtestResult.equity_curve;
            
            // Filter equity curve to selected range
            const filteredCurve = equityCurve.filter(d => d.date >= start && d.date <= end);
            
            if (filteredCurve.length < 2) {
                console.warn('Not enough data points in selected range');
                return;
            }
            
            // Calculate metrics for the selected period
            const startValue = filteredCurve[0].value;
            const endValue = filteredCurve[filteredCurve.length - 1].value;
            
            if (!startValue || !endValue || startValue === 0) {
                console.warn('Invalid values in selected range');
                return;
            }
            
            const totalReturn = (endValue / startValue - 1) * 100;
            
            // Calculate daily returns for volatility
            const dailyReturns = [];
            for (let i = 1; i < filteredCurve.length; i++) {
                const prevVal = filteredCurve[i-1].value;
                if (prevVal && prevVal !== 0) {
                    dailyReturns.push(filteredCurve[i].value / prevVal - 1);
                }
            }
            
            if (dailyReturns.length === 0) {
                return;
            }
            
            // Annualized volatility
            const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
            const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / dailyReturns.length;
            const dailyVol = Math.sqrt(variance);
            const annualizedVol = dailyVol * Math.sqrt(252) * 100;
            
            // CAGR
            const days = filteredCurve.length;
            const years = days / 252;
            const cagr = years > 0 ? (Math.pow(endValue / startValue, 1 / years) - 1) * 100 : 0;
            
            // Sharpe ratio (assuming 2% risk-free rate)
            const riskFreeRate = 2;
            const sharpe = annualizedVol > 0 ? (cagr - riskFreeRate) / annualizedVol : 0;
            
            // Update the range info display with metrics
            const selectedRange = document.getElementById('selectedRange');
            if (selectedRange) {
                selectedRange.innerHTML = `
                    <strong>${start} to ${end}</strong>
                    <span class="range-metrics">
                        Return: <span class="${totalReturn >= 0 ? 'positive' : 'negative'}">${totalReturn.toFixed(2)}%</span> |
                        CAGR: <span class="${cagr >= 0 ? 'positive' : 'negative'}">${cagr.toFixed(2)}%</span> |
                        Vol: ${annualizedVol.toFixed(2)}% |
                        Sharpe: ${sharpe.toFixed(2)}
                    </span>
                `;
            }
        } catch (error) {
            console.error('Error analyzing selected range:', error);
        }
    },
    
    /**
     * Add the currently selected range as a sub-period
     */
    addSelectedRangeAsSubPeriod() {
        if (this._selectedRange && this._selectedRange.start && this._selectedRange.end) {
            this.addSubPeriod(this._selectedRange.start, this._selectedRange.end);
            Utils.toast(`Sub-period added: ${this._selectedRange.start} to ${this._selectedRange.end}`, 'success');
        } else {
            Utils.toast('No range selected. Zoom on the chart first.', 'warning');
        }
    },
    
    /**
     * Add a new sub-period
     */
    addSubPeriod(startDate = null, endDate = null) {
        const id = Utils.generateId();
        const period = {
            id,
            start: startDate || this.state.dateRange.start,
            end: endDate || this.state.dateRange.end,
            weights: { ...this.state.weights },
            enabled: true,  // New: toggle to enable/disable this sub-period
        };
        
        this.state.subPeriods.push(period);
        this.renderSubPeriods();
        this.saveStateToStorage();
        
        // Show sub-period section
        document.getElementById('subPeriodSection').style.display = 'block';
    },
    
    /**
     * Close the sub-period confirmation modal
     */
    closeSubPeriodModal() {
        const modal = document.getElementById('subPeriodConfirmModal');
        if (modal) modal.style.display = 'none';
    },
    
    /**
     * Confirm adding the selected sub-period
     */
    confirmAddSubPeriod() {
        const startDate = Chart.selectionMode.confirmedStart;
        const endDate = Chart.selectionMode.confirmedEnd;
        
        if (startDate && endDate) {
            this.addSubPeriod(startDate, endDate);
            Utils.toast(`Sub-period added: ${startDate} to ${endDate}`, 'success');
        }
        
        this.closeSubPeriodModal();
    },
    
    /**
     * Remove a sub-period
     * @param {string} id - Period ID
     */
    removeSubPeriod(id) {
        this.state.subPeriods = this.state.subPeriods.filter(p => p.id !== id);
        this.renderSubPeriods();
        this.saveStateToStorage();
    },
    
    /**
     * Clear all sub-periods
     */
    clearAllSubPeriods() {
        this.state.subPeriods = [];
        this.renderSubPeriods();
        this.saveStateToStorage();
        Utils.toast('All sub-periods cleared', 'info');
    },
    
    /**
     * Render sub-period cards
     */
    renderSubPeriods() {
        const container = document.getElementById('subPeriodsContainer');
        
        if (this.state.subPeriods.length === 0) {
            container.innerHTML = '<p class="empty-state">No sub-periods defined</p>';
            return;
        }
        
        container.innerHTML = this.state.subPeriods.map((period, index) => `
            <div class="sub-period-card ${period.enabled !== false ? '' : 'disabled'}" data-id="${period.id}">
                <div class="sub-period-header">
                    <label class="sub-period-toggle">
                        <input type="checkbox" ${period.enabled !== false ? 'checked' : ''} 
                               onchange="App.toggleSubPeriod('${period.id}')">
                        <span>Period ${index + 1}</span>
                    </label>
                    <button class="icon-btn" onclick="App.removeSubPeriod('${period.id}')">&times;</button>
                </div>
                <div class="sub-period-dates">
                    <input type="text" class="sub-period-start" value="${period.start}" 
                           onchange="App.updateSubPeriodDate('${period.id}', 'start', this.value)"
                           ${period.enabled !== false ? '' : 'disabled'}>
                    <input type="text" class="sub-period-end" value="${period.end}"
                           onchange="App.updateSubPeriodDate('${period.id}', 'end', this.value)"
                           ${period.enabled !== false ? '' : 'disabled'}>
                </div>
                <div class="sub-period-weights">
                    ${this.state.selectedTickers.map(ticker => `
                        <div class="sub-period-weight">
                            <span>${ticker}:</span>
                            <input type="number" min="0" max="100" 
                                   value="${Math.round((period.weights[ticker] || 0) * 100)}"
                                   onchange="App.updateSubPeriodWeight('${period.id}', '${ticker}', this.value)"
                                   ${period.enabled !== false ? '' : 'disabled'}>%
                        </div>
                    `).join('')}
                </div>
                <div class="sub-period-margin">
                    <span>Margin:</span>
                    <input type="number" min="0.1" max="10" step="0.1"
                           value="${period.margin !== undefined ? period.margin : ''}"
                           placeholder="${this.state.margin}"
                           onchange="App.updateSubPeriodMargin('${period.id}', this.value)"
                           ${period.enabled !== false ? '' : 'disabled'}>
                    <span>x (blank = use global)</span>
                </div>
            </div>
        `).join('');
        
        // Initialize date pickers for sub-periods
        this.state.subPeriods.forEach(period => {
            const card = container.querySelector(`[data-id="${period.id}"]`);
            if (card) {
                flatpickr(card.querySelector('.sub-period-start'), {
                    dateFormat: 'Y-m-d',
                    defaultDate: period.start,
                    onChange: (dates, dateStr) => this.updateSubPeriodDate(period.id, 'start', dateStr),
                });
                flatpickr(card.querySelector('.sub-period-end'), {
                    dateFormat: 'Y-m-d',
                    defaultDate: period.end,
                    onChange: (dates, dateStr) => this.updateSubPeriodDate(period.id, 'end', dateStr),
                });
            }
        });
    },
    
    /**
     * Update sub-period date
     * @param {string} id - Period ID
     * @param {string} field - 'start' or 'end'
     * @param {string} value - Date value
     */
    updateSubPeriodDate(id, field, value) {
        const period = this.state.subPeriods.find(p => p.id === id);
        if (period) {
            period[field] = value;
        }
    },
    
    /**
     * Update sub-period weight
     * @param {string} id - Period ID
     * @param {string} ticker - Ticker symbol
     * @param {number} value - Weight value (0-100)
     */
    updateSubPeriodWeight(id, ticker, value) {
        const period = this.state.subPeriods.find(p => p.id === id);
        if (period) {
            period.weights[ticker] = parseInt(value) / 100;
        }
    },
    
    /**
     * Toggle sub-period enabled/disabled
     * @param {string} id - Period ID
     */
    toggleSubPeriod(id) {
        const period = this.state.subPeriods.find(p => p.id === id);
        if (period) {
            period.enabled = !period.enabled;
            this.renderSubPeriods();
            this.saveStateToStorage();
        }
    },
    
    /**
     * Update global margin value
     * @param {number|string} value - Margin value
     */
    updateMargin(value) {
        const margin = parseFloat(value) || 1.0;
        this.state.margin = Math.max(0.1, Math.min(10, margin));
        
        // Update the input in case we clamped the value
        document.getElementById('marginInput').value = this.state.margin;
        
        // Update info text
        this.updateMarginInfo();
        
        this.saveStateToStorage();
    },
    
    /**
     * Update margin info display
     */
    updateMarginInfo() {
        const info = document.getElementById('marginInfo');
        if (!info) return;
        
        const margin = this.state.margin;
        
        if (margin === 1.0) {
            info.textContent = 'No leverage';
            info.className = 'margin-info';
        } else if (margin > 1.0) {
            const borrowed = ((margin - 1) * 100).toFixed(0);
            info.textContent = `${margin}x leverage: borrowing ${borrowed}% at Fed rate + 1%`;
            info.className = 'margin-info warning';
        } else {
            const cash = ((1 - margin) * 100).toFixed(0);
            info.textContent = `${margin}x: ${cash}% held as cash`;
            info.className = 'margin-info';
        }
    },
    
    /**
     * Update sub-period margin
     * @param {string} id - Period ID
     * @param {number|string} value - Margin value
     */
    updateSubPeriodMargin(id, value) {
        const period = this.state.subPeriods.find(p => p.id === id);
        if (period) {
            period.margin = parseFloat(value) || undefined;
        }
    },
    
    /**
     * Run backtest with sub-periods
     */
    async runSubperiodBacktest() {
        // Filter to only enabled sub-periods
        const enabledPeriods = this.state.subPeriods.filter(p => p.enabled !== false);
        
        if (enabledPeriods.length === 0) {
            // No enabled sub-periods, run regular backtest
            Utils.toast('No enabled sub-periods. Running standard backtest.', 'info');
            return this.runBacktest();
        }
        
        Utils.showLoading('Running sub-period backtest...');
        
        try {
            // Normalize global weights
            const globalWeights = Utils.normalizeWeights(this.state.weights);
            
            // Normalize weights for each enabled sub-period and include margin
            const periods = enabledPeriods.map(p => ({
                start: p.start,
                end: p.end,
                weights: Utils.normalizeWeights(p.weights),
                margin: p.margin !== undefined ? p.margin : null,  // null means use global
            }));
            
            const result = await API.runSubperiodBacktest({
                tickers: this.state.selectedTickers,
                global_weights: globalWeights,
                global_margin: this.state.margin,
                start: this.state.dateRange.start,
                end: this.state.dateRange.end,
                periods: periods,
            });
            
            this.state.backtestResult = result;
            
            // Update chart with Fed rate overlay
            this.updateChartWithFedRate();
            
            // Update metrics
            this.displayMetrics(result.metrics);
            
            // Update weight allocation chart
            if (result.weight_timeline) {
                this.displayWeightAllocation(result.weight_timeline);
            }
            
            // Show asset prices chart
            this.displayAssetPrices();
            
            Utils.toast('Sub-period backtest complete', 'success');
        } catch (error) {
            Utils.toast(`Error: ${error.message}`, 'error');
        } finally {
            Utils.hideLoading();
        }
    },
    // =========================================================================
    // Strategy Save/Load
    // =========================================================================
    
    /**
     * Open save strategy modal
     */
    openSaveModal() {
        if (this.state.selectedTickers.length === 0) {
            Utils.toast('Add tickers before saving a strategy', 'error');
            return;
        }
        
        // Generate summary
        const summary = this.generateStrategySummary();
        document.getElementById('strategySummary').innerHTML = summary;
        document.getElementById('strategyName').value = '';
        document.getElementById('saveStrategyModal').style.display = 'flex';
    },
    
    /**
     * Close save strategy modal
     */
    closeSaveModal() {
        document.getElementById('saveStrategyModal').style.display = 'none';
    },
    
    /**
     * Generate strategy summary HTML
     */
    generateStrategySummary() {
        const tickers = this.state.selectedTickers;
        const weights = this.state.weights;
        const margin = this.state.margin;
        const dateRange = this.state.dateRange;
        const subPeriods = this.state.subPeriods;
        
        let html = `
            <div><strong>Tickers:</strong> ${tickers.join(', ')}</div>
            <div><strong>Date Range:</strong> ${dateRange.start} to ${dateRange.end}</div>
            <div><strong>Weights:</strong></div>
            <ul style="margin: 4px 0 8px 16px;">
                ${tickers.map(t => `<li>${t}: ${Math.round(weights[t] * 100)}%</li>`).join('')}
            </ul>
            <div><strong>Margin:</strong> ${margin}x</div>
        `;
        
        if (subPeriods.length > 0) {
            html += `<div><strong>Sub-periods:</strong> ${subPeriods.length} defined</div>`;
        }
        
        return html;
    },
    
    /**
     * Save strategy to backend
     */
    async saveStrategy() {
        const name = document.getElementById('strategyName').value.trim();
        
        if (!name) {
            Utils.toast('Please enter a strategy name', 'error');
            return;
        }
        
        const config = {
            tickers: this.state.selectedTickers,
            weights: this.state.weights,
            margin: this.state.margin,
            date_range: this.state.dateRange,
            sub_periods: this.state.subPeriods.map(p => ({
                start: p.start,
                end: p.end,
                weights: p.weights,
                margin: p.margin,
                enabled: p.enabled,
            })),
        };
        
        try {
            await API.savePortfolio(name, config);
            Utils.toast(`Strategy "${name}" saved successfully`, 'success');
            this.closeSaveModal();
        } catch (error) {
            Utils.toast(`Error saving strategy: ${error.message}`, 'error');
        }
    },
    
    /**
     * Open load strategy modal
     */
    async openLoadModal() {
        document.getElementById('loadStrategyModal').style.display = 'flex';
        document.getElementById('strategyList').innerHTML = '<p class="empty-state">Loading strategies...</p>';
        
        try {
            const response = await API.listPortfolios();
            this.renderStrategyList(response.portfolios);
        } catch (error) {
            document.getElementById('strategyList').innerHTML = 
                '<p class="empty-state">Failed to load strategies</p>';
        }
    },
    
    /**
     * Close load strategy modal
     */
    closeLoadModal() {
        document.getElementById('loadStrategyModal').style.display = 'none';
    },
    
    /**
     * Render strategy list in modal
     */
    renderStrategyList(portfolios) {
        const container = document.getElementById('strategyList');
        
        if (!portfolios || portfolios.length === 0) {
            container.innerHTML = '<p class="empty-state">No saved strategies</p>';
            return;
        }
        
        container.innerHTML = portfolios.map(p => `
            <div class="strategy-item">
                <div class="strategy-info" onclick="App.loadStrategy('${p.name}')">
                    <div class="strategy-name">${p.name}</div>
                    <div class="strategy-meta">Saved: ${new Date(p.created_at).toLocaleDateString()}</div>
                </div>
                <div class="strategy-actions">
                    <button class="btn btn-primary" onclick="App.loadStrategy('${p.name}')">Load</button>
                    <button class="btn btn-danger" onclick="App.deleteStrategy('${p.name}')">🗑️</button>
                </div>
            </div>
        `).join('');
    },
    
    /**
     * Load a strategy from backend
     */
    async loadStrategy(name) {
        Utils.showLoading(`Loading strategy "${name}"...`);
        
        try {
            const response = await API.getPortfolio(name);
            const config = response.config;
            
            // Update state
            this.state.selectedTickers = config.tickers || [];
            this.state.weights = config.weights || {};
            this.state.margin = config.margin || 1.0;
            this.state.dateRange = config.date_range || { start: null, end: null };
            
            // Convert sub_periods back to our format
            this.state.subPeriods = (config.sub_periods || []).map(p => ({
                id: Utils.generateId(),
                start: p.start,
                end: p.end,
                weights: p.weights,
                margin: p.margin,
                enabled: p.enabled !== false,
            }));
            
            // Update margin input
            const marginInput = document.getElementById('marginInput');
            if (marginInput) {
                marginInput.value = this.state.margin;
            }
            this.updateMarginInfo();
            
            // Update date pickers
            if (this.state.dateRange.start) {
                this.datePickers.start.setDate(this.state.dateRange.start);
            }
            if (this.state.dateRange.end) {
                this.datePickers.end.setDate(this.state.dateRange.end);
            }
            
            // Render UI
            this.renderTickers();
            this.renderWeights();
            this.renderSubPeriods();
            this.updateBacktestButton();
            
            // Show sub-period section if there are sub-periods
            if (this.state.subPeriods.length > 0) {
                document.getElementById('subPeriodSection').style.display = 'block';
            }
            
            // Save to localStorage
            this.saveStateToStorage();
            
            this.closeLoadModal();
            
            // Auto-load price data for all tickers
            Utils.showLoading('Loading price data...');
            await this.loadAllData();
            
            Utils.toast(`Strategy "${name}" loaded successfully`, 'success');
        } catch (error) {
            Utils.toast(`Error loading strategy: ${error.message}`, 'error');
        } finally {
            Utils.hideLoading();
        }
    },
    
    /**
     * Delete a strategy
     */
    async deleteStrategy(name) {
        if (!confirm(`Delete strategy "${name}"?`)) {
            return;
        }
        
        try {
            await API.deletePortfolio(name);
            Utils.toast(`Strategy "${name}" deleted`, 'success');
            
            // Refresh list
            const response = await API.listPortfolios();
            this.renderStrategyList(response.portfolios);
        } catch (error) {
            Utils.toast(`Error deleting strategy: ${error.message}`, 'error');
        }
    },
    
    // =========================================================================
    // Macro Indicators (Fed Rate, Unemployment, CPI)
    // =========================================================================
    
    /**
     * Load all macro indicator data from backend
     */
    async loadMacroData() {
        // Load all indicators in parallel
        await Promise.all([
            this.loadFedRateData(),
            this.loadUnemploymentData(),
            this.loadCpiData(),
        ]);
    },
    
    /**
     * Load Federal Funds Rate data from backend
     */
    async loadFedRateData() {
        try {
            console.log('Loading Fed Funds Rate data...');
            const response = await API.getFedRate(null, null, true);
            
            if (response.status === 'success' && response.data) {
                this.state.fedRateData = response.data;
                console.log(`Loaded ${response.data.length} Fed rate data points`);
            } else if (response.status === 'no_api_key') {
                console.warn('FRED API key not configured');
            }
        } catch (error) {
            console.warn('Could not load Fed rate data:', error.message);
        }
    },
    
    /**
     * Load Unemployment Rate data from backend
     */
    async loadUnemploymentData() {
        try {
            console.log('Loading Unemployment Rate data...');
            const response = await API.getUnemploymentRate(null, null, true);
            
            if (response.status === 'success' && response.data) {
                this.state.unemploymentData = response.data;
                console.log(`Loaded ${response.data.length} unemployment rate data points`);
            } else if (response.status === 'no_api_key') {
                console.warn('FRED API key not configured');
            }
        } catch (error) {
            console.warn('Could not load unemployment rate data:', error.message);
        }
    },
    
    /**
     * Load CPI Year-over-Year data from backend
     */
    async loadCpiData() {
        try {
            console.log('Loading CPI YoY data...');
            const response = await API.getCpiYoY(null, null, true);
            
            if (response.status === 'success' && response.data) {
                this.state.cpiYoyData = response.data;
                console.log(`Loaded ${response.data.length} CPI YoY data points`);
            } else if (response.status === 'no_api_key') {
                console.warn('FRED API key not configured');
            }
        } catch (error) {
            console.warn('Could not load CPI data:', error.message);
        }
    },
    
    /**
     * Toggle macro indicator display on chart
     * @param {string} indicator - 'fedRate', 'unemployment', or 'cpi'
     */
    toggleMacroIndicator(indicator) {
        const stateKeyMap = {
            fedRate: 'showFedRate',
            unemployment: 'showUnemployment',
            cpi: 'showCpi',
        };
        const btnIdMap = {
            fedRate: 'toggleFedRateBtn',
            unemployment: 'toggleUnemploymentBtn',
            cpi: 'toggleCpiBtn',
        };
        
        const stateKey = stateKeyMap[indicator];
        const btnId = btnIdMap[indicator];
        
        if (!stateKey) return;
        
        // Toggle state
        this.state[stateKey] = !this.state[stateKey];
        
        // Update toggle button state
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.classList.toggle('active', this.state[stateKey]);
        }
        
        // Refresh chart
        if (this.state.backtestResult) {
            this.updateChartWithMacroData();
        }
    },
    
    /**
     * Update chart to include or exclude macro indicator overlays
     */
    updateChartWithMacroData() {
        if (!this.state.backtestResult) return;
        
        const equityCurve = this.state.backtestResult.equity_curve;
        const startDate = equityCurve[0]?.date;
        const endDate = equityCurve[equityCurve.length - 1]?.date;
        
        // Filter data to backtest date range
        const filterByDateRange = (data) => {
            if (!data || data.length === 0) return null;
            return data.filter(d => d.date >= startDate && d.date <= endDate);
        };
        
        // Get filtered data for enabled indicators
        const fedRateForChart = this.state.showFedRate ? filterByDateRange(this.state.fedRateData) : null;
        const unemploymentForChart = this.state.showUnemployment ? filterByDateRange(this.state.unemploymentData) : null;
        const cpiForChart = this.state.showCpi ? filterByDateRange(this.state.cpiYoyData) : null;
        
        // Update chart with all macro data
        Chart.updateData(equityCurve, {
            onRangeSelect: (start, end) => this.onChartRangeSelect(start, end),
            fedRateData: fedRateForChart,
            unemploymentData: unemploymentForChart,
            cpiYoyData: cpiForChart,
        });
        
        // Store equity curve for sub-period selection mode
        Chart.setEquityCurveData(equityCurve);
    },
    
    /**
     * Legacy method - kept for compatibility
     */
    updateChartWithFedRate() {
        this.updateChartWithMacroData();
    },
    
    /**
     * Get Fed rate for a specific date (for hover tooltip)
     */
    getFedRateForDate(dateStr) {
        if (!this.state.fedRateData || this.state.fedRateData.length === 0) {
            return null;
        }
        
        // Find the closest date that's not after the target date
        const targetDate = new Date(dateStr);
        let closestRate = null;
        
        for (const item of this.state.fedRateData) {
            const itemDate = new Date(item.date);
            if (itemDate <= targetDate) {
                closestRate = item.rate;
            } else {
                break;
            }
        }
        
        return closestRate;
    },
    
    /**
     * Reset chart zoom to full date range
     */
    resetToFullRange() {
        if (!this.state.backtestResult) {
            Utils.toast('Run a backtest first', 'info');
            return;
        }
        
        // Reset the plotly chart to full range
        Chart.resetZoom();
        
        // Reset sub-charts to full range as well
        this.resetSubChartsZoom();
        
        // Hide the range info bar
        const rangeInfo = document.getElementById('chartRangeInfo');
        if (rangeInfo) {
            rangeInfo.style.display = 'none';
        }
        
        Utils.toast('Reset to full date range', 'success');
    },
    
    /**
     * Display weight allocation over time chart
     * Uses actual equity curve dates to ensure alignment with performance chart
     */
    displayWeightAllocation(weightTimeline) {
        const container = document.getElementById('weightAllocationContainer');
        const chartArea = document.getElementById('weightAllocationChart');
        
        if (!weightTimeline || weightTimeline.length === 0 || !this.state.backtestResult) {
            container.style.display = 'none';
            return;
        }
        
        container.style.display = 'block';
        
        // Get all tickers
        const tickers = this.state.selectedTickers;
        
        // Use equity curve dates to ensure alignment with performance chart
        const equityCurve = this.state.backtestResult.equity_curve;
        const expandedData = this.expandWeightTimelineToEquityCurve(weightTimeline, equityCurve);
        
        const traces = tickers.map((ticker, i) => ({
            x: expandedData.map(d => d.date),
            y: expandedData.map(d => (d.weights[ticker] || 0) * 100),
            type: 'scatter',
            mode: 'lines',
            name: ticker,
            stackgroup: 'weights',
            line: { width: 0.5 },
            hovertemplate: `${ticker}: %{y:.1f}%<extra></extra>`,
        }));
        
        const layout = {
            autosize: true,
            showlegend: true,
            legend: {
                x: 0,
                y: 1.15,
                orientation: 'h',
                font: { color: '#94a3b8', size: 10 },
            },
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            font: {
                family: "'JetBrains Mono', monospace",
                color: '#94a3b8',
                size: 10,
            },
            margin: { l: 40, r: 20, t: 10, b: 30 },
            xaxis: {
                type: 'date',
                gridcolor: '#2d3748',
                linecolor: '#2d3748',
                tickfont: { size: 9 },
            },
            yaxis: {
                title: 'Weight (%)',
                range: [0, 100],
                gridcolor: '#2d3748',
                linecolor: '#2d3748',
                tickfont: { size: 9 },
            },
            hovermode: 'x unified',
        };
        
        Plotly.newPlot(chartArea, traces, layout, { 
            responsive: true, 
            displayModeBar: false 
        });
    },
    
    /**
     * Expand weight timeline to match equity curve dates
     * This ensures the weight chart aligns perfectly with the performance chart
     */
    expandWeightTimelineToEquityCurve(weightTimeline, equityCurve) {
        if (!weightTimeline || weightTimeline.length === 0 || !equityCurve) return [];
        
        // Sort weight timeline by date
        const sortedTimeline = [...weightTimeline].sort((a, b) => 
            new Date(a.date) - new Date(b.date)
        );
        
        // For each equity curve date, find the applicable weights
        return equityCurve.map(point => {
            const pointDate = new Date(point.date);
            
            // Find the weight period that applies to this date
            let applicableWeights = sortedTimeline[0].weights;
            
            for (const period of sortedTimeline) {
                const periodDate = new Date(period.date);
                if (periodDate <= pointDate) {
                    applicableWeights = period.weights;
                } else {
                    break;
                }
            }
            
            return {
                date: point.date,
                weights: applicableWeights,
            };
        });
    },
    
    // =========================================================================
    // Asset Prices Chart
    // =========================================================================
    
    assetPricesData: {},  // Cache for asset price data
    priceLogScale: false,  // Whether to use log scale
    
    /**
     * Fetch and display asset prices chart
     */
    async displayAssetPrices() {
        const container = document.getElementById('assetPricesContainer');
        const chartArea = document.getElementById('assetPricesChart');
        
        if (!this.state.backtestResult || this.state.selectedTickers.length === 0) {
            container.style.display = 'none';
            return;
        }
        
        container.style.display = 'block';
        
        // Get the equity curve dates for alignment
        const equityCurve = this.state.backtestResult.equity_curve;
        if (!equityCurve || equityCurve.length === 0) {
            return;
        }
        
        const startDate = equityCurve[0].date;
        const endDate = equityCurve[equityCurve.length - 1].date;
        
        // Fetch price data for all tickers
        const pricePromises = this.state.selectedTickers.map(async ticker => {
            // Use cached data if available for the same date range
            const cacheKey = `${ticker}_${startDate}_${endDate}`;
            if (this.assetPricesData[cacheKey]) {
                return { ticker, data: this.assetPricesData[cacheKey] };
            }
            
            try {
                const response = await API.getPrices(ticker, startDate, endDate);
                this.assetPricesData[cacheKey] = response.data;
                return { ticker, data: response.data };
            } catch (e) {
                console.warn(`Failed to fetch prices for ${ticker}:`, e);
                return { ticker, data: [] };
            }
        });
        
        const results = await Promise.all(pricePromises);
        
        // Build normalized price traces
        this.renderAssetPricesChart(results, equityCurve);
    },
    
    /**
     * Render the asset prices chart
     */
    renderAssetPricesChart(priceData, equityCurve) {
        const chartArea = document.getElementById('assetPricesChart');
        
        // Create a date lookup from equity curve for alignment
        const equityDates = new Set(equityCurve.map(p => p.date));
        
        // Color palette for tickers
        const colors = [
            '#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa',
            '#f97316', '#22d3d8', '#ef4444', '#84cc16', '#e879f9'
        ];
        
        const traces = priceData.map((result, i) => {
            const { ticker, data } = result;
            
            if (!data || data.length === 0) {
                return null;
            }
            
            // Filter to equity curve dates and normalize to 100
            const filteredData = data.filter(d => equityDates.has(d.date));
            
            if (filteredData.length === 0) {
                return null;
            }
            
            // Normalize: first price = 100
            const firstPrice = filteredData[0].adj_close || filteredData[0].close;
            const normalizedPrices = filteredData.map(d => ({
                date: d.date,
                value: ((d.adj_close || d.close) / firstPrice) * 100
            }));
            
            return {
                x: normalizedPrices.map(d => d.date),
                y: normalizedPrices.map(d => d.value),
                type: 'scatter',
                mode: 'lines',
                name: ticker,
                line: { 
                    color: colors[i % colors.length],
                    width: 1.5 
                },
                hovertemplate: `${ticker}: %{y:.2f}<extra></extra>`,
            };
        }).filter(t => t !== null);
        
        if (traces.length === 0) {
            chartArea.innerHTML = '<p class="empty-state">No price data available</p>';
            return;
        }
        
        const layout = {
            autosize: true,
            showlegend: true,
            legend: {
                x: 0,
                y: 1.15,
                orientation: 'h',
                font: { color: '#94a3b8', size: 10 },
            },
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            font: {
                family: "'JetBrains Mono', monospace",
                color: '#94a3b8',
                size: 10,
            },
            margin: { l: 50, r: 20, t: 10, b: 30 },
            xaxis: {
                type: 'date',
                gridcolor: '#2d3748',
                linecolor: '#2d3748',
                tickfont: { size: 9 },
            },
            yaxis: {
                title: 'Normalized Price (100 = Start)',
                type: this.priceLogScale ? 'log' : 'linear',
                gridcolor: '#2d3748',
                linecolor: '#2d3748',
                tickfont: { size: 9 },
            },
            hovermode: 'x unified',
        };
        
        Plotly.newPlot(chartArea, traces, layout, { 
            responsive: true, 
            displayModeBar: false 
        });
        
        // Sync zoom with main chart - DISABLED to prevent recursive loops
        // The main chart is the source of truth and syncs TO sub-charts, not FROM
        // chartArea.on('plotly_relayout', (eventData) => { ... });
    },
    
    /**
     * Toggle log scale for price chart
     */
    togglePriceLogScale() {
        this.priceLogScale = document.getElementById('showLogScale').checked;
        
        // Re-render if we have data
        if (this.state.backtestResult) {
            this.displayAssetPrices();
        }
    },
    
    /**
     * Sync chart ranges across all sub-charts
     */
    syncChartRanges(start, end) {
        // Only sync if we have valid dates
        if (!start || !end) return;
        
        const weightChart = document.getElementById('weightAllocationChart');
        const priceChart = document.getElementById('assetPricesChart');
        
        const update = {
            'xaxis.range[0]': start,
            'xaxis.range[1]': end,
        };
        
        // Use try-catch to prevent any errors from cascading
        try {
            if (weightChart && weightChart.data) {
                Plotly.relayout(weightChart, update);
            }
        } catch (e) {
            console.warn('Could not sync weight chart:', e);
        }
        
        try {
            if (priceChart && priceChart.data) {
                Plotly.relayout(priceChart, update);
            }
        } catch (e) {
            console.warn('Could not sync price chart:', e);
        }
    },
    
    /**
     * Update all sub-charts to match main chart range
     */
    updateSubChartsRange(start, end) {
        this.syncChartRanges(start, end);
    },
    
    /**
     * Reset all sub-charts to full range
     */
    resetSubChartsZoom() {
        const weightChart = document.getElementById('weightAllocationChart');
        const priceChart = document.getElementById('assetPricesChart');
        
        const update = {
            'xaxis.autorange': true,
        };
        
        if (weightChart && weightChart.data) {
            Plotly.relayout(weightChart, update);
        }
        if (priceChart && priceChart.data) {
            Plotly.relayout(priceChart, update);
        }
    },
    
    // =========================================================================
    // Draggable Sections
    // =========================================================================
    
    SECTION_ORDER_KEY: 'portfolioViewer_sectionOrder',
    
    /**
     * Initialize drag-and-drop for subsections
     */
    initDraggableSections() {
        const container = document.getElementById('draggableContainer');
        if (!container) return;
        
        const sections = container.querySelectorAll('.draggable-section');
        
        sections.forEach(section => {
            // Only allow drag from the handle
            const handle = section.querySelector('.drag-handle');
            
            if (handle) {
                handle.addEventListener('mousedown', () => {
                    section.setAttribute('draggable', 'true');
                });
                
                handle.addEventListener('mouseup', () => {
                    section.setAttribute('draggable', 'false');
                });
            }
            
            section.addEventListener('dragstart', (e) => this.handleDragStart(e));
            section.addEventListener('dragend', (e) => this.handleDragEnd(e));
            section.addEventListener('dragover', (e) => this.handleDragOver(e));
            section.addEventListener('dragenter', (e) => this.handleDragEnter(e));
            section.addEventListener('dragleave', (e) => this.handleDragLeave(e));
            section.addEventListener('drop', (e) => this.handleDrop(e));
        });
    },
    
    draggedElement: null,
    
    handleDragStart(e) {
        this.draggedElement = e.target.closest('.draggable-section');
        if (this.draggedElement) {
            this.draggedElement.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', this.draggedElement.dataset.section);
        }
    },
    
    handleDragEnd(e) {
        const section = e.target.closest('.draggable-section');
        if (section) {
            section.classList.remove('dragging');
            section.setAttribute('draggable', 'false');
        }
        
        // Remove drag-over class from all sections
        document.querySelectorAll('.draggable-section').forEach(s => {
            s.classList.remove('drag-over');
        });
        
        this.draggedElement = null;
    },
    
    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    },
    
    handleDragEnter(e) {
        const section = e.target.closest('.draggable-section');
        if (section && section !== this.draggedElement) {
            section.classList.add('drag-over');
        }
    },
    
    handleDragLeave(e) {
        const section = e.target.closest('.draggable-section');
        if (section) {
            section.classList.remove('drag-over');
        }
    },
    
    handleDrop(e) {
        e.preventDefault();
        const targetSection = e.target.closest('.draggable-section');
        
        if (targetSection && this.draggedElement && targetSection !== this.draggedElement) {
            const container = document.getElementById('draggableContainer');
            const sections = Array.from(container.querySelectorAll('.draggable-section'));
            
            const draggedIndex = sections.indexOf(this.draggedElement);
            const targetIndex = sections.indexOf(targetSection);
            
            if (draggedIndex < targetIndex) {
                targetSection.after(this.draggedElement);
            } else {
                targetSection.before(this.draggedElement);
            }
            
            // Save the new order
            this.saveSectionOrder();
        }
        
        targetSection?.classList.remove('drag-over');
    },
    
    /**
     * Save section order to localStorage
     */
    saveSectionOrder() {
        const container = document.getElementById('draggableContainer');
        if (!container) return;
        
        const sections = container.querySelectorAll('.draggable-section');
        const order = Array.from(sections).map(s => s.dataset.section);
        
        try {
            localStorage.setItem(this.SECTION_ORDER_KEY, JSON.stringify(order));
        } catch (e) {
            console.warn('Could not save section order:', e);
        }
    },
    
    /**
     * Apply saved section order from localStorage
     */
    applySectionOrder() {
        try {
            const saved = localStorage.getItem(this.SECTION_ORDER_KEY);
            if (!saved) return;
            
            const order = JSON.parse(saved);
            const container = document.getElementById('draggableContainer');
            if (!container) return;
            
            // Reorder sections according to saved order
            order.forEach(sectionId => {
                const section = container.querySelector(`[data-section="${sectionId}"]`);
                if (section) {
                    container.appendChild(section);
                }
            });
        } catch (e) {
            console.warn('Could not apply section order:', e);
        }
    },
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

// Export for global access
window.App = App;
