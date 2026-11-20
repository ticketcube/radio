#!/usr/bin/env python3
"""
split-set: cut a long live recording into one tagged file per song.

    split-set RECORDING SONGLIST [options]

RECORDING can be any audio or video file ffmpeg can read (WAV, MP3, FLAC, M4A, MP4, MOV...).
SONGLIST is a CSV or a plain text setlist. See README.md for the formats.

  * If the songlist has start times, the cuts go exactly there.
  * If it has no times, the script listens for the quietest stretch between songs
    and makes one cut there per song. Check those cuts: crowd noise and banter make
    this a best guess, and the report flags anything that looks off.

Optional upload of the finished files to AzuraCast (station media library only, never
a playlist) or to AIMC. Keys come from a local env file, never from the command line.

Needs Python 3.9+ and ffmpeg. No other packages.
"""

from __future__ import annotations

import argparse
import base64
import csv
import json
import math
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

VERSION = "1.0.0"

# Station loudness target, same as otw-radio/sync/src/audio.ts.
TARGET_LUFS = -16.0
TARGET_TP = -1.5

KNOWN_COLUMNS = {"start", "end", "title", "artist", "album", "track"}

FORMATS = {
    # ext: (ffmpeg codec args, content type)
    "mp3": (["-c:a", "libmp3lame", "-id3v2_version", "3", "-write_id3v1", "1"], "audio/mpeg"),
    "wav": (["-c:a", "pcm_s24le"], "audio/wav"),
    "flac": (["-c:a", "flac"], "audio/flac"),
    "m4a": (["-c:a", "aac"], "audio/mp4"),
}


# --------------------------------------------------------------------------- helpers


def die(msg: str, code: int = 1) -> None:
    print(f"\nERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def info(msg: str) -> None:
    print(msg, flush=True)


def parse_time(value: str) -> float:
    """Accepts 75, 75.5, 1:15, 01:01:15, 1:01:15.250, and a leading minus sign."""
    s = value.strip()
    if not s:
        raise ValueError("empty time")
    neg = s.startswith("-")
    if neg:
        s = s[1:]
    parts = s.split(":")
    if len(parts) > 3:
        raise ValueError(f"bad time '{value}'")
    total = 0.0
    for p in parts:
        total = total * 60 + float(p)
    return -total if neg else total


def fmt_time(sec: float) -> str:
    sec = max(sec, 0)
    h, rem = divmod(int(round(sec)), 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def safe_name(text: str) -> str:
    text = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "", text).strip().strip(".")
    return re.sub(r"\s+", " ", text)[:120] or "untitled"


def run(cmd: list[str], capture: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=capture, text=True)


def need(tool: str) -> None:
    if shutil.which(tool) is None:
        die(f"'{tool}' is not installed. On a Mac: brew install ffmpeg")


def duration_of(path: Path) -> float:
    r = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(path)])
    try:
        return float(r.stdout.strip())
    except ValueError:
        die(f"ffprobe could not read '{path}'. Is it an audio or video file?\n{r.stderr[-500:]}")
    return 0.0


# --------------------------------------------------------------------------- songlist


@dataclass
class Song:
    title: str
    artist: str = ""
    album: str = ""
    start: float | None = None
    end: float | None = None
    extra: dict[str, str] = field(default_factory=dict)


TEXT_LINE = re.compile(r"^\s*(?:(?P<num>\d{1,3})[.)]\s+)?(?:(?P<time>\d{1,2}(?::\d{1,2}){1,2}(?:\.\d+)?)\s*[-–|]?\s+)?(?P<rest>.+?)\s*$")


def read_songlist(path: Path) -> list[Song]:
    raw = path.read_text(encoding="utf-8-sig")
    first = next((ln for ln in raw.splitlines() if ln.strip()), "")
    if path.suffix.lower() in (".csv", ".tsv") or ("title" in first.lower() and ("," in first or "\t" in first)):
        return read_csv(raw, "\t" if "\t" in first and "," not in first else ",")
    return read_text(raw)


