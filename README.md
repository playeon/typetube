# typetube

Fast YouTube stream resolver and downloader for Node.js with protobuf wire support. Performs full stream resolution in sub-second latency.

Features:
- Sub-second full stream resolution for queries and direct URLs
- Protocol Buffers by default for fast serialization and low network overhead
- Direct Google Video CDN URLs with automatic 256kbps AAC (itag 141) and Opus selection
- Multi-worker range downloads (up to 32 workers) to avoid YouTube speed throttling
- Automatic recovery when stream URLs expire mid-flight
- Quota tracking via `client.usage()`
- Optional video and audio muxing to MP4 via FFmpeg
- Zero external runtime dependencies

## Installation

```bash
npm install typetube
```

Requires Node.js 18 or higher. If you plan to mux video and audio into a single MP4 file, make sure `ffmpeg` is installed on your system.

## CLI Usage (yt-dlp Style)

TypeTube can be run directly from your terminal like `yt-dlp`:

```bash
npm install -g typetube
```

Or run on-demand via `npx typetube`.

Examples:
```bash
# Download audio directly (default)
typetube "espresso sabrina carpenter" -o ./music

# Download with 8 parallel connections
typetube https://www.youtube.com/watch?v=dQw4w9WgXcQ -N 8 -o ./downloads

# Download 1080p video stream
typetube https://www.youtube.com/watch?v=dQw4w9WgXcQ --video -f 1080p

# Print direct stream URL (for piping into mpv, vlc, ffmpeg)
typetube -g "chopin nocturne"

# Print video title or ID
typetube -e "daft punk get lucky"
typetube --get-id "starboy the weeknd"

# Dump metadata as JSON
typetube -j https://www.youtube.com/watch?v=dQw4w9WgXcQ

# Inspect track streams without downloading
typetube -s "reona nainai"

# Search YouTube
typetube search "daft punk" 5

# Check quota status
typetube usage
```

## Quick Start (SDK)

```typescript
import { createClient } from "typetube";

const client = createClient();

// Search or resolve a URL
const track = await client.resolve("espresso sabrina carpenter");
console.log(track.title, track.durationSeconds);
console.log("Audio URL:", track.bestAudio.url);

// Download audio with 4 parallel workers
const file = await client.downloadAudio(track, "./downloads", {
  audioQuality: "highest",
  workers: 4,
  onProgress: (p) => console.log(`${p.percent}% - ${p.speedMBps} MB/s`)
});

console.log("Saved to:", file.filePath);
```

## Client Setup

```typescript
import { createClient, TypeTubeClient } from "typetube";

// Uses the active public key automatically
const client = createClient();

// Or pass your own API key and options
const customClient = new TypeTubeClient({
  apiKey: "YOUR_KEY",
  host: "https://typetube.xysushi.in",
  timeoutMs: 10000,
  format: "protobuf"
});
```

If no `apiKey` is provided, the client binds to any active public key on the host.

## Methods

### `client.resolve(query, options?)`

Resolves a video URL, video ID, or search query into a complete track object with sub-second latency.

```typescript
const track = await client.resolve("https://www.youtube.com/watch?v=dQw4w9WgXcQ", {
  maxVideoHeight: 1080
});
```

Returns:
- `id`: YouTube video ID
- `title`: Video title
- `author`: Channel name
- `durationSeconds`: Track duration in seconds
- `bestAudio`: Best available audio stream (prefers 256kbps AAC or Opus)
- `bestVideo`: Best available video stream matching `maxVideoHeight`
- `audioStreams`: List of audio streams
- `videoStreams`: List of video streams
- `thumbnails`: Array of thumbnail objects with dimensions
- `latencyMs`: Resolution latency in milliseconds

### `client.search(query, limitOrOptions?)`

Searches YouTube and returns a list of search results.

```typescript
const results = await client.search("daft punk", 5);
for (const item of results) {
  console.log(item.title, item.url);
}
```

### `client.usage()`

Returns your current API key quota and remaining limits for both minute and daily windows.

```typescript
const usage = await client.usage();
console.log(`Remaining: ${usage.remaining}/${usage.limit}`);
console.log(`Daily: ${usage.dailyRemaining}/${usage.dailyLimit}`);
```

### `client.getPlayback(trackOrQuery, options?)`

Returns direct playback URLs. Accepts either a search query string or an existing `TrackResult` object. If you pass a `TrackResult`, no network call is made to re-resolve the track.

```typescript
const playback = await client.getPlayback(track, {
  audioQuality: "highest",
  quality: "1080p"
});

console.log("Audio URL:", playback.audioUrl);
console.log("Video URL:", playback.videoUrl);
```

### `client.downloadAudio(trackOrQuery, destPath?, options?)`

Downloads the audio stream to disk using multi-worker HTTP range requests.

```typescript
const result = await client.downloadAudio(track, "./music", {
  audioQuality: "highest",
  workers: 4,
  chunkSizeBytes: 10 * 1024 * 1024,
  onProgress: (p) => console.log(`${p.percent}% - ${p.speedMBps} MB/s`)
});
```

Options:
- `audioQuality`: `"highest"` | `"hifi"` | `"128kbps"` | `"256kbps"` | `"lowest"`
- `workers`: Number of parallel download connections (1 to 32, default 4)
- `chunkSizeBytes`: Size of each chunk in bytes (default 10MB)
- `onProgress`: Progress callback with percent, downloaded bytes, and speed in MB/s

### `client.downloadVideo(trackOrQuery, destPath?, options?)`

Downloads the standalone adaptive video stream to disk using multi-worker range requests.

```typescript
const result = await client.downloadVideo(track, "./videos", {
  quality: "1080p",
  preferCodec: "avc1",
  workers: 6,
  onProgress: (p) => console.log(`${p.percent}%`)
});
```

### `client.downloadMedia(trackOrQuery, destPath?, options?)`

Downloads both audio and video streams in parallel, then muxes them into a single container using FFmpeg.

```typescript
const result = await client.downloadMedia(track, "./media", {
  quality: "1080p",
  outputFormat: "mp4",
  workers: 6,
  onProgress: (p) => console.log(`${p.phase}: ${p.percent}%`)
});

console.log("Output file:", result.filePath);
```

### `client.isStreamExpired(url, marginSeconds?)`

Checks whether a Google Video CDN URL is expired or expiring within `marginSeconds` (default: 30 seconds).

```typescript
if (client.isStreamExpired(track.bestAudio.url)) {
  console.log("Stream token has expired");
}
```

## Error Handling

Errors throw `TypeTubeError` instances:

```typescript
import { TypeTubeError } from "typetube";

try {
  await client.resolve("...");
} catch (err) {
  if (err instanceof TypeTubeError) {
    console.error(`Status ${err.statusCode}: ${err.message}`);
  }
}
```

## License

MIT
