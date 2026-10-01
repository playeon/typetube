import { TrackResult, SearchItem, TypeTubeClientOptions, ResolveOptions, DownloadAudioOptions, DownloadVideoOptions, DownloadMediaOptions, DownloadResult, PlaybackOptions, PlaybackInfo, SearchOptions, Resolvable, UsageInfo } from "./types.js";
export * from "./types.js";
export declare class TypeTubeError extends Error {
    statusCode?: number;
    constructor(message: string, statusCode?: number);
}
export declare class TypeTubeClient {
    apiCallsCount: number;
    private readonly apiKey;
    readonly host: string;
    private readonly timeoutMs;
    private readonly format;
    get endpoint(): string;
    constructor(optionsOrApiKey?: string | TypeTubeClientOptions);
    usage(timeoutMs?: number): Promise<UsageInfo>;
    isStreamExpired(url?: string | null, marginSeconds?: number): boolean;
    coerceTrack(input: Resolvable): TrackResult | null;
    private ensureFreshTrack;
    resolve(query: string, options?: ResolveOptions): Promise<TrackResult>;
    search(query: string, optionsOrLimit?: number | SearchOptions): Promise<SearchItem[]>;
    getAudioStreamUrl(target: Resolvable): Promise<string>;
    getVideoStreamUrl(target: Resolvable, maxHeight?: number): Promise<string>;
    getPlayback(target: Resolvable, options?: PlaybackOptions): Promise<PlaybackInfo>;
    getMediaUrls(target: Resolvable, options?: PlaybackOptions): Promise<PlaybackInfo>;
    downloadAudio(target: Resolvable, destPathOrOptions?: string | DownloadAudioOptions, options?: DownloadAudioOptions): Promise<DownloadResult>;
    downloadVideo(target: Resolvable, destPathOrOptions?: string | DownloadVideoOptions, options?: DownloadVideoOptions): Promise<DownloadResult>;
    downloadMedia(target: Resolvable, destPathOrOptions?: string | DownloadMediaOptions, options?: DownloadMediaOptions): Promise<DownloadResult>;
    private resolveDestination;
    private selectAudioStream;
    private selectVideoStream;
    private filterVideoByHeight;
    private ensureDirectory;
    private downloadStreamToFile;
    private downloadChunkedRange;
    private downloadLinearStream;
    private muxStreamsWithFfmpeg;
}
export declare function createClient(optionsOrApiKey?: string | TypeTubeClientOptions, options?: Omit<TypeTubeClientOptions, "apiKey">): TypeTubeClient;
//# sourceMappingURL=index.d.ts.map