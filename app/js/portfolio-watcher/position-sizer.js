/**
 * Position Sizer
 * Calculates target positions and trade orders
 */

const PositionSizer = {
    /**
     * Calculate target positions for the portfolio
     * @param {number} targetCash - Total portfolio value
     * @param {Object} weights - {ticker: weight} (should sum to 1)
     * @param {Object} prices - {ticker: {price, ...}}
     * @param {Object} explicitTargetShares - Optional {ticker: shares} to bypass rounding from target dollar
     * @returns {Object} Position details by ticker
     */
    calculateTargetPositions(targetCash, weights, prices, explicitTargetShares = null) {
        const positions = {};
        let totalActual = 0;
        let totalTarget = 0;
        
        for (const [ticker, weight] of Object.entries(weights)) {
            const priceInfo = prices[ticker];
            if (!priceInfo) {
                console.warn(`No price data for ${ticker}`);
                continue;
            }
            
            const price = priceInfo.price;
            
            // Target dollar amount for this asset
            let targetDollar = targetCash * weight;
            
            // Target shares (round to nearest integer)
            let targetShares = Math.round(targetDollar / price);
            if (explicitTargetShares && explicitTargetShares[ticker] !== undefined) {
                targetShares = Math.max(0, Math.round(explicitTargetShares[ticker]));
                targetDollar = targetShares * price;
            }
            
            // Actual dollar value at target shares
            const actualDollar = targetShares * price;
            
            // Rounding drift
            const drift = targetDollar > 0 ? (actualDollar - targetDollar) / targetDollar : 0;
            
            positions[ticker] = {
                ticker,
                weight,
                targetDollar,
                price,
                priceDate: priceInfo.date,
                targetShares,
                actualDollar,
                drift,
            };
            
            totalActual += actualDollar;
            totalTarget += targetDollar;
        }
        
        // Add totals
        positions._totals = {
            targetDollar: totalTarget,
            actualDollar: totalActual,
            drift: totalTarget > 0 ? (totalActual - totalTarget) / totalTarget : 0,
        };
        
        return positions;
    },
    
    /**
     * Calculate trade orders based on current holdings
     * @param {Object} targetPositions - From calculateTargetPositions
     * @param {Object} currentHoldings - {ticker: shares}
     * @returns {Object} Trade orders by ticker
     */
    calculateTradeOrders(targetPositions, currentHoldings) {
        const orders = [];
        let totalBuyValue = 0;
        let totalSellValue = 0;
        
        for (const [ticker, position] of Object.entries(targetPositions)) {
            // Skip totals
            if (ticker === '_totals') continue;
            
            const currentShares = currentHoldings[ticker] || 0;
            const delta = position.targetShares - currentShares;
            
            let action, shares, tradeValue;
            
            if (delta > 0) {
                action = 'BUY';
                shares = delta;
                tradeValue = shares * position.price;
                totalBuyValue += tradeValue;
            } else if (delta < 0) {
                action = 'SELL';
                shares = Math.abs(delta);
                tradeValue = shares * position.price;
                totalSellValue += tradeValue;
            } else {
                action = 'HOLD';
                shares = 0;
                tradeValue = 0;
            }
            
            orders.push({
                ticker,
                action,
                shares,
                price: position.price,
                tradeValue,
                currentShares,
                targetShares: position.targetShares,
                currentValue: currentShares * position.price,
                targetValue: position.actualDollar,
            });
        }
        
        // Sort: BUY first, then SELL, then HOLD
        const actionOrder = { BUY: 0, SELL: 1, HOLD: 2 };
        orders.sort((a, b) => {
            const orderDiff = actionOrder[a.action] - actionOrder[b.action];
            if (orderDiff !== 0) return orderDiff;
            return b.tradeValue - a.tradeValue;
        });
        
        return {
            orders,
            totals: {
                buyValue: totalBuyValue,
                sellValue: totalSellValue,
                netCashFlow: totalSellValue - totalBuyValue,
            },
        };
    },
    
    /**
     * Calculate positions and orders in one call
     * @param {Object} options - Optional override settings
     * @returns {Object} {positions, orders}
     */
    calculate(options = {}) {
        const targetCash = PortfolioWatcherState.config.targetCash;
        const leverageRate = options.leverageRate || PortfolioWatcherState.config.leverageRate || 1;
        const weights = options.weights || PortfolioWatcherState.getWeights();
        const prices = PortfolioWatcherState.prices;
        const holdings = PortfolioWatcherState.getCurrentHoldings();
        
        // Apply leverage to get effective buying power
        const leveragedCash = options.effectiveBuyingPower || (targetCash * leverageRate);
        
        // Calculate positions with leveraged buying power
        const positions = this.calculateTargetPositions(
            leveragedCash,
            weights,
            prices,
            options.explicitTargetShares || null
        );
        
        // Calculate trade orders
        const orders = this.calculateTradeOrders(positions, holdings);
        
        // Store in state
        PortfolioWatcherState.setResult('positions', positions);
        PortfolioWatcherState.setResult('tradeOrders', orders);
        
        return { positions, orders };
    },
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PositionSizer;
}
