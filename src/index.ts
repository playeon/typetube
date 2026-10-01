import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { spawn } from "node:child_process";
import {
  TrackResult,
  SearchItem,
  TypeTubeClientOptions,
  ResolveOptions,
  AudioStream,
  VideoStream,
  DownloadProgress,
  DownloadAudioOptions,
  DownloadVideoOptions,
  DownloadMediaOptions,
  DownloadResult,
  PlaybackOptions,
  PlaybackInfo,
  SearchOptions,
  Resolvable,
  UsageInfo
} from "./types.js";
import { decodeTrackResult, decodeSearchResults } from "./protocol.js";

export * from "./types.js";

const DEFAULT_HOST = "https://typetube.xysushi.in";
const DEFAULT_TIMEOUT_MS = 10000;

export class TypeTubeError extends Error {
  public statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "TypeTubeError";
    this.statusCode = statusCode;
  }
}

export class TypeTubeClient {
  public apiCallsCount: number = 0;
  private readonly apiKey: string;
  public readonly host: string;
  private readonly timeoutMs: number;
  private readonly format: "protobuf" | "json";

  public get endpoint(): string {
    return this.host;
  }

  constructor(optionsOrApiKey?: string | TypeTubeClientOptions) {
    if (typeof optionsOrApiKey === "string") {
      const trimmed = optionsOrApiKey.trim();
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        this.apiKey = "public";
        this.host = trimmed.replace(/\/+$/, "");
      } else {
        this.apiKey = trimmed || "public";
        this.host = DEFAULT_HOST;
      }
      this.timeoutMs = DEFAULT_TIMEOUT_MS;
      this.format = "protobuf";
    } else if (typeof optionsOrApiKey === "object" && optionsOrApiKey !== null) {
      this.apiKey = (optionsOrApiKey.apiKey || "").trim() || "public";
      const rawHost = optionsOrApiKey.host || optionsOrApiKey.endpoint || DEFAULT_HOST;
      this.host = rawHost.replace(/\/+$/, "");
      this.timeoutMs = optionsOrApiKey.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      this.format = optionsOrApiKey.format ?? "protobuf";
    } else {
      this.apiKey = "public";
      this.host = DEFAULT_HOST;
      this.timeoutMs = DEFAULT_TIMEOUT_MS;
      this.format = "protobuf";
    }
  }

  public async usage(timeoutMs?: number): Promise<UsageInfo> {
    const url = `${this.host}/v1/usage`;
    const timeout = timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const headers: Record<string, string> = { "Accept": "application/json" };
      if (this.apiKey) {
        headers["X-API-Key"] = this.apiKey;
      }

      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal
      });

      if (!response.ok) {
        let errMessage = `Usage request failed with status ${response.status}`;
        try {
          const errBody = await response.json();
          if (errBody?.error) errMessage = errBody.error;
        } catch {}
        if (response.status === 401 && (this.apiKey === "public" || errMessage.toLowerCase().includes("public"))) {
          errMessage = "No public API key is available.";
        }
        throw new TypeTubeError(errMessage, response.status);
      }

      return (await response.json()) as UsageInfo;
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new TypeTubeError(`Usage request timed out after ${timeout}ms`, 408);
      }
      if (err instanceof TypeTubeError) {
        throw err;
      }
      throw new TypeTubeError(err.message || "Failed to retrieve usage quota");
    } finally {
      clearTimeout(timer);
    }
  }

  public isStreamExpired(url?: string | null, marginSeconds = 30): boolean {
    if (!url) return true;
    try {
      const parsed = new URL(url);
      const expireParam = parsed.searchParams.get("expire");
      if (!expireParam) return false;
      const expireTimestamp = parseInt(expireParam, 10);
      if (isNaN(expireTimestamp)) return false;
      const now = Math.floor(Date.now() / 1000);
      return now >= expireTimestamp - marginSeconds;
    } catch {
      return false;
    }
  }

  public coerceTrack(input: Resolvable): TrackResult | null {
    if (typeof input === "string") return null;
    if ("track" in input && input.track && typeof input.track === "object") {
      return input.track;
    }
    if ("audioStreams" in input && Array.isArray((input as any).audioStreams)) {
      return input as TrackResult;
    }
    return null;
  }

  private async ensureFreshTrack(target: Resolvable, options: ResolveOptions = {}): Promise<TrackResult> {
    const coerced = this.coerceTrack(target);
    if (!coerced) {
      return await this.resolve(target as string, options);
    }
    const sampleUrl = coerced.bestAudio?.url || coerced.audioStreams?.[0]?.url || coerced.bestVideo?.url || coerced.videoStreams?.[0]?.url;
    if (this.isStreamExpired(sampleUrl)) {
      const query = coerced.id ? `https://www.youtube.com/watch?v=${coerced.id}` : (coerced.title || coerced.query);
      if (query) {
        return await this.resolve(query, options);
      }
    }
    return coerced;
  }

  public async resolve(query: string, options: ResolveOptions = {}): Promise<TrackResult> {
    this.apiCallsCount++;
    const q = query.trim();
    if (!q) {
      throw new TypeTubeError("Query cannot be empty");
    }

    const url = new URL(`${this.host}/v1/resolve`);
    url.searchParams.set("q", q);

    const timeout = options.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const acceptHeader =
      this.format === "protobuf"
        ? "application/x-protobuf, application/json;q=0.9"
        : "application/json";

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "X-API-Key": this.apiKey,
          "Accept": acceptHeader
        },
        signal: controller.signal
      });

      if (!response.ok) {
        let errMessage = `Request failed with status ${response.status}`;
        try {
          const errBody = await response.json();
          if (errBody?.error) errMessage = errBody.error;
        } catch {}
        if (response.status === 401 && (this.apiKey === "public" || errMessage.toLowerCase().includes("public"))) {
          errMessage = "No public API key is available.";
        }
        throw new TypeTubeError(errMessage, response.status);
      }

      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("application/x-protobuf") || contentType.includes("application/octet-stream")) {
        const arrayBuffer = await response.arrayBuffer();
        const result = decodeTrackResult(new Uint8Array(arrayBuffer));
        if (options.maxVideoHeight && result.bestVideo) {
          result.bestVideo = this.filterVideoByHeight(result.videoStreams, options.maxVideoHeight) || result.bestVideo;
        }
        return result;
      }

      const json = await response.json();
      if (!json.success && json.error) {
        throw new TypeTubeError(json.error, response.status);
      }
      if (options.maxVideoHeight && json.bestVideo) {
        json.bestVideo = this.filterVideoByHeight(json.videoStreams, options.maxVideoHeight) || json.bestVideo;
      }
      return json as TrackResult;
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new TypeTubeError(`Request timed out after ${timeout}ms`, 408);
      }
      if (err instanceof TypeTubeError) {
        throw err;
      }
      throw new TypeTubeError(err.message || "Failed to resolve track");
    } finally {
      clearTimeout(timer);
    }
  }

  public async search(query: string, optionsOrLimit: number | SearchOptions = 5): Promise<SearchItem[]> {
    this.apiCallsCount++;
    const q = query.trim();
    if (!q) {
      throw new TypeTubeError("Search query cannot be empty");
    }

    const limit = typeof optionsOrLimit === "number" ? optionsOrLimit : (optionsOrLimit.limit ?? 5);
    const timeout = typeof optionsOrLimit === "object" && optionsOrLimit.timeoutMs ? optionsOrLimit.timeoutMs : this.timeoutMs;

    const url = new URL(`${this.host}/v1/search`);
    url.searchParams.set("q", q);
    url.searchParams.set("limit", String(limit));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const acceptHeader =
      this.format === "protobuf"
        ? "application/x-protobuf, application/json;q=0.9"
        : "application/json";

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "X-API-Key": this.apiKey,
          "Accept": acceptHeader
        },
        signal: controller.signal
      });

      if (!response.ok) {
        let errMessage = `Search failed with status ${response.status}`;
        try {
          const errBody = await response.json();
          if (errBody?.error) errMessage = errBody.error;
        } catch {}
        if (response.status === 401 && (this.apiKey === "public" || errMessage.toLowerCase().includes("public"))) {
          errMessage = "No public API key is available.";
        }
        throw new TypeTubeError(errMessage, response.status);
      }

      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("application/x-protobuf") || contentType.includes("application/octet-stream")) {
        const arrayBuffer = await response.arrayBuffer();
        return decodeSearchResults(new Uint8Array(arrayBuffer));
      }

      const json = await response.json();
      if (!json.success && json.error) {
        throw new TypeTubeError(json.error, response.status);
      }
      return (json.results || []) as SearchItem[];
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new TypeTubeError(`Search timed out after ${timeout}ms`, 408);
      }
      if (err instanceof TypeTubeError) {
        throw err;
      }
      throw new TypeTubeError(err.message || "Search failed");
    } finally {
      clearTimeout(timer);
    }
  }

  public async getAudioStreamUrl(target: Resolvable): Promise<string> {
    const track = await this.ensureFreshTrack(target);
    const selected = this.selectAudioStream(track.audioStreams, track.bestAudio);
    if (!selected?.url) {
      throw new TypeTubeError(`No audio stream found for "${typeof target === "string" ? target : track.title}"`);
    }
    return selected.url;
  }

  public async getVideoStreamUrl(target: Resolvable, maxHeight?: number): Promise<string> {
    const track = await this.ensureFreshTrack(target, { maxVideoHeight: maxHeight });
    const selected = maxHeight ? (this.filterVideoByHeight(track.videoStreams, maxHeight) || track.bestVideo) : track.bestVideo;
    if (!selected?.url) {
      throw new TypeTubeError(`No video stream found for "${typeof target === "string" ? target : track.title}"`);
    }
    return selected.url;
  }

  public async getPlayback(
    target: Resolvable,
    options: PlaybackOptions = {}
  ): Promise<PlaybackInfo> {
    const track = await this.ensureFreshTrack(target, { timeoutMs: options.timeoutMs, maxVideoHeight: options.maxVideoHeight });
    const audioStream = this.selectAudioStream(track.audioStreams, track.bestAudio, options.audioQuality);
    const videoStream = this.selectVideoStream(track.videoStreams, track.bestVideo, options.quality, options.preferCodec);

    return {
      id: track.id,
      title: track.title,
      artist: track.author,
      author: track.author,
      duration: track.durationSeconds,
      durationSeconds: track.durationSeconds,
      thumbnail: track.thumbnail,
      thumbnails: track.thumbnails,
      audioUrl: audioStream?.url,
      videoUrl: videoStream?.url,
      audioStream,
      videoStream,
      track
    };
  }

  public async getMediaUrls(
    target: Resolvable,
    options: PlaybackOptions = {}
  ): Promise<PlaybackInfo> {
    return this.getPlayback(target, options);
  }

  public async downloadAudio(
    target: Resolvable,
    destPathOrOptions?: string | DownloadAudioOptions,
    options?: DownloadAudioOptions
  ): Promise<DownloadResult> {
    const destPath = typeof destPathOrOptions === "string" ? destPathOrOptions : "./downloads";
    const opts = typeof destPathOrOptions === "object" ? destPathOrOptions : (options || {});

    let track = await this.ensureFreshTrack(target, { timeoutMs: opts.timeoutMs });
    let stream = this.selectAudioStream(track.audioStreams, track.bestAudio, opts.audioQuality);

    if (!stream?.url) {
      throw new TypeTubeError("No playable audio stream found for download");
    }

    const finalDest = this.resolveDestination(destPath, track, "m4a");
    this.ensureDirectory(finalDest);
    const t0 = performance.now();

    const doDownload = async (url: string) => {
      return await this.downloadStreamToFile(
        url,
        finalDest,
        (p) => {
          if (opts.onProgress) {
            opts.onProgress({
              ...p,
              phase: "downloading"
            });
          }
        },
        5,
        opts.chunkSizeBytes,
        opts.workers
      );
    };

    let dl: { bytes: number };
    try {
      dl = await doDownload(stream.url);
    } catch (err: any) {
      if (err instanceof TypeTubeError && (err.statusCode === 403 || err.statusCode === 410)) {
        const query = track.id ? `https://www.youtube.com/watch?v=${track.id}` : (track.title || track.query);
        track = await this.resolve(query, { timeoutMs: opts.timeoutMs });
        stream = this.selectAudioStream(track.audioStreams, track.bestAudio, opts.audioQuality);
        if (!stream?.url) {
          throw new TypeTubeError("No playable audio stream found on refreshed track");
        }
        dl = await doDownload(stream.url);
      } else {
        throw err;
      }
    }

    const durationSec = +((performance.now() - t0) / 1000).toFixed(2);
    const speedMBps = durationSec > 0 ? +((dl.bytes / (1024 * 1024)) / durationSec).toFixed(2) : 0;
    const stat = fs.statSync(finalDest);
    const fileSizeMB = +((stat.size / (1024 * 1024)).toFixed(2));
    const fileName = path.basename(finalDest);

    return {
      success: true,
      filePath: finalDest,
      fileName,
      sizeBytes: stat.size,
      fileSizeMB,
      durationSec,
      speedMBps,
      id: track.id,
      title: track.title,
      artist: track.author,
      author: track.author,
      duration: track.durationSeconds,
      durationSeconds: track.durationSeconds,
      thumbnail: track.thumbnail,
      thumbnails: track.thumbnails,
      track,
      stream,
      audioStream: stream
    };
  }

  public async downloadVideo(
    target: Resolvable,
    destPathOrOptions?: string | DownloadVideoOptions,
    options?: DownloadVideoOptions
  ): Promise<DownloadResult> {
    const destPath = typeof destPathOrOptions === "string" ? destPathOrOptions : "./downloads";
    const opts = typeof destPathOrOptions === "object" ? destPathOrOptions : (options || {});

    let track = await this.ensureFreshTrack(target, { timeoutMs: opts.timeoutMs });
    let stream = this.selectVideoStream(track.videoStreams, track.bestVideo, opts.quality, opts.preferCodec);

    if (!stream?.url) {
      throw new TypeTubeError("No playable video stream found for download");
    }

    const finalDest = this.resolveDestination(destPath, track, "mp4");
    this.ensureDirectory(finalDest);
    const t0 = performance.now();

    const doDownload = async (url: string) => {
      return await this.downloadStreamToFile(
        url,
        finalDest,
        (p) => {
          if (opts.onProgress) {
            opts.onProgress({
              ...p,
              phase: "downloading"
            });
          }
        },
        5,
        opts.chunkSizeBytes,
        opts.workers
      );
    };

    let dl: { bytes: number };
    try {
      dl = await doDownload(stream.url);
    } catch (err: any) {
      if (err instanceof TypeTubeError && (err.statusCode === 403 || err.statusCode === 410)) {
        const query = track.id ? `https://www.youtube.com/watch?v=${track.id}` : (track.title || track.query);
        track = await this.resolve(query, { timeoutMs: opts.timeoutMs });
        stream = this.selectVideoStream(track.videoStreams, track.bestVideo, opts.quality, opts.preferCodec);
        if (!stream?.url) {
          throw new TypeTubeError("No playable video stream found on refreshed track");
        }
        dl = await doDownload(stream.url);
      } else {
        throw err;
      }
    }

    const durationSec = +((performance.now() - t0) / 1000).toFixed(2);
    const speedMBps = durationSec > 0 ? +((dl.bytes / (1024 * 1024)) / durationSec).toFixed(2) : 0;
    const stat = fs.statSync(finalDest);
    const fileSizeMB = +((stat.size / (1024 * 1024)).toFixed(2));
    const fileName = path.basename(finalDest);
    const dims = stream.resolution ? stream.resolution.split("x").map((x) => parseInt(x, 10)) : [];

    return {
      success: true,
      filePath: finalDest,
      fileName,
      sizeBytes: stat.size,
      fileSizeMB,
      durationSec,
      speedMBps,
      id: track.id,
      title: track.title,
      artist: track.author,
      author: track.author,
      duration: track.durationSeconds,
      durationSeconds: track.durationSeconds,
      thumbnail: track.thumbnail,
      thumbnails: track.thumbnails,
      track,
      stream,
      videoStream: stream,
      width: dims[0],
      height: dims[1]
    };
  }

  public async downloadMedia(
    target: Resolvable,
    destPathOrOptions?: string | DownloadMediaOptions,
    options?: DownloadMediaOptions
  ): Promise<DownloadResult> {
    const destPath = typeof destPathOrOptions === "string" ? destPathOrOptions : "./downloads";
    const opts = typeof destPathOrOptions === "object" ? destPathOrOptions : (options || {});

    let track = await this.ensureFreshTrack(target, { timeoutMs: opts.timeoutMs });
    let vStream = this.selectVideoStream(track.videoStreams, track.bestVideo, opts.quality, opts.preferCodec);
    let aStream = this.selectAudioStream(track.audioStreams, track.bestAudio, opts.audioQuality);

    if (!vStream?.url) {
      throw new TypeTubeError("No playable video stream found for media download");
    }
    if (!aStream?.url) {
      throw new TypeTubeError("No playable audio stream found for media download");
    }

    const ext = opts.outputFormat || "mp4";
    const finalDest = this.resolveDestination(destPath, track, ext);
    this.ensureDirectory(finalDest);

    const tempV = `${finalDest}.tmp.${Date.now()}.v`;
    const tempA = `${finalDest}.tmp.${Date.now()}.a`;

    let vBytes = 0;
    let vTotal = 0;
    let aBytes = 0;
    let aTotal = 0;

    const notifyCombinedProgress = () => {
      if (!opts.onProgress) return;
      const totalDownloaded = vBytes + aBytes;
      const totalBytes = (vTotal > 0 && aTotal > 0) ? (vTotal + aTotal) : 0;
      const pct = totalBytes > 0 ? +((totalDownloaded / totalBytes) * 100).toFixed(1) : 0;
      opts.onProgress({
        percent: pct,
        downloadedBytes: totalDownloaded,
        totalBytes,
        speedMBps: 0,
        phase: "downloading"
      });
    };

    const doDownloadParallel = async (videoUrl: string, audioUrl: string) => {
      const vWorkers = opts.videoWorkers ?? opts.workers;
      const vChunk = opts.videoChunkSizeBytes ?? opts.chunkSizeBytes;
      const aWorkers = opts.audioWorkers ?? opts.workers;
      const aChunk = opts.audioChunkSizeBytes ?? opts.chunkSizeBytes;

      await Promise.all([
        this.downloadStreamToFile(
          videoUrl,
          tempV,
          (p) => {
            vBytes = p.downloadedBytes;
            vTotal = p.totalBytes;
            notifyCombinedProgress();
          },
          5,
          vChunk,
          vWorkers
        ),
        this.downloadStreamToFile(
          audioUrl,
          tempA,
          (p) => {
            aBytes = p.downloadedBytes;
            aTotal = p.totalBytes;
            notifyCombinedProgress();
          },
          5,
          aChunk,
          aWorkers
        )
      ]);
    };

    const t0 = performance.now();

    try {
      try {
        await doDownloadParallel(vStream.url, aStream.url);
      } catch (err: any) {
        if (err instanceof TypeTubeError && (err.statusCode === 403 || err.statusCode === 410)) {
          if (fs.existsSync(tempV)) fs.unlinkSync(tempV);
          if (fs.existsSync(tempA)) fs.unlinkSync(tempA);
          vBytes = 0;
          aBytes = 0;
          const query = track.id ? `https://www.youtube.com/watch?v=${track.id}` : (track.title || track.query);
          track = await this.resolve(query, { timeoutMs: opts.timeoutMs });
          vStream = this.selectVideoStream(track.videoStreams, track.bestVideo, opts.quality, opts.preferCodec);
          aStream = this.selectAudioStream(track.audioStreams, track.bestAudio, opts.audioQuality);
          if (!vStream?.url || !aStream?.url) {
            throw new TypeTubeError("Missing playable streams on refreshed track");
          }
          await doDownloadParallel(vStream.url, aStream.url);
        } else {
          throw err;
        }
      }

      if (opts.onProgress) {
        opts.onProgress({
          percent: 100,
          downloadedBytes: vBytes + aBytes,
          totalBytes: vTotal + aTotal,
          speedMBps: 0,
          phase: "muxing"
        });
      }

      const tMuxStart = performance.now();
      await this.muxStreamsWithFfmpeg(tempV, tempA, finalDest, opts.ffmpegPath);
      const muxTimeSec = +((performance.now() - tMuxStart) / 1000).toFixed(2);

      const totalDurationSec = +((performance.now() - t0) / 1000).toFixed(2);
      const stat = fs.statSync(finalDest);
      const fileSizeMB = +((stat.size / (1024 * 1024)).toFixed(2));
      const fileName = path.basename(finalDest);
      const speedMBps = totalDurationSec > 0 ? +((stat.size / (1024 * 1024)) / totalDurationSec).toFixed(2) : 0;
      const dims = vStream.resolution ? vStream.resolution.split("x").map((x) => parseInt(x, 10)) : [];

      if (opts.onProgress) {
        opts.onProgress({
          percent: 100,
          downloadedBytes: stat.size,
          totalBytes: stat.size,
          speedMBps,
          phase: "complete"
        });
      }

      return {
        success: true,
        filePath: finalDest,
        fileName,
        sizeBytes: stat.size,
        fileSizeMB,
        durationSec: totalDurationSec,
        speedMBps,
        id: track.id,
        title: track.title,
        artist: track.author,
        author: track.author,
        duration: track.durationSeconds,
        durationSeconds: track.durationSeconds,
        thumbnail: track.thumbnail,
        thumbnails: track.thumbnails,
        track,
        videoStream: vStream,
        audioStream: aStream,
        muxTimeSec,
        width: dims[0],
        height: dims[1]
      };
    } finally {
      if (fs.existsSync(tempV)) fs.unlinkSync(tempV);
      if (fs.existsSync(tempA)) fs.unlinkSync(tempA);
    }
  }

  private resolveDestination(destPath: string, track: TrackResult, ext: string): string {
    const target = destPath.trim();
    const isDir = (fs.existsSync(target) && fs.statSync(target).isDirectory()) || target.endsWith("/") || target.endsWith("\\");
    if (isDir) {
      const author = (track.author || "").trim();
      const title = (track.title || track.id).trim();
      const name = author && !title.toLowerCase().startsWith(author.toLowerCase()) ? `${author} - ${title}` : title;
      const safeName = name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
      return path.join(target, `${safeName}.${ext}`);
    }
    return target;
  }

  private selectAudioStream(streams: AudioStream[], best?: AudioStream, preference?: string): AudioStream {
    if (!Array.isArray(streams) || streams.length === 0) return best!;

    const nonGcr = streams.filter((s) => !s.url.includes("gcr="));
    const pool = nonGcr.length > 0 ? nonGcr : streams;

    if (preference === "hifi" || preference === "256kbps") {
      const hifi = pool.find((s) => s.itag === 141 || s.itag === 774);
      if (hifi) return hifi;
    }

    if (preference === "128kbps") {
      const std = pool.find((s) => s.itag === 140 || s.itag === 251);
      if (std) return std;
    }

    if (preference === "lowest") {
      return [...pool].sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0))[0]!;
    }

    return pool[0] || best!;
  }

  private selectVideoStream(
    streams: VideoStream[],
    best?: VideoStream,
    qualityPreference?: string,
    codecPreference?: string
  ): VideoStream {
    if (!Array.isArray(streams) || streams.length === 0) return best!;

    let pool = [...streams];

    if (codecPreference && codecPreference !== "any") {
      const filtered = pool.filter((s) => s.mimeType.toLowerCase().includes(codecPreference.toLowerCase()));
      if (filtered.length > 0) pool = filtered;
    }

    const parseHeight = (q: string): number => {
      const m = (q || "").match(/^(\d+)p/);
      return m ? parseInt(m[1]!, 10) : (parseInt(q, 10) || 0);
    };

    if (qualityPreference && qualityPreference !== "highest" && qualityPreference !== "lowest") {
      const targetHeight = parseHeight(qualityPreference);
      if (targetHeight > 0) {
        const exact = pool.find((s) => parseHeight(s.quality) === targetHeight);
        if (exact) return exact;
        const lowerOrEqual = pool.filter((s) => parseHeight(s.quality) <= targetHeight);
        if (lowerOrEqual.length > 0) return lowerOrEqual[0]!;
      }
    }

    if (qualityPreference === "lowest") {
      return [...pool].sort((a, b) => parseHeight(a.quality) - parseHeight(b.quality))[0]!;
    }

    return pool[0] || best!;
  }

  private filterVideoByHeight(streams: VideoStream[], maxHeight: number): VideoStream | null {
    if (!Array.isArray(streams) || streams.length === 0) return null;
    const parseHeight = (q: string): number => {
      const m = (q || "").match(/^(\d+)p/);
      return m ? parseInt(m[1]!, 10) : (parseInt(q, 10) || 0);
    };
    const candidates = streams.filter((v) => {
      const h = parseHeight(v.quality);
      return isNaN(h) || h <= maxHeight;
    });
    return candidates[0] || streams[0] || null;
  }

  private ensureDirectory(targetFile: string): void {
    const dir = path.dirname(targetFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private async downloadStreamToFile(
    url: string,
    destPath: string,
    onProgress?: (p: { downloadedBytes: number; totalBytes: number; speedMBps: number; percent: number }) => void,
    maxRedirects = 5,
    chunkSizeBytes?: number,
    workersCount?: number
  ): Promise<{ bytes: number }> {
    try {
      const probeRes = await fetch(url, { headers: { "Range": "bytes=0-0", "User-Agent": "Mozilla/5.0" } });
      const cr = probeRes.headers.get("content-range");
      if (probeRes.status === 206 && cr) {
        const totalBytes = parseInt(cr.split("/")[1] || "0", 10);
        if (totalBytes > 8 * 1024 * 1024) {
          return await this.downloadChunkedRange(url, destPath, totalBytes, onProgress, chunkSizeBytes, workersCount);
        }
      }
    } catch {}

    return this.downloadLinearStream(url, destPath, onProgress, maxRedirects);
  }

  private async downloadChunkedRange(
    url: string,
    destPath: string,
    totalBytes: number,
    onProgress?: (p: { downloadedBytes: number; totalBytes: number; speedMBps: number; percent: number }) => void,
    chunkSizeBytes?: number,
    workersCount?: number
  ): Promise<{ bytes: number }> {
    const CHUNK_SIZE = Math.max(512 * 1024, chunkSizeBytes || (10 * 1024 * 1024));
    const NUM_WORKERS = Math.max(1, Math.min(32, workersCount || 4));
    const chunks: Array<{ start: number; end: number }> = [];
    for (let start = 0; start < totalBytes; start += CHUNK_SIZE) {
      const end = Math.min(start + CHUNK_SIZE - 1, totalBytes - 1);
      chunks.push({ start, end });
    }

    const fd = fs.openSync(destPath, "w");
    const t0 = performance.now();
    let downloaded = 0;
    const queue = [...chunks];

    const worker = async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        const res = await fetch(url, {
          headers: {
            "Range": `bytes=${item.start}-${item.end}`,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
          }
        });
        if (!res.ok && res.status !== 206) {
          throw new TypeTubeError(`Range chunk download failed with status ${res.status}`, res.status);
        }
        const ab = await res.arrayBuffer();
        const buf = Buffer.from(ab);
        fs.writeSync(fd, buf, 0, buf.length, item.start);
        downloaded += buf.length;

        if (onProgress) {
          const sec = (performance.now() - t0) / 1000;
          const speedMBps = sec > 0 ? +((downloaded / (1024 * 1024)) / sec).toFixed(2) : 0;
          const pct = +((downloaded / totalBytes) * 100).toFixed(1);
          onProgress({
            downloadedBytes: downloaded,
            totalBytes,
            speedMBps,
            percent: pct
          });
        }
      }
    };

    try {
      const workers = Array.from({ length: NUM_WORKERS }, () => worker());
      await Promise.all(workers);
      return { bytes: downloaded };
    } finally {
      fs.closeSync(fd);
    }
  }

  private downloadLinearStream(
    url: string,
    destPath: string,
    onProgress?: (p: { downloadedBytes: number; totalBytes: number; speedMBps: number; percent: number }) => void,
    maxRedirects = 5
  ): Promise<{ bytes: number }> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);
      const t0 = performance.now();

      const fetchUrl = (currentUrl: string, redirectsLeft: number) => {
        const transport = currentUrl.startsWith("https:") ? https : http;
        const req = transport.get(currentUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
          }
        }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (redirectsLeft <= 0) {
              file.close();
              fs.unlink(destPath, () => {});
              return reject(new TypeTubeError("Too many redirects during stream download"));
            }
            const nextUrl = new URL(res.headers.location, currentUrl).toString();
            return fetchUrl(nextUrl, redirectsLeft - 1);
          }

          if (res.statusCode !== 200 && res.statusCode !== 206) {
            file.close();
            fs.unlink(destPath, () => {});
            return reject(new TypeTubeError(`Download stream failed with status ${res.statusCode}`, res.statusCode));
          }

          const totalBytes = parseInt(res.headers["content-length"] || "0", 10) || 0;
          let downloaded = 0;

          res.on("data", (chunk: Buffer) => {
            downloaded += chunk.length;
            if (onProgress) {
              const sec = (performance.now() - t0) / 1000;
              const speedMBps = sec > 0 ? +((downloaded / (1024 * 1024)) / sec).toFixed(2) : 0;
              const pct = totalBytes > 0 ? +((downloaded / totalBytes) * 100).toFixed(1) : 0;
              onProgress({
                downloadedBytes: downloaded,
                totalBytes,
                speedMBps,
                percent: pct
              });
            }
          });

          res.pipe(file);

          file.on("finish", () => {
            file.close(() => resolve({ bytes: downloaded }));
          });
        });

        req.on("error", (err) => {
          file.close();
          fs.unlink(destPath, () => {});
          reject(new TypeTubeError(err.message || "Network error while downloading stream"));
        });

        req.setTimeout(60000, () => {
          req.destroy();
          file.close();
          fs.unlink(destPath, () => {});
          reject(new TypeTubeError("Stream download timed out after 60s", 408));
        });
      };

      fetchUrl(url, maxRedirects);
    });
  }

  private muxStreamsWithFfmpeg(
    videoPath: string,
    audioPath: string,
    outputPath: string,
    ffmpegBin = "ffmpeg"
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        "-y",
        "-i", videoPath,
        "-i", audioPath,
        "-c:v", "copy",
        "-c:a", "copy",
        "-movflags", "+faststart",
        outputPath
      ];

      const proc = spawn(ffmpegBin, args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";

      proc.stderr.on("data", (d) => {
        stderr += d.toString();
      });

      proc.on("error", (err) => {
        reject(new TypeTubeError(`Failed to spawn ffmpeg: ${err.message}. Ensure ffmpeg is installed.`));
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new TypeTubeError(`ffmpeg muxing failed with code ${code}: ${stderr.slice(-300)}`));
        }
      });
    });
  }
}

export function createClient(
  optionsOrApiKey?: string | TypeTubeClientOptions,
  options?: Omit<TypeTubeClientOptions, "apiKey">
): TypeTubeClient {
  if (typeof optionsOrApiKey === "string") {
    const trimmed = optionsOrApiKey.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return new TypeTubeClient({ host: trimmed, ...options });
    }
    return new TypeTubeClient({ apiKey: trimmed, ...options });
  }
  return new TypeTubeClient(optionsOrApiKey || options);
}
