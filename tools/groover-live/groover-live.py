#!/usr/bin/env python3
"""groover-live: play a Groover shortlist into AzuraCast's DJ input, then cut it with split-set.

  1. shortlist  Groover CSV export  -> shortlist.csv (accepted tracks, clean titles, run order)
  2. fetch      shortlist.csv        -> tracks/NN.flac (yt-dlp from YouTube/SoundCloud, trimmed, -16 LUFS)
  3. play       shortlist.csv        -> one continuous stream to the DJ input (or a local file),
                                        plus setlist.csv with exact song start/end times
  4. align      AzuraCast recording  -> measures the recording's offset and prints the split-set command

Needs Python 3.9+, ffmpeg, and yt-dlp (fetch only). DJ credentials come from environment
variables or ~/.otw-split-set.env, never from this file or the repo.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, quote, urlencode, urlparse, urlunparse

VERSION = "0.1.0"
RATE = 44100
LEAD_IN = 5.0      # seconds of silence before the first song
GAP = 2.0          # seconds of silence between songs (marks every boundary in the recording)
TAIL = 5.0         # seconds of silence after the last song
TARGET_LUFS = -16  # station level, same as split-set
SHORTLIST_COLUMNS = ["order", "artist", "title", "groover_title", "decision", "source_url", "spotify_url",
                     "genres", "countries", "date_sent", "status"]


def die(msg: str, code: int = 1) -> None:
    print(f"groover-live: {msg}", file=sys.stderr)
    sys.exit(code)


def need(tool: str) -> None:
    if not shutil.which(tool):
        hint = "brew install ffmpeg" if tool.startswith("ff") else "brew install yt-dlp"
        die(f"{tool} not found. Install it with: {hint}")


def fmt(sec: float) -> str:
    sec = max(sec, 0.0)
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h)}:{int(m):02d}:{s:06.3f}" if h else f"{int(m)}:{s:06.3f}"


def duration_of(path: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
                       capture_output=True, text=True)
    try:
        return float(json.loads(r.stdout)["format"]["duration"])
    except (KeyError, ValueError, json.JSONDecodeError):
        die(f"Could not read the length of {path}")
    return 0.0


def read_rows(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8-sig") as fh:
        return [{(k or "").strip(): (v or "").strip() for k, v in row.items()} for row in csv.DictReader(fh)]


def write_rows(path: Path, rows: list[dict], columns: list[str]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=columns, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def load_env(path: str | None) -> dict[str, str]:
    env: dict[str, str] = {}
    candidates = [Path(path).expanduser()] if path else [Path(__file__).with_name(".env"),
                                                           Path("~/.otw-split-set.env").expanduser()]
    for p in candidates:
        if p.is_file():
            for ln in p.read_text().splitlines():
                ln = ln.strip()
                if ln and not ln.startswith("#") and "=" in ln:
                    k, v = ln.split("=", 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
            break
    env.update({k: v for k, v in os.environ.items() if k.startswith("OTW_") and v})
    return env


# --------------------------------------------------------------------------- 1. shortlist

def list_field(raw: str) -> str:
    """Groover writes lists as ["a" "b"]; turn that into 'a; b'."""
    return "; ".join(re.findall(r'"([^"]+)"', raw)) or raw


def clean_title(title: str, artist: str) -> str:
    t = re.sub(r"\.(wav|mp3|aiff?|flac|m4a)$", "", title.strip(), flags=re.I)
    t = re.sub(r"[\s_-]*\b(final\s+)?master(ed)?\b\s*$", "", t, flags=re.I)
    t = re.sub(r"\s*[|(\[]\s*(official|lyric|music|audio|visuali[sz]er|pre-release).*$", "", t, flags=re.I)
    a = re.escape(artist.strip())
    t = re.sub(rf"^\s*{a}\s*[-_–:]\s*", "", t, flags=re.I)  # "Artist - Title" or "Artist_Title"
    t = re.sub(rf"\s*[-_–]\s*{a}\s*$", "", t, flags=re.I)   # "Title - Artist"
    t = t.strip(" -_:|")
    if t.isupper() and len(t) > 3:
        t = t.title()
    return t or title


def clean_url(url: str) -> str:
    """Drop playlist and tracking parameters so yt-dlp fetches exactly one track."""
    if not url:
        return ""
    u = urlparse(url)
    q = parse_qs(u.query)
    host = u.netloc.lower()
    if "spotify.com" in host:
        keep = {}
    elif "youtube.com" in host:
        keep = {"v": q["v"]} if "v" in q else {}
    elif "youtu.be" in host:
        keep = {}
    else:  # SoundCloud and others: drop utm_*, si, etc.
        keep = {k: v for k, v in q.items() if not k.startswith("utm_") and k not in ("si", "ref", "feature")}
    return urlunparse(u._replace(query=urlencode(keep, doseq=True), fragment=""))


def playable(url: str) -> bool:
    host = urlparse(url).netloc.lower()
    return any(h in host for h in ("youtube.com", "youtu.be", "soundcloud.com", "bandcamp.com", "vimeo.com"))


def spread_artists(rows: list[dict]) -> list[dict]:
    """Keep the given order but never play the same artist twice in a row."""
    out: list[dict] = []
    pending = list(rows)
    while pending:
        pick = next((r for r in pending if not out or r["artist"].lower() != out[-1]["artist"].lower()), pending[0])
        pending.remove(pick)
        out.append(pick)
    return out


def cmd_shortlist(args) -> None:
    rows = read_rows(args.report)
    if not rows or "accepted_status" not in rows[0]:
        die("That doesn't look like a Groover answers report (no accepted_status column).")
    keep = [r for r in rows if r.get("accepted_status", "").lower() == "true"]
    if args.decision:
        keep = [r for r in keep if r.get("decision") in args.decision]
    out = []
    for r in keep:
        src = clean_url(r.get("track_link", ""))
        alt = clean_url(r.get("track_secondary_link", ""))
        if not playable(src) and playable(alt):
            src, alt = alt, src
        status = "ok" if playable(src) else "no playable link"
        if r.get("band_name", "").lower() == "deleted artist":
            status = "deleted on Groover"
        out.append({
            "artist": r.get("band_name", ""),
            "title": clean_title(r.get("track_name", ""), r.get("band_name", "")),
            "groover_title": r.get("track_name", ""),
            "decision": r.get("decision", ""),
            "source_url": src if playable(src) else "",
            "spotify_url": alt if "spotify.com" in alt else (r.get("spotify", "") if "spotify.com" in r.get("spotify", "") else ""),
            "genres": list_field(r.get("subgenres", "")),
            "countries": list_field(r.get("countries", "")),
            "date_sent": r.get("date_sent", ""),
            "status": status,
        })
    out = spread_artists(out)
    for i, r in enumerate(out, 1):
        r["order"] = i
    write_rows(args.out, out, SHORTLIST_COLUMNS)
    bad = [r for r in out if r["status"] != "ok"]
    print(f"{len(out)} accepted tracks -> {args.out}  ({len(out) - len(bad)} with a playable link)")
    for r in bad:
        print(f"  skipped at play time: {r['artist']} - {r['title']} ({r['status']})")
    renamed = [r for r in out if r["title"] != r["groover_title"]]
    if renamed:
        print("Titles cleaned (edit the 'title' column if any are wrong):")
        for r in renamed:
            print(f"  {r['groover_title']!r} -> {r['title']!r}")


# --------------------------------------------------------------------------- 2. fetch

def track_path(tracks: Path, row: dict) -> Path:
    return tracks / f"{int(row['order']):02d}.flac"


def cmd_fetch(args) -> None:
    need("ffmpeg")
    need("yt-dlp")
    rows = read_rows(args.shortlist)
    tracks: Path = args.tracks
    raw_dir = tracks / "_raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    report = []
    for row in rows:
        if row.get("status") in ("deleted on Groover",):
            report.append((row, "skipped (deleted on Groover)"))
            continue
        dst = track_path(tracks, row)
        if dst.exists() and not args.force:
            report.append((row, "already fetched"))
            continue
        sources = [row["source_url"]] if row.get("source_url") else []
        if args.search:
            sources.append(f"ytsearch1:{row['artist']} - {row['title']} audio")
        got = None
        for src in sources:
            for old in raw_dir.glob(f"{dst.stem}.*"):
                old.unlink()
            print(f"[{row['order']:>2}] {row['artist']} - {row['title']}  <- {src}")
            r = subprocess.run(["yt-dlp", "--no-playlist", "--quiet", "--no-warnings", "-f", "bestaudio/best",
                                "-o", str(raw_dir / f"{dst.stem}.%(ext)s"), src])
            files = [f for f in raw_dir.glob(f"{dst.stem}.*") if not f.name.endswith(".part")]
            if r.returncode == 0 and files:
                got = (files[0], "search match, check it" if src.startswith("ytsearch") else "ok")
                break
        if not got:
            report.append((row, "FAILED, no audio"))
            continue
        # Uniform 44.1 kHz stereo FLAC, leading/trailing silence trimmed, station loudness.
        trim = "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05"
        af = f"{trim},areverse,{trim},areverse,loudnorm=I={TARGET_LUFS}:TP=-1.5:LRA=11"
        r = subprocess.run(["ffmpeg", "-y", "-hide_banner", "-v", "error", "-i", str(got[0]), "-vn", "-af", af,
                            "-ar", str(RATE), "-ac", "2", "-sample_fmt", "s16", "-c:a", "flac", str(dst)])
        if r.returncode != 0:
            report.append((row, "FAILED converting"))
            continue
        report.append((row, f"{got[1]} ({fmt(duration_of(dst))})"))
    print("\nFetch report:")
    for row, status in report:
        print(f"  {row['order']:>2}. {row['artist']} - {row['title']}: {status}")
    print(f"\nAudio is in {tracks}/ . Delete tracks/_raw when you're happy.")


# --------------------------------------------------------------------------- 3. play

def silence(path: Path, seconds: float) -> Path:
    if not path.exists():
        subprocess.run(["ffmpeg", "-y", "-hide_banner", "-v", "error", "-f", "lavfi",
                        "-i", f"anullsrc=r={RATE}:cl=stereo", "-t", f"{seconds}", "-sample_fmt", "s16",
                        "-c:a", "flac", str(path)], check=True)
    return path


def dj_url(env: dict) -> tuple[str, str]:
    host = env.get("OTW_HOST", "radio.onestowatch.live")
    port = env.get("OTW_PORT", "8005")
    mount = env.get("OTW_MOUNT", "/")
    user, pw = env.get("OTW_DJ_USER", ""), env.get("OTW_DJ_PASSWORD", "")
    if not user or not pw:
        die("Set OTW_DJ_USER and OTW_DJ_PASSWORD (and OTW_HOST/OTW_PORT/OTW_MOUNT) in ~/.otw-split-set.env "
            "or the environment. Copy them from AzuraCast > Streamer/DJ Accounts.")
    mount = mount if mount.startswith("/") else "/" + mount
    # Plain HTTP with the Icecast SOURCE method (what BUTT and Liquidsoap send). ffmpeg's icecast://
    # protocol refuses the mount "/" that AzuraCast uses by default, so it isn't used here.
    real = f"http://{quote(user, safe='')}:{quote(pw, safe='')}@{host}:{port}{mount}"
    shown = f"{host}:{port}{mount} as {user}"
    return real, shown


def send_now_playing(env: dict, artist: str, title: str) -> bool:
    """Best effort: tell AzuraCast's DJ input what's playing (Icecast admin metadata call), so the
    station's now-playing and play history show each song, not just the stream name."""
    import base64
    import urllib.request
    host, port = env.get("OTW_HOST", "radio.onestowatch.live"), env.get("OTW_PORT", "8005")
    mount = env.get("OTW_MOUNT", "/")
    q = urlencode({"mode": "updinfo", "mount": mount if mount.startswith("/") else "/" + mount,
                   "song": f"{artist} - {title}", "artist": artist, "title": title})
    req = urllib.request.Request(f"http://{host}:{port}/admin/metadata?{q}")
    tok = base64.b64encode(f"{env.get('OTW_DJ_USER', '')}:{env.get('OTW_DJ_PASSWORD', '')}".encode()).decode()
    req.add_header("Authorization", f"Basic {tok}")
    try:
        with urllib.request.urlopen(req, timeout=3) as r:
            return r.status < 400
    except Exception:
        return False


