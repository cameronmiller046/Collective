// Looks up the country and U.S./Canadian state for an IP address, entirely in memory. No dependencies, no network calls.
// The address is used for the lookup and then forgotten; only a place name ever leaves this module.
// Data: IP Geolocation by DB-IP (https://db-ip.com), licensed CC BY 4.0. Built by tools/build-geo.js.
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");
const net = require("net");

module.exports = function createGeo(file) {
  file = file || path.join(__dirname, "geo", "geo.bin.gz");
  let buf = null, regions = ["?"], n4 = 0, n6 = 0, o4 = 0, o6 = 0, built = null;
  try {
    buf = zlib.gunzipSync(fs.readFileSync(file));
    const hl = buf.readUInt32LE(0);
    const head = JSON.parse(buf.toString("utf8", 4, 4 + hl));
    regions = head.regions; n4 = head.n4; n6 = head.n6; built = head.built;
    o4 = 4 + hl; o6 = o4 + n4 * 6;
  } catch (e) {
    buf = null;
    console.error("geo: location table not loaded (" + e.message + ") - visits will be counted without a place");
  }

  // last index whose start <= v
  function find(n, v, at) {
    let lo = 0, hi = n - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (at(mid) <= v) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }
  function v6prefix(ip) { // first 48 bits as a number, or -1
    let [head, tail] = ip.split("::");
    const h = head ? head.split(":") : [], t = tail !== undefined && tail ? tail.split(":") : [];
    if (h.some((x) => x.includes(".")) || t.some((x) => x.includes("."))) return -1;
    const g = h.concat(new Array(Math.max(0, 8 - h.length - t.length)).fill("0"), t);
    const a = parseInt(g[0], 16), b = parseInt(g[1], 16), c = parseInt(g[2], 16);
    return Number.isNaN(a + b + c) ? -1 : (a * 65536 + b) * 65536 + c;
  }

  return {
    loaded: () => !!buf,
    built: () => built,
    // returns "US|California", "GB", "CA|Ontario", or "?" when unknown
    lookup(ip) {
      if (!buf) return "?";
      ip = String(ip || "").trim().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
      const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
      if (mapped) ip = mapped[1];
      const kind = net.isIP(ip);
      let i;
      if (kind === 4) {
        const p = ip.split(".");
        const v = ((+p[0] << 24) >>> 0) + (+p[1] << 16) + (+p[2] << 8) + +p[3];
        i = find(n4, v, (k) => buf.readUInt32LE(o4 + k * 4));
        return i < 0 ? "?" : regions[buf.readUInt16LE(o4 + n4 * 4 + i * 2)] || "?";
      }
      if (kind === 6) {
        const v = v6prefix(ip);
        if (v < 0) return "?";
        i = find(n6, v, (k) => buf.readDoubleLE(o6 + k * 8));
        return i < 0 ? "?" : regions[buf.readUInt16LE(o6 + n6 * 8 + i * 2)] || "?";
      }
      return "?";
    },
  };
};
