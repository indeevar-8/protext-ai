
// ProText AI Phase 1: local face detection + faithful portrait crops.
// No network calls are made by this module. Model/WASM must be installed under public/.
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";

const $ = (id) => document.getElementById(id);
const BASE = import.meta.env.BASE_URL;
const MAX_FILE = 20 * 1024 * 1024;
let detector, photo, faces = [], selected = 0, sourceURL = null, cardURLs = [];

function message(s) { $("faceStatus").textContent = s; }
function clearCards() {
  for (const u of cardURLs) URL.revokeObjectURL(u);
  cardURLs = [];
  $("faceCards").replaceChildren();
}
function reset() {
  faces = []; selected = 0; photo = null;
  $("faceSelection").hidden = true;
  $("faceBoxes").replaceChildren();
  clearCards();
  if (sourceURL) URL.revokeObjectURL(sourceURL);
  sourceURL = null;
  message("");
}
async function getDetector() {
  if (detector) return detector;
  message("Loading offline face detector...");
  const vision = await FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`);
  detector = await FaceDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: `${BASE}models/blaze_face_short_range.tflite`, delegate: "CPU" },
    runningMode: "IMAGE", minDetectionConfidence: 0.5
  });
  return detector;
}
function drawBoxes() {
  const host = $("faceBoxes");
  host.replaceChildren();
  faces.forEach((f, i) => {
    const b = f.boundingBox;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "face-box" + (i === selected ? " selected" : "");
    btn.setAttribute("aria-label", `Select face ${i + 1}`);
    Object.assign(btn.style, {
      left: `${100 * b.originX / photo.naturalWidth}%`,
      top: `${100 * b.originY / photo.naturalHeight}%`,
      width: `${100 * b.width / photo.naturalWidth}%`,
      height: `${100 * b.height / photo.naturalHeight}%`
    });
    btn.addEventListener("click", () => { selected = i; drawBoxes(); });
    host.append(btn);
  });
}
async function detect() {
  const file = $("imageFile").files?.[0];
  if (!file) throw Error("Choose a photo first.");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > MAX_FILE)
    throw Error("Choose a PNG, JPEG, or WebP photo under 20 MB.");
  reset();
  sourceURL = URL.createObjectURL(file);
  photo = new Image();
  photo.src = sourceURL;
  await photo.decode();
  if (photo.naturalWidth * photo.naturalHeight > 20_000_000)
    throw Error("Photo is too large for local face detection. Choose a smaller image.");
  const d = await getDetector();
  const result = d.detect(photo);
  faces = (result.detections || []).filter(x => x.boundingBox?.width > 0 && x.boundingBox?.height > 0);
  if (!faces.length) { message("No faces detected. Try a clearer photo with visible, front-facing faces."); return; }
  $("faceSourcePreview").src = sourceURL;
  $("faceSelection").hidden = false;
  drawBoxes();
  message(`${faces.length} face(s) detected locally. Select a face or create all cards.`);
}
function enhance(canvas, strength) {
  if (strength === "natural") return;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const {width:w,height:h} = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const a = img.data, original = new Uint8ClampedArray(a);
  const amount = strength === "strong" ? 0.38 : 0.19;
  // Mild unsharp mask with 4-neighbor blur. Does not synthesize facial features.
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const blur = (original[i+c] * 4 + original[i-4+c] + original[i+4+c] +
          original[i-w*4+c] + original[i+w*4+c]) / 8;
        a[i+c] = Math.max(0, Math.min(255, original[i+c] + amount * (original[i+c] - blur)));
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}
async function makeCard(index) {
  const b = faces[index].boundingBox;
  const w = photo.naturalWidth, h = photo.naturalHeight;
  const size = Number($("faceResolution").value);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  // Expand face box to include hair, chin and shoulders where available.
  const span = Math.max(b.width * 1.9, b.height * 1.7);
  const centerX = b.originX + b.width / 2;
  const centerY = b.originY + b.height * 0.63;
  const sx = centerX - span / 2, sy = centerY - span / 2;
  // Use neutral background for crops extending beyond photo edges.
  ctx.fillStyle = "#e7eaf0";
  ctx.fillRect(0, 0, size, size);
  // Clip crop to source bounds; avoid browser-dependent out-of-bounds drawImage.
  const ix = Math.max(0, sx), iy = Math.max(0, sy);
  const ex = Math.min(w, sx + span), ey = Math.min(h, sy + span);
  if (ex > ix && ey > iy) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(photo, ix, iy, ex-ix, ey-iy,
      (ix-sx)/span*size, (iy-sy)/span*size, (ex-ix)/span*size, (ey-iy)/span*size);
  }
  enhance(canvas, $("faceStrength").value);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw Error("Could not export face card.");
  const url = URL.createObjectURL(blob);
  cardURLs.push(url);
  const item = document.createElement("div");
  item.className = "face-card-item";
  const img = document.createElement("img");
  img.src = url; img.alt = `Face ${index+1} card`;
  const label = document.createElement("b");
  label.textContent = `Face ${index+1}`;
  const link = document.createElement("a");
  link.href = url; link.download = `protext-face-${index+1}-${size}.png`;
  link.textContent = "Save face card";
  item.append(img, label, link);
  $("faceCards").append(item);
}
async function run(action) {
  const buttons = [$("faceDetectBtn"), $("faceCreateBtn"), $("faceCreateAllBtn")];
  buttons.forEach(b => b.disabled = true);
  try { await action(); }
  catch (e) { message(e?.message || "Face processing failed."); console.error(e); }
  finally { buttons.forEach(b => b.disabled = false); }
}
function init() {
  if (!$("imageFaceOptions")) return;
  $("faceDetectBtn").addEventListener("click", () => run(detect));
  $("faceCreateBtn").addEventListener("click", () => run(async () => {
    if (!faces.length) throw Error("Detect faces first.");
    clearCards(); await makeCard(selected); message("Face card created locally.");
  }));
  $("faceCreateAllBtn").addEventListener("click", () => run(async () => {
    if (!faces.length) throw Error("Detect faces first.");
    clearCards();
    for (let i = 0; i < faces.length; i++) await makeCard(i);
    message(`${faces.length} face cards created locally.`);
  }));
  $("imageFile").addEventListener("change", reset);
  window.addEventListener("pagehide", reset);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