def read_csv(raw: str, delim: str) -> list[Song]:
    rows = list(csv.DictReader(raw.splitlines(), delimiter=delim))
    if not rows:
        die("The songlist CSV has no rows.")
    songs = []
    for i, row in enumerate(rows, 1):
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
        if not row.get("title"):
            if any(row.values()):
                die(f"Songlist row {i} has no title.")
            continue
        try:
            start = parse_time(row["start"]) if row.get("start") else None
            end = parse_time(row["end"]) if row.get("end") else None
        except ValueError as e:
            die(f"Songlist row {i} ({row['title']}): {e}")
        extra = {k: v for k, v in row.items() if k not in KNOWN_COLUMNS and k and v}
        songs.append(Song(row["title"], row.get("artist", ""), row.get("album", ""), start, end, extra))
    return songs


def read_text(raw: str) -> list[Song]:
    songs = []
    for ln in raw.splitlines():
        if not ln.strip() or ln.strip().startswith("#"):
            continue
        m = TEXT_LINE.match(ln)
        rest = m.group("rest")
        start = parse_time(m.group("time")) if m.group("time") else None
        artist, title = "", rest
        if " - " in rest:
            artist, title = [x.strip() for x in rest.split(" - ", 1)]
        songs.append(Song(title, artist, start=start))
    if not songs:
        die("The songlist is empty.")
    return songs


# --------------------------------------------------------------------------- finding cuts


def loudness_curve(path: Path, step: float = 0.5) -> list[float]:
    """RMS level in dB for every `step` seconds of audio, computed by ffmpeg."""
    rate = 8000
    n = int(rate * step)
    af = (f"aresample={rate},aformat=channel_layouts=mono,asetnsamples=n={n}:p=0,"
          f"astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-")
    r = run(["ffmpeg", "-hide_banner", "-nostats", "-v", "error", "-i", str(path), "-vn", "-af", af, "-f", "null", "-"])
    levels = []
    for ln in r.stdout.splitlines():
        if "RMS_level=" in ln:
            v = ln.split("=", 1)[1]
            levels.append(-120.0 if v in ("-inf", "inf", "nan") else max(float(v), -120.0))
    if not levels:
        die(f"Could not analyse the audio for quiet gaps.\n{r.stderr[-500:]}")
    return levels


def find_cuts(path: Path, count: int, total: float, min_song: float) -> list[float]:
    """Pick `count - 1` cut points at the quietest stretches, spaced at least min_song apart."""
    if count <= 1:
        return []
    step = 0.5
    levels = loudness_curve(path, step)
    win = 6  # smooth over 3 seconds so a single drum hit or pause does not count
    smooth = []
    for i in range(len(levels)):
        a, b = max(0, i - win), min(len(levels), i + win + 1)
        # average in the power domain
        smooth.append(10 * math.log10(sum(10 ** (x / 10) for x in levels[a:b]) / (b - a) + 1e-12))

    spacing = min(min_song, total / count * 0.5)
    order = sorted(range(len(smooth)), key=lambda i: smooth[i])
    chosen: list[int] = []
    for i in order:
        t = i * step
        if t < spacing or total - t < spacing:
            continue
        if all(abs(t - c * step) >= spacing for c in chosen):
            chosen.append(i)
            if len(chosen) == count - 1:
                break
    if len(chosen) < count - 1:
        die(f"Could only find {len(chosen) + 1} songs' worth of gaps for {count} songs. "
            f"Add start times to the songlist, or lower --min-song (now {min_song:.0f}s).")
    return sorted(c * step + step / 2 for c in chosen)


# --------------------------------------------------------------------------- audio


def measure_loudness(path: Path, start: float | None = None, dur: float | None = None) -> float:
    """Integrated loudness (LUFS) of the whole file or one stretch of it, via ffmpeg's ebur128."""
    cmd = ["ffmpeg", "-hide_banner", "-nostats"]
    if start is not None:
        cmd += ["-ss", f"{start:.3f}"]
    if dur is not None:
        cmd += ["-t", f"{dur:.3f}"]
    cmd += ["-i", str(path), "-vn", "-af", "ebur128", "-f", "null", "-"]
    r = run(cmd)
    m = re.findall(r"I:\s+(-?[\d.]+|-inf) LUFS", r.stderr)
    if not m:
        die(f"Loudness measurement failed.\n{r.stderr[-500:]}")
    return -70.0 if m[-1] == "-inf" else float(m[-1])


