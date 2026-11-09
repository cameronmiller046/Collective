// Tells Bing (and other IndexNow search engines) when the site's pages have changed.
// The key below is public by design: IndexNow proves ownership by finding the same key at /<key>.txt on the site.
// Runs only on the live site (Railway) and only when the pages actually changed since the last ping.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const KEY = "b30b0390a1ba6fa79c29fa0ea3b46bc8";

module.exports = function ({ origin, dataDir, rootDir, urls }) {
  async function run() {
    try {
      if (!origin || !(process.env.RAILWAY_ENVIRONMENT || process.env.INDEXNOW_ENABLED)) return;
      const list = urls();
      if (!list.length) return;
      const hash = crypto.createHash("sha256");
      for (const f of ["index.html", "seo.json"]) hash.update(fs.readFileSync(path.join(rootDir, f)));
      hash.update(list.join("\n"));
      const fingerprint = hash.digest("hex");
      const stateFile = path.join(dataDir, "indexnow.json");
      let last = "";
      try { last = JSON.parse(fs.readFileSync(stateFile, "utf8")).fingerprint || ""; } catch (e) {}
      if (last === fingerprint) return;
      const res = await fetch("https://api.indexnow.org/indexnow", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ host: new URL(origin).hostname, key: KEY, keyLocation: `${origin}/${KEY}.txt`, urlList: list }),
      });
      console.log(`IndexNow: sent ${list.length} addresses, answer ${res.status}`);
      if (res.status === 200 || res.status === 202) {
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(stateFile, JSON.stringify({ fingerprint, sentAt: new Date().toISOString() }));
      }
    } catch (e) {
      console.error("IndexNow ping skipped:", e.message);
    }
  }
  return { run };
};
