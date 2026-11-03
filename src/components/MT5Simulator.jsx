"use client";

import React, { useState, useEffect, useRef } from "react";
import styles from "./MT5Simulator.module.css";
import useLivePrices from "./useLivePrices";
import {
  Menu, Wallet, ArrowUpDown, FilePlus, Activity,
  CandlestickChart, History, MessageSquare, X, Plus,
  ChevronDown, RotateCcw, ArrowLeft
} from "lucide-react";

const INITIAL_QUOTES = [
  { symbol: "EURUSD", bid: 1.08450, ask: 1.08465, change: 0.12 },
  { symbol: "XAUUSD", bid: 3907.00, ask: 3907.17, change: -0.45 },
  { symbol: "GBPUSD", bid: 1.26320, ask: 1.26340, change: 0.08 },
  { symbol: "USDJPY", bid: 149.450, ask: 149.465, change: 0.25 },
];

// Profit in USD for a position at a given price
const calcProfit = (base, type, volume, openPrice, price) => {
  const diff = type === "buy" ? price - openPrice : openPrice - price;
  const contractSize = base === "XAUUSD" ? 100 : 100000;
  let profit = diff * volume * contractSize;
  if (base === "USDJPY") profit /= price; // JPY profit converted to USD
  return profit;
};

// Step size / decimals used by the +/- buttons on the order page
const symbolMeta = (sym) =>
  sym === "XAUUSD" ? { step: 0.1, dp: 2 }
  : sym === "USDJPY" ? { step: 0.01, dp: 3 }
  : { step: 0.0001, dp: 5 };

