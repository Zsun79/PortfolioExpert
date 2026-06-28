/**
 * UI Manager for Portfolio Watcher
 * Handles all UI rendering and interactions
 */

const PortfolioWatcherUI = {
    // =========================================================================
    // Data Status
    // =========================================================================
    
    /**
     * Update data status indicator
     * @param {string} status - 'checking', 'fresh', 'updating', 'stale', 'error'
     * @param {string} text - Status text
     */
    updateDataStatus(status, text) {
        const icon = document.getElementById('dataStatusIcon');
        const textEl = document.getElementById('dataStatusText');
        
        if (icon) {
            icon.className = 'status-icon ' + status;
        }
        if (textEl) {
            textEl.textContent = text;
        }

        PortfolioWatcherState.setUiState({
            dataStatus: { status, text },
        });
    },
    
    // =========================================================================
    // Assets List
    // =========================================================================
    
    /**
     * Render the assets list
     */
    renderAssetsList() {
        const container = document.getElementById('assetsList');
        const assets = PortfolioWatcherState.assets;
        const mode = this.getAllocationMode();
        
        if (assets.length === 0) {
            container.innerHTML = '<p class="empty-state">No assets added yet</p>';
            this.updateTotalWeight();
            this.renderHoldingsList();
            return;
        }
        
        container.innerHTML = assets.map(asset => {
            const price = PortfolioWatcherState.prices[asset.ticker];
            const hasValidPrice = Number.isFinite(price?.price);
            const priceStr = hasValidPrice ? `$${price.price.toFixed(2)}` : 'Loading...';
            const derivedTargetValue = hasValidPrice
                ? Math.max(0, Math.round((asset.targetShares || 0) * price.price))
                : Math.max(0, Math.round(asset.targetValue || 0));
            const derivedTargetShares = hasValidPrice
                ? Math.max(
                    0,
                    Math.round(
                        (asset.targetShares || 0) > 0
                            ? asset.targetShares
                            : (asset.targetValue || 0) / price.price
                    )
                )
                : Math.max(0, Math.round(asset.targetShares || 0));
            const allocationInput = mode === 'weight'
                ? `
                    <input type="number" class="asset-weight-input" 
                           value="${(asset.weight * 100).toFixed(1)}" 
                           min="0" max="100" step="0.1"
                           onchange="PortfolioWatcher.onWeightChange('${asset.ticker}', this.value)">
                    <span>%</span>
                `
                : mode === 'shares'
                ? `
                    <input type="number" class="asset-weight-input" 
                           value="${derivedTargetShares}" 
                           min="0" step="1"
                           onchange="PortfolioWatcher.onTargetSharesChange('${asset.ticker}', this.value)">
                    <span>sh</span>
                `
                : `
                    <input type="number" class="asset-weight-input" 
                           value="${derivedTargetValue}" 
                           min="0" step="1"
                           onchange="PortfolioWatcher.onTargetValueChange('${asset.ticker}', this.value)">
                    <span>$</span>
                `;
            
            return `
                <div class="asset-row" data-ticker="${asset.ticker}">
                    <span class="asset-ticker">${asset.ticker}</span>
                    ${allocationInput}
                    <span class="asset-price">${priceStr}</span>
                    <button class="remove-asset-btn" onclick="PortfolioWatcher.removeAsset('${asset.ticker}')">&times;</button>
                </div>
            `;
        }).join('');
        
        this.updateTotalWeight();
        this.renderHoldingsList();
        this.syncAllocationModeUI();
        this.syncLeverageForShareMode();
    },
    
    /**
     * Update total weight display
     */
    updateTotalWeight() {
        const labelEl = document.getElementById('totalLabel');
        const totalEl = document.getElementById('totalWeight');
        const mode = this.getAllocationMode();
        
        if (!totalEl) return;
        
        if (mode === 'shares' || mode === 'value') {
            const { totalTargetValue } = PortfolioWatcherState.getShareModePortfolio();
            if (labelEl) {
                labelEl.textContent = 'Total Target Value:';
            }
            totalEl.textContent = '$' + totalTargetValue.toLocaleString(undefined, { maximumFractionDigits: 0 });
            totalEl.className = 'weight-value';
            return;
        }

        const total = PortfolioWatcherState.getTotalWeight();
        const percentage = (total * 100).toFixed(1);
        
        if (labelEl) {
            labelEl.textContent = 'Total Weight:';
        }
        totalEl.textContent = `${percentage}%`;
        totalEl.className = 'weight-value' + (Math.abs(total - 1) > 0.01 ? ' invalid' : '');
    },
    
    /**
     * Render holdings inputs
     */
    renderHoldingsList() {
        const container = document.getElementById('holdingsList');
        const assets = PortfolioWatcherState.assets;
        
        if (assets.length === 0) {
            container.innerHTML = '<p class="empty-state">Add assets first</p>';
            return;
        }
        
        container.innerHTML = assets.map(asset => `
            <div class="holding-row">
                <span class="holding-ticker">${asset.ticker}</span>
                <input type="number" class="holding-input" 
                       value="${asset.currentShares}" 
                       min="0" step="1"
                       onchange="PortfolioWatcher.onHoldingChange('${asset.ticker}', this.value)">
                <span>shares</span>
            </div>
        `).join('');
    },
    
    // =========================================================================
    // Position Summary
    // =========================================================================
    
    /**
     * Render position summary table
     * @param {Object} positions - Position data
     */
    renderPositionSummary(positions) {
        const card = document.getElementById('positionSummary');
        const tbody = document.querySelector('#positionTable tbody');
        
        if (!positions || Object.keys(positions).length <= 1) {
            card.style.display = 'none';
            return;
        }
        
        card.style.display = 'block';
        
        const rows = [];
        for (const [ticker, pos] of Object.entries(positions)) {
            if (ticker === '_totals') continue;
            
            rows.push(`
                <tr>
                    <td>${ticker}</td>
                    <td>${(pos.weight * 100).toFixed(1)}%</td>
                    <td>$${pos.price.toFixed(2)}</td>
                    <td>$${pos.targetDollar.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td>${pos.targetShares.toLocaleString()}</td>
                    <td>$${pos.actualDollar.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                </tr>
            `);
        }
        
        tbody.innerHTML = rows.join('');
        
        // Update totals
        const totals = positions._totals;
        document.getElementById('totalWeightResult').textContent = '100%';
        document.getElementById('totalTargetDollar').textContent = 
            '$' + totals.targetDollar.toLocaleString(undefined, { maximumFractionDigits: 0 });
        document.getElementById('totalActualDollar').textContent = 
            '$' + totals.actualDollar.toLocaleString(undefined, { maximumFractionDigits: 0 });
    },
    
    // =========================================================================
    // Risk Metrics
    // =========================================================================
    
    /**
     * Render risk metrics
     * @param {Object} metrics - Risk metrics
     */
    renderRiskMetrics(metrics) {
        const card = document.getElementById('riskMetrics');
        
        if (!metrics) {
            card.style.display = 'none';
            return;
        }
        
        card.style.display = 'block';
        
        // Format percentages
        const formatPct = (val) => (val * 100).toFixed(2) + '%';
        const formatMoney = (val) => '-$' + val.toLocaleString(undefined, { maximumFractionDigits: 0 });
        
        document.getElementById('expectedReturn').textContent = formatPct(metrics.annualizedReturn);
        document.getElementById('expectedReturn').className = 
            'metric-value ' + (metrics.annualizedReturn >= 0 ? 'positive' : 'negative');
        
        document.getElementById('volatility').textContent = formatPct(metrics.annualizedVolatility);
        
        document.getElementById('sharpeRatio').textContent = metrics.sharpeRatio.toFixed(2);
        document.getElementById('sharpeRatio').className = 
            'metric-value ' + (metrics.sharpeRatio >= 0 ? 'positive' : 'negative');
        
        document.getElementById('maxDrawdown').textContent = formatPct(metrics.maxDrawdown);
        document.getElementById('maxDrawdown').className = 'metric-value negative';
        
        document.getElementById('var95').textContent = formatMoney(metrics.var95_30d);
        document.getElementById('var99').textContent = formatMoney(metrics.var99_30d);
        
        // Render correlation matrix if available
        if (metrics.correlation) {
            this.renderCorrelationMatrix(metrics.correlation, metrics.dataPoints);
        }

        this.renderTopDrawdowns(metrics.topDrawdowns);
    },

    /**
     * Render top drawdown episodes
     * @param {Array} drawdowns - Top drawdown episodes
     */
    renderTopDrawdowns(drawdowns) {
        const card = document.getElementById('drawdownCard');
        const tbody = document.querySelector('#drawdownTable tbody');

        if (!card || !tbody || !Array.isArray(drawdowns) || drawdowns.length === 0) {
            if (card) card.style.display = 'none';
            return;
        }

        card.style.display = 'block';
        tbody.innerHTML = drawdowns.map(episode => `
            <tr>
                <td>${(episode.drawdown * 100).toFixed(2)}%</td>
                <td>${episode.dateCount}</td>
                <td>${episode.startDate}</td>
                <td>${episode.endDate}</td>
            </tr>
        `).join('');
    },
    
    // =========================================================================
    // Correlation Matrix
    // =========================================================================
    
    /**
     * Render correlation matrix
     * @param {Object} correlationData - {tickers: [], matrix: [][], commonDates: number}
     * @param {number} dataPoints - Number of data points used for portfolio
     */
    renderCorrelationMatrix(correlationData, dataPoints) {
        const card = document.getElementById('correlationCard');
        const container = document.getElementById('correlationMatrix');
        const lookbackInfo = document.getElementById('correlationLookback');
        
        if (!correlationData || correlationData.tickers.length === 0) {
            card.style.display = 'none';
            return;
        }
        
        card.style.display = 'block';
        
        // Update lookback info - show common dates used for correlation
        if (lookbackInfo) {
            const commonDates = correlationData.commonDates || dataPoints;
            lookbackInfo.textContent = `(${commonDates} common trading days)`;
        }
        
        const { tickers, matrix } = correlationData;
        
        // Build table HTML
        let html = '<table class="correlation-table">';
        
        // Header row
        html += '<thead><tr><th></th>';
        for (const ticker of tickers) {
            html += `<th>${ticker}</th>`;
        }
        html += '</tr></thead>';
        
        // Data rows
        html += '<tbody>';
        for (let i = 0; i < tickers.length; i++) {
            html += `<tr><th class="row-header">${tickers[i]}</th>`;
            for (let j = 0; j < tickers.length; j++) {
                const corr = matrix[i][j];
                const colorClass = this.getCorrelationColorClass(corr, i === j);
                const displayValue = i === j ? '1.00' : corr.toFixed(2);
                html += `<td><span class="corr-cell ${colorClass}">${displayValue}</span></td>`;
            }
            html += '</tr>';
        }
        html += '</tbody></table>';
        
        container.innerHTML = html;
    },
    
    /**
     * Get color class for correlation value
     * @param {number} corr - Correlation value (-1 to 1)
     * @param {boolean} isDiagonal - Is this a diagonal cell
     * @returns {string} CSS class name
     */
    getCorrelationColorClass(corr, isDiagonal) {
        if (isDiagonal) return 'diagonal';
        
        if (corr >= 0.7) return 'positive-high';
        if (corr >= 0.4) return 'positive-med';
        if (corr >= 0) return 'positive-low';
        if (corr >= -0.4) return 'negative-low';
        if (corr >= -0.7) return 'negative-med';
        return 'negative-high';
    },
    
    // =========================================================================
    // Projection
    // =========================================================================
    
    /**
     * Render projection summary
     * @param {Object} projection - Projection data (360d projection)
     */
    renderProjectionSummary(projection) {
        const card = document.getElementById('projectionCard');
        
        if (!projection) {
            card.style.display = 'none';
            return;
        }
        
        card.style.display = 'flex';
        
        const formatMoney = (val) => '$' + val.toLocaleString(undefined, { maximumFractionDigits: 0 });
        
        document.getElementById('projCurrentValue').textContent = formatMoney(projection.currentValue);
        document.getElementById('projExpectedValue').textContent = formatMoney(projection.expectedValue);
        document.getElementById('projRange95').textContent = 
            `${formatMoney(projection.intervals.p95.low)} - ${formatMoney(projection.intervals.p95.high)}`;

        Projection.renderContinuousChart();
    },
    
    // =========================================================================
    // Collapsible Sections
    // =========================================================================
    
    /**
     * Toggle collapsible section
     * @param {string} sectionId - Section element ID
     */
    toggleSection(sectionId) {
        const section = document.getElementById(sectionId);
        const parent = section?.closest('.collapsible');
        
        if (parent) {
            parent.classList.toggle('expanded');
        }
    },
    
    // =========================================================================
    // Status & Loading
    // =========================================================================
    
    /**
     * Show loading overlay
     * @param {string} text - Loading text
     */
    showLoading(text = 'Loading...') {
        const overlay = document.getElementById('loadingOverlay');
        const textEl = document.getElementById('loadingText');
        
        if (textEl) textEl.textContent = text;
        if (overlay) overlay.style.display = 'flex';
    },
    
    /**
     * Hide loading overlay
     */
    hideLoading() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) overlay.style.display = 'none';
    },
    
    /**
     * Update status bar
     * @param {string} text - Status text
     */
    updateStatus(text) {
        const statusEl = document.getElementById('statusText');
        if (statusEl) statusEl.textContent = text;
        PortfolioWatcherState.setUiState({ statusText: text });
    },
    
    /**
     * Update last calculated time
     */
    updateLastCalculated(timestamp = new Date().toISOString()) {
        const el = document.getElementById('lastCalculated');
        if (el) {
            el.textContent = 'Last calculated: ' + new Date(timestamp).toLocaleTimeString();
        }
        PortfolioWatcherState.setUiState({ lastCalculatedAt: timestamp });
    },

    /**
     * Restore persisted footer, status, and result cards
     */
    restorePersistedSession() {
        const persistedDataStatus = PortfolioWatcherState.ui?.dataStatus;
        if (persistedDataStatus?.status && persistedDataStatus?.text) {
            const icon = document.getElementById('dataStatusIcon');
            const textEl = document.getElementById('dataStatusText');
            if (icon) {
                icon.className = 'status-icon ' + persistedDataStatus.status;
            }
            if (textEl) {
                textEl.textContent = persistedDataStatus.text;
            }
        }

        const statusEl = document.getElementById('statusText');
        if (statusEl) {
            statusEl.textContent = PortfolioWatcherState.ui?.statusText || 'Ready';
        }

        const lastCalculatedAt = PortfolioWatcherState.ui?.lastCalculatedAt;
        if (lastCalculatedAt) {
            this.updateLastCalculated(lastCalculatedAt);
        }

        const { positions, riskMetrics, projection } = PortfolioWatcherState.results;
        if (positions) this.renderPositionSummary(positions);
        if (riskMetrics) this.renderRiskMetrics(riskMetrics);

        if (riskMetrics && projection) {
            Projection.calculateAll();
            this.renderProjectionSummary(projection);
        }
    },
    
    /**
     * Show toast notification
     * @param {string} message - Toast message
     * @param {string} type - Toast type ('success', 'error', 'info')
     */
    toast(message, type = 'info') {
        // Use existing Utils.toast if available
        if (typeof Utils !== 'undefined' && Utils.toast) {
            Utils.toast(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    },
    
    // =========================================================================
    // Form Values
    // =========================================================================
    
    /**
     * Get target cash from input
     * @returns {number} Target cash value
     */
    getTargetCash() {
        const input = document.getElementById('targetCash');
        return parseFloat(input?.value) || 100000;
    },
    
    /**
     * Get lookback window from input
     * @returns {number} Lookback window in days
     */
    getLookbackWindow() {
        const input = document.getElementById('lookbackWindow');
        return parseInt(input?.value) || 252;
    },
    
    /**
     * Get leverage rate from input
     * @returns {number} Leverage rate (1 = no leverage)
     */
    getLeverageRate() {
        const input = document.getElementById('leverageRate');
        return parseFloat(input?.value) || 1;
    },

    /**
     * Get allocation input mode
     * @returns {string} 'weight', 'shares', or 'value'
     */
    getAllocationMode() {
        return ['shares', 'value'].includes(PortfolioWatcherState.config.allocationMode)
            ? PortfolioWatcherState.config.allocationMode
            : 'weight';
    },
    
    /**
     * Get new asset input values
     * @returns {Object} {ticker, weight}
     */
    getNewAssetInput() {
        const tickerInput = document.getElementById('assetTickerInput');
        const weightInput = document.getElementById('assetWeightInput');
        const mode = this.getAllocationMode();
        const rawValue = parseFloat(weightInput?.value) || 0;
        
        return {
            ticker: tickerInput?.value.toUpperCase().trim() || '',
            weight: mode === 'weight' ? rawValue / 100 : 0,
            targetShares: mode === 'shares' ? Math.max(0, Math.round(rawValue)) : 0,
            targetValue: mode === 'value' ? Math.max(0, rawValue) : 0,
            mode,
        };
    },
    
    /**
     * Clear new asset inputs
     */
    clearNewAssetInput() {
        const tickerInput = document.getElementById('assetTickerInput');
        const weightInput = document.getElementById('assetWeightInput');
        
        if (tickerInput) tickerInput.value = '';
        if (weightInput) {
            const mode = this.getAllocationMode();
            weightInput.value = mode === 'shares' ? '10' : mode === 'value' ? '1000' : '25';
        }
    },

    /**
     * Sync UI controls with selected allocation mode
     */
    syncAllocationModeUI() {
        const mode = this.getAllocationMode();
        const modeSelect = document.getElementById('allocationMode');
        const leverageInput = document.getElementById('leverageRate');
        const leverageHint = document.getElementById('leverageHint');
        const allocationInput = document.getElementById('assetWeightInput');

        if (modeSelect) modeSelect.value = mode;
        if (allocationInput) {
            allocationInput.placeholder = mode === 'shares'
                ? 'Target Shares'
                : mode === 'value'
                ? 'Target Value $'
                : 'Weight %';
            allocationInput.step = mode === 'weight' ? '0.1' : '1';
            allocationInput.min = '0';
            if (mode === 'weight') {
                allocationInput.max = '100';
                if (allocationInput.value === '' || parseFloat(allocationInput.value) === 10 || parseFloat(allocationInput.value) === 1000) {
                    allocationInput.value = '25';
                }
            } else if (mode === 'shares') {
                allocationInput.removeAttribute('max');
                if (allocationInput.value === '' || parseFloat(allocationInput.value) === 25) {
                    allocationInput.value = '10';
                }
            } else {
                allocationInput.removeAttribute('max');
                if (allocationInput.value === '' || parseFloat(allocationInput.value) === 25 || parseFloat(allocationInput.value) === 10) {
                    allocationInput.value = '1000';
                }
            }
        }

        if (leverageInput) {
            leverageInput.readOnly = mode !== 'weight';
            leverageInput.title = mode !== 'weight'
                ? 'Auto-calculated from target allocations and cash'
                : '';
        }
        if (leverageHint) {
            leverageHint.textContent = mode !== 'weight'
                ? 'Auto: leverage = total target value / cash (minimum 1.0x).'
                : 'Manual in Weight mode; auto-calculated in Shares or Value mode.';
        }
        this.updateTotalWeight();
    },

    /**
     * Update leverage display when using non-weight mode
     */
    syncLeverageForShareMode() {
        if (this.getAllocationMode() === 'weight') return;

        const leverageInput = document.getElementById('leverageRate');
        if (!leverageInput) return;

        const { leverageRate } = PortfolioWatcherState.getShareModePortfolio();
        leverageInput.value = leverageRate.toFixed(2);
    },
    
    /**
     * Initialize UI with current state
     */
    init() {
        // Set initial values from state
        const targetInput = document.getElementById('targetCash');
        const lookbackInput = document.getElementById('lookbackWindow');
        const leverageInput = document.getElementById('leverageRate');
        const allocationModeInput = document.getElementById('allocationMode');
        
        if (targetInput) targetInput.value = PortfolioWatcherState.config.targetCash;
        if (lookbackInput) lookbackInput.value = PortfolioWatcherState.config.lookbackWindow;
        if (leverageInput) leverageInput.value = PortfolioWatcherState.config.leverageRate || 1;
        if (allocationModeInput) allocationModeInput.value = this.getAllocationMode();
        
        // Render assets
        this.syncAllocationModeUI();
        this.renderAssetsList();
        this.restorePersistedSession();
    },
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PortfolioWatcherUI;
}