def cmd_play(args) -> None:
    need("ffmpeg")
    rows = [r for r in read_rows(args.shortlist) if int(r["order"]) >= args.start_from]
    if args.only:
        rows = rows[: args.only]
    tracks: Path = args.tracks
    playlist = [(r, track_path(tracks, r)) for r in rows]
    missing = [r for r, p in playlist if not p.exists()]
    playlist = [(r, p) for r, p in playlist if p.exists()]
    for r in missing:
        print(f"  not fetched, skipping: {r['order']}. {r['artist']} - {r['title']}")
    if not playlist:
        die("Nothing to play. Run fetch first.")

    session = args.session or dt.datetime.now().strftime("groover-%Y-%m-%d-%H%M")
    out_dir = (args.out or Path(session)).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)
    lead, gap, tail = (silence(tracks / f"_silence-{s:g}.flac", s) for s in (LEAD_IN, args.gap, TAIL))

    # The cue sheet: song times measured from the first byte the server receives.
    concat, cues, t = [lead], [], LEAD_IN
    for i, (r, p) in enumerate(playlist):
        d = duration_of(p)
        cues.append({"start": round(t, 3), "end": round(t + d, 3), "title": r["title"], "artist": r["artist"],
                     "source_url": r.get("source_url", ""), "spotify_url": r.get("spotify_url", ""),
                     "groover_decision": r.get("decision", ""), "groover_genres": r.get("genres", "")})
        concat.append(p)
        t += d
        if i < len(playlist) - 1:
            concat.append(gap)
            t += args.gap
    concat.append(tail)
    total = t + TAIL

    setlist = out_dir / "setlist.csv"
    write_rows(setlist, cues, list(cues[0].keys()))
    lst = out_dir / "concat.txt"
    lst.write_text("".join("file '" + str(p.resolve()).replace("'", "'\\''") + "'\n" for p in concat))

    print(f"{len(cues)} songs, {fmt(total)} total. Cue sheet: {setlist}")
    for c in cues:
        print(f"  {fmt(c['start']):>12}  {c['artist']} - {c['title']}")

    enc = ["-c:a", "libmp3lame", "-b:a", "320k", "-ar", str(RATE), "-ac", "2"]
    base = ["ffmpeg", "-hide_banner", "-nostats", "-v", "error", "-progress", "pipe:1"]
    secret, env = "", {}
    if args.to:
        cmd = base + ["-y", "-f", "concat", "-safe", "0", "-i", str(lst)] + enc + [str(args.to)]
        target_label = str(args.to)
    else:
        env = load_env(args.env)
        url, shown = dj_url(env)
        cmd = base + ["-re", "-f", "concat", "-safe", "0", "-i", str(lst)] + enc + [
            "-f", "mp3", "-method", "SOURCE", "-chunked_post", "0", "-auth_type", "basic", "-send_expect_100", "0",
            "-content_type", "audio/mpeg",
            "-headers", f"Ice-Name: {args.name}\r\nIce-Description: Groover picks session\r\nIce-Public: 0\r\n",
            url]
        secret = env.get("OTW_DJ_PASSWORD", "")
        target_label = shown
    if args.dry_run:
        print(f"\nDry run. Would send to {target_label}")
        return

    print(f"\nSending to {target_label}  (Ctrl-C stops)")
    started = dt.datetime.now().astimezone()
    log_rows, nxt = [], 0
    errlog = out_dir / "ffmpeg-errors.log"
    errfh = open(errlog, "w")
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=errfh, text=True)
    try:
        for ln in proc.stdout:
            if not ln.startswith("out_time_us="):
                continue
            try:
                pos = int(ln.split("=", 1)[1]) / 1e6
            except ValueError:
                continue
            while nxt < len(cues) and pos >= cues[nxt]["start"]:
                c = cues[nxt]
                now = dt.datetime.now().astimezone()
                log_rows.append({"n": nxt + 1, "planned": fmt(c["start"]), "clock": now.strftime("%H:%M:%S"),
                                 "artist": c["artist"], "title": c["title"]})
                meta = ""
                if env and not args.no_metadata:
                    meta = "" if send_now_playing(env, c["artist"], c["title"]) else "  (title not sent)"
                print(f"  {now:%H:%M:%S}  [{nxt + 1}/{len(cues)}]  {c['artist']} - {c['title']}{meta}", flush=True)
                nxt += 1
        proc.wait()
    except KeyboardInterrupt:
        proc.terminate()
        proc.wait()
        print("\nStopped.")
    errfh.close()
    err = errlog.read_text()
    if not args.to:  # never leave the DJ password in a log or on screen
        for s in {secret, quote(secret, safe="")} - {""}:
            err = err.replace(s, "***")
        errlog.write_text(err)
    if err.strip():
        print("ffmpeg said:\n  " + "\n  ".join(err.strip().splitlines()[-6:]))
    write_rows(out_dir / "play-log.csv", log_rows, ["n", "planned", "clock", "artist", "title"])
    (out_dir / "session.json").write_text(json.dumps({
        "session": session, "started": started.isoformat(), "songs": len(cues), "planned_length_sec": round(total, 1),
        "gap_sec": args.gap, "lead_in_sec": LEAD_IN, "target": target_label, "ffmpeg_exit": proc.returncode}, indent=2))
    if proc.returncode not in (0, None) or nxt < len(cues):
        print(f"\nThe stream ended early after song {nxt} of {len(cues)} (ffmpeg exit {proc.returncode}).")
        if nxt:
            stopped = int(rows[0]["order"]) + nxt - 1
            print(f"Cut the recording you have with this setlist. To carry on, start a new run with "
                  f"--start-from {stopped} (it makes its own setlist, for its own recording).")
        sys.exit(1)
    album = args.album or f"OTW Groover Picks, {started:%Y-%m-%d}"
    rec = args.to or Path("<AzuraCast recording>.mp3")
    print(f"\nDone. Next: download the recording from AzuraCast (Streamer/DJ Accounts > Broadcasts), then:\n"
          f"  groover-live align \"{rec}\" \"{setlist}\"")
    print(f"  (it prints the split-set command, album '{album}')")


