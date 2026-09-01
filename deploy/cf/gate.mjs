// Commerce Fountain embed gate for the Design Studio (OpenDesign fork).
//
// Sits between Caddy (TLS) and the daemon. Commerce Fountain mints a short
// lived HMAC token (lib/design-studio-embed/token.ts) and loads
//   /embed?token=<payload>.<sig>&next=/
// in an iframe. The gate swaps that token for its own 12h session cookie, then
// proxies every request to the daemon injecting `Authorization: Bearer
// <OD_API_TOKEN>` (the daemon's documented reverse-proxy auth mode). Browsers
// block Basic-Auth in iframe URLs, which is why this hop exists at all.
//
// Zero npm dependencies on purpose: auditably small, nothing to install.
import http from "node:http";
import net from "node:net";
import { createHmac, timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.GATE_PORT || 8080);
const UPSTREAM = new URL(process.env.GATE_UPSTREAM || "http://open-design:7456");
const SECRET = process.env.DESIGN_STUDIO_EMBED_SECRET || "";
const OD_API_TOKEN = process.env.OD_API_TOKEN || "";
const FRAME_ANCESTORS =
  process.env.GATE_FRAME_ANCESTORS ||
  "'self' https://commercefountain.com https://www.commercefountain.com https://fh-chamber-ecosystem.vercel.app http://localhost:3000";
const COOKIE = "od_session";
const SESSION_TTL_S = 12 * 60 * 60;
const RENEW_BELOW_S = 6 * 60 * 60;
const SKEW_S = 30;

if (!SECRET) {
  console.error("[gate] DESIGN_STUDIO_EMBED_SECRET is required");
  process.exit(1);
}

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const sign = (payloadB64) => b64u(createHmac("sha256", SECRET).update(payloadB64).digest());

function mintSession(uid, tid) {
  const payload = b64u(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S, uid, tid, s: 1 }),
  );
  return `${payload}.${sign(payload)}`;
}

// Verify `payload.sig`; returns the parsed payload or null. Never throws.
function verifyToken(token) {
  if (typeof token !== "string" || token.length > 2048) return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000 - SKEW_S) return null;
    return payload;
  } catch {
    return null;
  }
}

function sessionFrom(req) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return verifyToken(decodeURIComponent(v.join("=")));
  }
  return null;
}

const cookieValue = (token) =>
  `${COOKIE}=${encodeURIComponent(token)}; Max-Age=${SESSION_TTL_S}; Path=/; HttpOnly; Secure; SameSite=None`;

// Shown when the browser refused our cookie (Safari, cross-site) or the
// session is gone. postMessage tells the Commerce Fountain parent to swap in
// its fallback card with the "Open in new tab" launch.
const blockedPage = `<!doctype html><meta charset="utf-8"><title>Design Studio</title>
<style>body{font-family:Poppins,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fff;color:#202020}div{max-width:26rem;text-align:center;padding:2rem}h1{font-size:1.1rem;color:#054d87}p{font-size:.9rem;color:#5c5c5c}</style>
<div><h1>The Design Studio session could not start here</h1>
<p>Head back to Commerce Fountain and use "Open in new tab", or reload the page.</p></div>
<script>try{window.parent.postMessage("od-embed-blocked","*")}catch(e){}</script>`;

function securityHeaders(headers) {
  const out = { ...headers };
  delete out["x-frame-options"];
  out["content-security-policy"] = `frame-ancestors ${FRAME_ANCESTORS}`;
  return out;
}

function proxy(req, res, session) {
  // Preserve the client's Host. The daemon's same-origin check
  // (isLocalSameOrigin) validates the Host header, so rewriting it to the
  // internal service name made every browser same-origin GET (which omits
  // Origin per the Fetch spec) fail with 403 - including GET/PUT
  // /api/app-config, so no setting ever persisted server-side.
  const headers = { ...req.headers };
  delete headers.authorization;
  if (OD_API_TOKEN) headers.authorization = `Bearer ${OD_API_TOKEN}`;
  const up = http.request(
    { host: UPSTREAM.hostname, port: UPSTREAM.port, path: req.url, method: req.method, headers },
    (upRes) => {
      const outHeaders = securityHeaders(upRes.headers);
      // Sliding renewal on documents so a workday never expires mid-session.
      const isDoc = String(upRes.headers["content-type"] || "").includes("text/html");
      if (isDoc && session.exp - Date.now() / 1000 < RENEW_BELOW_S) {
        outHeaders["set-cookie"] = cookieValue(mintSession(session.uid, session.tid));
      }
      res.writeHead(upRes.statusCode || 502, outHeaders);
      upRes.pipe(res); // streams SSE unbuffered
    },
  );
  up.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end("upstream unavailable");
  });
  req.pipe(up);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://gate");

  if (url.pathname === "/gate/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("ok");
  }

  if (url.pathname === "/embed") {
    const payload = verifyToken(url.searchParams.get("token") || "");
    if (!payload || payload.s === 1) {
      // Invalid, expired, or someone replaying a session cookie as an embed token.
      res.writeHead(403, securityHeaders({ "content-type": "text/html; charset=utf-8" }));
      return res.end(blockedPage);
    }
    const next = url.searchParams.get("next") || "/";
    const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
    console.log(`[gate] embed session for uid=${payload.uid} tid=${payload.tid}`);
    res.writeHead(302, {
      location: safeNext,
      "set-cookie": cookieValue(mintSession(payload.uid, payload.tid)),
      ...securityHeaders({}),
    });
    return res.end();
  }

  const session = sessionFrom(req);
  if (!session) {
    if (url.pathname.startsWith("/api/")) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "session expired" }));
    }
    res.writeHead(200, securityHeaders({ "content-type": "text/html; charset=utf-8" }));
    return res.end(blockedPage);
  }
  proxy(req, res, session);
});

// WebSocket pass-through (cookie-authenticated), in case any UI surface uses it.
server.on("upgrade", (req, socket) => {
  const session = sessionFrom(req);
  if (!session) return socket.destroy();
  const up = net.connect(Number(UPSTREAM.port), UPSTREAM.hostname, () => {
    const headers = { ...req.headers }; // Host preserved, see proxy() above
    delete headers.authorization;
    if (OD_API_TOKEN) headers.authorization = `Bearer ${OD_API_TOKEN}`;
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
    up.write(lines.join("\r\n") + "\r\n\r\n");
    socket.pipe(up).pipe(socket);
  });
  up.on("error", () => socket.destroy());
  socket.on("error", () => up.destroy());
});

server.listen(PORT, () => console.log(`[gate] listening on :${PORT} -> ${UPSTREAM.href}`));
