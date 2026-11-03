"use client";

import React, { useState, useEffect, useRef } from "react";
import styles from "./MT5Simulator.module.css";
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

const SPREAD = 0.17;

const GOLD_SOURCES = [
  {
    name: "gold-api",
    url: "https://api.gold-api.com/price/XAU",
    parse: (d) => {
      const p = Number(d?.price);
      return p > 0 ? { bid: p, ask: p + SPREAD } : null;
    },
  },
  {
    name: "binance-paxg",
    url: "https://api.binance.com/api/v3/ticker/bookTicker?symbol=PAXGUSDT",
    parse: (d) => {
      const bid = Number(d?.bidPrice);
      const ask = Number(d?.askPrice);
      return bid > 0 && ask > 0 ? { bid, ask } : null;
    },
  },
];

export default function MT5Simulator() {
  const [activeTab, setActiveTab] = useState("trade");
  const [subView, setSubView] = useState(null); // For New Order page
  const [quotes, setQuotes] = useState(INITIAL_QUOTES);
  
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
  
  // New Order State
  const [newOrder, setNewOrder] = useState({
    symbol: "XAUUSD", type: "buy", volume: 0.01, sl: "", tp: "", price: 0
  });

  const quotesRef = useRef(quotes);
  quotesRef.current = quotes;
  const positionsRef = useRef(positions);
  positionsRef.current = positions;

   // --- CORE ENGINE: Live Ticker, SL/TP Checks, and P&L ---
  useEffect(() => {
    // 1) LIVE XAUUSD PRICE
    const fetchLivePrice = async () => {
      for (const src of GOLD_SOURCES) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 4000);
          const res = await fetch(src.url, { signal: ctrl.signal, cache: "no-store" });
          clearTimeout(timer);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const quote = src.parse(await res.json());
          if (!quote) throw new Error("unexpected response shape");

          setQuotes((prev) =>
            prev.map((q) => (q.symbol === "XAUUSD" ? { ...q, ...quote } : q))
          );
          console.log(`[price] ${src.name}: ${quote.bid}`);
          return; // success, skip remaining sources
        } catch (err) {
          console.warn(`[price] ${src.name} failed:`, err.message);
        }
      }
    };

    fetchLivePrice();
    const priceInterval = setInterval(fetchLivePrice, 5000);

    // 2) SL/TP + P&L ENGINE (runs every second)
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
        const price = isBuy ? q.bid : q.ask;
        const diff = isBuy ? price - pos.openPrice : pos.openPrice - price;
        const contractSize = base === "XAUUSD" ? 100 : 100000;
        let profit = diff * pos.volume * contractSize;
        if (base === "USDJPY") profit /= price;

        const updated = { ...pos, currentPrice: price, profit };

        let reason = null;
        if (pos.sl > 0 && (isBuy ? price <= pos.sl : price >= pos.sl)) reason = "SL";
        if (pos.tp > 0 && (isBuy ? price >= pos.tp : price <= pos.tp)) reason = "TP";

        if (reason) {
          closed.push({
            ...updated,
            closePrice: price,
            closeTime: new Date().toLocaleTimeString(),
            reason,
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
    }, 1000);

    // 3) CLEANUP
    return () => {
      clearInterval(priceInterval);
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
      price: type === "buy" ? q.ask : q.bid
    });
    setSubView("order");
    setShowSidebar(false);
  };

  const executeOrder = () => {
    const q = quotes.find(q => q.symbol === newOrder.symbol);
    const price = newOrder.type === "buy" ? q.ask : q.bid;
    
    const pos = {
      id: Date.now(),
      symbol: newOrder.symbol === "XAUUSD" ? "XAUUSD.pro" : newOrder.symbol,
      type: newOrder.type,
      volume: parseFloat(newOrder.volume),
      openPrice: price,
      currentPrice: price,
      sl: parseFloat(newOrder.sl) || 0,
      tp: parseFloat(newOrder.tp) || 0,
      profit: 0,
      openTime: new Date().toLocaleTimeString()
    };

    setPositions([pos, ...positions]);
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
              <span>Market Execution</span>
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

            <div className={styles.slTpControls}>
              <div className={styles.slTpBox}>
                <button>-</button>
                <span>SL</span>
                <button>+</button>
              </div>
              <div className={styles.slTpBox}>
                <button>-</button>
                <span>TP</span>
                <button>+</button>
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
              Attention! The trade will be executed at market conditions, difference with requested price may be significant!
            </div>

            <div className={styles.bottomActionButtons}>
              <div onClick={executeOrder} className={styles.btnActionSell}>
                <span>SELL</span>
                <small>BY MARKET</small>
              </div>
              <div className={styles.divider}></div>
              <div onClick={executeOrder} className={styles.btnActionBuy}>
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