export default function MT5Simulator() {
  const [activeTab, setActiveTab] = useState("trade");
  const [subView, setSubView] = useState(null); // For New Order page
  const { quotes, quotesRef, status: priceStatus } = useLivePrices(INITIAL_QUOTES);
  
  // UI States
  const [showSidebar, setShowSidebar] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [sortBy, setSortBy] = useState("Symbol");
  const [sortAsc, setSortAsc] = useState(true);

  // Trade States
  const [account, setAccount] = useState({ balance: 10000.0, equity: 10000.0, margin: 0, freeMargin: 10000.0, marginLevel: 0 });
  const [positions, setPositions] = useState([]);
  const [history, setHistory] = useState([]);
  const [orderError, setOrderError] = useState("");
  
  // New Order State
  const [newOrder, setNewOrder] = useState({
    symbol: "XAUUSD", type: "buy", volume: 0.01, sl: "", tp: "", price: 0
  });

  const positionsRef = useRef(positions);
  positionsRef.current = positions;

   // --- CORE ENGINE: Live Ticker, SL/TP Checks, and P&L ---
  useEffect(() => {
    // SL/TP + P&L ENGINE (checks 10x per second against the latest tick)
    const engineInterval = setInterval(() => {
      const current = positionsRef.current;
      if (!current.length) return;

      const closed = [];
      const stillOpen = [];

      current.forEach((pos) => {
        const base = pos.symbol.replace(".pro", "");
        const q = quotesRef.current.find((x) => x.symbol === base);
        if (!q) { stillOpen.push(pos); return; }

        const isBuy = pos.type === "buy";
        const marketPx = isBuy ? q.bid : q.ask;
        // Price starts at the entry and then moves 1:1 with the live market
        const anchor = pos.anchor ?? pos.openPrice;
        const price = pos.openPrice + (marketPx - anchor);
        const profit = calcProfit(base, pos.type, pos.volume, pos.openPrice, price);
        const updated = { ...pos, currentPrice: price, profit };

        // Stop Loss is intentionally display-only: it NEVER closes a trade.
        // Only Take Profit closes automatically (filled at the TP price).
        const tpHit = pos.tp > 0 && (isBuy ? price >= pos.tp : price <= pos.tp);

        if (tpHit) {
          closed.push({
            ...updated,
            currentPrice: pos.tp,
            closePrice: pos.tp,
            profit: calcProfit(base, pos.type, pos.volume, pos.openPrice, pos.tp),
            closeTime: new Date().toLocaleTimeString(),
            reason: "TP",
          });
        } else {
          stillOpen.push(updated);
        }
      });

      setPositions(stillOpen);
      if (closed.length) {
        const pnl = closed.reduce((s, p) => s + p.profit, 0);
        setAccount((prev) => ({ ...prev, balance: prev.balance + pnl }));
        setHistory((prev) => [...closed.reverse(), ...prev]);
      }
    }, 100);

    // CLEANUP
    return () => {
      clearInterval(engineInterval);
    };
  }, []);

  // --- RECALCULATE ACCOUNT METRICS ---
  useEffect(() => {
    const floatingProfit = positions.reduce((sum, pos) => sum + pos.profit, 0);
    const usedMargin = positions.reduce((sum, pos) => sum + (pos.volume * 1000), 0);
    const equity = account.balance + floatingProfit;
    const freeMargin = equity - usedMargin;
    const marginLevel = usedMargin > 0 ? (equity / usedMargin) * 100 : 0;

    setAccount((prev) => ({ ...prev, equity, margin: usedMargin, freeMargin, marginLevel }));
  }, [positions, account.balance]);

  // --- ACTIONS ---
  const handleOpenNewOrderPage = (symbol = "XAUUSD", type = "buy") => {
    const q = quotes.find(q => q.symbol === symbol);
    setNewOrder({
      symbol,
      type,
      volume: 0.01,
      sl: "",
      tp: "",
      price: "" // empty = market price; type a number to enter manually
    });
    setOrderError("");
    setSubView("order");
    setShowSidebar(false);
  };

  const setField = (field, value) => {
    setOrderError("");
    setNewOrder((o) => ({ ...o, [field]: value }));
  };

  const nudge = (field, dir) => {
    const q = quotes.find((x) => x.symbol === newOrder.symbol);
    const { step, dp } = symbolMeta(newOrder.symbol);
    const ref = parseFloat(newOrder.price) || (q ? (q.bid + q.ask) / 2 : 0);
    const base = parseFloat(newOrder[field]) || ref;
    setField(field, (base + dir * step).toFixed(dp));
  };

  const executeOrder = (type) => {
    const q = quotes.find((x) => x.symbol === newOrder.symbol);
    const isBuy = type === "buy";

    // Entry price: typed value, or market if the field is empty
    const hasTyped = String(newOrder.price).trim() !== "";
    const typed = parseFloat(newOrder.price);
    if (hasTyped && !(typed > 0)) {
      setOrderError("Invalid price. Enter a number, or clear it to use the market price.");
      return;
    }
    const price = hasTyped ? typed : (isBuy ? q.ask : q.bid);

    const sl = parseFloat(newOrder.sl) || 0;
    const tp = parseFloat(newOrder.tp) || 0;
    if (sl > 0 && (isBuy ? sl >= price : sl <= price)) {
      setOrderError(`Invalid S/L: for a ${type} it must be ${isBuy ? "below" : "above"} the entry price.`);
      return;
    }
    if (tp > 0 && (isBuy ? tp <= price : tp >= price)) {
      setOrderError(`Invalid T/P: for a ${type} it must be ${isBuy ? "above" : "below"} the entry price.`);
      return;
    }

    const volume = parseFloat(newOrder.volume);
    const base = newOrder.symbol;
    const marketNow = isBuy ? q.bid : q.ask;
    // Manual entry: anchor to the market right now, so profit starts at 0 from the typed price.
    // Market entry: anchor to the fill price, so the normal spread cost still shows.
    const anchor = hasTyped ? marketNow : price;
    const startPrice = price + (marketNow - anchor);

    const pos = {
      id: Date.now(),
      symbol: base === "XAUUSD" ? "XAUUSD.pro" : base,
      type,
      volume,
      openPrice: price,
      anchor,
      currentPrice: startPrice,
      sl,
      tp,
      profit: calcProfit(base, type, volume, price, startPrice),
      openTime: new Date().toLocaleTimeString()
    };

    setPositions([pos, ...positions]);
    setOrderError("");
    setSubView(null);
    setActiveTab("trade");
  };

  const closePosition = (id) => {
    const pos = positions.find(p => p.id === id);
    if (!pos) return;
    
    setAccount(prev => ({ ...prev, balance: prev.balance + pos.profit }));
    setPositions(prev => prev.filter(p => p.id !== id));
    setHistory(prev => [{ 
      ...pos, closePrice: pos.currentPrice, profit: pos.profit, 
      closeTime: new Date().toLocaleTimeString(), reason: "Manual" 
    }, ...prev]);
  };

  // Sorting Logic
  const sortedPositions = [...positions].sort((a, b) => {
    let valA = a[sortBy.toLowerCase()];
    let valB = b[sortBy.toLowerCase()];
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();
    if (valA < valB) return sortAsc ? -1 : 1;
    if (valA > valB) return sortAsc ? 1 : -1;
    return 0;
  });

  // --- RENDER NEW ORDER PAGE ---
  if (subView === "order") {
    return (
      <div className={styles.pageWrapper}>
        <div className={styles.mobileContainer}>
          <header className={styles.header}>
            <div className={styles.headerLeft} onClick={() => setSubView(null)}>
              <ArrowLeft size={22} />
            </div>
            <div className={styles.tradeInfo} style={{ alignItems: 'center', flexGrow: 1 }}>
              <span className={styles.tradeValue} style={{ fontSize: '16px' }}>{newOrder.symbol}.pro</span>
              <span className={styles.tradeLabel}>Spot Gold 100oz</span>
            </div>
            <RotateCcw size={20} className={styles.iconButton} />
          </header>

          <div className={styles.orderPage}>
            <div className={styles.orderTopBar}>
              <span>{String(newOrder.price).trim() ? "Manual Entry" : "Market Execution"}</span>
            </div>
            
            <div className={styles.volumeSelector}>
              {[-0.5, -0.1, -0.01, 0.01, 0.1, 0.5].map(v => (
                <div key={v} className={styles.volBtn}>{v > 0 ? `+${v}` : v}</div>
              ))}
            </div>

            <div className={styles.priceDisplay}>
              <span className={styles.sellPrice}>{quotes.find(q => q.symbol === newOrder.symbol)?.bid.toFixed(2)}</span>
              <span className={styles.buyPrice}>{quotes.find(q => q.symbol === newOrder.symbol)?.ask.toFixed(2)}</span>
            </div>

            {/* Entry price: leave empty for market, or type your own */}
            <div className={styles.slTpControls}>
              <div className={styles.slTpBox} style={{ width: "100%" }}>
                <button onClick={() => nudge("price", -1)}>-</button>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder={`Price (market ${quotes.find(q => q.symbol === newOrder.symbol)?.ask.toFixed(symbolMeta(newOrder.symbol).dp)})`}
                  value={newOrder.price}
                  onChange={(e) => setField("price", e.target.value.replace(/[^0-9.]/g, ""))}
                  style={{ flex: 1, minWidth: 0, width: "100%", textAlign: "center", background: "transparent", border: "none", outline: "none", color: "inherit", font: "inherit" }}
                />
                <button onClick={() => nudge("price", 1)}>+</button>
              </div>
            </div>

            <div className={styles.slTpControls}>
              <div className={styles.slTpBox}>
                <button onClick={() => nudge("sl", -1)}>-</button>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="SL"
                  value={newOrder.sl}
                  onChange={(e) => setField("sl", e.target.value.replace(/[^0-9.]/g, ""))}
                  style={{ flex: 1, minWidth: 0, width: "100%", textAlign: "center", background: "transparent", border: "none", outline: "none", color: "inherit", font: "inherit" }}
                />
                <button onClick={() => nudge("sl", 1)}>+</button>
              </div>
              <div className={styles.slTpBox}>
                <button onClick={() => nudge("tp", -1)}>-</button>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="TP"
                  value={newOrder.tp}
                  onChange={(e) => setField("tp", e.target.value.replace(/[^0-9.]/g, ""))}
                  style={{ flex: 1, minWidth: 0, width: "100%", textAlign: "center", background: "transparent", border: "none", outline: "none", color: "inherit", font: "inherit" }}
                />
                <button onClick={() => nudge("tp", 1)}>+</button>
              </div>
            </div>

            <div className={styles.fillPolicy}>
              <span>Fill policy</span>
              <span>Immediate or Cancel</span>
            </div>

            <div className={styles.chartPreview}>
              <div className={styles.chartLineRed} style={{ top: '30%' }}><span>{quotes.find(q => q.symbol === newOrder.symbol)?.ask.toFixed(2)}</span></div>
              <div className={styles.chartLineDash} style={{ top: '50%' }}></div>
              <div className={styles.chartLineBlue} style={{ top: '70%' }}><span>{quotes.find(q => q.symbol === newOrder.symbol)?.bid.toFixed(2)}</span></div>
            </div>

            <div className={styles.orderWarning}>
              {String(newOrder.price).trim()
                ? "The position opens at the price you typed with zero profit, then follows the live market from there."
                : "Attention! The trade will be executed at market conditions, difference with requested price may be significant!"}
            </div>

            {orderError && (
              <div style={{ color: "#ef4444", fontSize: "12px", padding: "6px 12px" }}>{orderError}</div>
            )}

            <div className={styles.bottomActionButtons}>
              <div onClick={() => executeOrder("sell")} className={styles.btnActionSell}>
                <span>SELL</span>
                <small>BY MARKET</small>
              </div>
              <div className={styles.divider}></div>
              <div onClick={() => executeOrder("buy")} className={styles.btnActionBuy}>
                <span>BUY</span>
                <small>BY MARKET</small>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- RENDER MAIN APP ---
  return (
    <div className={styles.pageWrapper}>
      <div className={styles.mobileContainer}>
        
        {/* --- HEADER --- */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <button className={styles.iconButton} onClick={() => setShowSidebar(true)}>
              <Menu size={22} />
            </button>
            <div className={styles.tradeInfo}>
              <span className={styles.tradeLabel}>Trade</span>
              <span className={styles.tradeValue}>{account.equity.toFixed(2)} USD</span>
            </div>
          </div>
          
          <div className={styles.headerRight} style={{ position: 'relative' }}>
            <button className={styles.iconButton} onClick={() => setShowWalletMenu(!showWalletMenu)}>
              <Wallet size={20} />
            </button>
            <button className={styles.iconButton} onClick={() => setShowSortMenu(!showSortMenu)}>
              <ArrowUpDown size={20} />
            </button>
            <button className={styles.iconButton} onClick={() => handleOpenNewOrderPage()}>
              <FilePlus size={20} />
            </button>

            {/* Sort Dropdown */}
            {showSortMenu && (
              <div className={styles.dropdownMenu} style={{ right: '40px' }}>
                {["Order", "Time", "Symbol", "Profit"].map(opt => (
                  <div 
                    key={opt} 
                    className={styles.dropdownItem}
                    onClick={() => { setSortBy(opt); setShowSortMenu(false); }}
                  >
                    {opt} {sortBy === opt && <span className={styles.sortArrow}>{sortAsc ? "↑" : "↓"}</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Wallet Dropdown */}
            {showWalletMenu && (
              <div className={styles.dropdownMenu} style={{ right: '120px', width: '200px' }}>
                <div className={styles.dropdownItem}>Balance</div>
                <div className={styles.dropdownItem}>Deposit</div>
                <div className={styles.dropdownItem}>Withdrawal</div>
              </div>
            )}
          </div>
        </header>

        {/* --- SIDEBAR --- */}
        {showSidebar && (
          <div className={styles.sidebarOverlay} onClick={() => setShowSidebar(false)}>
            <div className={styles.sidebar} onClick={e => e.stopPropagation()}>
              <div className={styles.sidebarHeader}>
                <Wallet size={24} color="#3b82f6" />
                <span>Accounts</span>
              </div>
              <div className={styles.sidebarItem}>Account 1 (Demo)</div>
              <div className={styles.sidebarItem}>Account 2 (Demo)</div>
              <div className={styles.sidebarDivider}></div>
              <div className={styles.sidebarItem}>Journal</div>
              <div className={styles.sidebarItem}>Settings</div>
              <div className={styles.sidebarItem}>About</div>
            </div>
          </div>
        )}

        {/* --- MAIN CONTENT --- */}
        <div className={styles.contentArea}>
          {activeTab === "trade" && (
            <>
              <section className={styles.statsSection}>
                <div className={styles.statRow}><span>Balance:</span><span>{account.balance.toFixed(2)}</span></div>
                <div className={styles.statRow}><span>Equity:</span><span>{account.equity.toFixed(2)}</span></div>
                <div className={styles.statRow}><span>Margin:</span><span>{account.margin.toFixed(2)}</span></div>
                <div className={styles.statRow}><span>Free margin:</span><span>{account.freeMargin.toFixed(2)}</span></div>
                <div className={styles.statRow}><span>Margin Level (%):</span><span>{account.marginLevel.toFixed(2)}</span></div>
              </section>

              <div className={styles.sectionHeader}>
                <span>Positions</span>
                <span className={styles.dots}>...</span>
              </div>
              
              <div className={styles.listContainer}>
                {sortedPositions.length === 0 ? (
                  <div className={styles.emptyState}>No open positions</div>
                ) : (
                  sortedPositions.map((pos) => (
                    <div key={pos.id} className={styles.positionItem} onDoubleClick={() => handleOpenNewOrderPage(pos.symbol, pos.type)}>
                      <div className={styles.posDetails}>
                        <div className={styles.symbolLine}>
                          {pos.symbol}, 
                          <span className={pos.type === "buy" ? styles.buyText : styles.sellText}>
                            {pos.type} {pos.volume}
                          </span>
                        </div>
                        <div className={styles.priceLine}>
                          {pos.openPrice.toFixed(2)} <span className={styles.arrow}>→</span> {pos.currentPrice.toFixed(2)}
                        </div>
                        {(pos.sl > 0 || pos.tp > 0) && (
                          <div className={styles.priceLine} style={{ fontSize: "11px", opacity: 0.7 }}>
                            {pos.sl > 0 && `S/L: ${pos.sl.toFixed(2)}  `}
                            {pos.tp > 0 && `T/P: ${pos.tp.toFixed(2)}`}
                          </div>
                        )}
                      </div>
                      <div className={styles.posRight}>
                        <span className={pos.profit >= 0 ? styles.profitText : styles.lossText}>
                          {pos.profit >= 0 ? "+" : ""}{pos.profit.toFixed(2)}
                        </span>
                        <button onClick={() => closePosition(pos.id)} className={styles.closeBtn}>Close</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {activeTab === "quotes" && (
            <>
              <div style={{ fontSize: "11px", opacity: 0.6, padding: "4px 12px" }}>
                XAUUSD feed: {priceStatus === "live" ? "● live (websocket)" : priceStatus === "polling" ? "○ polling (fallback)" : "connecting..."}
              </div>
              <div className={styles.sectionHeader}>
                <span>Symbol</span>
                <span>Bid / Ask</span>
              </div>
              <div className={styles.listContainer}>
                {quotes.map((q) => (
                  <div key={q.symbol} className={styles.quoteItem}>
                    <div className={styles.quoteLeft}>
                      <span className={styles.quoteSymbol}>{q.symbol}</span>
                    </div>
                    <div className={styles.quoteRight}>
                      <div className={styles.quotePrices}>
                        <span>{q.bid.toFixed(5)}</span>
                        <span>{q.ask.toFixed(5)}</span>
                      </div>
                      <div className={styles.quoteActions}>
                        <button onClick={() => handleOpenNewOrderPage(q.symbol, "sell")} className={styles.btnSell}>SELL</button>
                        <button onClick={() => handleOpenNewOrderPage(q.symbol, "buy")} className={styles.btnBuy}>BUY</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {activeTab === "history" && (
            <>
              <div className={styles.sectionHeader}>
                <span>Time</span>
                <span>Symbol / Profit</span>
              </div>
              <div className={styles.listContainer}>
                {history.length === 0 ? (
                  <div className={styles.emptyState}>No trade history</div>
                ) : (
                  history.map((h, i) => (
                    <div key={i} className={styles.historyItem}>
                      <div className={styles.posDetails}>
                        <span className={styles.historyTime}>{h.closeTime} ({h.reason})</span>
                        <span className={styles.symbolLine}>{h.symbol} <span className={h.type === "buy" ? styles.buyText : styles.sellText}>{h.type} {h.volume}</span></span>
                        <span className={styles.historyPrices}>{h.openPrice.toFixed(2)} → {h.closePrice.toFixed(2)}</span>
                      </div>
                      <span className={h.profit >= 0 ? styles.profitText : styles.lossText}>
                        {h.profit >= 0 ? "+" : ""}{h.profit.toFixed(2)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {(activeTab === "charts" || activeTab === "messages") && (
            <div className={styles.placeholderTab}>
              <p>{activeTab.toUpperCase()} View</p>
              <span>(Simulator Mode)</span>
            </div>
          )}
        </div>

        {/* --- BOTTOM NAV --- */}
        <nav className={styles.bottomNav}>
          <div className={`${styles.navItem} ${activeTab === "quotes" ? styles.activeNavItem : ""}`} onClick={() => setActiveTab("quotes")}>
            <ArrowUpDown size={20} /><span className={styles.navText}>Quotes</span>
          </div>
          <div className={`${styles.navItem} ${activeTab === "charts" ? styles.activeNavItem : ""}`} onClick={() => setActiveTab("charts")}>
            <CandlestickChart size={20} /><span className={styles.navText}>Charts</span>
          </div>
          <div className={`${styles.navItem} ${activeTab === "trade" ? styles.activeNavItem : ""}`} onClick={() => setActiveTab("trade")}>
            <div className={activeTab === "trade" ? styles.activeIconWrapper : ""}><Activity size={20} /></div>
            <span className={`${styles.navText} ${activeTab === "trade" ? styles.activeNavText : ""}`}>Trade</span>
          </div>
          <div className={`${styles.navItem} ${activeTab === "history" ? styles.activeNavItem : ""}`} onClick={() => setActiveTab("history")}>
            <History size={20} /><span className={styles.navText}>History</span>
          </div>
          <div className={`${styles.navItem} ${activeTab === "messages" ? styles.activeNavItem : ""}`} onClick={() => setActiveTab("messages")}>
            <div className={styles.messageIconWrapper}><MessageSquare size={20} /><span className={styles.badge}>4</span></div>
            <span className={styles.navText}>Messages</span>
          </div>
        </nav>

      </div>
    </div>
  );
}