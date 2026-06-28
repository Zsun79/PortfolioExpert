/**
 * Risk Analysis Module
 * Calculates expected return, variance, volatility, Sharpe ratio, and VaR
 */

const RiskAnalysis = {
    // Trading days per year for annualization
    TRADING_DAYS_PER_YEAR: 252,
    
    // Z-scores for VaR confidence levels
    Z_SCORES: {
        0.90: 1.282,
        0.95: 1.645,
        0.99: 2.326,
    },
    
    /**
     * Calculate daily returns from price history
     * @param {Array} prices - Array of {date, adjClose}
     * @returns {Array} Array of daily returns
     */
    calculateDailyReturns(prices) {
        if (!prices || prices.length < 2) {
            return [];
        }
        
        const returns = [];
        for (let i = 1; i < prices.length; i++) {
            const prevPrice = prices[i - 1].adjClose;
            const currPrice = prices[i].adjClose;
            if (prevPrice > 0) {
                returns.push((currPrice - prevPrice) / prevPrice);
            }
        }
        return returns;
    },

    /**
     * Normalize raw price rows into valid date/price points
     * @param {Array} prices - Array of {date, adjClose}
     * @returns {Array} Cleaned and sorted price points
     */
    normalizePriceSeries(prices) {
        if (!Array.isArray(prices)) {
            return [];
        }

        return prices
            .map(point => ({
                date: point?.date,
                adjClose: Number(point?.adjClose),
            }))
            .filter(point => point.date && Number.isFinite(point.adjClose) && point.adjClose > 0)
            .sort((a, b) => a.date.localeCompare(b.date));
    },

    /**
     * Align multiple price series on common trading dates
     * @param {Object} priceHistory - {ticker: [{date, adjClose}]}
     * @param {string[]} tickers - Tickers to align
     * @returns {Object} {alignedPrices, commonDates}
     */
    alignPriceSeriesByDate(priceHistory, tickers) {
        const normalized = {};
        const validTickers = tickers.filter(ticker => {
            const series = this.normalizePriceSeries(priceHistory[ticker]);
            if (series.length < 2) {
                return false;
            }
            normalized[ticker] = series;
            return true;
        });

        if (validTickers.length === 0) {
            return { alignedPrices: {}, commonDates: [] };
        }

        let commonDates = new Set(normalized[validTickers[0]].map(point => point.date));
        for (let i = 1; i < validTickers.length; i++) {
            const dates = new Set(normalized[validTickers[i]].map(point => point.date));
            commonDates = new Set([...commonDates].filter(date => dates.has(date)));
        }

        const orderedDates = [...commonDates].sort();
        const alignedPrices = {};
        validTickers.forEach(ticker => {
            const priceMap = new Map(normalized[ticker].map(point => [point.date, point.adjClose]));
            alignedPrices[ticker] = orderedDates.map(date => ({
                date,
                adjClose: priceMap.get(date),
            }));
        });

        return { alignedPrices, commonDates: orderedDates };
    },
    
    /**
     * Calculate weighted portfolio returns on common trading dates
     * @param {Object} priceHistory - {ticker: [{date, adjClose}]}
     * @param {Object} weights - {ticker: weight}
     * @returns {Array} Array of daily portfolio returns
     */
    calculatePortfolioReturns(priceHistory, weights) {
        return this.calculatePortfolioReturnSeries(priceHistory, weights).map(point => point.return);
    },

    /**
     * Calculate weighted portfolio returns on common trading dates with dates
     * @param {Object} priceHistory - {ticker: [{date, adjClose}]}
     * @param {Object} weights - {ticker: weight}
     * @returns {Array} Array of {date, return}
     */
    calculatePortfolioReturnSeries(priceHistory, weights) {
        const tickers = Object.entries(weights)
            .filter(([, weight]) => weight !== undefined)
            .map(([ticker]) => ticker);
        const { alignedPrices } = this.alignPriceSeriesByDate(priceHistory, tickers);
        const alignedTickers = Object.keys(alignedPrices);

        if (alignedTickers.length === 0) {
            return [];
        }

        const assetReturns = {};
        alignedTickers.forEach(ticker => {
            assetReturns[ticker] = this.calculateDailyReturns(alignedPrices[ticker]);
        });

        const returnLength = Math.min(...alignedTickers.map(ticker => assetReturns[ticker].length));
        if (!Number.isFinite(returnLength) || returnLength <= 0) {
            return [];
        }

        const portfolioReturns = [];
        for (let i = 0; i < returnLength; i++) {
            const dayReturn = alignedTickers.reduce((sum, ticker) => {
                return sum + ((weights[ticker] || 0) * assetReturns[ticker][i]);
            }, 0);
            portfolioReturns.push({
                date: alignedPrices[alignedTickers[0]][i + 1].date,
                return: dayReturn,
            });
        }

        return portfolioReturns;
    },
    
    /**
     * Calculate mean of an array
     * @param {Array} arr - Array of numbers
     * @returns {number} Mean
     */
    mean(arr) {
        if (!arr || arr.length === 0) return 0;
        return arr.reduce((a, b) => a + b, 0) / arr.length;
    },
    
    /**
     * Calculate sample standard deviation
     * @param {Array} arr - Array of numbers
     * @param {number} mean - Pre-calculated mean (optional)
     * @returns {number} Standard deviation
     */
    stdDev(arr, mean = null) {
        if (!arr || arr.length < 2) return 0;
        
        if (mean === null) {
            mean = this.mean(arr);
        }
        
        const squaredDiffs = arr.map(x => Math.pow(x - mean, 2));
        const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (arr.length - 1);
        return Math.sqrt(variance);
    },
    
    /**
     * Calculate expected return statistics
     * @param {Array} portfolioReturns - Daily portfolio returns
     * @returns {Object} Return statistics
     */
    calculateExpectedReturn(portfolioReturns) {
        const dailyMean = this.mean(portfolioReturns);
        const annualizedArithmeticReturn = dailyMean * this.TRADING_DAYS_PER_YEAR;
        const compoundedGrowth = portfolioReturns.reduce((growth, dailyReturn) => {
            return growth * (1 + dailyReturn);
        }, 1);
        const annualizedReturn = portfolioReturns.length > 0
            ? Math.pow(compoundedGrowth, this.TRADING_DAYS_PER_YEAR / portfolioReturns.length) - 1
            : 0;
        
        return {
            dailyReturn: dailyMean,
            annualizedArithmeticReturn,
            annualizedReturn: annualizedReturn,
        };
    },
    
    /**
     * Calculate volatility statistics
     * @param {Array} portfolioReturns - Daily portfolio returns
     * @returns {Object} Volatility statistics
     */
    calculateVolatility(portfolioReturns) {
        const dailyMean = this.mean(portfolioReturns);
        const dailyStdDev = this.stdDev(portfolioReturns, dailyMean);
        const annualizedVolatility = dailyStdDev * Math.sqrt(this.TRADING_DAYS_PER_YEAR);
        
        return {
            dailyVolatility: dailyStdDev,
            annualizedVolatility: annualizedVolatility,
            dailyVariance: dailyStdDev * dailyStdDev,
        };
    },
    
    /**
     * Calculate Sharpe ratio
     * @param {number} annualizedReturn - Annualized portfolio return
     * @param {number} annualizedVolatility - Annualized volatility
     * @param {number} riskFreeRate - Annual risk-free rate
     * @returns {number} Sharpe ratio
     */
    calculateSharpeRatio(annualizedReturn, annualizedVolatility, riskFreeRate) {
        if (annualizedVolatility === 0) return 0;
        return (annualizedReturn - riskFreeRate) / annualizedVolatility;
    },
    
    /**
     * Calculate Value at Risk
     * @param {number} portfolioValue - Current portfolio value
     * @param {number} dailyVolatility - Daily volatility (std dev)
     * @param {number} days - Time horizon (e.g., 1 or 30)
     * @param {number} confidenceLevel - Confidence level (e.g., 0.95)
     * @returns {number} VaR (positive value representing potential loss)
     */
    calculateVaR(portfolioValue, dailyVolatility, days, confidenceLevel) {
        const z = this.Z_SCORES[confidenceLevel] || 1.645;
        const periodVolatility = dailyVolatility * Math.sqrt(days);
        return portfolioValue * periodVolatility * z;
    },

    /**
     * Calculate maximum drawdown from a return series
     * Drawdown is measured peak-to-trough, where the peak must occur first.
     * @param {Array} returns - Period returns
     * @param {number} startingValue - Starting portfolio value
     * @returns {number} Max drawdown as a positive decimal
     */
    calculateMaxDrawdown(returns, startingValue = 1) {
        if (!Array.isArray(returns) || returns.length === 0 || startingValue <= 0) {
            return 0;
        }

        let equity = startingValue;
        let peak = startingValue;
        let maxDrawdown = 0;

        for (const periodReturn of returns) {
            equity *= (1 + periodReturn);
            peak = Math.max(peak, equity);
            const drawdown = peak > 0 ? (peak - equity) / peak : 0;
            maxDrawdown = Math.max(maxDrawdown, drawdown);
        }

        return maxDrawdown;
    },

    /**
     * Calculate inclusive calendar-day span between two YYYY-MM-DD dates
     * @param {string} startDate - Episode start date
     * @param {string} endDate - Episode end date
     * @returns {number} Inclusive day count
     */
    calculateInclusiveDateCount(startDate, endDate) {
        if (!startDate || !endDate) return 0;

        const start = new Date(`${startDate}T00:00:00Z`);
        const end = new Date(`${endDate}T00:00:00Z`);
        const msPerDay = 24 * 60 * 60 * 1000;
        const diff = Math.round((end - start) / msPerDay);

        return diff >= 0 ? diff + 1 : 0;
    },

    /**
     * Calculate top drawdown episodes from a dated return series
     * @param {Array} returnSeries - Array of {date, return}
     * @param {number} startingValue - Starting portfolio value
     * @param {number} limit - Maximum number of episodes
     * @returns {Array} Ranked drawdown episodes
     */
    calculateTopDrawdowns(returnSeries, startingValue = 1, limit = 10) {
        if (!Array.isArray(returnSeries) || returnSeries.length === 0 || startingValue <= 0) {
            return [];
        }

        let equity = startingValue;
        let peakValue = startingValue;
        let peakDate = returnSeries[0].date;
        let worstEpisode = null;
        const episodes = [];

        for (let i = 0; i < returnSeries.length; i++) {
            const point = returnSeries[i];
            equity *= (1 + point.return);

            if (equity >= peakValue) {
                if (worstEpisode && worstEpisode.endDate) {
                    worstEpisode.dateCount = this.calculateInclusiveDateCount(
                        worstEpisode.startDate,
                        worstEpisode.endDate
                    );
                    episodes.push(worstEpisode);
                    worstEpisode = null;
                }
                peakValue = equity;
                peakDate = point.date;
                continue;
            }

            const drawdown = peakValue > 0 ? (peakValue - equity) / peakValue : 0;
            const startDate = peakDate;
            const endDate = point.date;
            const dateCount = this.calculateInclusiveDateCount(startDate, endDate);

            if (!worstEpisode || drawdown > worstEpisode.drawdown) {
                worstEpisode = {
                    drawdown,
                    startDate,
                    endDate,
                    dateCount,
                };
            }
        }

        if (worstEpisode && worstEpisode.endDate) {
            worstEpisode.dateCount = this.calculateInclusiveDateCount(
                worstEpisode.startDate,
                worstEpisode.endDate
            );
            episodes.push(worstEpisode);
        }

        return episodes
            .sort((a, b) => b.drawdown - a.drawdown)
            .slice(0, limit);
    },
    
    /**
     * Calculate daily returns WITH dates from price history
     * @param {Array} prices - Array of {date, adjClose}
     * @returns {Array} Array of {date, return}
     */
    calculateDailyReturnsWithDates(prices) {
        const normalized = this.normalizePriceSeries(prices);
        if (normalized.length < 2) {
            return [];
        }
        
        const returns = [];
        for (let i = 1; i < normalized.length; i++) {
            const prevPrice = normalized[i - 1].adjClose;
            const currPrice = normalized[i].adjClose;
            if (prevPrice > 0 && Number.isFinite(currPrice)) {
                returns.push({
                    date: normalized[i].date,
                    return: (currPrice - prevPrice) / prevPrice,
                });
            }
        }
        return returns;
    },
    
    /**
     * Calculate correlation between two aligned return series
     * @param {Array} returns1 - First return series
     * @param {Array} returns2 - Second return series
     * @returns {number} Correlation coefficient (-1 to 1)
     */
    calculateCorrelation(returns1, returns2) {
        const n = Math.min(returns1?.length || 0, returns2?.length || 0);
        if (n < 2) return 0;

        const aligned1 = returns1.slice(0, n);
        const aligned2 = returns2.slice(0, n);
        
        // Calculate means
        const mean1 = this.mean(aligned1);
        const mean2 = this.mean(aligned2);
        
        // Calculate correlation
        let sumProduct = 0;
        let sumSq1 = 0;
        let sumSq2 = 0;
        
        for (let i = 0; i < n; i++) {
            const diff1 = aligned1[i] - mean1;
            const diff2 = aligned2[i] - mean2;
            sumProduct += diff1 * diff2;
            sumSq1 += diff1 * diff1;
            sumSq2 += diff2 * diff2;
        }
        
        const denom = Math.sqrt(sumSq1 * sumSq2);
        if (denom === 0) return 0;
        
        return sumProduct / denom;
    },
    
    /**
     * Calculate correlation matrix for all assets
     * @param {Object} priceHistory - {ticker: [{date, adjClose}]}
     * @returns {Object} {tickers: [], matrix: [][], commonDates: number}
     */
    calculateCorrelationMatrix(priceHistory) {
        const tickers = Object.keys(priceHistory);
        const n = tickers.length;
        
        if (n === 0) return { tickers: [], matrix: [], commonDates: 0 };
        const { alignedPrices, commonDates } = this.alignPriceSeriesByDate(priceHistory, tickers);
        const alignedTickers = tickers.filter(ticker => alignedPrices[ticker]?.length >= 2);

        if (alignedTickers.length === 0) {
            return { tickers: [], matrix: [], commonDates: 0 };
        }

        const assetReturns = {};
        alignedTickers.forEach(ticker => {
            assetReturns[ticker] = this.calculateDailyReturns(alignedPrices[ticker]);
        });
        
        // Build correlation matrix
        const matrix = [];
        
        for (let i = 0; i < alignedTickers.length; i++) {
            const row = [];
            for (let j = 0; j < alignedTickers.length; j++) {
                if (i === j) {
                    row.push(1.0); // Self-correlation is 1
                } else if (j < i) {
                    row.push(matrix[j][i]); // Matrix is symmetric
                } else {
                    const corr = this.calculateCorrelation(
                        assetReturns[alignedTickers[i]],
                        assetReturns[alignedTickers[j]]
                    );
                    row.push(corr);
                }
            }
            matrix.push(row);
        }
        
        return { 
            tickers: alignedTickers, 
            matrix, 
            commonDates: Math.max(commonDates.length - 1, 0),
        };
    },
    
    /**
     * Run full risk analysis
     * @param {Object} priceHistory - {ticker: [{date, adjClose}]}
     * @returns {Object} Complete risk metrics
     */
    async analyze(priceHistory = null) {
        // Fetch historical prices if not provided
        if (!priceHistory) {
            const window = PortfolioWatcherState.config.lookbackWindow;
            priceHistory = await DataManager.fetchHistoricalPrices(window);
        }
        
        const weights = PortfolioWatcherState.getWeights();
        const targetCash = PortfolioWatcherState.config.targetCash;
        const leverageRate = PortfolioWatcherState.config.leverageRate || 1;
        const riskFreeRate = 0;
        
        // Gross exposure (position size) shown for reference only.
        // Risk metrics below are computed on equity/cash basis.
        const grossExposure = targetCash * leverageRate;
        
        // Calculate portfolio returns
        const portfolioReturnSeries = this.calculatePortfolioReturnSeries(priceHistory, weights);
        const portfolioReturns = portfolioReturnSeries.map(point => point.return);
        
        if (portfolioReturns.length === 0) {
            return null;
        }
        
        // Calculate base asset-only metrics before leverage is applied.
        const returnStats = this.calculateExpectedReturn(portfolioReturns);
        const volStats = this.calculateVolatility(portfolioReturns);
        
        // Translate the asset basket into equity/cash returns.
        // Using target cash as the base means leverage scales both return and volatility.
        const leveragedDailyReturn = returnStats.dailyReturn * leverageRate;
        const leveragedAnnualizedArithmeticReturn =
            returnStats.annualizedArithmeticReturn * leverageRate;
        const leveragedDailyVolatility = volStats.dailyVolatility * leverageRate;
        const leveragedAnnualizedVolatility = volStats.annualizedVolatility * leverageRate;
        const leveragedAnnualizedReturn = Math.pow(
            1 + leveragedDailyReturn,
            this.TRADING_DAYS_PER_YEAR
        ) - 1;
        const leveragedPortfolioReturns = portfolioReturns.map(periodReturn => periodReturn * leverageRate);
        const leveragedPortfolioReturnSeries = portfolioReturnSeries.map(point => ({
            date: point.date,
            return: point.return * leverageRate,
        }));
        
        // Sharpe ratio calculation (uses leveraged metrics)
        // Note: Sharpe ratio remains the same with leverage (both return and vol scale equally)
        // But we calculate based on leveraged values for consistency
        const sharpeRatio = this.calculateSharpeRatio(
            leveragedAnnualizedArithmeticReturn,
            leveragedAnnualizedVolatility,
            riskFreeRate
        );
        const maxDrawdown = this.calculateMaxDrawdown(leveragedPortfolioReturns, targetCash);
        const topDrawdowns = this.calculateTopDrawdowns(leveragedPortfolioReturnSeries, targetCash);
        
        // IMPORTANT: compute VaR in dollars on the investor's equity/cash base
        // (not on gross leveraged position size).
        const var95_1d = this.calculateVaR(targetCash, leveragedDailyVolatility, 1, 0.95);
        const var99_1d = this.calculateVaR(targetCash, leveragedDailyVolatility, 1, 0.99);
        const var95_30d = this.calculateVaR(targetCash, leveragedDailyVolatility, 30, 0.95);
        const var99_30d = this.calculateVaR(targetCash, leveragedDailyVolatility, 30, 0.99);
        
        // Calculate correlation matrix
        const correlationData = this.calculateCorrelationMatrix(priceHistory);
        
        const metrics = {
            // Return metrics (leveraged)
            dailyReturn: leveragedDailyReturn,
            annualizedReturn: leveragedAnnualizedReturn,
            
            // Volatility metrics (leveraged)
            dailyVolatility: leveragedDailyVolatility,
            annualizedVolatility: leveragedAnnualizedVolatility,
            
            // Base (unleveraged) metrics for projection calculations
            baseDailyReturn: returnStats.dailyReturn,
            baseAnnualizedArithmeticReturn: returnStats.annualizedArithmeticReturn,
            baseDailyVolatility: volStats.dailyVolatility,
            baseAnnualizedReturn: returnStats.annualizedReturn,
            baseAnnualizedVolatility: volStats.annualizedVolatility,
            
            // Risk-adjusted
            sharpeRatio: sharpeRatio,
            maxDrawdown: maxDrawdown,
            topDrawdowns,
            
            // VaR (dollar loss on equity/cash base)
            var95_1d: var95_1d,
            var99_1d: var99_1d,
            var95_30d: var95_30d,
            var99_30d: var99_30d,
            
            // Correlation matrix
            correlation: correlationData,
            
            // Leverage info
            leverageRate: leverageRate,
            grossExposure: grossExposure,
            baseCash: targetCash,
            
            // Raw data for projection (base unleveraged returns)
            portfolioReturns: portfolioReturns,
            portfolioReturnSeries,
            dataPoints: portfolioReturns.length,
        };
        
        // Store in state
        PortfolioWatcherState.setResult('riskMetrics', metrics);
        
        return metrics;
    },
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RiskAnalysis;
}