def gain_filter(gain_db: float) -> str:
    # One fixed gain per file (no pumping), with a limiter to hold peaks under the ceiling.
    return f"volume={gain_db:.2f}dB,alimiter=limit={10 ** (TARGET_TP / 20):.3f}:attack=5:release=50:level=false"


def cut_song(src: Path, dst: Path, start: float, end: float, tags: dict[str, str], args, set_gain_db: float | None) -> None:
    dur = end - start
    filters = []
    if args.normalize == "song":
        filters.append(gain_filter(TARGET_LUFS - measure_loudness(src, start, dur)))
    elif args.normalize == "set" and set_gain_db is not None:
        filters.append(gain_filter(set_gain_db))
    if args.fade > 0 and dur > args.fade * 4:
        filters.append(f"afade=t=in:st=0:d={args.fade}")
        filters.append(f"afade=t=out:st={dur - args.fade:.3f}:d={args.fade}")

    codec, _ = FORMATS[args.format]
    cmd = ["ffmpeg", "-hide_banner", "-nostats", "-v", "error", "-y",
           "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", str(src),
           "-vn", "-map_metadata", "-1", "-ac", "2", "-ar", "48000" if args.format == "wav" else "44100"]
    if filters:
        cmd += ["-af", ",".join(filters)]
    cmd += codec
    if args.format in ("mp3", "m4a"):
        cmd += ["-b:a", args.bitrate]
    for k, v in tags.items():
        if v:
            cmd += ["-metadata", f"{k}={v}"]
    cmd.append(str(dst))
    r = run(cmd)
    if r.returncode != 0:
        die(f"ffmpeg failed on '{dst.name}':\n{r.stderr[-1500:]}")


# --------------------------------------------------------------------------- env + uploads


def load_env(path: str | None) -> dict[str, str]:
    candidates = [path] if path else [
        os.environ.get("OTW_ENV"),
        str(Path(__file__).resolve().parent / ".env"),
        str(Path.home() / ".otw-split-set.env"),
    ]
    env = dict(os.environ)
    for c in candidates:
        if c and Path(c).expanduser().is_file():
            for ln in Path(c).expanduser().read_text().splitlines():
                ln = ln.strip()
                if not ln or ln.startswith("#") or "=" not in ln:
                    continue
                k, v = ln.split("=", 1)
                env.setdefault(k.strip().removeprefix("export ").strip(), v.strip().strip('"').strip("'"))
            info(f"Using keys from {c}")
            break
    else:
        if path:
            die(f"Env file not found: {path}")
    return env


def http(method: str, url: str, headers: dict, body: bytes | None = None, timeout: int = 300) -> tuple[int, bytes]:
    url = urllib.parse.quote(url, safe=":/?&=%#+@,;~!$'()*[]")
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except urllib.error.URLError as e:
        if "CERTIFICATE_VERIFY_FAILED" in str(e):
            die("Python can't verify HTTPS certificates. If you installed Python from python.org, "
                "run 'Install Certificates.command' in its Applications folder, or use Homebrew's python3.")
        raise


def require(env: dict, *keys: str) -> None:
    missing = [k for k in keys if not env.get(k)]
    if missing:
        die(f"Missing {', '.join(missing)} in your env file. See .env.example.")


