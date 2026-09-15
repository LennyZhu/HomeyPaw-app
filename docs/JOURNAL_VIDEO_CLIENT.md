# Journal Video client

The reader is additive: Journal list, detail, and Home activity read the
one-to-one `post_videos` relation while retaining the existing `post_media`
photo path. Timeline and Home request only private thumbnail signed URLs. The
10-minute video signed URL is requested only after a user opens the dedicated
video viewer.

Creation is controlled through `journalVideoCreationEnabled` in
`src/config/capabilities.ts`. Production defaults to disabled. Local testing can
enable it by setting this public flag while the backend URL is strictly local:

```dotenv
EXPO_PUBLIC_JOURNAL_VIDEO_CREATION_ENABLED=true
```

The same flag is ignored for a remote backend. A future authenticated server
capability can enable creation after reader-capable app adoption reaches the
release threshold.

The formal write path creates stable post and video UUIDs, compresses through
the version-patched iOS compressor, generates a JPEG thumbnail, uploads the MP4
with 6 MiB native-backed TUS slices, uploads the small thumbnail, and finally
calls the v2 RPC. Completed Storage objects are removed when the transaction
does not commit. If the RPC response is ambiguous, the client reconciles the
stable post/video identity before cleanup and records unresolved object paths in
local structured orphan state for a future sweeper.

Photo and video drafts are mutually exclusive. Existing photo-only creates and
edits retain their original RPC and composer behavior. Conversions involving a
video use `create_post_v2` or `update_post_v2`; committed replaced objects remain
the database cleanup outbox's responsibility.

## Viewer V1

The full-screen React Native Modal is the only fullscreen viewer. Save/Close,
the video area, and Play/Pause occupy separate layout regions. VideoView uses
`nativeControls={false}` and `pointerEvents="none"` to render frames without
participating in hit testing. There is no AVKit system fullscreen action.
Playback pauses at the end; pressing Play again restarts from the beginning.

Known Simulator HLG rendering issue / pending physical-device confirmation:
the inspected compressed H.264 MP4 retains BT.2020 primaries, BT.2100 HLG
transfer, BT.2020 matrix, and limited range. Simulator playback appears washed
out. This is a working diagnosis, not proof of a Simulator-only defect.
No HDR-to-SDR conversion, Rec.709 rewrite, tone mapping, or compressor change
is included in this viewer simplification.
