# Five-minute Crease / Lab demo

## Before the demo

Run the frontend and API using the commands in the [README](../README.md). On the computer you will present from, upload the rehearsal clip ahead of time and wait for **Processed**. Open the saved review and check that it opens on its first detection. Keep the source file locally for the live upload.

For a new clip, use one delivery filmed without cuts from a fixed camera behind or slightly offset from the bowler. Keep the ball, both wicket lines and the striker in frame from release to contact. Use H.264 MP4. Use the 1.48-second WhatsApp clip to illustrate **No verdict**. Its seven candidate detections failed the hand-labeled spot check, so label the overlay as unverified. [Footage validation](../demo_videos/CREDITS.md)

## 0:00–0:45 · Open the workspace

Open the dashboard and select **Launch simulation**. The four standard deliveries use the bundled physics engine output and work when the analysis server is unavailable. Custom pitch and spin settings, clip uploads, and saved reviews use the server.

## 0:45–2:15 · Show the decision forming

1. Start with **Fast inswinger** and press **Play delivery**. Watch the path build through release, bounce, impact and projected flight. The evidence panel reveals each check as the replay reaches it.
2. Switch the camera to **Broadcast** for the line to the wickets. Use the timeline to inspect the bounce.
3. Select **Leg break** and play it to show **Umpire’s call**. If time allows, show **Sharp bouncer** for **Not out**.
4. For a presentation where the API is running, open **Delivery settings & presentation tools** to change pitch surface or spin, then replay.

## 2:15–4:15 · Show tracking on footage

1. Return to the dashboard and open the prepared delivery or select **Choose file**. The upload opens the review as tracking begins. The original clip can play while analysis runs.
2. Click **Replay detections at ¼ speed**, then use **Previous detection** and **Next detection** to inspect individual candidates. The review starts in Video view for 2D results. On desktop, a successful 3D fit opens in Split view.
3. Show **No verdict** on the rehearsed WhatsApp clip. On a suitable uncut clip, use **Mark pitch corners** if the camera fit fails and **Refit ball flight** after placing the four marks. If a calibrated review shows **Wicket projection**, explain that it estimates the ball's position at the stumps. The tracker cannot verify pad contact for an LBW ruling.
4. Open **Measurements** or the diagnostics only if you need to show the recorded evidence for the clip. If live analysis is still running, open the already processed copy from the delivery library.

## 4:15–5:00 · Explain how it works

Explain the pipeline from frame detection to track reconstruction, trajectory fitting, and synchronized rendering. For a quick evaluation example, run `python scripts/evaluate_tracking.py --demo` from the backend directory. The simulation demonstrates the physics and review sequence. Footage analysis depends on the quality of the clip and calibration.
