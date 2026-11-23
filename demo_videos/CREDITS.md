# Demo videos

| File | Source | What the app shows |
|---|---|---|
| `1_real_lbw_appeal_hatfield_heath.webm` | Real club match footage (see credit below) | Candidate for testing projection accuracy. The on-field umpire declined the appeal. The current tracker still needs verification on this source. |
| `2_real_ball2.mp4` | Real club match footage (local test clip) | Previously used for a side-on reconstruction. The current tracker still needs verification on this source. |
| `3_synthetic_lbw_out.mp4` | Rendered by `scripts/generate_hawkeye_synthetic.py` | Known ground truth (`synthetic_lbw_out.ground_truth.json`): 136 km/h, bounce 4.45 m from stumps, hitting → **OUT**. App: 134.3 km/h, bounce within 4 cm. |
| `4_synthetic_not_out_leg.mp4` | Rendered by `scripts/generate_hawkeye_synthetic.py` | Known ground truth: 131 km/h, pitched outside leg → **NOT OUT**. App: 129.9 km/h, bounce within 2 cm. |

## Credit (required by the licence)

`1_real_lbw_appeal_hatfield_heath.webm` is
"Hatfield Heath CC v Potter Street & Church Langley CC Video 3 LBW appeal" by **Acabashi**,
licensed under **CC BY-SA 4.0** (https://creativecommons.org/licenses/by-sa/4.0/), via Wikimedia Commons:
https://commons.wikimedia.org/wiki/File:Hatfield_Heath_CC_v_Potter_Street_%26_Church_Langley_CC_Video_3_LBW_appeal.webm
(remuxed only: seek index moved to the front of the file; no frames changed).

## Notes for the demo
- Press play from the start; the 3D ribbon and the DRS verdicts appear in sync as the ball reaches each event.
- The **Side** 3D camera shows the whole arc, bounce and projected path into the stumps most clearly.

## Real footage validation

`whatsapp_delivery_visible_ball.csv` contains nine hand-labeled ball centers in zero-based frames of the local 852 × 480 WhatsApp clip from 12 November 2026. The visible ball is already moving away from the striker in these frames. A camera cut occurs between the release and this segment, and the bounce is ambiguous, so no bounce coordinates were assigned.

On this clip the upload tracker returned seven candidates. Three fell on labeled frames. None matched within 15 pixels, so all nine labeled positions were missed. This is a sparse check of the visible post-contact segment. The other frames and the wicket projection are unscored. Use this clip as the **No verdict** rehearsal.

To use the same tracker as the upload API, run from the repository root:

```powershell
python backend/scripts/evaluate_tracking.py --video path/to/clip.mp4 --ground-truth demo_videos/whatsapp_delivery_visible_ball.csv --annotated-frames-only
```

For the next clips, record a stationary behind-bowler angle with both wicket lines visible. Label clear ball centers before and after the bounce, and record the bounce frame and location independently. Score annotated ball centers with the script. Check bounce position and wicket projection against independently measured footage before using the projection as a demo claim.
