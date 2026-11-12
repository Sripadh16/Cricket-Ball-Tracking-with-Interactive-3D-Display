// Usage: node scripts/audit_ui.cjs <Chromium executable> <fixture JSON> <output directory>
// Fixtures isolate UI checks from accounts, private footage, and running analysis jobs.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const http = require('node:http');

async function main() {
  const [executable, fixturePath, output, buildPath] = process.argv.slice(2);
  assert(executable && fixturePath && output, 'Provide Chromium, fixture, and output paths');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  let mediaFile = path.join(path.dirname(fixturePath), 'timing.webm');
  fs.mkdirSync(output, { recursive: true });
  const build = buildPath ? path.resolve(buildPath) : path.resolve(__dirname, '../frontend/build');
  const server = http.createServer((request, response) => {
    const file = path.resolve(build, '.' + new URL(request.url, 'http://local').pathname);
    if (!file.startsWith(build + path.sep) && file !== build) { response.writeHead(403).end(); return; }
    const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(build, 'index.html');
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' };
    response.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream');
    fs.createReadStream(target).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'crease-ui-audit-'));
  const browser = spawn(executable, ['--headless=new', '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--enable-unsafe-swiftshader', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let socket;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    const pending = new Map();
    let id = 0;
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
    const errors = [];
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) request?.reject(new Error(JSON.stringify(message.error)));
        else request?.resolve(message.result);
      }
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
      if (message.method === 'Fetch.requestPaused') {
        const { request, requestId } = message.params;
        const url = new URL(request.url);
        const stream = url.pathname.endsWith('/stream');
        let bytes;
        let range;
        let start = 0;
        let end;
        if (stream) {
          bytes = fs.readFileSync(mediaFile);
          range = /bytes=(\d+)-(\d*)/.exec(request.headers.Range || request.headers.range || '');
          start = range ? Number(range[1]) : 0;
          end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
        }
        const body = url.pathname.startsWith('/videos/presets/') ? (fixture.presets?.[url.pathname.split('/').pop()] || fixture.trajectory)
          : url.pathname.endsWith('/trajectory') ? fixture.uploadTrajectory
          : url.pathname === '/videos/' ? { videos: fixture.videos } : {};
        send('Fetch.fulfillRequest', { requestId, responseCode: stream && range ? 206 : 200, responseHeaders: [
          { name: 'Content-Type', value: stream ? 'video/webm' : 'application/json' },
          ...(stream ? [{ name: 'Accept-Ranges', value: 'bytes' }, { name: 'Content-Length', value: String(end - start + 1) },
            ...(range ? [{ name: 'Content-Range', value: `bytes ${start}-${end}/${bytes.length}` }] : [])] : []),
          { name: 'Access-Control-Allow-Origin', value: '*' },
          { name: 'Access-Control-Allow-Headers', value: '*' },
          { name: 'Access-Control-Allow-Methods', value: '*' }
        ], body: stream ? bytes.subarray(start, end + 1).toString('base64')
          : Buffer.from(JSON.stringify(body)).toString('base64') }).catch(error => errors.push(error.message));
      }
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: 'http://localhost:8000/*' }] });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    };
    const waitFor = async expression => {
      for (let i = 0; i < 100; i++) {
        if (await evaluate(`Boolean(${expression})`)) return;
        await sleep(100);
      }
      console.log(await evaluate(`JSON.stringify({ video: Array.from(document.querySelectorAll('video')).map(v => ({ src: v.currentSrc, error: v.error?.message, time: v.currentTime, ready: v.readyState, seeking: v.seeking, ranges: v.seekable.length })), timeline: document.querySelector('[aria-label="Delivery timeline"]')?.outerHTML, text: document.body.innerText.slice(-800) })`));
      throw new Error(`Timed out: ${expression}`);
    };
    const viewport = (width, height) => send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false
    });
    const screenshot = async name => {
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(output, `${name}.png`), Buffer.from(data, 'base64'));
    };
    const click = text => evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === ${JSON.stringify(text)})?.click()`);
    const overflow = () => evaluate('document.documentElement.scrollWidth > innerWidth');
    await viewport(1440, 900);
    await send('Page.navigate', { url: baseUrl });
    await waitFor('document.querySelector(".auth-layout")');
    await screenshot('entry-desktop');
    await viewport(375, 812);
    await sleep(200);
    assert.equal(await overflow(), false, 'Entry overflows mobile viewport');
    await screenshot('entry-mobile');
    await click('Continue without account');
    await waitFor('document.querySelector(".review-workspace")');
    await sleep(900);
    assert.equal(await overflow(), false, 'Demo overflows mobile viewport');
    await screenshot('demo-mobile');
    await viewport(1440, 900);
    await sleep(300);
    await screenshot('demo-desktop');
    await evaluate(`document.querySelector('[aria-label="Delivery source"]').parentElement.querySelector('[role="combobox"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`);
    await waitFor(`document.querySelector('[data-value="offcutter_bowled"]')`);
    await evaluate(`document.querySelector('[data-value="offcutter_bowled"]').click()`);
    await waitFor('document.body.innerText.includes("Good Length Off-Cutter")');
    await sleep(400);
    await click('0.5x');
    // Capture the actual canvas playback for visual motion review, using generated physics only.
    const motionCapture = await evaluate(`(async () => {
      const canvas = document.querySelector('canvas');
      if (!canvas?.captureStream || !window.MediaRecorder) return null;
      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const chunks = [];
      window.motionFrames = [];
      const milestones = [0.15, 0.35, 0.5, 0.65, 0.9, 1.3];
      const monitor = setInterval(() => {
        const time = Number(document.querySelector('[aria-label="Delivery timeline"]').value);
        if (milestones.length && time >= milestones[0]) {
          milestones.shift(); window.motionFrames.push({ time, png: canvas.toDataURL('image/png').split(',')[1] });
        }
      }, 30);
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise(resolve => { recorder.onstop = resolve; });
      recorder.start();
      document.querySelector('[aria-label="Play"]').click();
      await new Promise(resolve => setTimeout(resolve, 3200));
      recorder.stop(); await stopped;
      clearInterval(monitor);
      stream.getTracks().forEach(track => track.stop());
      const reader = new FileReader();
      return new Promise(resolve => { reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(new Blob(chunks, { type: 'video/webm' })); });
    })()`);
    if (motionCapture) fs.writeFileSync(path.join(output, 'simulation-motion.webm'), Buffer.from(motionCapture, 'base64'));
    for (const frame of await evaluate('window.motionFrames || []')) {
      fs.writeFileSync(path.join(output, `motion-${frame.time.toFixed(2)}.png`), Buffer.from(frame.png, 'base64'));
    }
    assert.equal(await evaluate('document.querySelector("[aria-label=Play]") !== null'), true, 'Simulation should stop at the end instead of jumping into a loop');
    const pausedFrame = await evaluate('document.querySelector("canvas").toDataURL()');
    await sleep(250);
    assert.equal(await evaluate('document.querySelector("canvas").toDataURL()'), pausedFrame, 'Paused replay should not keep animating');
    await screenshot('demo-after-delivery');
    await evaluate('document.querySelector(".viewer-tools").open = true');
    await click('UltraEdge demo');
    await waitFor('document.body.innerText.includes("Simulated audio demonstration")');
    await screenshot('demo-audio');
    await viewport(375, 812);
    await sleep(200);
    assert.equal(await overflow(), false, 'Audio controls overflow phone viewport');
    assert.ok(await evaluate('document.querySelector("canvas").getBoundingClientRect().height >= 140'), 'Audio panel collapsed the replay canvas');
    await screenshot('demo-audio-mobile');
    await viewport(1440, 900);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await sleep(200);
    await screenshot('demo-reduced-motion');
    await send('Emulation.setEmulatedMedia', { features: [] });
    assert.equal(await evaluate('document.querySelectorAll(".viewer-camera-bar > .MuiToggleButtonGroup-root button").length'), 4, 'Primary camera toolbar exceeds four choices');
    await evaluate('localStorage.setItem("token", "ui-fixture-token"); location.reload()');
    await waitFor('document.querySelector(".delivery-row")');
    await screenshot('library-desktop');
    await viewport(375, 812);
    await sleep(250);
    assert.equal(await overflow(), false, 'Library overflows mobile viewport');
    await screenshot('library-mobile');
    await evaluate('window.scrollTo(0, document.body.scrollHeight)');
    await evaluate('document.querySelector(".delivery-name").click()');
    await waitFor('document.querySelector(".review-workspace")');
    assert.equal(await evaluate('window.scrollY'), 0, 'Review inherited library scroll position');
    await evaluate('document.querySelector("video").load()');
    await waitFor('document.querySelector("video").readyState >= 2');
    assert.equal(await overflow(), false, 'Uploaded review overflows mobile viewport');
    assert.equal(await evaluate('document.querySelector(".review-controls [value=split]") !== null'), false, 'Mobile defaults to split');
    await screenshot('upload-mobile');
    for (const width of [768, 1024]) {
      await viewport(width, 900);
      await sleep(200);
      assert.equal(await overflow(), false, `Uploaded review overflows ${width}px viewport`);
      await screenshot(`upload-${width}`);
    }
    await viewport(1440, 900);
    await click('Split');
    await evaluate('document.querySelector("video").currentTime = 2.1');
    await waitFor(`Number(document.querySelector('[aria-label="Delivery timeline"]').value) > 2`);
    await sleep(300);
    await screenshot('upload-desktop');
    for (const width of [1200, 1279, 1440, 1920]) {
      await viewport(width, 900);
      await sleep(200);
      assert.equal(await overflow(), false, `Split review overflows ${width}px viewport`);
      const layout = await evaluate(`(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect();
        const header = rect('.review-header'), source = rect('.source-panel'), scene = rect('.scene-panel');
        const evidence = rect('.review-inspector'), playback = rect('.review-playback'), toolbar = rect('.viewer-camera-bar');
        return { headerTop: header.top, sourceWidth: source.width, sceneWidth: scene.width,
          panelsFit: source.right <= scene.left + 1 && scene.right <= evidence.left + 1 && evidence.right <= innerWidth + 1,
          playbackVisible: playback.bottom <= innerHeight + 1,
          toolbarFits: toolbar.left >= scene.left - 1 && toolbar.right <= scene.right + 1 && toolbar.bottom <= scene.bottom + 1 };
      })()`);
      assert.ok(layout.headerTop >= 0 && layout.sourceWidth > 200 && layout.sceneWidth > 200 && layout.panelsFit && layout.playbackVisible && layout.toolbarFits, `Split layout broken at ${width}px: ${JSON.stringify(layout)}`);
      await screenshot(`split-layout-${width}`);
    }
    await viewport(1440, 900);
    const timing = [];
    for (const rate of [1, 0.5, 0.25, 0.1]) {
      await click(`${rate}x`);
      const measurement = await evaluate(`(async () => {
        const video = document.querySelector('video');
        const timeline = document.querySelector('[aria-label="Delivery timeline"]');
        video.muted = true;
        await new Promise(resolve => {
          video.addEventListener('seeked', resolve, { once: true });
          video.currentTime = video.currentTime > 2.2 ? 2.1 : 2.2;
        });
        await video.play();
        return new Promise(resolve => {
          let samples = 0;
          let maxErrorSeconds = 0;
          let latestPresentedTime = video.currentTime;
          let monitorId;
          const trace = [];
          const monitor = (_, metadata) => {
            latestPresentedTime = metadata.mediaTime;
            monitorId = video.requestVideoFrameCallback(monitor);
          };
          monitorId = video.requestVideoFrameCallback(monitor);
          const tick = async (_, metadata) => {
            // Compare after React has had a paint opportunity, not inside its incoming media callback.
            await new Promise(requestAnimationFrame);
            const uiTime = Number(timeline.value);
            const error = Math.abs(uiTime - latestPresentedTime);
            trace.push({ uiTime, latestPresentedTime, originalCallbackTime: metadata.mediaTime, mediaClock: video.currentTime, error });
            maxErrorSeconds = Math.max(maxErrorSeconds, error);
            if (++samples === 8) {
              video.pause();
              video.cancelVideoFrameCallback(monitorId);
              resolve({ rate: video.playbackRate, samples, maxErrorSeconds, trace });
            } else video.requestVideoFrameCallback(tick);
          };
          video.requestVideoFrameCallback(tick);
        });
      })()`);
      timing.push(measurement);
    }
    mediaFile = path.join(output, 'simulation-motion.webm');
    await viewport(1920, 1020);
    await evaluate('document.querySelector("video").src += "&layoutProbe=wide"');
    await waitFor('document.querySelector("video").readyState >= 2');
    assert.equal(await overflow(), false, 'Wide recorded video forces split overflow');
    assert.ok(await evaluate('document.querySelector(".scene-panel").getBoundingClientRect().right <= document.querySelector(".review-inspector").getBoundingClientRect().left + 1'), 'Wide recorded video pushes scene out of its panel');
    await screenshot('wide-recording-split');
    await click('Save reviewer assessment');
    await waitFor('document.querySelector("[role=dialog]")');
    assert.equal(await evaluate('Array.from(document.querySelectorAll("[role=dialog] button")).find(button => button.textContent === "Save Decision").disabled'), true, 'Unknown automated outcome defaults to a saveable verdict');
    await screenshot('review-dialog');
    assert.deepEqual(errors, [], 'Uncaught browser exceptions');
    const timingPassed = timing.every(measurement => measurement.maxErrorSeconds <= 1 / 30 + 0.005);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: timingPassed, functionalChecksPassed: true,
      timingPassed, timingToleranceSeconds: 1 / 30 + 0.005,
      viewportChecks: [375, 768, 1024, 1200, 1279, 1440, 1920], layoutChecks: ['scroll reset', 'split panel boundaries', 'visible toolbar and playback', 'wide recorded video'], motionChecks: ['bowled replay capture', 'stops at end', 'paused canvas stable', 'reduced motion render'], errors, timing,
      media: 'Synthetic 30fps WebM source and API fixtures; real cricket accuracy not measured' }, null, 2));
    console.log('PASS: guest entry, library, review, camera toolbar, mobile overflow, explicit reviewer outcome, no uncaught exceptions');
    console.log(JSON.stringify({ timingPassed, timing }));
    if (!timingPassed) process.exitCode = 1;
  } finally {
    socket?.close();
    browser.kill();
    server.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
