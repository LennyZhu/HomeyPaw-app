# Journal Video client

The reader is additive: Journal list, detail, and Home activity read the
one-to-one `post_videos` relation while retaining the existing `post_media`
photo path. Timeline and Home request only private thumbnail signed URLs. The
10-minute video signed URL is requested only after a user opens the dedicated
video viewer.

Creation is controlled through `journalVideoCreationEnabled` in
`src/config/capabilities.ts`. The 1.3.0 release train explicitly sets
`RELEASE_JOURNAL_VIDEO_CREATION_ENABLED = true`: non-DEV JavaScript bundles
(Production, TestFlight and release-mode preview) enable Video creation without
an environment flag or version comparison. Backend URL does not decide release
availability. DEV bundles retain local-only opt-in:

```dotenv
EXPO_PUBLIC_JOURNAL_VIDEO_CREATION_ENABLED=true
```

The same environment flag is ignored for a remote DEV backend. Development
clients running DEV JavaScript follow this rule; a release-mode bundle follows
the release capability regardless of its EAS profile name. The existing
`ServerCapabilities` argument is reserved and has no fetch/cache integration.
There is no Video-specific remote kill switch. The existing app-wide release
maintenance/minimum-version gates and backend write guards remain unchanged;
they are not a selective Video switch. Changing the release constant requires
a new binary. Existing 1.2.0 binaries are unchanged; no backend flag or OTA update
is introduced. Before building the RC, assign its approved 1.3.0 version/build
and complete the separate backend/worker release gates.

The formal write path creates stable post and video UUIDs, compresses through
the version-patched iOS compressor, generates a JPEG thumbnail, uploads the MP4
with 6 MiB native-backed TUS slices, uploads the small thumbnail, and finally
calls the v2 RPC. Completed Storage objects are removed when the transaction
does not commit. If the RPC response is ambiguous, the client reconciles the
stable post/video identity before cleanup and records unresolved object paths in
local structured orphan state for a future sweeper.

Failure safety does not promise zero orphan objects during an outage. Failed
Storage deletion is recorded locally on a best-effort basis; unknown commits
preserve objects to avoid deleting committed media. The local orphan registry
has no automatic sweeper today. The server cleanup worker handles queued
committed-media lifecycle deletions, not every uncommitted upload. These existing
failure paths are unchanged by the release capability and need controlled RC
failure/recovery verification.

Run `npm run verify:journal-video-capability` for the actual capability module's
release/DEV/local/remote matrix, and `npm run verify:journal-video-client` plus
the Journal composer/create verifiers for unchanged pipeline and UI contracts.

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
