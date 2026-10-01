export class ProtoReader {
    buf;
    view;
    pos = 0;
    constructor(buf) {
        this.buf = buf;
        this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    get hasMore() {
        return this.pos < this.buf.length;
    }
    readVarint() {
        let res = 0;
        let shift = 0;
        while (this.pos < this.buf.length) {
            const b = this.buf[this.pos++];
            res |= (b & 0x7f) << shift;
            if ((b & 0x80) === 0)
                return res >>> 0;
            shift += 7;
        }
        return res >>> 0;
    }
    readTag() {
        const v = this.readVarint();
        return { field: v >>> 3, wire: v & 0x7 };
    }
    readString() {
        const len = this.readVarint();
        const sub = this.buf.subarray(this.pos, this.pos + len);
        this.pos += len;
        return new TextDecoder().decode(sub);
    }
    readDouble() {
        const val = this.view.getFloat64(this.pos, true);
        this.pos += 8;
        return val;
    }
    readBytes() {
        const len = this.readVarint();
        const sub = this.buf.subarray(this.pos, this.pos + len);
        this.pos += len;
        return sub;
    }
    skip(wire) {
        if (wire === 0)
            this.readVarint();
        else if (wire === 1)
            this.pos += 8;
        else if (wire === 2) {
            const len = this.readVarint();
            this.pos += len;
        }
        else if (wire === 5)
            this.pos += 4;
    }
}
function readAudioStream(buf) {
    const r = new ProtoReader(buf);
    const stream = { isHiFi: false };
    while (r.hasMore) {
        const { field, wire } = r.readTag();
        if (field === 1)
            stream.itag = r.readVarint();
        else if (field === 2)
            stream.quality = r.readString();
        else if (field === 3)
            stream.mimeType = r.readString();
        else if (field === 4)
            stream.bitrate = r.readVarint();
        else if (field === 5)
            stream.url = r.readString();
        else if (field === 6)
            stream.isHiFi = r.readVarint() === 1;
        else if (field === 7)
            stream.rawUrl = r.readString();
        else
            r.skip(wire);
    }
    return stream;
}
function readVideoStream(buf) {
    const r = new ProtoReader(buf);
    const stream = {};
    while (r.hasMore) {
        const { field, wire } = r.readTag();
        if (field === 1)
            stream.itag = r.readVarint();
        else if (field === 2)
            stream.quality = r.readString();
        else if (field === 3)
            stream.resolution = r.readString();
        else if (field === 4)
            stream.mimeType = r.readString();
        else if (field === 5)
            stream.url = r.readString();
        else
            r.skip(wire);
    }
    return stream;
}
function readThumbnail(buf) {
    const r = new ProtoReader(buf);
    const thumb = {};
    while (r.hasMore) {
        const { field, wire } = r.readTag();
        if (field === 1)
            thumb.url = r.readString();
        else if (field === 2)
            thumb.width = r.readVarint();
        else if (field === 3)
            thumb.height = r.readVarint();
        else
            r.skip(wire);
    }
    return thumb;
}
export function decodeTrackResult(buf) {
    const r = new ProtoReader(buf);
    const track = {
        success: false,
        thumbnails: [],
        audioStreams: [],
        videoStreams: []
    };
    while (r.hasMore) {
        const { field, wire } = r.readTag();
        if (field === 1)
            track.success = r.readVarint() === 1;
        else if (field === 2)
            track.query = r.readString();
        else if (field === 3)
            track.id = r.readString();
        else if (field === 4)
            track.title = r.readString();
        else if (field === 5)
            track.author = r.readString();
        else if (field === 6)
            track.uploader = r.readString();
        else if (field === 7)
            track.artistAvatar = r.readString();
        else if (field === 8)
            track.durationSeconds = r.readVarint();
        else if (field === 9)
            track.thumbnail = r.readString();
        else if (field === 10)
            track.thumbnails.push(readThumbnail(r.readBytes()));
        else if (field === 11)
            track.latencyMs = r.readDouble();
        else if (field === 12)
            track.bestAudio = readAudioStream(r.readBytes());
        else if (field === 13)
            track.bestVideo = readVideoStream(r.readBytes());
        else if (field === 14)
            track.audioStreams.push(readAudioStream(r.readBytes()));
        else if (field === 15)
            track.videoStreams.push(readVideoStream(r.readBytes()));
        else
            r.skip(wire);
    }
    return track;
}
export function decodeSearchResults(buf) {
    const r = new ProtoReader(buf);
    const items = [];
    while (r.hasMore) {
        const { field, wire } = r.readTag();
        if (field === 2) {
            const itemBuf = r.readBytes();
            const ir = new ProtoReader(itemBuf);
            const item = { duration: null, uploader: null };
            while (ir.hasMore) {
                const { field: ifield, wire: iwire } = ir.readTag();
                if (ifield === 1)
                    item.id = ir.readString();
                else if (ifield === 2)
                    item.title = ir.readString();
                else if (ifield === 3)
                    item.url = ir.readString();
                else if (ifield === 4)
                    item.duration = ir.readVarint();
                else if (ifield === 5)
                    item.uploader = ir.readString();
                else
                    ir.skip(iwire);
            }
            items.push(item);
        }
        else {
            r.skip(wire);
        }
    }
    return items;
}
//# sourceMappingURL=protocol.js.map