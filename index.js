import express from "express";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv"
dotenv.config();
const app = express();

app.use(cors());

const BITQUERY_URL = "https://streaming.bitquery.io/eap";
const BITQUERY_KEY = process.env.BITQUERY_API_KEY;

const PUMP_PROTOCOLS = ["pump", "pump_amm", "pumpswap"];

const tokenStats = new Map();

const QUERY = `
{
  Solana {
    DEXTrades(limit: {count: 100}, orderBy: {descending: Block_Time}) {
      Trade {
        Dex { ProtocolName }
        Buy {
          AmountInUSD
          Price
          Currency {
            Symbol
            Name
            MintAddress
          }
        }
      }
      Block { Time }
    }
  }
}
`;

async function fetchTrades() {
  const start = Date.now(); 

  try {
    const res = await axios.post(
      BITQUERY_URL,
      { query: QUERY },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${BITQUERY_KEY}`,
        },
      }
    );

    const latency = Date.now() - start;
    console.log(`Bitquery latency: ${latency} ms`);

    const trades = res.data.data.Solana.DEXTrades;
    const now = Date.now();

    for (const t of trades) {
      const dex = t.Trade.Dex.ProtocolName.toLowerCase();
      if (!PUMP_PROTOCOLS.includes(dex)) continue;

      const token = t.Trade.Buy.Currency.MintAddress;
      const symbol = t.Trade.Buy.Currency.Symbol;
      const name = t.Trade.Buy.Currency.Name;
      const volume = Number(t.Trade.Buy.AmountInUSD || 0);
      const price = Number(t.Trade.Buy.Price || 0);

      if (!tokenStats.has(token)) {
        tokenStats.set(token, {
          token,
          symbol,
          name,
          dex,
          trades: [],
        });
      }

      const coin = tokenStats.get(token);
      coin.trades.push({
        time: now,
        volume,
        price,
      });

      coin.trades = coin.trades.filter((tr) => now - tr.time < 10 * 60 * 1000);
    }

    console.log("Pump.fun stream updated");
  } catch (err) {
    console.error("Stream error:", err.message);
  }
}

setInterval(fetchTrades, 4000);
fetchTrades();


app.get("/top-meme", (req, res) => {
  const ranked = [...tokenStats.values()].map((c) => {
    const totalVolume = c.trades.reduce((s, t) => s + t.volume, 0);
    return { ...c, volume: totalVolume };
  });

  ranked.sort((a, b) => b.volume - a.volume);
  res.json(ranked.slice(0, 10));
});

app.get("/top-trending", (req, res) => {
  const now = Date.now();

  const ranked = [...tokenStats.values()].map((c) => {
    const last1m = c.trades.filter((t) => now - t.time < 60_000);
    const last5m = c.trades.filter((t) => now - t.time < 300_000);

    const vol1m = last1m.reduce((s, t) => s + t.volume, 0);
    const vol5m = last5m.reduce((s, t) => s + t.volume, 0);
    const trades1m = last1m.length;

    let priceChange = 0;
    if (last5m.length > 1) {
      const first = last5m[0].price;
      const last = last5m[last5m.length - 1].price;
      if (first > 0) priceChange = ((last - first) / first) * 100;
    }

    const score = vol1m * 2 + trades1m * 5 + vol5m + priceChange * 10;

    return {
      token: c.token,
      symbol: c.symbol,
      name: c.name,
      dex: c.dex,
      vol1m,
      vol5m,
      trades1m,
      priceChange,
      score,
    };
  });

  ranked.sort((a, b) => b.score - a.score);
  res.json(ranked.slice(0, 10));
});

app.get("/top-surge", (req, res) => {
  const now = Date.now();

  const ranked = [...tokenStats.values()].map((c) => {
    const last1m = c.trades.filter((t) => now - t.time < 60_000);
    const prev1m = c.trades.filter(
      (t) => now - t.time >= 60_000 && now - t.time < 120_000
    );

    const volNow = last1m.reduce((s, t) => s + t.volume, 0);
    const volPrev = prev1m.reduce((s, t) => s + t.volume, 0);

    const surge = volPrev > 0 ? volNow / volPrev : volNow;

    return {
      token: c.token,
      symbol: c.symbol,
      name: c.name,
      dex: c.dex,
      volNow,
      volPrev,
      surge,
    };
  });

  ranked.sort((a, b) => b.surge - a.surge);
  res.json(ranked.slice(0, 10));
});

app.listen(process.env.PORT, () => {
  console.log(
    `Pump.fun Trading Terminal running on http://localhost:${process.env.PORT}`
  );
});
