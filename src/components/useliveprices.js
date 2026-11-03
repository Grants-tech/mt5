"use client";

import { useEffect, useRef, useState } from "react";

// ---- Settings you may want to tweak -------------------------------------
// Real-time best bid/ask pushed by the exchange (no polling, no proxy).
// PAXG is a gold-backed token, so it tracks spot gold closely.
const WS_URL = "wss://stream.binance.com:9443/ws/paxgusdt@bookTicker";

// Fallback if the WebSocket is blocked/down: slower polling of a spot feed.
const POLL_URL = "https://api.gold-api.com/price/XAU";
const POLL_MS = 3000;
const POLL_SPREAD = 0.17;

// Added to every incoming XAUUSD price. If your broker shows 3907.00 and this
// feed shows 3904.50, set it to 2.5 (use a negative number for the reverse).
const PRICE_OFFSET = 0;
// --------------------------------------------------------------------------

/**
 * Keeps `quotes` up to date with live XAUUSD ticks.
 *  - quotes:    React state, refreshed at most once per screen frame (~60/s)
 *  - quotesRef: always holds the very latest tick (use it in timers/engines)
 *  - status:    "connecting" | "live" | "polling"
 */
export default function useLivePrices(initialQuotes) {
  const [quotes, setQuotes] = useState(initialQuotes);
  const [status, setStatus] = useState("connecting");
  const quotesRef = useRef(initialQuotes);

  useEffect(() => {
    let disposed = false;
    let ws = null;
    let reconnectTimer = null;
    let pollTimer = null;
    let retry = 0;
    let rafId = null;

    // Write the tick to the ref immediately; repaint at most once per frame.
    const applyTick = (bid, ask) => {
      if (!(bid > 0 && ask > 0)) return;
      quotesRef.current = quotesRef.current.map((q) =>
        q.symbol === "XAUUSD"
          ? { ...q, bid: bid + PRICE_OFFSET, ask: ask + PRICE_OFFSET }
          : q
      );
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (!disposed) setQuotes(quotesRef.current);
        });
      }
    };

    // ---- Fallback: polling -------------------------------------------
    const pollOnce = async () => {
      try {
        const res = await fetch(POLL_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const p = Number((await res.json())?.price);
        applyTick(p, p + POLL_SPREAD);
      } catch (err) {
        console.warn("[price] poll failed:", err.message);
      }
    };
    const startPolling = () => {
      if (pollTimer || disposed) return;
      setStatus("polling");
      pollOnce();
      pollTimer = setInterval(pollOnce, POLL_MS);
    };
    const stopPolling = () => {
      clearInterval(pollTimer);
      pollTimer = null;
    };

    // ---- Primary: WebSocket ------------------------------------------
    const connect = () => {
      if (disposed) return;
      try {
        ws = new WebSocket(WS_URL);
      } catch (err) {
        startPolling();
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        retry = 0;
        stopPolling();
        setStatus("live");
        console.log("[price] websocket connected");
      };

      ws.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          applyTick(Number(d.b), Number(d.a)); // b = best bid, a = best ask
        } catch (_) {
          /* ignore malformed frames */
        }
      };

      ws.onerror = () => ws && ws.close();

      ws.onclose = () => {
        if (disposed) return;
        console.warn("[price] websocket closed, falling back to polling");
        startPolling();
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer) return;
      const delay = Math.min(1000 * 2 ** retry, 15000); // 1s, 2s, 4s ... 15s
      retry += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      stopPolling();
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, []);

  return { quotes, quotesRef, status };
}