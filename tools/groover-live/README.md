# groover-live

Plays the tracks OTW accepted on Groover, one after another, into AzuraCast's live DJ input. AzuraCast records the broadcast, and `split-set` cuts that recording back into one tagged file per song.

It runs on a Mac. It needs Python 3.9 or newer, ffmpeg and yt-dlp: `brew install ffmpeg yt-dlp`.

## The four steps

```bash
# 1. Accepted tracks from the Groover export, with clean titles and a run order
python3 groover-live.py shortlist groover_answers_report.csv -o shortlist.csv

# 2. Download the audio (YouTube and SoundCloud links) into tracks/
python3 groover-live.py fetch shortlist.csv --search

# 3. Stream it to the station (about 3 hours for 52 songs)
python3 groover-live.py play shortlist.csv

# 4. After downloading AzuraCast's recording of the broadcast
python3 groover-live.py align recording.mp3 groover-2026-11-22-2000/setlist.csv
#    ...then run the split-set command it prints
```

### 1. shortlist

Keeps the rows with `accepted_status` true (use `--decision playlist` for playlist picks only). It cleans titles such as `Effy Harvard_Heatwave.wav` to `Heatwave`, strips playlist and tracking parameters from links, and orders the list so no artist plays twice in a row. **The run order is the file's order**, so edit `shortlist.csv` by hand to change it, fix a title, or delete a row.

### 2. fetch

Downloads each `source_url` with yt-dlp, trims silence at both ends, and brings every song to -16 LUFS, the station level. Files land in `tracks/` as `01.flac`, `02.flac` and so on, named by the `order` column. With `--search`, a dead link falls back to the first YouTube search match for "Artist - Title". The report marks those as "search match, check it".

YouTube music videos can carry spoken intros or outros. Listen to the start and end of those, or swap in the SoundCloud or official audio link.

### 3. play

Builds one continuous stream: 5 seconds of silence, then each song with 2 seconds of silence between songs (`--gap`), then 5 seconds at the end. It is one connection for the whole session, so AzuraCast makes one recording. Before it starts, it writes `setlist.csv` with the exact start and end of every song, measured from the moment the stream connects. While it plays, it prints each song as it starts, sends the title to AzuraCast so now-playing and the play history show it, and logs clock times to `play-log.csv`.

Rehearse without the station: `play shortlist.csv --to mix.mp3` writes the same mix to a file in a minute or two. `--only 3` plays the first three songs, for a quick connection test.

If the connection drops, the script says which song it reached. Cut what was recorded with that session's setlist, then carry on with `--start-from N`, which makes a new setlist for the new recording.

### 4. align

The recording may start a moment before or after the stream connects. `align` finds every 2-second gap in the recording, compares them with the setlist, and prints the offset and the full `split-set` command. If any gap doesn't line up (a dropout, or a song with silence inside it), it names it so you can check that cut.

## Station settings

Put the Streamer/DJ account in `~/.otw-split-set.env` (the same file split-set uses), or in environment variables. Copy the server, port and mount from AzuraCast > Streamer/DJ Accounts. Never commit the filled-in file.

```
OTW_HOST=radio.onestowatch.live
OTW_PORT=8005
OTW_MOUNT=/
OTW_DJ_USER=
OTW_DJ_PASSWORD=
```

In AzuraCast, turn on **Record Live Broadcasts** (Station > Edit Profile > Streamers/DJs) before you start. The recording appears under Streamer/DJ Accounts > Broadcasts when the session ends.

While the session plays, it is on air on the station. Until the station's licenses are in place, treat it as a capture test and don't share the stream.
