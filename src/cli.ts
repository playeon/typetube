#!/usr/bin/env node

import { createClient, TypeTubeError } from "./index.js";
import path from "node:path";
import fs from "node:fs";

const rawArgs = process.argv.slice(2);

function printHelp(): void {
  console.log(`TypeTube CLI - Fast, unthrottled YouTube media stream resolver and downloader

Usage:
  typetube <url|query> [options]
  typetube <command> [options]

Commands:
  download <url|query>     Download stream (default behavior when URL/query is provided)
  resolve <url|query>      Resolve stream details without downloading
  search <query> [limit]   Search YouTube and list matching results
  usage                    Show current API quota and rate limit status

Options:
  -x, --extract-audio      Download audio stream only (default)
  --video                  Download adaptive video stream
  --media                  Download and mux combined video and audio (requires ffmpeg)
  -f, --format <quality>   Target resolution or format (e.g. 1080p, 720p, highest, lowest)
  --audio-quality <q>      Target audio quality (highest, hifi, 128kbps, 256kbps)
  -o, --output <path>      Output file path or destination directory (default: current dir)
  -N, --workers <count>    Parallel download range workers (1-32, default: 4)
  --chunk-size <mb>        Chunk size in MB for range streaming (default: 10)
  -g, --get-url            Print direct stream URL to stdout and exit
  -e, --get-title          Print video title to stdout and exit
  --get-id                 Print video ID to stdout and exit
  --get-thumbnail          Print thumbnail URL to stdout and exit
  -j, --dump-json          Output full track details as JSON
  -s, --simulate           Do not download; inspect track metadata and available streams
  --key <apiKey>           TypeTube API key (or set TYPETUBE_API_KEY)
  --host <url>             TypeTube host URL (default: https://typetube.xysushi.in)
  -v, --version            Show version number
  -h, --help               Show this help message

Examples:
  typetube https://www.youtube.com/watch?v=dQw4w9WgXcQ
  typetube "espresso sabrina carpenter" -x --audio-quality highest
  typetube "https://www.youtube.com/watch?v=dQw4w9WgXcQ" -o ./videos --video -f 1080p -N 6
  typetube -g "chopin nocturne"
  typetube -j https://www.youtube.com/watch?v=dQw4w9WgXcQ
  typetube search "daft punk" 5
  typetube usage
`);
}

function parseCliArgs(argv: string[]): {
  command?: string;
  query?: string;
  flags: Record<string, any>;
} {
  const flags: Record<string, any> = {};
  const positionals: string[] = [];

  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      flags.help = true;
      i++;
    } else if (a === "-v" || a === "--version") {
      flags.version = true;
      i++;
    } else if (a === "-x" || a === "--extract-audio") {
      flags.extractAudio = true;
      i++;
    } else if (a === "--video") {
      flags.video = true;
      i++;
    } else if (a === "--media") {
      flags.media = true;
      i++;
    } else if (a === "-j" || a === "--dump-json" || a === "--json") {
      flags.dumpJson = true;
      i++;
    } else if (a === "-g" || a === "--get-url") {
      flags.getUrl = true;
      i++;
    } else if (a === "-e" || a === "--get-title") {
      flags.getTitle = true;
      i++;
    } else if (a === "--get-id") {
      flags.getId = true;
      i++;
    } else if (a === "--get-thumbnail") {
      flags.getThumbnail = true;
      i++;
    } else if (a === "-s" || a === "--simulate") {
      flags.simulate = true;
      i++;
    } else if ((a === "-o" || a === "--output") && i + 1 < argv.length) {
      flags.output = argv[i + 1];
      i += 2;
    } else if ((a === "-f" || a === "--format") && i + 1 < argv.length) {
      flags.format = argv[i + 1];
      i += 2;
    } else if (a === "--audio-quality" && i + 1 < argv.length) {
      flags.audioQuality = argv[i + 1];
      i += 2;
    } else if ((a === "-N" || a === "--workers") && i + 1 < argv.length) {
      flags.workers = parseInt(argv[i + 1], 10);
      i += 2;
    } else if (a === "--chunk-size" && i + 1 < argv.length) {
      flags.chunkSize = parseInt(argv[i + 1], 10);
      i += 2;
    } else if (a === "--key" && i + 1 < argv.length) {
      flags.key = argv[i + 1];
      i += 2;
    } else if (a === "--host" && i + 1 < argv.length) {
      flags.host = argv[i + 1];
      i += 2;
    } else if (a.startsWith("-")) {
      i++;
    } else {
      positionals.push(a);
      i++;
    }
  }

  const knownCommands = ["download", "resolve", "search", "usage", "help"];
  let command: string | undefined;
  let query: string | undefined;

  if (positionals.length > 0 && knownCommands.includes(positionals[0].toLowerCase())) {
    command = positionals[0].toLowerCase();
    query = positionals.slice(1).join(" ").trim();
  } else if (positionals.length > 0) {
    command = "download";
    query = positionals.join(" ").trim();
  }

  return { command, query, flags };
}

