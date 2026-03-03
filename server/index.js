
import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const PIXEL_ID = "839080675810591";
const ACCESS_TOKEN = "EAGL4Qz35aTEBQzHT8fEbKwGx3ce0kPksKvgEDhdINxhh9AL1mvHJCFC6ClD0tJVDf4VyT8gAguIJKgq6fFNkDphqYGDs9hqgQErYnLjKxIhVzYSv7JfK929ggPHYDBlZBw2RmkFFa7o7bw1lNPlwkIBZAEW6IDEinZCucfd3vN2xJYVjBiDu6bZAUEx3OgZDZD";
const API_VERSION = "v19.0";

// Very small in-memory rate limiter per IP (60s window)
const bucket = new Map(); // ip -> {count, ts}
function rateLimited(ip) {
  const now = Date.now();
  const w = 60_000; // 60s
  const limit = 30; // max 30 events / minute / IP
  const cur = bucket.get(ip);
  if (!cur || (now - cur.ts) > w) {
    bucket.set(ip, { count: 1, ts: now });
    return false;
  }
  cur.count += 1;
  bucket.set(ip, cur);
  return cur.count > limit;
}

function looksLikeBotUA(ua="") {
  const re = /(bot|crawler|spider|slurp|curl|wget|python|httpclient|headless|phantom|selenium|playwright|puppeteer)/i;
  return re.test(ua);
}

app.post("/api/lead", async (req, res) => {
  const ua = (req.headers["user-agent"] || "");
  const nonce = req.headers["x-nonce"]; // required: produced after user gesture on client
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();

  // Anti-bot gates
  if (!nonce || String(nonce).length < 12) {
    return res.status(400).json({ ok: false, reason: "missing_nonce" });
  }
  if (looksLikeBotUA(ua)) {
    return res.status(400).json({ ok: false, reason: "bot_ua" });
  }
  if (rateLimited(ip)) {
    return res.status(429).json({ ok: false, reason: "rate_limited" });
  }

  const { event_id, event_source_url } = req.body || {};
  if (!event_id || !event_source_url) {
    return res.status(400).json({ ok: false, reason: "missing_fields" });
  }

  const payload = {
    data: [
      {
        event_name: "Lead",
        event_time: Math.floor(Date.now() / 1000),
        event_id: event_id,
        action_source: "website",
        event_source_url: event_source_url,
        user_data: {
          client_user_agent: ua,
          client_ip_address: ip
        },
        custom_data: {
          content_name: "line_click"
        }
      }
    ]
  };

  const url = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(400).json({ ok: false, data });
    }
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.toString() });
  }
});

app.listen(3000, () => console.log("Server running on 3000"));