# --------------------------------------------------------------------------- 4. align

def silences(path: Path, min_len: float) -> list[float]:
    """Start times of every silent stretch at least min_len long."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-vn",
                        "-af", f"silencedetect=noise=-50dB:d={min_len}", "-f", "null", "-"],
                       capture_output=True, text=True)
    return [float(m) for m in re.findall(r"silence_start:\s*(-?[\d.]+)", r.stderr)]


def cmd_align(args) -> None:
    need("ffmpeg")
    cues = read_rows(args.setlist)
    if not cues:
        die("The setlist is empty.")
    found = silences(args.recording, max(args.gap * 0.6, 0.8))
    expected = [float(c["end"]) for c in cues[:-1]]  # each gap starts where a song ends
    diffs = []
    for e in expected:
        near = [s - e for s in found if abs(s - e) <= args.window]
        if near:
            diffs.append(min(near, key=abs))
    if len(diffs) < max(2, len(expected) // 3):
        die(f"Only matched {len(diffs)} of {len(expected)} gaps, so the offset is unclear. "
            f"Try --window 120, or check the recording is the right one.")
    offset = statistics.median(diffs)
    spread = statistics.pstdev(diffs) if len(diffs) > 1 else 0.0
    late = [i + 1 for i, d in enumerate(diffs) if abs(d - offset) > 1.5]
    print(f"Matched {len(diffs)} of {len(expected)} song gaps. Recording offset: {offset:+.2f}s (spread {spread:.2f}s)")
    if late:
        print(f"  Gaps that don't line up (a dropout or a song with silence inside): {late}. Check those cuts.")
    total = duration_of(args.recording)
    print(f"  Recording length {fmt(total)}, last song should end at {fmt(float(cues[-1]['end']) + offset)}")
    album = args.album or f"OTW Groover Picks, {dt.date.today():%Y-%m-%d}"
    cmd = (f"split-set \"{args.recording}\" \"{args.setlist}\" --offset={offset:.2f} "
           f"--album \"{album}\" --date {dt.date.today():%Y-%m-%d} --fade 0.05")
    print(f"\nRun this (add --dry-run first to see the cut list):\n  {cmd}")


# --------------------------------------------------------------------------- main

def main() -> None:
    p = argparse.ArgumentParser(prog="groover-live", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--version", action="version", version=f"groover-live {VERSION}")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("shortlist", help="accepted tracks from a Groover CSV export")
    s.add_argument("report", type=Path)
    s.add_argument("-o", "--out", type=Path, default=Path("shortlist.csv"))
    s.add_argument("--decision", nargs="*", help="only these decisions, e.g. playlist article")
    s.set_defaults(fn=cmd_shortlist)

    f = sub.add_parser("fetch", help="download and prepare the audio with yt-dlp")
    f.add_argument("shortlist", type=Path)
    f.add_argument("--tracks", type=Path, default=Path("tracks"))
    f.add_argument("--search", action="store_true", help="if a link fails, take the first YouTube search match")
    f.add_argument("--force", action="store_true", help="fetch again even if the file exists")
    f.set_defaults(fn=cmd_fetch)

    pl = sub.add_parser("play", help="stream the tracks in order and write the cue sheet")
    pl.add_argument("shortlist", type=Path)
    pl.add_argument("--tracks", type=Path, default=Path("tracks"))
    pl.add_argument("--to", type=Path, help="write the mix to this file instead of streaming (rehearsal)")
    pl.add_argument("-o", "--out", type=Path, help="session folder for setlist.csv and logs")
    pl.add_argument("--session", help="session name (default groover-<date>-<time>)")
    pl.add_argument("--start-from", type=int, default=1, help="start at this order number")
    pl.add_argument("--only", type=int, help="play only this many songs (for a test)")
    pl.add_argument("--gap", type=float, default=GAP, help=f"seconds of silence between songs (default {GAP:g})")
    pl.add_argument("--name", default="OTW Groover Picks", help="stream name shown in AzuraCast")
    pl.add_argument("--album", help="album tag suggested for split-set")
    pl.add_argument("--env", help="env file with OTW_DJ_* settings (default ~/.otw-split-set.env)")
    pl.add_argument("--no-metadata", action="store_true", help="don't send song titles to AzuraCast")
    pl.add_argument("--dry-run", action="store_true")
    pl.set_defaults(fn=cmd_play)

    a = sub.add_parser("align", help="find the recording's offset and print the split-set command")
    a.add_argument("recording", type=Path)
    a.add_argument("setlist", type=Path)
    a.add_argument("--gap", type=float, default=GAP)
    a.add_argument("--window", type=float, default=30, help="how far off (seconds) a gap may be")
    a.add_argument("--album")
    a.set_defaults(fn=cmd_align)

    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        die("Stopped.", 130)
