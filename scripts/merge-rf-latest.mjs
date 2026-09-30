import { readFile, writeFile } from "node:fs/promises";

const basePath = new URL("../public/data/rf.json", import.meta.url);
const latestPath = new URL("../public/data/rf-latest.json", import.meta.url);

const base = JSON.parse(await readFile(basePath, "utf8"));
const latest = JSON.parse(await readFile(latestPath, "utf8"));

const latestDates = new Set(latest.history.map((row) => row.date));
const history = [
  ...base.history.filter((row) => !latestDates.has(row.date)),
  ...latest.history,
].sort((a, b) => a.date.localeCompare(b.date));

const merged = {
  ...base,
  lastMarketDate: latest.lastMarketDate,
  history,
};

await writeFile(basePath, JSON.stringify(merged));
console.log(`RF actualizado hasta ${merged.lastMarketDate}`);
