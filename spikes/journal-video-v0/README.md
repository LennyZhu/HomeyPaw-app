# Journal Video V0 manual validation

This spike is isolated from Journal and performs no upload. It must be removed
or converted into production code after the dependency decision.

## Open the spike

1. Build a new iOS Development Build because `expo-video` and
   `react-native-compressor` add native modules.
2. Sign in to the Development Build.
3. Open `pawday://dev/journal-video-spike`.

## Run the matrix

Use 15-second-or-shorter samples covering:

- MOV / HEVC, MP4 / H.264
- portrait and landscape
- audio and no audio
- HDR and SDR
- 4K, 1080p, 60 fps, and variable frame rate when available

For each sample, record the selected and compressed JSON shown on screen. Check:

- selection reports URI, duration, bytes, dimensions, and MIME
- output is MP4, has a longest edge no greater than 1280, and stays under 25 MiB
- orientation is visually correct
- audio is retained only when the source has audio
- player reports frame rate and video range
- fullscreen and native controls work
- playback pauses after backgrounding the app
- thumbnail is a readable JPEG from 0.5–1 second
- cancellation returns control without leaving the screen stuck
- saving the compressed video to Photos succeeds

The optional remote URL field is only for a non-Production test asset. No URL is
provided or contacted by the spike itself.

## Known static finding

`react-native-compressor@2.0.3` outputs MP4/H.264/AAC on iOS, but its native
implementation retains source frame rates up to 60 fps and exposes no 30 fps
limit. The manual matrix must confirm whether this is acceptable or whether the
project needs a fork/native transcoder before implementation.

## Video metadata privacy

HomeyPaw must not upload source-file metadata that is unnecessary for Journal
playback. Compressed upload files must not retain:

- GPS, ISO 6709 location, or other location metadata
- camera make/model or other device-identifying metadata
- source capture, creation, or modification timestamps
- original filename, title, description, comment, author, artist, or copyright
- unnecessary QuickTime user-data metadata

Journal event dates and `created_at` values belong in HomeyPaw PostgreSQL/app
data. The app must not derive them from media-file metadata.

The version-locked `react-native-compressor@2.0.3` patch in
`patches/react-native-compressor+2.0.3.patch` stops iOS from forwarding source
`AVMetadataItem` values. `AVAssetWriter` still creates the dimensions, codec,
orientation transform, duration, timing, audio, and container information
required by the newly encoded MP4.

### Inspect a compressed MP4

Copy the compressed output itself to the Mac, then run the dependency-free
AVFoundation inspector:

```sh
xcrun swift spikes/journal-video-v0/inspect-video-metadata.swift "/path/to/compressed.mp4"
```

Review every `[PRIVACY]` and `[TIMESTAMP REVIEW]` line. The output must contain
no source location, make/model, software/device identity, original name/title,
comment, author, or source capture date. A timestamp generated for the newly
encoded file may describe the output container itself; compare its value with
the compression time and the source capture time. A copied source capture time
is not acceptable.

`mdls "/path/to/compressed.mp4"` can supplement this check with Spotlight/file
system attributes, but it does not enumerate every embedded QuickTime atom. If
already installed, either of these tools provides an additional independent
check without becoming a project dependency:

```sh
exiftool -G1 -a -s "/path/to/compressed.mp4"
ffprobe -v error -show_entries format_tags:stream_tags -of json "/path/to/compressed.mp4"
```
