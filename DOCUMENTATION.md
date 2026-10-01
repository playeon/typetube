# TypeTube SDK Documentation

TypeTube is a TypeScript client for resolving and downloading YouTube streams with direct CDN URLs, Protocol Buffer support, and parallel chunked downloads. It performs full stream resolution in sub-second latency.

## 1. How It Works

TypeTube handles media requests in two parts:
- Stream Resolution: The client queries the TypeTube backend, which performs full stream resolution and extracts signed stream URLs directly from YouTube in sub-second latency. Responses can be returned in binary Protocol Buffers (`application/x-protobuf`) or standard JSON.
- Direct Media Transfer: Media downloads connect directly to Google Video CDN edge nodes. Downloads use multi-worker HTTP range requests so they do not hit the typical 40-80 KB/s throttles on single YouTube connections.

Passing an existing `TrackResult` object to `getPlayback`, `downloadAudio`, `downloadVideo`, or `downloadMedia` uses the cached stream URLs directly and skips making extra resolution network calls.

## 2. Installation and Requirements

```bash
npm install typetube
```

- Runtime: Node.js 18.0.0 or higher.
- System dependencies: If you want to use `downloadMedia` to produce combined video and audio files, ensure `ffmpeg` is installed in your system PATH.

## 3. Command Line Interface (CLI)

TypeTube includes a built-in CLI that can be run on-demand via `npx typetube` or installed globally:

```bash
npm install -g typetube
```

### CLI Commands

```bash
# Resolve a track or video URL with stream links and metadata
typetube resolve "espresso sabrina carpenter"
typetube resolve https://www.youtube.com/watch?v=dQw4w9WgXcQ --json

# Search YouTube
typetube search "daft punk" 5

# Download audio using parallel chunk workers
typetube download "chopin nocturne" ./music --workers 6

# Download video stream up to 1080p
typetube download "https://www.youtube.com/watch?v=dQw4w9WgXcQ" ./videos --video --quality 1080p

# Check current rate limit and daily quota usage
typetube usage
```

### CLI Flags

| Flag | Description |
| :--- | :--- |
| `-o, --output <path>` | Destination file path or directory (default: current directory) |
| `-x, --extract-audio` | Download audio stream only (default) |
| `--video` | Download raw adaptive video stream instead of audio |
| `--media` | Download and mux combined video and audio (requires ffmpeg) |
| `-f, --format <q>` | Video resolution target (e.g. `1080p`, `720p`, `highest`) |
| `--audio-quality <q>` | Audio stream preference (`highest`, `hifi`, `128kbps`, `256kbps`) |
| `-N, --workers <count>` | Parallel download range workers (1 to 32, default 4) |
| `--chunk-size <mb>` | Chunk size in MB for range streaming (default 10) |
| `-g, --get-url` | Print direct CDN stream URL to stdout and exit |
| `-e, --get-title` | Print track title to stdout and exit |
| `--get-id` | Print YouTube video ID to stdout and exit |
| `--get-thumbnail` | Print thumbnail image URL to stdout and exit |
| `-j, --dump-json` | Output complete metadata as JSON |
| `-s, --simulate` | Inspect track details without downloading |
| `--key <apiKey>` | TypeTube API key (or set `TYPETUBE_API_KEY` env var) |
| `--host <url>` | TypeTube host URL (default: `https://typetube.xysushi.in`) |
| `-v, --version` | Print installed TypeTube version |
| `-h, --help` | Show command usage |

## 4. Client Setup

```typescript
import { createClient, TypeTubeClient } from "typetube";

// Initializes with default host and binds to any active public key
const client = createClient();

// Custom configuration
const customClient = new TypeTubeClient({
  apiKey: "YOUR_KEY",
  host: "https://typetube.xysushi.in",
  timeoutMs: 10000,
  format: "protobuf"
});
```

### Options Reference

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `apiKey` | `string` | *(optional)* | API key. If omitted, binds to any active public key on the host. |
| `host` | `string` | `"https://typetube.xysushi.in"` | Backend server URL. |
| `endpoint` | `string` | `"https://typetube.xysushi.in"` | Alias for `host`. |
| `timeoutMs` | `number` | `10000` | Network request timeout in milliseconds. |
| `format` | `"protobuf"` \| `"json"` | `"protobuf"` | Wire format for resolving queries and searches. |

## 5. API Reference

### `client.resolve(query, options?)`

Resolves a search query, video ID, or direct URL into a full `TrackResult` with sub-second latency.

```typescript
const track = await client.resolve("espresso sabrina carpenter", {
  maxVideoHeight: 1080,
  timeoutMs: 10000
});
```

#### Parameters
- `query` (`string`): Search terms, YouTube video URL, or 11-character video ID.
- `options.maxVideoHeight` (`number`, optional): Caps `bestVideo` to a maximum vertical resolution (e.g. 720, 1080).
- `options.timeoutMs` (`number`, optional): Request timeout override in milliseconds.

#### Return Type (`TrackResult`)
```typescript
interface TrackResult {
  success: boolean;
  query: string;
  id: string;
  title: string;
  author: string;
  uploader?: string;
  artistAvatar?: string;
  durationSeconds: number;
  thumbnail: string;
  thumbnails: Thumbnail[];
  latencyMs: number;
  bestAudio: AudioStream;
  bestVideo?: VideoStream;
  audioStreams: AudioStream[];
  videoStreams: VideoStream[];
}
```

### `client.search(query, optionsOrLimit?)`

Runs a search query on YouTube and returns matching video items.

```typescript
const items = await client.search("miles davis", 5);
```

#### Parameters
- `query` (`string`): Search string.
- `optionsOrLimit` (`number | SearchOptions`, optional): Number of results to return (default 5) or an options object `{ limit?: number, timeoutMs?: number }`.

