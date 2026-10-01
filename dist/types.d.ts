export interface AudioStream {
    itag: number;
    quality: string;
    mimeType: string;
    bitrate: number;
    url: string;
    rawUrl?: string;
    isHiFi: boolean;
}
export interface VideoStream {
    itag: number;
    quality: string;
    resolution?: string;
    mimeType: string;
    url: string;
}
export interface Thumbnail {
    url: string;
    width?: number;
    height?: number;
}
export interface TrackResult {
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
export interface SearchItem {
    id: string;
    title: string;
    url: string;
    duration: number | null;
    uploader: string | null;
}
export interface TypeTubeClientOptions {
    apiKey?: string;
    host?: string;
    endpoint?: string;
    timeoutMs?: number;
    format?: "protobuf" | "json";
}
export interface UsageInfo {
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
export interface ResolveOptions {
    timeoutMs?: number;
    maxVideoHeight?: number;
}
export interface DownloadProgress {
    percent: number;
    downloadedBytes: number;
    totalBytes: number;
    speedMBps: number;
    phase: "resolving" | "downloading" | "muxing" | "complete";
}
export interface DownloadAudioOptions {
    audioQuality?: "highest" | "hifi" | "128kbps" | "256kbps" | "lowest";
    timeoutMs?: number;
    workers?: number;
    chunkSizeBytes?: number;
    onProgress?: (progress: DownloadProgress) => void;
}
export interface DownloadVideoOptions {
    quality?: "2160p" | "1440p" | "1080p" | "720p" | "480p" | "360p" | "highest" | "lowest" | string;
    preferCodec?: "avc1" | "vp9" | "av01" | "any";
    timeoutMs?: number;
    workers?: number;
    chunkSizeBytes?: number;
    onProgress?: (progress: DownloadProgress) => void;
}
export interface DownloadMediaOptions extends DownloadVideoOptions, DownloadAudioOptions {
    outputFormat?: "mp4" | "mkv" | "webm";
    ffmpegPath?: string;
    videoWorkers?: number;
    audioWorkers?: number;
    videoChunkSizeBytes?: number;
    audioChunkSizeBytes?: number;
}
export interface DownloadResult {
    success: boolean;
    filePath: string;
    fileName: string;
    sizeBytes: number;
    fileSizeMB: number;
    durationSec: number;
    speedMBps: number;
    id: string;
    title: string;
    artist: string;
    author: string;
    duration: number;
    durationSeconds: number;
    thumbnail: string;
    thumbnails: Thumbnail[];
    track: TrackResult;
    stream?: AudioStream | VideoStream;
    videoStream?: VideoStream;
    audioStream?: AudioStream;
    muxTimeSec?: number;
    width?: number;
    height?: number;
}
export interface PlaybackOptions {
    quality?: string;
    preferCodec?: "avc1" | "vp9" | "av01" | "any";
    audioQuality?: "highest" | "hifi" | "128kbps" | "256kbps" | "lowest";
    maxVideoHeight?: number;
    timeoutMs?: number;
}
export interface PlaybackInfo {
    id: string;
    title: string;
    artist: string;
    author: string;
    duration: number;
    durationSeconds: number;
    thumbnail: string;
    thumbnails: Thumbnail[];
    audioUrl?: string;
    videoUrl?: string;
    audioStream?: AudioStream;
    videoStream?: VideoStream;
    track: TrackResult;
}
export interface SearchOptions {
    limit?: number;
    timeoutMs?: number;
}
export type Resolvable = string | TrackResult | PlaybackInfo;
//# sourceMappingURL=types.d.ts.map