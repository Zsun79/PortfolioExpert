/**
 * Value Projection Module
 * Calculates and visualizes portfolio value projection
 * Keeps a one-year summary plus a continuous timeline chart
 */

const Projection = {
    // Time horizons for distribution view (in trading days)
    // 1 month = 21, 3 months = 63, 6 months = 126, 1 year = 252
    TIME_HORIZONS: [21, 63, 126, 252],
    
    // Labels for time horizons
    HORIZON_LABELS: {
        21: '1 Month',
        63: '3 Months',
        126: '6 Months',
        252: '1 Year',
    },
    
    // Trading days per year
    TRADING_DAYS_PER_YEAR: 252,
    
    // Stored projections for all horizons
    projections: {},
    
    /**
     * Calculate projection for a specific time horizon
     * Projects your actual equity/cash value with returns amplified by leverage
     * 
     * @param {number} baseCash - Your actual cash/equity
     * @param {number} baseDailyReturn - Daily mean return of real assets
     * @param {number} baseDailyStd - Daily standard deviation of real assets
     * @param {number} leverageRate - Leverage multiplier (1 = no leverage)
     * @param {number} days - Projection horizon in days
     * @returns {Object} Projection details
     */
    calculate(baseCash, baseDailyReturn, baseDailyStd, leverageRate = 1, days = 30) {
        // Your equity return is amplified by leverage
        const leveragedDailyReturn = baseDailyReturn * leverageRate;
        // Leveraged volatility (also amplified by leverage)
        const leveragedDailyStd = baseDailyStd * leverageRate;
        
        // Expected value of YOUR EQUITY after N days
        const expectedValue = baseCash * Math.pow(1 + leveragedDailyReturn, days);
        
        // Standard deviation of YOUR EQUITY after N days
        // Using the expected value as base and scaling volatility by √T
        // σ_T = E[V_T] × σ_leveraged_daily × √T
        const projectedStd = expectedValue * leveragedDailyStd * Math.sqrt(days);
        
        // Confidence intervals for YOUR EQUITY
        const intervals = {
            p68: {
                low: expectedValue - projectedStd,
                high: expectedValue + projectedStd,
            },
            p95: {
                low: expectedValue - 1.96 * projectedStd,
                high: expectedValue + 1.96 * projectedStd,
            },
            p99: {
                low: expectedValue - 2.576 * projectedStd,
                high: expectedValue + 2.576 * projectedStd,
            },
        };
        
        // Expected return as percentage
        const expectedReturn = (expectedValue - baseCash) / baseCash;
        
        return {
            currentValue: baseCash,
            expectedValue,
            expectedReturn,
            standardDeviation: projectedStd,
            intervals,
            days,
            leverageRate,
            leveragedDailyReturn,
            leveragedDailyStd,
            baseDailyReturn,
            baseDailyStd,
        };
    },
    
    /**
     * Calculate projections for all time horizons
     * @returns {Object} Projections keyed by days
     */
    calculateAll() {
        const riskMetrics = CalculatorState.results.riskMetrics;
        if (!riskMetrics) {
            console.warn('Risk metrics not available for projection');
            return null;
        }
        
        const baseCash = CalculatorState.config.targetCash;
        const leverageRate = CalculatorState.config.leverageRate || 1;
        
        const projections = {};
        
        for (const days of this.TIME_HORIZONS) {
            projections[days] = this.calculate(
                baseCash,
                riskMetrics.baseDailyReturn,
                riskMetrics.baseDailyVolatility,
                leverageRate,
                days
            );
        }
        
        this.projections = projections;
        return projections;
    },
    
    /**
     * Generate continuous projection data for timeline chart
     * Uses trading days (252 per year)
     * @returns {Object} Continuous projection data with daily values
     */
    calculateContinuous() {
        const riskMetrics = CalculatorState.results.riskMetrics;
        if (!riskMetrics) return null;
        
        const baseCash = CalculatorState.config.targetCash;
        const leverageRate = CalculatorState.config.leverageRate || 1;
        const leveragedDailyReturn = riskMetrics.baseDailyReturn * leverageRate;
        // Leveraged daily volatility (amplified by leverage)
        const leveragedDailyStd = riskMetrics.baseDailyVolatility * leverageRate;
        
        const days = [];
        const expected = [];
        const upper95 = [];
        const lower95 = [];
        const upper68 = [];
        const lower68 = [];
        
        // Use 252 trading days (1 year)
        for (let d = 0; d <= this.TRADING_DAYS_PER_YEAR; d++) {
            days.push(d);
            
            // Expected value at day d
            const expValue = baseCash * Math.pow(1 + leveragedDailyReturn, d);
            
            // Standard deviation at day d: σ_d = E[V_d] × σ_leveraged_daily × √d
            // Volatility scales with √T (square root of time rule)
            const std = expValue * leveragedDailyStd * Math.sqrt(Math.max(d, 1));
            
            expected.push(expValue);
            upper95.push(expValue + 1.96 * std);
            lower95.push(expValue - 1.96 * std);
            upper68.push(expValue + std);
            lower68.push(expValue - std);
        }
        
        return { days, expected, upper95, lower95, upper68, lower68 };
    },
    
    /**
     * Render the continuous timeline chart
     */
    renderContinuousChart() {
        const container = document.getElementById('projChartContinuous');
        if (!container) return;
        
        const data = this.calculateContinuous();
        if (!data) return;
        
        const traces = [];
        
        // 95% confidence band
        traces.push({
            x: [...data.days, ...data.days.slice().reverse()],
            y: [...data.upper95, ...data.lower95.slice().reverse()],
            fill: 'toself',
            type: 'scatter',
            mode: 'none',
            fillcolor: 'rgba(251, 191, 36, 0.15)',
            name: '95% CI',
            hoverinfo: 'skip',
        });
        
        // 68% confidence band
        traces.push({
            x: [...data.days, ...data.days.slice().reverse()],
            y: [...data.upper68, ...data.lower68.slice().reverse()],
            fill: 'toself',
            type: 'scatter',
            mode: 'none',
            fillcolor: 'rgba(16, 185, 129, 0.25)',
            name: '68% CI',
            hoverinfo: 'skip',
        });
        
        // Expected value line
        traces.push({
            x: data.days,
            y: data.expected,
            type: 'scatter',
            mode: 'lines',
            line: { color: '#f59e0b', width: 2 },
            name: 'Expected',
            hovertemplate: 'Day %{x}<br>Expected: $%{y:,.0f}<extra></extra>',
        });
        
        // Upper 95% line
        traces.push({
            x: data.days,
            y: data.upper95,
            type: 'scatter',
            mode: 'lines',
            line: { color: '#fbbf24', width: 1, dash: 'dot' },
            name: '95% Upper',
            hovertemplate: 'Day %{x}<br>95% Upper: $%{y:,.0f}<extra></extra>',
        });
        
        // Lower 95% line
        traces.push({
            x: data.days,
            y: data.lower95,
            type: 'scatter',
            mode: 'lines',
            line: { color: '#fbbf24', width: 1, dash: 'dot' },
            name: '95% Lower',
            hovertemplate: 'Day %{x}<br>95% Lower: $%{y:,.0f}<extra></extra>',
        });
        
        // Current value reference line
        traces.push({
            x: [0, this.TRADING_DAYS_PER_YEAR],
            y: [data.expected[0], data.expected[0]],
            type: 'scatter',
            mode: 'lines',
            line: { color: '#3b82f6', width: 1, dash: 'dash' },
            name: 'Current',
            hoverinfo: 'skip',
        });
        
        // Time horizon markers (trading days)
        const markerDays = this.TIME_HORIZONS; // [21, 63, 126, 252]
        const markerLabels = ['1M', '3M', '6M', '1Y'];
        const markerColors = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b'];
        
        markerDays.forEach((d, i) => {
            traces.push({
                x: [d],
                y: [data.expected[d]],
                type: 'scatter',
                mode: 'markers+text',
                marker: { color: markerColors[i], size: 10, symbol: 'circle' },
                text: [markerLabels[i]],
                textposition: 'top center',
                textfont: { color: markerColors[i], size: 10 },
                name: this.HORIZON_LABELS[d],
                hovertemplate: `${this.HORIZON_LABELS[d]}<br>Expected: $%{y:,.0f}<extra></extra>`,
                showlegend: false,
            });
        });
        
        const layout = {
            autosize: true,
            showlegend: true,
            legend: {
                x: 0,
                y: 1,
                xanchor: 'left',
                bgcolor: 'rgba(17, 24, 39, 0.8)',
                font: { color: '#94a3b8', size: 10 },
            },
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            font: {
                family: "'JetBrains Mono', monospace",
                color: '#94a3b8',
            },
            margin: { l: 70, r: 30, t: 20, b: 50 },
            xaxis: {
                title: 'Trading Days',
                gridcolor: '#2d3748',
                linecolor: '#2d3748',
                tickfont: { size: 10 },
                tickvals: [0, 21, 63, 126, 189, 252],
                ticktext: ['0', '1M', '3M', '6M', '9M', '1Y'],
            },
            yaxis: {
                title: 'Portfolio Value ($)',
                gridcolor: '#2d3748',
                linecolor: '#2d3748',
                tickformat: '$,.0f',
                tickfont: { size: 10 },
            },
            hovermode: 'x unified',
        };
        
        const config = {
            responsive: true,
            displayModeBar: false,
        };
        
        Plotly.newPlot(container, traces, layout, config);
    },
    
    /**
     * Run projection calculation and render all views
     * @returns {Object} Projection data for 1 year (252 trading days) used for summary
     */
    run() {
        // Calculate projections for all horizons
        const projections = this.calculateAll();
        if (!projections) return null;
        
        // Store in state (use 1 year / 252 trading days for main projection)
        CalculatorState.setResult('projection', projections[252]);
        
        // Render continuous chart
        this.renderContinuousChart();
        
        // Return 1 year projection for summary display
        return projections[252];
    },
};

// Export for global access
window.Projection = Projection;

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Projection;
}
