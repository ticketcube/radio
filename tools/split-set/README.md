# split-set

Cuts a long live recording into one file per song, tags each file (title, artist, album, track number, date, plus anything else in your songlist such as ISRC), and can upload the files to AzuraCast or AIMC.

It runs on any Mac with Homebrew. It needs Python 3.9 or newer and ffmpeg, and nothing else.

## Set up (once per Mac)

```bash
curl -fsSL https://raw.githubusercontent.com/ticketcube/radio/main/tools/split-set/install.sh | bash
```

This installs ffmpeg (and Python if it's missing), puts `split-set` on your PATH, and creates `~/.otw-split-set.env` for upload keys.

Without the installer: `brew install ffmpeg`, then run `python3 split-set.py ...` from this folder.

## Use it

```bash
split-set show.wav setlist.csv --date 2026-11-14 --venue "The Fillmore"
```

The songs go to a folder next to the recording (`show - songs/`), named `01 - Artist - Title.mp3`, plus `songs.csv` with the actual cut times. The recording can be audio or video (WAV, MP3, FLAC, M4A, MP4, MOV).

Run with `--dry-run` first to see the cut list without writing anything.

## Songlist formats

**CSV (best).** Only `title` is required. `start` and `end` are optional. Any extra column, such as `isrc`, `composer` or `label`, is written into the tags as is.

```csv
start,title,artist,album,isrc
0:20,First Song,Mei Semones,,USABC2600001
2:58,Second Song,,,
6:26,Cover Song,Guest Artist,,
8:34,Last Song,,,
```

- `start` is the time into the recording: `75`, `1:15`, or `1:01:15`.
- A song ends where the next one starts. Add an `end` time to cut out banter after a song.
- A blank `artist` uses `--artist`, or the first artist named in the list.

**Plain text.** One song per line, with an optional time and an optional `Artist - ` prefix:

```text
0:20 First Song
2:58 Second Song
6:26 Guest Artist - Cover Song
```

**Setlist with clock times** (for example `20:14:05`, from a broadcast log): add `--clock-start 20:00:00`, the clock time the recording started.

**No times at all:** list the titles only, or just pass `--songs 12`. The script finds the quietest stretch between each pair of songs and cuts there. Live crowd noise and banter make this a best guess, so check the cut list. The report flags songs shorter than 90 seconds or longer than 10 minutes (`--min-song`, `--max-song`).

## Options worth knowing

| Option | Default | What it does |
| --- | --- | --- |
| `--artist`, `--album`, `--venue`, `--date`, `--genre` | | Tags. The album defaults to `<Artist> Live at <Venue>, <date>`. |
| `--format` | `mp3` | `mp3`, `wav`, `flac` or `m4a` |
| `--bitrate` | `320k` | for MP3 and M4A |
| `--normalize` | `song` | `song` brings each song to -16 LUFS, the station's level. `set` applies one gain to the whole show, which keeps quiet songs quiet. `off` leaves the levels alone. |
| `--fade` | `0.3` | seconds of fade at each cut, so cuts don't click |
| `--offset` | `0` | shifts every time; for a negative value write `--offset=-0:42` |
| `-o` | next to the recording | output folder |

## Upload

```bash
split-set show.wav setlist.csv --date 2026-11-14 --upload azuracast   # or aimc, or both
```

Keys are read from `~/.otw-split-set.env` (or `--env path`). Copy `.env.example` and fill it in. The file never goes in the repo.

- **AzuraCast:** files go to the station media library under `live-recordings/<date> <artist>/`. AzuraCast reads the tags from the file. The script **does not add them to any playlist or schedule**: live shows air live only, and recordings belong to the artist. Putting a song into rotation is a separate decision, made in AzuraCast with the artist's OK. Add `--aimc-asset-id ID` to record which AIMC recording the songs came from.
- **AIMC:** files go to `OTW/OTWL_Audio/<date> <artist>/` through the same upload flow the site uses (`/assets/upload`, then a presigned PUT). That route is the one in `src/pages/api/aimc/generate-upload.ts`; the AIMC team hasn't formally confirmed it yet.
- `--folder` sets your own upload folder.

Use an AzuraCast API key from a user who can only manage this station's media, not an admin key.