function getPackageVersion(): string {
  try {
    const pkgPath = path.resolve(new URL(".", import.meta.url).pathname, "../package.json");
    if (fs.existsSync(pkgPath)) {
      const data = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      return data.version || "1.1.0";
    }
  } catch {}
  return "1.1.0";
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

async function main(): Promise<void> {
  const { command, query, flags } = parseCliArgs(rawArgs);

  if (flags.version) {
    console.log(`typetube v${getPackageVersion()}`);
    return;
  }

  if (flags.help || !command || command === "help") {
    printHelp();
    return;
  }

  const apiKey = (flags.key as string) || process.env.TYPETUBE_API_KEY || "public";
  const host = (flags.host as string) || process.env.TYPETUBE_HOST || "https://typetube.xysushi.in";

  const client = createClient(apiKey, { host });

  try {
    if (command === "usage") {
      const usage = await client.usage();
      if (flags.dumpJson) {
        console.log(JSON.stringify(usage, null, 2));
        return;
      }
      console.log(`TypeTube Quota Status:`);
      console.log(`  Key Type:               ${usage.keyType}`);
      console.log(`  Minute Limit:           ${usage.used}/${usage.limit} used (${usage.remaining} remaining)`);
      console.log(`  Minute Reset In:        ${usage.resetInSeconds}s (window: ${usage.windowSeconds}s)`);
      console.log(`  Daily Limit:            ${usage.dailyUsed}/${usage.dailyLimit} used (${usage.dailyRemaining} remaining)`);
      console.log(`  Daily Reset In:         ${usage.dailyResetInSeconds}s (${(usage.dailyResetInSeconds / 3600).toFixed(1)}h)`);
      return;
    }

    if (command === "search") {
      if (!query) {
        console.error("Error: Missing search query.");
        console.error("Usage: typetube search <query> [limit]");
        process.exit(1);
      }
      const parts = query.split(" ");
      let limit = 5;
      const last = parseInt(parts[parts.length - 1], 10);
      let term = query;
      if (!isNaN(last) && parts.length > 1) {
        limit = last;
        term = parts.slice(0, -1).join(" ");
      }
      const items = await client.search(term, limit);
      if (flags.dumpJson) {
        console.log(JSON.stringify(items, null, 2));
        return;
      }
      console.log(`Search results for "${term}" (${items.length} items):\n`);
      items.forEach((item, index) => {
        const idx = String(index + 1).padStart(2, " ");
        const dur = item.duration ? ` [${formatDuration(item.duration)}]` : "";
        const uploader = item.uploader ? ` - ${item.uploader}` : "";
        console.log(`${idx}. ${item.title}${uploader}${dur}`);
        console.log(`    ${item.url}\n`);
      });
      return;
    }

    if (!query) {
      printHelp();
      process.exit(1);
    }

    const t0 = performance.now();
    const track = await client.resolve(query);
    const rtt = Math.round(performance.now() - t0);

    if (flags.getTitle) {
      console.log(track.title);
      return;
    }

    if (flags.getId) {
      console.log(track.id);
      return;
    }

    if (flags.getThumbnail) {
      console.log(track.thumbnail);
      return;
    }

    if (flags.getUrl) {
      if (flags.video && track.bestVideo?.url) {
        console.log(track.bestVideo.url);
      } else {
        console.log(track.bestAudio.url);
      }
      return;
    }

    if (flags.dumpJson) {
      console.log(JSON.stringify(track, null, 2));
      return;
    }

    if (command === "resolve" || flags.simulate) {
      console.log(`\nTitle:      ${track.title}`);
      console.log(`Author:     ${track.author}`);
      console.log(`ID:         ${track.id}`);
      console.log(`Duration:   ${formatDuration(track.durationSeconds)} (${track.durationSeconds}s)`);
      console.log(`Latency:    ${rtt}ms (server: ${track.latencyMs}ms)`);
      console.log(`Best Audio: ${track.bestAudio.quality} (${track.bestAudio.mimeType})`);
      if (track.bestVideo) {
        console.log(`Best Video: ${track.bestVideo.quality} (${track.bestVideo.mimeType})`);
      }
      console.log(`Audio URL:  ${track.bestAudio.url}`);
      if (track.bestVideo?.url) {
        console.log(`Video URL:  ${track.bestVideo.url}`);
      }
      console.log("");
      return;
    }

    let dest = flags.output || "./";
    if (dest && !fs.existsSync(dest)) {
      if (!path.extname(dest)) {
        fs.mkdirSync(dest, { recursive: true });
      } else {
        const parentDir = path.dirname(dest);
        if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
      }
    }

    const workers = flags.workers || 4;
    const chunkSizeBytes = flags.chunkSize ? flags.chunkSize * 1024 * 1024 : 10 * 1024 * 1024;
    const quality = flags.format || "1080p";
    const audioQuality = flags.audioQuality || "highest";

    console.log(`[typetube] ${track.id}: Downloading stream`);
    console.log(`[info] Title: ${track.title} [${formatDuration(track.durationSeconds)}]`);

    let lastLine = "";
    const progressCallback = (p: any) => {
      const mb = (p.downloadedBytes / (1024 * 1024)).toFixed(1);
      const totalMb = p.totalBytes ? (p.totalBytes / (1024 * 1024)).toFixed(1) : "?";
      const speed = p.speedMBps ? `${p.speedMBps.toFixed(2)} MB/s` : "";
      const phase = p.phase ? `[${p.phase}] ` : "";
      const line = `[download] ${phase}${p.percent}% of ~${totalMb}MB at ${speed}`;
      if (line !== lastLine) {
        process.stdout.write(`\r${line.padEnd(65)}`);
        lastLine = line;
      }
    };

    if (flags.media) {
      const res = await client.downloadMedia(track, dest, {
        quality,
        workers,
        chunkSizeBytes,
        onProgress: progressCallback
      });
      process.stdout.write("\n");
      console.log(`[download] 100% completed: ${res.filePath} (${res.fileSizeMB} MB in ${res.durationSec}s)`);
      return;
    }

    if (flags.video) {
      const res = await client.downloadVideo(track, dest, {
        quality,
        workers,
        chunkSizeBytes,
        onProgress: progressCallback
      });
      process.stdout.write("\n");
      console.log(`[download] 100% completed: ${res.filePath} (${res.fileSizeMB} MB in ${res.durationSec}s)`);
      return;
    }

    const res = await client.downloadAudio(track, dest, {
      audioQuality,
      workers,
      chunkSizeBytes,
      onProgress: progressCallback
    });
    process.stdout.write("\n");
    console.log(`[download] 100% completed: ${res.filePath} (${res.fileSizeMB} MB in ${res.durationSec}s)`);

  } catch (err: any) {
    if (err instanceof TypeTubeError) {
      console.error(`\n[error] ${err.message}${err.statusCode ? ` (HTTP ${err.statusCode})` : ""}`);
    } else {
      console.error(`\n[error] ${err.message || err}`);
    }
    process.exit(1);
  }
}

main();
