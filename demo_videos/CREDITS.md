# Demo videos

| File | Source | What the app shows |
|---|---|---|
| `1_real_lbw_appeal_hatfield_heath.webm` | Real club match footage (see credit below) | Ball tracked from release to bounce, 99 km/h, short of length, leg-cutter; projected path clips the bails → **UMPIRE'S CALL**. The on-field umpire gave NOT OUT, which umpire's call upholds. |
| `2_real_ball2.mp4` | Real club match footage (our own test clip) | Side-on stump-scaled reconstruction: 82 km/h, full length → **NO VERDICT** (line not measurable from this angle). |
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
