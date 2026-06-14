/**
 * Individual asset analysis with n-day return percentile positioning.
 */

const AssetAnalysis = {
    CALCULATOR_STORAGE_KEY: 'portfolioCalculator_state',
    STORAGE_KEY: 'assetAnalysis_state',

    state: {
        tickers: [],
        activeTicker: null,
        returnWindow: 20,
        lookbackYears: 10,
        trendDays: 20,
        analyses: {},
    },

    async init() {
        this.loadState();
        this.bindEvents();
        this.renderTickers();
        this.renderTabs();
        this.syncControls();

        await API.checkHealth();

        if (this.state.tickers.length > 0) {
            await this.analyzeAll();
        } else {
            this.showPlaceholder();
        }
    },

    bindEvents() {
        document.getElementById('syncCalculatorBtn')?.addEventListener('click', () => {
            this.syncFromCalculator(true);
            this.analyzeAll();
        });

        document.getElementById('addTickerBtn')?.addEventListener('click', () => this.addTicker());
        document.getElementById('tickerInput')?.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') this.addTicker();
        });

        document.getElementById('returnWindowInput')?.addEventListener('change', (event) => {
            this.state.returnWindow = this.clampInteger(event.target.value, 1, 756, 20);
            this.saveState();
        });

        document.getElementById('lookbackYearsInput')?.addEventListener('change', (event) => {
            this.state.lookbackYears = this.clampInteger(event.target.value, 1, 30, 10);
            this.saveState();
        });

        document.getElementById('trendDaysInput')?.addEventListener('change', (event) => {
            this.state.trendDays = this.clampInteger(event.target.value, 2, 252, 20);
            this.saveState();
        });

        document.getElementById('loadDataBtn')?.addEventListener('click', () => this.updateDataAndAnalyze());
        document.getElementById('analyzeBtn')?.addEventListener('click', () => this.analyzeAll());
    },

    loadState() {
        const calculatorDefaults = this.getCalculatorDefaults();

        try {
            const saved = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '{}');
            this.state.tickers = Array.isArray(saved.tickers) && saved.tickers.length
                ? saved.tickers
                : calculatorDefaults.tickers;
            this.state.returnWindow = saved.returnWindow || calculatorDefaults.returnWindow || 20;
            this.state.lookbackYears = saved.lookbackYears || 10;
            this.state.trendDays = saved.trendDays || 20;
            this.state.activeTicker = saved.activeTicker || this.state.tickers[0] || null;
        } catch (error) {
            console.warn('Failed to load asset analysis state:', error);
            this.state.tickers = calculatorDefaults.tickers;
            this.state.returnWindow = calculatorDefaults.returnWindow || 20;
            this.state.trendDays = 20;
            this.state.activeTicker = this.state.tickers[0] || null;
        }
    },

    saveState() {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
            tickers: this.state.tickers,
            activeTicker: this.state.activeTicker,
            returnWindow: this.state.returnWindow,
            lookbackYears: this.state.lookbackYears,
            trendDays: this.state.trendDays,
        }));
    },

    getCalculatorDefaults() {
        try {
            const parsed = JSON.parse(localStorage.getItem(this.CALCULATOR_STORAGE_KEY) || '{}');
            const tickers = (parsed.assets || [])
                .map(asset => asset.ticker)
                .filter(Boolean);

            return {
                tickers: [...new Set(tickers)],
                returnWindow: parsed.config?.lookbackWindow,
            };
        } catch (error) {
            console.warn('Failed to read calculator assets:', error);
            return { tickers: [], returnWindow: 20 };
        }
    },

    syncFromCalculator(showToast = false) {
        const defaults = this.getCalculatorDefaults();
        this.state.tickers = defaults.tickers;
        this.state.returnWindow = defaults.returnWindow || this.state.returnWindow;
        this.state.activeTicker = this.state.tickers[0] || null;
        this.state.analyses = {};
        this.syncControls();
        this.renderTickers();
        this.renderTabs();
        this.saveState();

        if (showToast) {
            Utils.toast(
                this.state.tickers.length
                    ? `Loaded ${this.state.tickers.length} calculator assets`
                    : 'No assets found in Calculator',
                'info'
            );
        }
    },

    syncControls() {
        const returnWindow = document.getElementById('returnWindowInput');
        const lookbackYears = document.getElementById('lookbackYearsInput');
        const trendDays = document.getElementById('trendDaysInput');
        if (returnWindow) returnWindow.value = this.state.returnWindow;
        if (lookbackYears) lookbackYears.value = this.state.lookbackYears;
        if (trendDays) trendDays.value = this.state.trendDays;
    },

    addTicker() {
        const input = document.getElementById('tickerInput');
        const ticker = (input?.value || '').trim().toUpperCase();
        if (!ticker) return;

        if (!this.state.tickers.includes(ticker)) {
            this.state.tickers.push(ticker);
            this.state.activeTicker = ticker;
            this.saveState();
            this.renderTickers();
            this.renderTabs();
            this.analyzeAll();
        }

        input.value = '';
    },

    removeTicker(ticker) {
        this.state.tickers = this.state.tickers.filter(item => item !== ticker);
        delete this.state.analyses[ticker];
        if (this.state.activeTicker === ticker) {
            this.state.activeTicker = this.state.tickers[0] || null;
        }
        this.saveState();
        this.renderTickers();
        this.renderTabs();
        this.renderActiveAnalysis();
    },

    setActiveTicker(ticker) {
        this.state.activeTicker = ticker;
        this.saveState();
        this.renderTabs();
        this.renderActiveAnalysis();
    },

    renderTickers() {
        const container = document.getElementById('selectedTickers');
        if (!container) return;

        if (this.state.tickers.length === 0) {
            container.innerHTML = '<p class="empty-state">No calculator assets found</p>';
            return;
        }

        container.innerHTML = this.state.tickers.map(ticker => `
            <span class="ticker-chip">
                ${ticker}
                <button class="remove-btn" onclick="AssetAnalysis.removeTicker('${ticker}')">&times;</button>
            </span>
        `).join('');
    },

    renderTabs() {
        const tabs = document.getElementById('assetTabs');
        if (!tabs) return;

        if (this.state.tickers.length === 0) {
            tabs.innerHTML = '';
            return;
        }

        tabs.innerHTML = this.state.tickers.map(ticker => `
            <button
                class="asset-subtab ${ticker === this.state.activeTicker ? 'active' : ''}"
                onclick="AssetAnalysis.setActiveTicker('${ticker}')"
            >
                ${ticker}
            </button>
        `).join('');
    },

    async updateDataAndAnalyze() {
        if (this.state.tickers.length === 0) {
            Utils.toast('No tickers selected', 'error');
            return;
        }

        Utils.showLoading('Updating asset data...');
        try {
            for (const ticker of this.state.tickers) {
                await API.loadData(ticker, null, null, 'yfinance');
            }
            Utils.toast('Asset data updated', 'success');
            await this.analyzeAll();
        } catch (error) {
            Utils.toast(`Data update failed: ${error.message}`, 'error');
        } finally {
            Utils.hideLoading();
        }
    },

    async analyzeAll() {
        if (this.state.tickers.length === 0) {
            this.showPlaceholder();
            return;
        }

        Utils.showLoading('Analyzing asset returns...');
        Utils.setStatus('Analyzing asset returns...', 'info');

        try {
            this.state.returnWindow = this.clampInteger(
                document.getElementById('returnWindowInput')?.value,
                1,
                756,
                this.state.returnWindow
            );
            this.state.lookbackYears = this.clampInteger(
                document.getElementById('lookbackYearsInput')?.value,
                1,
                30,
                this.state.lookbackYears
            );
            this.state.trendDays = this.clampInteger(
                document.getElementById('trendDaysInput')?.value,
                2,
                252,
                this.state.trendDays
            );

            const start = this.yearsAgo(this.state.lookbackYears);
            const end = Utils.today();
            const analyses = {};

            for (const ticker of this.state.tickers) {
                try {
                    const response = await API.getPrices(ticker, start, end);
                    const prices = this.normalizePrices(response.data || []);
                    analyses[ticker] = this.buildAnalysis(ticker, prices);
                } catch (error) {
                    analyses[ticker] = { ticker, error: error.message };
                }
            }

            this.state.analyses = analyses;
            this.saveState();
            this.renderActiveAnalysis();
            const validCount = Object.values(analyses).filter(analysis => !analysis.error).length;
            Utils.toast(
                validCount > 0
                    ? `Analysis complete for ${validCount} asset${validCount === 1 ? '' : 's'}`
                    : 'No asset analysis available. Check API status or update data.',
                validCount > 0 ? 'success' : 'error'
            );
        } finally {
            Utils.hideLoading();
        }
    },

    normalizePrices(rows) {
        return rows
            .map(row => ({
                date: row.date,
                price: Number(row.adj_close ?? row.close),
            }))
            .filter(row => row.date && Number.isFinite(row.price) && row.price > 0)
            .sort((a, b) => a.date.localeCompare(b.date));
    },

    buildAnalysis(ticker, prices) {
        const n = this.state.returnWindow;
        if (prices.length <= n) {
            return {
                ticker,
                error: `Need more than ${n} price observations; found ${prices.length}.`,
            };
        }

        const returns = [];
        for (let i = n; i < prices.length; i += 1) {
            returns.push({
                date: prices[i].date,
                value: prices[i].price / prices[i - n].price - 1,
            });
        }

        const values = returns.map(item => item.value).sort((a, b) => a - b);
        const current = returns[returns.length - 1];
        const percentile = this.percentileRank(values, current.value);
        const trend = this.buildPercentileTrend(returns, values);
        const percentiles = {
            min: values[0],
            p10: this.quantile(values, 0.1),
            p25: this.quantile(values, 0.25),
            median: this.quantile(values, 0.5),
            p75: this.quantile(values, 0.75),
            p90: this.quantile(values, 0.9),
            max: values[values.length - 1],
        };

        return {
            ticker,
            prices,
            returns,
            current,
            percentile,
            trend,
            percentiles,
            latestPrice: prices[prices.length - 1],
        };
    },

    renderActiveAnalysis() {
        const analysis = this.state.analyses[this.state.activeTicker];
        if (!this.state.activeTicker || !analysis) {
            this.showPlaceholder();
            return;
        }

        if (analysis.error) {
            this.showPlaceholder(`${analysis.ticker}: ${analysis.error}`);
            return;
        }

        document.getElementById('placeholderContainer').style.display = 'none';
        document.getElementById('analysisContainer').style.display = 'flex';

        const percentile = Math.round(analysis.percentile);
        const color = this.signalColor(analysis.percentile);
        const label = this.signalLabel(analysis.percentile);

        document.getElementById('assetTitle').textContent = analysis.ticker;
        document.getElementById('assetSubtitle').textContent =
            `${this.state.returnWindow}-trading-day return through ${analysis.current.date}`;
        document.getElementById('signalBadge').textContent = label;
        document.getElementById('signalBadge').style.background = color;
        document.getElementById('signalBadge').style.borderColor = color;
        document.getElementById('signalMarker').style.left = `${Math.max(0, Math.min(100, analysis.percentile))}%`;
        document.getElementById('latestPrice').textContent = `$${analysis.latestPrice.price.toFixed(2)}`;
        document.getElementById('currentReturn').textContent = Utils.formatPercent(analysis.current.value, 2);
        document.getElementById('currentReturn').style.color = color;
        document.getElementById('currentPercentile').textContent = `${percentile}%`;
        document.getElementById('currentPercentile').style.color = color;
        document.getElementById('observationCount').textContent = analysis.returns.length.toLocaleString();

        this.renderDistributionTable(analysis);
        this.renderPercentileTrend(analysis);
        this.renderDistributionChart(analysis, color);
    },

    showPlaceholder(message = null) {
        document.getElementById('analysisContainer').style.display = 'none';
        const placeholder = document.getElementById('placeholderContainer');
        placeholder.style.display = 'flex';
        const text = placeholder.querySelector('p');
        if (text) {
            text.textContent = message || 'Load calculator assets, choose an n-day return window, then analyze the current return against history.';
        }
    },

    renderDistributionTable(analysis) {
        const rows = [
            ['10th percentile', analysis.percentiles.p10, 'Historically low n-day return'],
            ['25th percentile', analysis.percentiles.p25, 'Weak side of normal range'],
            ['Median', analysis.percentiles.median, 'Middle of history'],
            ['75th percentile', analysis.percentiles.p75, 'Strong side of normal range'],
            ['90th percentile', analysis.percentiles.p90, 'Historically high n-day return'],
            ['Current', analysis.current.value, `${Math.round(analysis.percentile)}th percentile`],
        ];

        document.querySelector('#distributionTable tbody').innerHTML = rows.map(([label, value, meaning]) => {
            const isCurrent = label === 'Current';
            const color = isCurrent ? this.signalColor(analysis.percentile) : null;
            return `
                <tr class="${isCurrent ? 'distribution-current-row' : ''}">
                    <td>${label}</td>
                    <td>${Utils.formatPercent(value, 2)}</td>
                    <td>
                        ${isCurrent ? `<span class="position-chip" style="background: ${color};">${meaning}</span>` : meaning}
                    </td>
                </tr>
            `;
        }).join('');
    },

    buildPercentileTrend(returns, sortedValues) {
        const trendLength = Math.min(this.state.trendDays, returns.length);
        return returns.slice(-trendLength).map(item => ({
            date: item.date,
            value: item.value,
            percentile: this.percentileRank(sortedValues, item.value),
        }));
    },

    renderPercentileTrend(analysis) {
        const trend = analysis.trend || [];
        if (trend.length === 0) return;

        const start = trend[0];
        const end = trend[trend.length - 1];
        const change = end.percentile - start.percentile;
        const badgeText = this.trendLabel(change, end.percentile);
        const badgeColor = this.trendColor(change);

        document.getElementById('trendSubtitle').textContent =
            `Last ${trend.length} trading days of ${this.state.returnWindow}-day return percentiles`;
        document.getElementById('trendBadge').textContent = badgeText;
        document.getElementById('trendBadge').style.background = badgeColor;
        document.getElementById('trendBadge').style.borderColor = badgeColor;
        document.getElementById('trendStartPercentile').textContent = `${Math.round(start.percentile)}%`;
        document.getElementById('trendEndPercentile').textContent = `${Math.round(end.percentile)}%`;
        document.getElementById('trendEndPercentile').style.color = this.signalColor(end.percentile);
        document.getElementById('trendPercentileChange').textContent =
            `${change >= 0 ? '+' : ''}${change.toFixed(1)} pts`;
        document.getElementById('trendPercentileChange').style.color = badgeColor;

        this.renderPercentileTrendTable(trend);
        this.renderPercentileTrendChart(trend);
    },

    renderPercentileTrendTable(trend) {
        document.querySelector('#percentileTrendTable tbody').innerHTML = trend
            .slice()
            .reverse()
            .map(item => {
                const color = this.signalColor(item.percentile);
                return `
                    <tr>
                        <td>${item.date}</td>
                        <td>${Utils.formatPercent(item.value, 2)}</td>
                        <td>${item.percentile.toFixed(1)}%</td>
                        <td><span class="position-chip" style="background: ${color};">${this.signalLabel(item.percentile)}</span></td>
                    </tr>
                `;
            })
            .join('');
    },

    renderPercentileTrendChart(trend) {
        const dates = trend.map(item => item.date);
        const percentiles = trend.map(item => item.percentile);
        const colors = percentiles.map(value => this.signalColor(value));

        const trace = {
            type: 'scatter',
            mode: 'lines+markers',
            x: dates,
            y: percentiles,
            line: {
                color: '#f1f5f9',
                width: 2,
            },
            marker: {
                size: 9,
                color: colors,
                line: { color: '#0a0e17', width: 1 },
            },
            customdata: trend.map(item => item.value * 100),
            hovertemplate: '%{x}<br>Percentile: %{y:.1f}%<br>Return: %{customdata:.2f}%<extra></extra>',
        };

        const layout = {
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            font: { color: '#f1f5f9', family: 'JetBrains Mono, monospace' },
            margin: { l: 56, r: 24, t: 20, b: 56 },
            xaxis: {
                title: 'Date',
                gridcolor: '#2d3748',
            },
            yaxis: {
                title: 'Percentile',
                range: [0, 100],
                gridcolor: '#2d3748',
                zeroline: false,
            },
            shapes: [
                {
                    type: 'rect',
                    xref: 'paper',
                    x0: 0,
                    x1: 1,
                    y0: 75,
                    y1: 100,
                    fillcolor: 'rgba(239, 68, 68, 0.10)',
                    line: { width: 0 },
                    layer: 'below',
                },
                {
                    type: 'rect',
                    xref: 'paper',
                    x0: 0,
                    x1: 1,
                    y0: 0,
                    y1: 25,
                    fillcolor: 'rgba(16, 185, 129, 0.10)',
                    line: { width: 0 },
                    layer: 'below',
                },
                {
                    type: 'line',
                    xref: 'paper',
                    x0: 0,
                    x1: 1,
                    y0: 50,
                    y1: 50,
                    line: { color: '#f59e0b', width: 1, dash: 'dot' },
                },
            ],
            annotations: [
                {
                    xref: 'paper',
                    x: 1,
                    y: 50,
                    text: 'Median',
                    showarrow: false,
                    xanchor: 'right',
                    yanchor: 'bottom',
                    font: { color: '#f59e0b', size: 11 },
                },
            ],
        };

        Plotly.newPlot('percentileTrendChart', [trace], layout, {
            responsive: true,
            displayModeBar: false,
        });
    },

    renderDistributionChart(analysis, markerColor) {
        const values = analysis.returns.map(item => item.value * 100);
        const current = analysis.current.value * 100;

        const trace = {
            type: 'histogram',
            x: values,
            nbinsx: 36,
            marker: {
                color: 'rgba(148, 163, 184, 0.62)',
                line: { color: 'rgba(241, 245, 249, 0.18)', width: 1 },
            },
            hovertemplate: 'Return: %{x:.2f}%<br>Count: %{y}<extra></extra>',
        };

        const layout = {
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            font: { color: '#f1f5f9', family: 'JetBrains Mono, monospace' },
            margin: { l: 56, r: 24, t: 20, b: 56 },
            xaxis: {
                title: `${this.state.returnWindow}-day return (%)`,
                gridcolor: '#2d3748',
                zerolinecolor: '#64748b',
            },
            yaxis: {
                title: 'Observations',
                gridcolor: '#2d3748',
            },
            bargap: 0.05,
            shapes: [{
                type: 'line',
                x0: current,
                x1: current,
                y0: 0,
                y1: 1,
                yref: 'paper',
                line: { color: markerColor, width: 4 },
            }],
            annotations: [{
                x: current,
                y: 1,
                yref: 'paper',
                text: `Current ${Utils.formatPercent(analysis.current.value, 2)}`,
                showarrow: true,
                arrowhead: 2,
                ax: 0,
                ay: -40,
                bgcolor: markerColor,
                bordercolor: markerColor,
                font: { color: '#0a0e17', size: 12 },
            }],
        };

        Plotly.newPlot('distributionChart', [trace], layout, {
            responsive: true,
            displayModeBar: false,
        });
    },

    percentileRank(sortedValues, value) {
        const count = sortedValues.filter(item => item <= value).length;
        return (count / sortedValues.length) * 100;
    },

    quantile(sortedValues, q) {
        if (sortedValues.length === 0) return null;
        const position = (sortedValues.length - 1) * q;
        const base = Math.floor(position);
        const rest = position - base;
        const next = sortedValues[base + 1];
        return next === undefined
            ? sortedValues[base]
            : sortedValues[base] + rest * (next - sortedValues[base]);
    },

    signalLabel(percentile) {
        if (percentile >= 90) return 'Very High';
        if (percentile >= 75) return 'High';
        if (percentile <= 10) return 'Very Low';
        if (percentile <= 25) return 'Low';
        return 'Neutral';
    },

    trendLabel(change, currentPercentile) {
        if (Math.abs(change) < 5) return 'Stable';
        if (currentPercentile >= 75 && change > 0) return 'Toward High';
        if (currentPercentile <= 25 && change < 0) return 'Toward Low';
        if ((currentPercentile > 50 && change < 0) || (currentPercentile < 50 && change > 0)) {
            return 'Toward Median';
        }
        return change > 0 ? 'Rising' : 'Falling';
    },

    trendColor(change) {
        if (Math.abs(change) < 5) return '#f59e0b';
        return change > 0 ? '#ef4444' : '#10b981';
    },

    signalColor(percentile) {
        const clamped = Math.max(0, Math.min(100, percentile)) / 100;
        const stops = [
            { p: 0, rgb: [16, 185, 129] },
            { p: 0.5, rgb: [245, 158, 11] },
            { p: 1, rgb: [239, 68, 68] },
        ];
        const left = clamped <= 0.5 ? stops[0] : stops[1];
        const right = clamped <= 0.5 ? stops[1] : stops[2];
        const local = (clamped - left.p) / (right.p - left.p);
        const rgb = left.rgb.map((channel, index) => Math.round(channel + (right.rgb[index] - channel) * local));
        return `rgb(${rgb.join(', ')})`;
    },

    yearsAgo(years) {
        const date = new Date();
        date.setFullYear(date.getFullYear() - years);
        return Utils.formatDate(date);
    },

    clampInteger(value, min, max, fallback) {
        const parsed = parseInt(value, 10);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.max(min, Math.min(max, parsed));
    },
};

document.addEventListener('DOMContentLoaded', () => {
    AssetAnalysis.init();
});
