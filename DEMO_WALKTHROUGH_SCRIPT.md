# Cricket DRS & Hawk-Eye Ball Tracking: Complete Video Demo Walkthrough Script

> **Project Title:** Computer Vision Cricket Ball Tracking with Interactive 3D Hawk-Eye Display  
> **Course / Subject:** Introduction to Computer Graphics (ICG) Project  
> **Live Web Application:** [http://localhost:3000](http://localhost:3000) (Backend: [http://127.0.0.1:8000](http://127.0.0.1:8000))  
> **Target Video Length:** 5 to 7 Minutes

---

## Quick Demo Flowchart

```
┌────────────────────────────────────────────────────────┐
│ 1. Introduction & Overview (0:00 - 0:45)               │
│    - Motivation, System Architecture & Dual Engine     │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 2. Real Video Upload & 1:1 Ball Tracking (0:45 - 2:30) │
│    - Split View (Left: Video | Right: 3D Hawk-Eye)     │
│    - Lockstep Scrubbing & 2D Neon Tracking Reticle     │
│    - Automated Delivery Classification (Yorker, Inswing)│
│    - Official 3-Stage DRS LBW Rulebook Verdict         │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 3. Interactive 3D Physics Simulator (2:30 - 4:15)      │
│    - Aerodynamic Forces (Magnus, Drag, Seam Angle)     │
│    - Real-Time Spin RPM Slider (0 to 3,500 RPM)        │
│    - Pitch Turf Restitution Profiles (Hard, Green, etc)│
│    - Interactive Shattering Zing Stumps & Avatar       │
│    - 9 Cinematic Camera Views (Bullet Time, Drone)     │
│    - Multi-Delivery Ghost Overlay Comparison           │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 4. Guided Pitch Calibration Tool (4:15 - 5:00)         │
│    - 4-Corner Homography Matrix Calibration            │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 5. Technical Limitations & Challenges (5:00 - 6:00)    │
│    - Monocular Depth Ambiguity vs. Multi-Camera Setup  │
│    - 25-30 FPS Broadcast vs. 340 FPS High-Speed Cams   │
│    - Occlusion Behind Batsman Pads                     │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 6. Conclusion & Summary (6:00 - 6:30)                  │
└────────────────────────────────────────────────────────┘
```

---

## Detailed Step-by-Step Script & Actions

### Scene 1: Introduction & System Architecture (0:00 – 0:45)
* **On Screen:** Start at the Landing / Dashboard page (`http://localhost:3000`).
* **What to Say:**
  > "Hello everyone. Today I am presenting our project: **Computer Vision Cricket Ball Tracking with Interactive 3D Hawk-Eye Display**.
  > Professional cricket decision review systems like Hawk-Eye traditionally require 6 to 8 ultra-high-speed specialized industrial cameras costing hundreds of thousands of dollars.
  > The objective of our project is to bring broadcast-grade ball tracking and interactive 3D trajectory reconstruction to accessible consumer platforms using two synergistic systems:
  > 1. A **Computer Vision Pipeline** combining deep learning (YOLO) and geometric camera calibration to track real deliveries from standard broadcast footage.
  > 2. An **Interactive 3D Physics & DRS Simulation Engine** built in Three.js and WebGL, incorporating Newtonian aerodynamics, the Magnus effect, pitch turf restitution tensors, and the official ICC DRS decision rulebook."

---

### Scene 2: Real Video Upload & 1:1 Synchronized Tracking (0:45 – 2:30)
* **On Screen:** Navigate to **"DRS Review Console"** and open an uploaded delivery (e.g. `lbw1_mirr.mp4`). Ensure **Split View** is selected.
* **Actions to Perform:**
  1. Show the split view: Left side is the **Original Video Feed**, Right side is the **3D Hawk-Eye Pitch**.
  2. Press **Play** — observe the ball moving down the pitch in the video and the 3D ball traveling down the 3D turf in exact lockstep.
  3. Drag the **Scrubber bar** backward and forward slowly.
  4. Point your mouse to the **2D Neon Reticle & Trail** on the video overlay tracking the ball frame-by-frame.
  5. Point out the **Delivery Classification Card**: show how the system detected delivery type (*Left-Arm Toe-Crushing Yorker*), speed (*78 km/h*), and length zone (*Yorker*).
  6. Point out the **DRS Decision Readout** panel on the right:
     - **Pitching:** In Line / Outside Leg
     - **Impact:** In Line
     - **Wickets:** Hitting / Umpire's Call
     - **Decision:** Official verdict banner with ICC rules justification.
* **What to Say:**
  > "Here in the Split View, we see our core computer vision innovation:
  > On the left is the raw broadcast video of an LBW appeal. On the right is our real-time Three.js 3D reconstruction.
  > Notice the synchronized 1:1 playback. As I scrub through the delivery timeline, the 2D neon cyan reticle precisely locks onto the ball in pixel space, while the 3D cricket ball simultaneously traverses the pitch in metric space.
  > Our automated classification engine extracts delivery metrics in real time: release speed, flight time, bounce location, and aerodynamic swing.
  > The DRS panel evaluates the three critical legal criteria: Pitching, Impact, and Wickets Line, providing an authoritative decision matching official broadcast graphics."

---

### Scene 3: Interactive 3D Physics Simulator (2:30 – 4:15)
* **On Screen:** Switch view to **3D Hawk-Eye Only** or click **"Launch Interactive 3D Simulator"**.
* **Actions to Perform:**
  1. **Delivery Presets:** Cycle between presets in the top dropdown:
     - *Fast Inswinger - LBW Out (142 km/h)*
     - *Good Length Off-Cutter - Bowled (132 km/h)*
     - *Sharp Bouncer - Missing Stumps (148 km/h)*
     - *Leg Break - Umpire's Call (88 km/h)*
  2. **RPM Slider:** Adjust the **Spin RPM slider** from 800 RPM up to 2,800 RPM. Show how the trajectory ribbon physically curves due to the Magnus aerodynamic force ($F_M = \frac{1}{2} C_L \rho A v^2 (\hat{\omega} \times \hat{v})$).
  3. **Turf Selection:** Switch pitch types:
     - *Green Seamer:* High bounce ($e_z = 0.68$) and lateral seam kick.
     - *Dry & Dusty:* Sharp spin grip and lower bounce ($e_z = 0.52$).
  4. **Dynamic Force Vectors:** Toggle the **Vectors** button to show instantaneous 3D arrows: Velocity (Cyan), Magnus force (Pink), Gravity (Yellow), and Spin Axis (White).
  5. **Smart Zing Stumps & Avatar:**
     - Click on the wickets or let an OUT delivery hit the stumps — show the LED bails lighting up and the dynamic physics shatter!
     - Switch batsman stance between **RHB** and **LHB**, and trigger animations (**Defend**, **Drive**, **Leave**).
  6. **Cinematic Cameras:** Showcase multiple camera views from the bottom bar:
     - **Broadcast (Bowler POV)**
     - **Batsman POV** (show what the batsman sees facing 140 km/h)
     - **Side Arc** (perfect for seeing the bounce height)
     - **Pitch Map (Top)** (shows lateral drift and line)
     - **Bullet Time / Drone Cam** (cinematic sweeps)
  7. **Ghost Trajectory Comparison:** Select a ghost delivery preset from the dropdown (e.g. *Ghost: Sharp Bouncer*) to see two trajectory ribbons rendered simultaneously for comparative analysis.
* **What to Say:**
  > "Next, let's explore the interactive 3D physics engine.
  > Rather than relying on static pre-rendered animations, our system computes real-time aerodynamic differential equations.
  > When I increase the Spin RPM slider to 2,800 RPM, you can visibly see the Magnus aerodynamic drift bend the path in mid-air.
  > Switching the pitch turf from Standard Hard to Green Seamer alters the surface restitution tensor, producing higher bounce and increased seam deviation.
  > We have modeled dynamic Zing LED stumps with collision hitboxes that shatter upon impact, along with a rigged 3D batsman avatar supporting both right-hand and left-hand stances.
  > Broadcasters and analysts can switch between 9 distinct camera perspectives, including Batsman POV, Pitch Map, Side Arc, and 360-degree Bullet Time."

---

### Scene 4: Guided Pitch Calibration Tool (4:15 – 5:00)
* **On Screen:** Click the **"Calibrate Pitch"** button in the header toolbar.
* **Actions to Perform:**
  1. Show the 4-point calibration modal over the video frame.
  2. Explain the 4 corners: Bowler Crease Left/Right and Popping Crease Left/Right.
  3. Click **"Save Calibration"** to show how the homography matrix ($H$) is updated dynamically to project $(u, v)$ pixels into $(X, Y, Z)$ pitch metric coordinates.
* **What to Say:**
  > "To accommodate footage from any camera angle without manual code changes, we built a Guided Pitch Calibration tool.
  > By selecting the four corners of the pitch strip, the backend computes the planar projective homography matrix $H$, establishing a direct mapping between 2D screen pixels and the standard 20.12-meter cricket pitch coordinate system."

---

### Scene 5: Project Limitations & Technical Boundaries (5:00 – 6:00)
* **On Screen:** Return to the split view or show the **Decision Flow HUD / Match Report Card**.
* **What to Address (Crucial for high academic grading):**
  1. **Monocular Depth Ambiguity:**
     > *"Official Hawk-Eye relies on 6 or more synchronized camera towers to triangulate depth via stereo baseline. Because we operate on a single monocular broadcast camera, longitudinal distance ($Y$) along the pitch relies on pitch plane perspective homography and physics parabolic regression rather than true stereo disparity."*
  2. **Standard Frame Rates (25/30 FPS) vs. High-Speed Cameras (340 FPS):**
     > *"At 140 km/h, a cricket ball travels roughly 1.5 meters between consecutive frames of a 25 FPS video. To bridge this, our engine employs cubic spline and Kalman filtering. Rapid seam changes occurring within a single frame cannot be directly resolved by monocular 25 FPS footage."*
  3. **Visual Occlusion:**
     > *"When the ball passes behind the batsman's front leg or bat before impact, direct optical pixels are lost. Our system handles this gracefully using temporal Kalman velocity propagation until the ball re-emerges or reaches the stumps plane."*
  4. **Camera Movement:**
     > *"Our homography projection assumes a stationary or stable high-angle broadcast camera. Wild pans, rapid zooms, or hand-held spectator footage require frame-by-frame feature tracking to maintain calibration."*

---

### Scene 6: Conclusion (6:00 – 6:30)
* **On Screen:** Show the completed DRS decision card and 3D visual.
* **What to Say:**
  > "In summary, our project bridges the gap between complex multi-million dollar sports telemetry systems and accessible software.
  > By combining OpenCV, YOLO object detection, calibrated projective geometry, classical aerodynamics, and interactive WebGL graphics, we have delivered a full-featured DRS review suite that is interactive, educational, and broadcast-ready.
  > Thank you for watching!"

---

## Evaluation Checklist for Your Demo Video

| Category | Feature to Show in Video | Verified Working |
| :--- | :--- | :---: |
| **CV Tracking** | Split View with 1:1 synchronized video and 3D playback | Yes |
| **CV Tracking** | 2D Neon glowing reticle and trail directly on the video | Yes |
| **CV Tracking** | Scrubbing / seeking preserves lockstep alignment | Yes |
| **DRS Decision** | Automated Pitching, Impact, and Wickets verdict banner | Yes |
| **DRS Decision** | Delivery classification (Inswing/Outswing, Speed, Length Zone) | Yes |
| **3D Graphics** | Multi-phase colored trajectory tube (pre-bounce, post-bounce, predicted) | Yes |
| **3D Graphics** | Interactive Zing LED Stumps shattering on impact | Yes |
| **3D Graphics** | 3D Batsman Avatar with RHB/LHB stance & batting actions | Yes |
| **3D Physics** | Real-time Spin RPM slider (Magnus force curve) | Yes |
| **3D Physics** | Pitch turf restitution selector (Hard, Green Seamer, Dusty) | Yes |
| **3D Physics** | Instantaneous 3D Force Vectors (Velocity, Magnus, Gravity) | Yes |
| **Cinematics** | Multi-camera views (Broadcast, Umpire, Batsman POV, Side, Top, Bullet Time) | Yes |
| **Comparison** | Ghost trajectory overlay comparing two deliveries | Yes |
| **Calibration** | 4-point manual pitch calibration interface | Yes |
| **Limitations** | Clear spoken explanation of single-camera vs multi-camera & 25 FPS | Yes |