def upload_azuracast(env: dict, files: list[Path], folder: str, aimc_asset_id: str | None) -> None:
    require(env, "AZURACAST_URL", "AZURACAST_API_KEY", "AZURACAST_STATION_ID")
    base = env["AZURACAST_URL"].rstrip("/")
    station = env["AZURACAST_STATION_ID"]
    headers = {"X-API-Key": env["AZURACAST_API_KEY"], "Content-Type": "application/json", "Accept": "application/json"}
    info(f"\nUploading {len(files)} file(s) to AzuraCast media library: {folder}/")
    info("  (Library only. Nothing is added to a playlist or scheduled.)")
    for f in files:
        body = json.dumps({"path": f"{folder}/{f.name}", "file": base64.b64encode(f.read_bytes()).decode()}).encode()
        status, out = http("POST", f"{base}/api/station/{station}/files", headers, body)
        if status >= 300:
            die(f"AzuraCast upload of '{f.name}' failed ({status}): {out[:500].decode(errors='replace')}")
        media_id = None
        try:
            media_id = json.loads(out or b"{}").get("id")
        except (ValueError, AttributeError):
            pass
        info(f"  ✓ {f.name}" + (f"  (media id {media_id})" if media_id else ""))
        if aimc_asset_id and media_id:
            s2, o2 = http("PUT", f"{base}/api/station/{station}/file/{media_id}", headers,
                          json.dumps({"custom_fields": {"aimc_asset_id": aimc_asset_id}}).encode())
            if s2 >= 300:
                info(f"    ! could not set aimc_asset_id ({s2}): {o2[:200].decode(errors='replace')}")


def upload_aimc(env: dict, files: list[Path], folder: str, content_type: str) -> None:
    """Same two-step flow the site's /api/aimc/generate-upload route uses:
    ask AIMC for a presigned URL, then PUT the file to it."""
    require(env, "AIMC_API_KEY")
    base = env.get("AIMC_API_URL", "https://otw.aimc-ln.com/v1").rstrip("/")
    connector = env.get("AIMC_UPLOAD_CONNECTOR_ID", "115b2c89-246f-4d8f-8c83-71fd7fe77644")
    info(f"\nUploading {len(files)} file(s) to AIMC: {folder}/")
    for f in files:
        size = f.stat().st_size
        req = {"connector_id": connector, "filename": f.name, "content_type": content_type,
               "file_size": size, "path": folder, "collection_ids": [], "method": "PUT"}
        status, out = http("POST", f"{base}/assets/upload",
                           {"X-API-Key": env["AIMC_API_KEY"], "Content-Type": "application/json", "Accept": "application/json"},
                           json.dumps(req).encode())
        if status >= 300:
            die(f"AIMC refused the upload of '{f.name}' ({status}): {out[:500].decode(errors='replace')}")
        data = json.loads(out)
        if isinstance(data, dict) and "body" in data and "statusCode" in data:
            data = json.loads(data["body"]) if isinstance(data["body"], str) else data["body"]
        data = data.get("data", data)
        url = data.get("url")
        if not url:
            die(f"AIMC gave no upload URL for '{f.name}': {str(data)[:300]}")
        s2, o2 = http("PUT", url, {"Content-Type": content_type, "Content-Length": str(size)}, f.read_bytes())
        if s2 >= 300:
            die(f"AIMC upload of '{f.name}' failed ({s2}): {o2[:300].decode(errors='replace')}")
        info(f"  ✓ {f.name}  ({data.get('key', '')})")


# --------------------------------------------------------------------------- main


