import { TrackResult, SearchItem } from "./types.js";
export declare class ProtoReader {
    private buf;
    private view;
    private pos;
    constructor(buf: Uint8Array);
    get hasMore(): boolean;
    readVarint(): number;
    readTag(): {
        field: number;
        wire: number;
    };
    readString(): string;
    readDouble(): number;
    readBytes(): Uint8Array;
    skip(wire: number): void;
}
export declare function decodeTrackResult(buf: Uint8Array): TrackResult;
export declare function decodeSearchResults(buf: Uint8Array): SearchItem[];
//# sourceMappingURL=protocol.d.ts.map