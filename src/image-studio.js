// ProText AI Image Studio: offline presets + optional authenticated online editing.
// Do not put IMAGE_ACCESS_KEY or other secrets in this file.
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;
const ONLINE_MAX_DIMENSION = 384;
const ONLINE_MAX_BYTES = 1024 * 1024;
const WORKER_URL = "https://round-dawn-4989.indeevartummala8.workers.dev/edit";
const SUPPORTED = new Set(["image/jpeg", "image/png", "image/webp"]);
const $ = (id) => document.getElementById(id);
let originalUrl = null;
let resultUrl = null;
let processing = false;

function status(message) {
  const el = $("imageStatus");
  if (el) el.textContent = message;
}

function releaseResults() {
  const comparison = $("imageComparison");
  const original = $("imageOriginal");
  const result = $("imageResult");
  if (comparison) comparison.hidden = true;
  if (original) original.removeAttribute("src");
  if (result) result.removeAttribute("src");
  $("imageDownload")?.removeAttribute("href");
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  originalUrl = resultUrl = null;
}

function setComparePosition(value) {
  const slider = $("imageCompareSlider");
  const container = $("imageSliderContainer");
  if (!slider || !container) return;
  const n = Number(value);
  const position = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 50;
  slider.value = String(position);
  container.style.setProperty("--compare-position", `${position}%`);
  // Remove inline properties left by older versions of Image Studio.
  $("imageSliderOverlay")?.style.removeProperty("width");
  $("imageSliderDivider")?.style.removeProperty("left");
}

function showResult(original, edited, message) {
  const comparison = $("imageComparison");
  const originalImage = $("imageOriginal");
  const resultImage = $("imageResult");
  const download = $("imageDownload");
  if (!comparison || !originalImage || !resultImage || !download) {
    throw new Error("Image preview elements are missing from index.html.");
  }
  const nextOriginal = URL.createObjectURL(original);
  const nextResult = URL.createObjectURL(edited);
  const previousOriginal = originalUrl;
  const previousResult = resultUrl;
  originalUrl = nextOriginal;
  resultUrl = nextResult;
  originalImage.removeAttribute("style");
  resultImage.removeAttribute("style");
  originalImage.src = nextOriginal;
  resultImage.src = nextResult;
  download.href = nextResult;
  download.download = "protext-ai-edited.png";
  comparison.hidden = false;
  setComparePosition(50);
  // Match the comparison frame to the ORIGINAL photo's dimensions.
  // Both images use object-fit:cover, so neither image is stretched.
  const frame = $("imageSliderContainer");
  if (frame) {
    const probe = new Image();
    probe.onload = () => {
      if (originalUrl === nextOriginal && probe.naturalWidth && probe.naturalHeight) {
        frame.style.aspectRatio = `${probe.naturalWidth} / ${probe.naturalHeight}`;
      }
    };
    probe.src = nextOriginal;
  }
  if (previousOriginal) URL.revokeObjectURL(previousOriginal);
  if (previousResult) URL.revokeObjectURL(previousResult);
  status(message);
}

function requestedPreset(prompt, selected) {
  const p = prompt.toLowerCase().trim();
  if (!p) return selected;
  const rules = [
    [/\b(?:black and white|grayscale|greyscale|monochrome)\b/, "grayscale"],
    [/\b(?:brighten|brighter|lighten|exposure)\b/, "bright"],
    [/\b(?:contrast|punchier)\b/, "contrast"],
    [/\b(?:enhance|improve|natural|color|colour|clarity)\b/, "auto"]
  ];
  const match = rules.find(([pattern]) => pattern.test(p));
  const unsupported = /\b(remove|erase|replace|change background|add person|generate|create|restore face|upscale|sharpen text|fix blur)\b/i.test(p);
  if (unsupported) throw new Error("This prompt needs advanced AI editing. Local mode supports brightness, contrast, grayscale, and natural enhancement.");
  if (!match && selected === "auto") throw new Error("This prompt cannot be performed accurately by local filters. Select a supported preset or use online AI.");
  return match ? match[1] : selected;
}

function applyPixels(data, preset) {
  const a = data.data;
  for (let i = 0; i < a.length; i += 4) {
    let r = a[i], g = a[i + 1], b = a[i + 2];
    if (preset === "grayscale") { const y = .2126*r + .7152*g + .0722*b; r = g = b = y; }
    else if (preset === "bright") { r = r*1.08+12; g = g*1.08+12; b = b*1.08+12; }
    else if (preset === "contrast") { r = (r-128)*1.17+128; g = (g-128)*1.17+128; b = (b-128)*1.17+128; }
    else if (preset === "auto") { r = (r-128)*1.07+133; g = (g-128)*1.07+133; b = (b-128)*1.07+133; }
    a[i] = Math.max(0,Math.min(255,r));
    a[i+1] = Math.max(0,Math.min(255,g));
    a[i+2] = Math.max(0,Math.min(255,b));
  }
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === "function") return createImageBitmap(file, { imageOrientation: "from-image" });
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

function canvasToBlob(canvas, type = "image/png", quality) {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("Could not export image.")),
    type, quality
  ));
}

