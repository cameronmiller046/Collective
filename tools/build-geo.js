// Shrinks DB-IP's free "IP to City Lite" CSV into the small lookup table the site uses (geo/geo.bin.gz).
// Usage: node tools/build-geo.js path/to/dbip-city-lite-YYYY-MM.csv.gz
// Keeps country for every address and U.S./Canadian state or province. No city, no coordinates.
// Data: IP Geolocation by DB-IP (https://db-ip.com), licensed CC BY 4.0.
const fs = require("fs");
const zlib = require("zlib");
const readline = require("readline");
const path = require("path");

const src = process.argv[2];
if (!src) { console.error("Usage: node tools/build-geo.js <dbip-city-lite csv.gz>"); process.exit(1); }

const regions = ["?"]; // 0 = unknown
const regionId = new Map([["?", 0]]);
const idOf = (key) => { let i = regionId.get(key); if (i === undefined) { i = regions.length; regions.push(key); regionId.set(key, i); } return i; };

// first five CSV fields (start,end,continent,country,stateprov), honouring "quoted, values"
function fields(line) {
  const out = []; let i = 0;
  while (out.length < 5 && i <= line.length) {
    if (line[i] === '"') { let j = i + 1, v = ""; while (j < line.length) { if (line[j] === '"') { if (line[j + 1] === '"') { v += '"'; j += 2; continue; } break; } v += line[j++]; } out.push(v); i = j + 2; }
    else { const j = line.indexOf(",", i); const e = j < 0 ? line.length : j; out.push(line.slice(i, e)); i = e + 1; }
  }
  return out;
}
function v4(s) { const p = s.split("."); return ((+p[0] << 24) >>> 0) + (+p[1] << 16) + (+p[2] << 8) + +p[3]; }
function v6prefix(s) { // first 48 bits of an IPv6 address, as a number
  let [head, tail] = s.split("::");
  const h = head ? head.split(":") : [], t = tail !== undefined && tail ? tail.split(":") : [];
  const groups = h.concat(new Array(Math.max(0, 8 - h.length - t.length)).fill("0"), t);
  return (parseInt(groups[0], 16) * 65536 + parseInt(groups[1], 16)) * 65536 + parseInt(groups[2], 16);
}

const A = { starts: [], idx: [], end: -1 }, B = { starts: [], idx: [], end: -1 };
function add(t, start, end, id) {
  if (start > t.end + 1 && t.starts.length) { // gap with no data
    if (t.idx[t.idx.length - 1] !== 0) { t.starts.push(t.end + 1); t.idx.push(0); }
  }
  const n = t.starts.length;
  if (n && t.starts[n - 1] >= start) { // finer than we can store: last one wins
    t.idx[n - 1] = id;
  } else if (!n || t.idx[n - 1] !== id) { t.starts.push(start); t.idx.push(id); }
  t.end = Math.max(t.end, end);
}

(async () => {
  const rl = readline.createInterface({ input: fs.createReadStream(src).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  let lines = 0;
  for await (const line of rl) {
    if (!line) continue;
    const [s, e, , country, state] = fields(line);
    lines++;
    const key = country === "ZZ" || !country ? "?" : (country === "US" || country === "CA") && state ? country + "|" + state : country;
    const id = idOf(key);
    if (s.includes(":")) add(B, v6prefix(s), v6prefix(e), id);
    else add(A, v4(s), v4(e), id);
  }
  const head = Buffer.from(JSON.stringify({ built: new Date().toISOString().slice(0, 10), source: path.basename(src), regions, n4: A.starts.length, n6: B.starts.length }));
  const hl = Buffer.alloc(4); hl.writeUInt32LE(head.length);
  const b4 = Buffer.alloc(A.starts.length * 6), b6 = Buffer.alloc(B.starts.length * 10);
  A.starts.forEach((v, i) => b4.writeUInt32LE(v, i * 4));
  A.idx.forEach((v, i) => b4.writeUInt16LE(v, A.starts.length * 4 + i * 2));
  B.starts.forEach((v, i) => b6.writeDoubleLE(v, i * 8));
  B.idx.forEach((v, i) => b6.writeUInt16LE(v, B.starts.length * 8 + i * 2));
  const out = zlib.gzipSync(Buffer.concat([hl, head, b4, b6]), { level: 9 });
  fs.mkdirSync(path.join(__dirname, "..", "geo"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "..", "geo", "geo.bin.gz"), out);
  console.log("rows read:", lines, "| regions:", regions.length, "| v4 ranges:", A.starts.length, "| v6 ranges:", B.starts.length, "| file bytes:", out.length);
})();