def main() -> None:
    p = argparse.ArgumentParser(
        prog="split-set",
        description="Cut a long live recording into tagged song files using a songlist.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Examples:\n"
               "  split-set show.wav setlist.csv\n"
               "  split-set show.mp4 setlist.txt --artist 'Mei Semones' --date 2026-11-14\n"
               "  split-set show.wav setlist.csv --upload azuracast\n"
               "  split-set show.wav setlist.txt --clock-start 20:00:00   (setlist has clock times)\n"
               "  split-set show.wav setlist.txt --dry-run",
    )
    p.add_argument("recording", type=Path, help="the long recording (audio or video)")
    p.add_argument("songlist", type=Path, nargs="?", help="CSV or text setlist (see README)")
    p.add_argument("-o", "--out", type=Path, help="output folder (default: next to the recording)")
    p.add_argument("--artist", default="", help="artist for every song that doesn't name one")
    p.add_argument("--album", default="", help="album tag (default: '<Artist> Live at <venue>, <date>' or the file name)")
    p.add_argument("--venue", default="", help="venue, used in the album and comment tags")
    p.add_argument("--date", default="", help="show date, YYYY-MM-DD")
    p.add_argument("--genre", default="", help="genre tag")
    p.add_argument("--songs", type=int, help="number of songs, when you have no songlist")
    p.add_argument("--offset", default="0", help="shift every songlist time; for negative use = (e.g. --offset=-0:42)")
    p.add_argument("--clock-start", help="wall-clock time the recording started, when songlist times are clock times (e.g. 20:00:00)")
    p.add_argument("--format", choices=FORMATS, default="mp3", help="output format (default mp3)")
    p.add_argument("--bitrate", default="320k", help="MP3/M4A bitrate (default 320k)")
    p.add_argument("--normalize", choices=["song", "set", "off"], default="song",
                   help="song: each song to -16 LUFS (radio); set: one gain for the whole show; off (default song)")
    p.add_argument("--fade", type=float, default=0.3, help="fade in/out seconds at each cut (default 0.3, 0 for none)")
    p.add_argument("--min-song", type=float, default=90, help="shortest plausible song in seconds (default 90)")
    p.add_argument("--max-song", type=float, default=600, help="longest plausible song in seconds (default 600)")
    p.add_argument("--dry-run", action="store_true", help="show the cut list and stop")
    p.add_argument("--upload", choices=["azuracast", "aimc", "both"], help="upload the files when done")
    p.add_argument("--folder", help="upload folder (default AzuraCast: live-recordings/<date> <artist>; AIMC: OTW/OTWL_Audio/<date> <artist>)")
    p.add_argument("--aimc-asset-id", help="AIMC id of the source recording, stored on each AzuraCast file")
    p.add_argument("--env", help="env file with keys (default: .env next to the script, then ~/.otw-split-set.env)")
    p.add_argument("--version", action="version", version=f"split-set {VERSION}")
    args = p.parse_args()

    need("ffmpeg")
    need("ffprobe")
    src: Path = args.recording.expanduser()
    if not src.is_file():
        die(f"Recording not found: {src}")
    total = duration_of(src)
    info(f"Recording: {src.name}  ({fmt_time(total)})")

    # ---- songs
    if args.songlist:
        if not args.songlist.expanduser().is_file():
            die(f"Songlist not found: {args.songlist}")
        songs = read_songlist(args.songlist.expanduser())
    elif args.songs:
        songs = [Song(f"Track {i:02d}") for i in range(1, args.songs + 1)]
    else:
        die("Give a songlist, or --songs N if you only know how many songs there are.")

    for s in songs:
        s.artist = s.artist or args.artist

    offset = parse_time(args.offset) - (parse_time(args.clock_start) if args.clock_start else 0)
    have = [s.start is not None for s in songs]
    if any(have) and not all(have):
        missing = [s.title for s in songs if s.start is None]
        die("Some songs have a start time and some don't. Add times for: " + ", ".join(missing[:5]))

    if all(have):
        mode = "songlist times"
        for s in songs:
            s.start = s.start + offset
            if s.end is not None:
                s.end = s.end + offset
        songs.sort(key=lambda s: s.start)
    else:
        mode = "quiet-gap detection (check these cuts)"
        info(f"No start times, listening for the {len(songs) - 1} gaps between {len(songs)} songs...")
        cuts = find_cuts(src, len(songs), total, args.min_song)
        bounds = [0.0] + cuts + [total]
        for i, s in enumerate(songs):
            s.start = bounds[i]

    for i, s in enumerate(songs):
        nxt = songs[i + 1].start if i + 1 < len(songs) else total
        s.end = min(s.end if s.end is not None else nxt, total)
        if s.start < 0 or s.start >= total:
            die(f"'{s.title}' starts at {fmt_time(s.start)}, outside the recording ({fmt_time(total)}). Check --offset.")
        if s.end <= s.start:
            die(f"'{s.title}' ends before it starts. Check the songlist times.")

    # ---- album + tags
    main_artist = args.artist or next((s.artist for s in songs if s.artist), "")
    album = args.album
    if not album:
        bits = [f"{main_artist} Live" if main_artist else "Live"]
        if args.venue:
            bits[0] += f" at {args.venue}"
        album = ", ".join(bits + ([args.date] if args.date else [])) if (args.venue or args.date) else src.stem
    for s in songs:
        s.album = s.album or album
        s.artist = s.artist or main_artist

    out_dir = (args.out or src.parent / safe_name(f"{src.stem} - songs")).expanduser()

    # ---- report
    warnings = []
    info(f"\nCuts from {mode}:\n")
    info(f"  {'#':>2}  {'start':>8}  {'end':>8}  {'length':>6}  song")
    for i, s in enumerate(songs, 1):
        length = s.end - s.start
        flag = ""
        if length < args.min_song:
            flag = "  <- short"
            warnings.append(f"#{i} '{s.title}' is only {fmt_time(length)}")
        elif length > args.max_song:
            flag = "  <- long"
            warnings.append(f"#{i} '{s.title}' runs {fmt_time(length)}")
        who = f"{s.artist} - " if s.artist and s.artist != main_artist else ""
        info(f"  {i:>2}  {fmt_time(s.start):>8}  {fmt_time(s.end):>8}  {fmt_time(length):>6}  {who}{s.title}{flag}")
    lead = songs[0].start
    tail = total - max(s.end for s in songs)
    if lead > 5 or tail > 5:
        info(f"\n  Left out: {fmt_time(lead)} before the first song, {fmt_time(tail)} after the last.")
    if warnings:
        info("\nCheck these:\n  " + "\n  ".join(warnings))
    if args.dry_run:
        info("\nDry run, nothing written.")
        return

    # ---- cut
    out_dir.mkdir(parents=True, exist_ok=True)
    set_gain = None
    if args.normalize == "set":
        info("\nMeasuring the whole show's loudness...")
        set_gain = TARGET_LUFS - measure_loudness(src)
    info(f"\nWriting {len(songs)} {args.format.upper()} files to {out_dir}/")
    written: list[Path] = []
    n = len(songs)
    for i, s in enumerate(songs, 1):
        name = f"{i:02d} - " + (f"{safe_name(s.artist)} - " if s.artist else "") + safe_name(s.title) + f".{args.format}"
        dst = out_dir / name
        comment = "Live recording" + (f" at {args.venue}" if args.venue else "") + (f", {args.date}" if args.date else "")
        tags = {"title": s.title, "artist": s.artist, "album_artist": main_artist or s.artist, "album": s.album,
                "track": f"{i}/{n}", "date": args.date, "genre": args.genre, "comment": comment}
        for k, v in s.extra.items():
            tags.setdefault(k, v)  # isrc, composer, publisher, label, etc. pass straight through
        if args.format == "mp3" and "isrc" in tags:
            tags["TSRC"] = tags.pop("isrc")  # the real ID3 ISRC frame
        cut_song(src, dst, s.start, s.end, tags, args, set_gain)
        written.append(dst)
        info(f"  ✓ {name}")

    # manifest for the record and for royalty reporting
    with open(out_dir / "songs.csv", "w", newline="", encoding="utf-8") as fh:
        extra_keys = sorted({k for s in songs for k in s.extra})
        w = csv.writer(fh)
        w.writerow(["track", "file", "start", "end", "length_sec", "title", "artist", "album"] + extra_keys)
        for i, (s, f) in enumerate(zip(songs, written), 1):
            w.writerow([i, f.name, fmt_time(s.start), fmt_time(s.end), round(s.end - s.start, 1),
                        s.title, s.artist, s.album] + [s.extra.get(k, "") for k in extra_keys])
    info(f"  ✓ songs.csv (cut list)")

    # ---- upload
    if args.upload:
        env = load_env(args.env)
        label = safe_name(" ".join(x for x in [args.date, main_artist] if x) or src.stem)
        if args.upload in ("azuracast", "both"):
            upload_azuracast(env, written, args.folder or f"live-recordings/{label}", args.aimc_asset_id)
        if args.upload in ("aimc", "both"):
            upload_aimc(env, written, args.folder or f"{env.get('AIMC_UPLOAD_FOLDER', 'OTW/OTWL_Audio')}/{label}",
                        FORMATS[args.format][1])

    info("\nDone.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        die("Stopped.", 130)