async function localEdit(file, prompt, preset) {
  const chosen = requestedPreset(prompt, preset);
  const bitmap = await loadBitmap(file);
  try {
    const w = bitmap.width, h = bitmap.height;
    if (!w || !h || w*h > MAX_PIXELS) throw new Error("Image dimensions are too large. Use an image under 16 megapixels.");
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas processing is unavailable.");
    ctx.drawImage(bitmap, 0, 0);
    if (chosen !== "original") {
      const pixels = ctx.getImageData(0, 0, w, h);
      applyPixels(pixels, chosen);
      ctx.putImageData(pixels, 0, 0);
    }
    return await canvasToBlob(canvas);
  } finally { if (typeof bitmap.close === "function") bitmap.close(); }
}

async function prepareOnlineImage(file) {
  const bitmap = await loadBitmap(file);
  try {
    const w = bitmap.width, h = bitmap.height;
    if (!w || !h) throw new Error("Could not read image dimensions.");
    const scale = Math.min(1, ONLINE_MAX_DIMENSION / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w*scale));
    canvas.height = Math.max(1, Math.round(h*scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image resizing is unavailable.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, "image/jpeg", .85);
    if (blob.size > ONLINE_MAX_BYTES) throw new Error("Prepared image exceeds the online size limit.");
    return new File([blob], "protext-upload.jpg", { type: "image/jpeg" });
  } finally { if (typeof bitmap.close === "function") bitmap.close(); }
}

async function onlineEdit(file, prompt) {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) throw new Error("Enter instructions for the AI image edit.");
  if (cleanPrompt.length > 1000) throw new Error("Online prompts must be 1000 characters or fewer.");
  if (!navigator.onLine) throw new Error("You appear to be offline. Switch to local mode or connect to the internet.");
  const key = window.prompt("Enter your private Image Studio access key (used for this request only):");
  if (key === null) throw new Error("Online image editing cancelled.");
  if (!key.trim()) throw new Error("An access key is required.");
  status("Preparing a smaller image on your device...");
  const prepared = await prepareOnlineImage(file);
  const form = new FormData();
  form.append("image", prepared);
  form.append("prompt", cleanPrompt);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  status("Sending approved image for AI editing...");
  try {
    const response = await fetch(WORKER_URL, {
      method: "POST", headers: { "X-Image-Access-Key": key },
      body: form, cache: "no-store", signal: controller.signal
    });
    if (!response.ok) {
      let message = `Online editing failed (HTTP ${response.status}).`;
      try {
        const error = await response.json();
        if (typeof error?.error === "string") message += ` ${error.error}`;
      } catch { /* Keep HTTP status. */ }
      throw new Error(message);
    }
    const type = response.headers.get("Content-Type") || "";
    if (!type.toLowerCase().startsWith("image/")) throw new Error("The AI service did not return an image.");
    const result = await response.blob();
    if (!result.size) throw new Error("The AI returned an empty image.");
    return result;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("The AI request timed out. Please try again.");
    throw error;
  } finally { clearTimeout(timeout); }
}

export function initImageStudio() {
  const mode = $("imageMode");
  const fileInput = $("imageFile");
  const process = $("imageProcess");
  const slider = $("imageCompareSlider");
  const frame = $("imageSliderContainer");
  if (!mode || !fileInput || !process) return;

  // Single slider handler: no overlay-width mutations and no duplicate listeners.
  if (slider && frame) {
    slider.addEventListener("input", () => setComparePosition(slider.value));
    slider.addEventListener("change", () => setComparePosition(slider.value));
    // Direct pointer tracking makes the entire image draggable on desktop and iPhone.
    const updateFromPointer = (event) => {
      const bounds = frame.getBoundingClientRect();
      if (!bounds.width) return;
      setComparePosition((event.clientX - bounds.left) / bounds.width * 100);
    };
    slider.addEventListener("pointerdown", (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      slider.setPointerCapture?.(event.pointerId);
      updateFromPointer(event);
    });
    slider.addEventListener("pointermove", (event) => {
      if (event.buttons === 1 || (event.pointerType === "touch" && slider.hasPointerCapture?.(event.pointerId))) {
        updateFromPointer(event);
      }
    });
    setComparePosition(50);
  }

  mode.addEventListener("change", () => {
    $("imageLocalOptions").hidden = mode.value !== "local";
    $("imageOnlineOptions").hidden = mode.value !== "online";
    $("imageConsent").checked = false;
    releaseResults();
    status("");
  });
  fileInput.addEventListener("change", () => { releaseResults(); status(""); });
  process.addEventListener("click", async () => {
    if (processing) return;
    const file = fileInput.files?.[0];
    if (!file) return status("Choose an image first.");
    if (!SUPPORTED.has(file.type)) return status("Choose a PNG, JPEG, or WebP image.");
    if (file.size > MAX_BYTES) return status("Choose an image smaller than 20 MB.");
    const isOnline = mode.value === "online";
    if (isOnline && !$("imageConsent").checked) return status("Approve online processing before continuing.");
    processing = true;
    process.disabled = true;
    try {
      let blob;
      if (isOnline) {
        blob = await onlineEdit(file, $("imagePrompt").value);
        showResult(file, blob, "AI editing complete. Drag the divider to compare, then save the image.");
      } else {
        status("Processing locally. Your image is not uploaded.");
        blob = await localEdit(file, $("imagePrompt").value, $("imagePreset").value);
        showResult(file, blob, "Processed locally. Drag the divider to compare, then save the image.");
      }
    } catch (error) { status(error?.message || "Image processing failed."); }
    finally { processing = false; process.disabled = false; }
  });
  window.addEventListener("pagehide", releaseResults);
}