#### Return Type (`SearchItem[]`)
```typescript
interface SearchItem {
  id: string;
  title: string;
  url: string;
  duration: number | null;
  uploader: string | null;
}
```

### `client.usage(timeoutMs?)`

Checks quota usage and limits for your current API key.

```typescript
const info = await client.usage();
console.log(`Minute quota: ${info.remaining}/${info.limit}`);
console.log(`Daily quota: ${info.dailyRemaining}/${info.dailyLimit}`);
```

#### Return Type (`UsageInfo`)
```typescript
interface UsageInfo {
  success: boolean;
  keyType: "public" | "private";
  limit: number;
  used: number;
  remaining: number;
  resetInSeconds: number;
  windowSeconds: number;
  dailyLimit: number;
  dailyUsed: number;
  dailyRemaining: number;
  dailyResetInSeconds: number;
}
```

### `client.getPlayback(target, options?)`

Returns stream URLs and track metadata. If `target` is an existing `TrackResult`, it skips the resolve step and returns the playback URLs immediately.

```typescript
const playback = await client.getPlayback(track, {
  audioQuality: "highest",
  quality: "1080p",
  preferCodec: "avc1"
});
```

#### Parameters
- `target` (`string | TrackResult | PlaybackInfo`): Query string or pre-resolved track.
- `options.audioQuality` (`"highest" | "hifi" | "128kbps" | "256kbps" | "lowest"`): Audio stream preference.
- `options.quality` (`"2160p" | "1440p" | "1080p" | "720p" | "480p" | "360p" | "highest" | "lowest"`): Video resolution preference.
- `options.preferCodec` (`"avc1" | "vp9" | "av01" | "any"`): Video codec preference.

### `client.downloadAudio(target, destPath?, options?)`

Downloads the audio stream to disk using parallel chunked range requests.

```typescript
const res = await client.downloadAudio(track, "./downloads", {
  audioQuality: "highest",
  workers: 4,
  chunkSizeBytes: 10 * 1024 * 1024,
  onProgress: (p) => {
    console.log(`${p.percent}% - ${p.speedMBps} MB/s`);
  }
});
```

#### Options (`DownloadAudioOptions`)
- `audioQuality`: Stream quality target (default `"highest"`).
- `workers`: Number of parallel download workers (1 to 32, default `4`).
- `chunkSizeBytes`: Size of each chunk range in bytes (default `10485760` / 10MB).
- `onProgress`: Callback receiving `{ percent, downloadedBytes, totalBytes, speedMBps }`.
- `timeoutMs`: Per-request timeout in milliseconds.

### `client.downloadVideo(target, destPath?, options?)`

Downloads the raw adaptive video stream (without audio) to disk.

```typescript
const res = await client.downloadVideo(track, "./downloads", {
  quality: "1080p",
  preferCodec: "avc1",
  workers: 6,
  onProgress: (p) => {
    console.log(`${p.percent}%`);
  }
});
```

#### Options (`DownloadVideoOptions`)
- `quality`: Target video resolution (default `"highest"`).
- `preferCodec`: Codec preference (`"avc1"`, `"vp9"`, `"av01"`, or `"any"`).
- `workers`: Number of parallel workers (1 to 32, default `4`).
- `chunkSizeBytes`: Chunk size in bytes (default 10MB).
- `onProgress`: Progress callback.

### `client.downloadMedia(target, destPath?, options?)`

Downloads video and audio streams in parallel and combines them into a single container using FFmpeg.

```typescript
const res = await client.downloadMedia(track, "./downloads", {
  quality: "1080p",
  outputFormat: "mp4",
  workers: 6,
  onProgress: (p) => {
    console.log(`${p.phase}: ${p.percent}%`);
  }
});
console.log("Saved to:", res.filePath);
```

#### Options (`DownloadMediaOptions`)
- Inherits all options from `DownloadVideoOptions` and `DownloadAudioOptions`.
- `outputFormat`: Output container format (`"mp4"` | `"mkv"` | `"webm"`, default `"mp4"`).
- `ffmpegPath`: Custom path to ffmpeg binary (default `"ffmpeg"`).
- `videoWorkers`: Override worker count for video stream download.
- `audioWorkers`: Override worker count for audio stream download.
- `videoChunkSizeBytes`: Override chunk size for video stream.
- `audioChunkSizeBytes`: Override chunk size for audio stream.

### `client.isStreamExpired(url, marginSeconds?)`

Checks whether a stream URL signature is expired or about to expire.

```typescript
const expired = client.isStreamExpired(track.bestAudio.url, 30);
```

## 6. Performance Tips

- Workers: For standard audio downloads, 4 workers are usually enough to saturate typical connections. For large 1080p video files, setting `workers` to 6 or 8 improves throughput.
- Chunk Size: The default 10MB chunk size works well for most connections. On slower networks or low-memory environments, you can reduce this to 2MB or 4MB.
- Reuse Track Results: Avoid re-resolving URLs when calling download or playback methods. Pass the `TrackResult` object directly to save round-trips and quota.

## 7. Error Handling

All client methods throw `TypeTubeError`:

```typescript
import { TypeTubeError } from "typetube";

try {
  await client.resolve("invalid query");
} catch (err) {
  if (err instanceof TypeTubeError) {
    console.error(`Status: ${err.statusCode}`);
    console.error(`Message: ${err.message}`);
  }
}
```

Common status codes:
- `400`: Invalid parameters or empty search query.
- `401`: Unauthorized or no public key is active on the server.
- `408`: Request timed out.
- `429`: Quota exceeded (either per-minute or daily limit reached).

## 8. License

MIT
