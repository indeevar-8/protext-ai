
/*
 * ProText AI — Face Studio 1.5.2
 *
 * Local MediaPipe face detection
 * Adjustable face crop
 * Original / Classic / Experimental AI processing
 * Offline ONNX 3x super-resolution
 * Original vs AI preview
 * 512 / 1024 / 2048 / 4096 PNG export
 */

import {
  checkAIModel,
  inspectAIModel,
  enhanceFaceCanvas
} from "./face-ai-engine.js";

import {
  FaceDetector,
  FilesetResolver
} from "@mediapipe/tasks-vision";

const $ = id => document.getElementById(id);
const BASE = import.meta.env.BASE_URL;

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 20_000_000;
const VERSION = "1.5.2";

let detector = null;
let photo = null;
let sourceURL = null;
let thumbnailURL = null;
let generation = 0;

let faces = [];
let selected = 0;
let crop = null;
let drag = null;

let cardURLs = [];
let busy = false;
let aiReady = false;

let sourceInfo = {
  fileName: "",
  fileSize: 0
};

function message(text) {
  const element = $("faceStatus");
  if (element) element.textContent = text;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function imageWidth() {
  return photo?.naturalWidth || 0;
}

function imageHeight() {
  return photo?.naturalHeight || 0;
}

function newCanvas(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function getContext(canvas, options = {}) {
  const ctx = canvas.getContext("2d", options);

  if (!ctx) {
    throw new Error("Canvas processing is unavailable.");
  }

  return ctx;
}

function drawScaled(source, size) {
  const canvas = newCanvas(size);
  const ctx = getContext(canvas);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, size, size);

  return canvas;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("PNG export failed."));
    }, "image/png");
  });
}

function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

function clearCards() {
  for (const url of cardURLs) {
    URL.revokeObjectURL(url);
  }

  cardURLs = [];
  $("faceCards")?.replaceChildren();
}

function reset() {
  faces = [];
  selected = 0;
  crop = null;
  drag = null;
  photo = null;

  const selection = $("faceSelection");
  if (selection) selection.hidden = true;

  $("faceBoxes")?.replaceChildren();
  $("facePersonPicker")?.replaceChildren();

  const preview = $("faceSourcePreview");
  if (preview) preview.removeAttribute("src");

  clearCards();

  if (sourceURL) {
    URL.revokeObjectURL(sourceURL);
    sourceURL = null;
  }

  message("");
}

function updateSourceDiagnostics() {
  const element = $("faceFileDetails");

  if (!element || !photo) return;

  element.textContent =
    `${sourceInfo.fileName} · ` +
    `${imageWidth()} × ${imageHeight()} pixels · ` +
    `${(sourceInfo.fileSize / 1048576).toFixed(2)} MB · ` +
    `Face Studio ${VERSION}`;
}

/* ----------------------------------------
 * Processing mode
 * ---------------------------------------- */

function installEnhancementMode() {
  if ($("faceEnhancementMode")) return;

  const clarity = $("faceStrength");
  if (!clarity?.parentElement) return;

  const parent = clarity.parentElement;

  const label = document.createElement("label");
  label.htmlFor = "faceEnhancementMode";
  label.textContent = "Processing mode";
  label.style.display = "block";
  label.style.marginTop = "12px";
  label.style.fontWeight = "600";

  const select = document.createElement("select");
  select.id = "faceEnhancementMode";
  select.style.width = "100%";
  select.style.marginTop = "6px";

  select.add(new Option(
    "Original Quality (no sharpening)",
    "original"
  ));

  select.add(new Option(
    "Classic clarity (existing filters)",
    "classic"
  ));

  const aiOption = new Option(
    "Offline AI Enhance (experimental 3x)",
    "ai"
  );

  aiOption.disabled = true;
  select.add(aiOption);
  select.value = "original";

  const info = document.createElement("p");
  info.id = "faceEnhancementInfo";
  info.style.fontSize = "0.85rem";
  info.style.opacity = "0.8";

  parent.insertAdjacentElement("afterend", label);
  label.insertAdjacentElement("afterend", select);
  select.insertAdjacentElement("afterend", info);

  function sync() {
    const mode = select.value;
    clarity.disabled = mode !== "classic";

    if (mode === "classic") {
      info.textContent =
        "Classic clarity uses the existing sharpening filter.";
    } else if (mode === "ai") {
      info.textContent =
        "Experimental offline 3x AI super-resolution. " +
        "The model processes a 224-pixel input and produces " +
        "a 672-pixel result. Facial details may change.";
    } else {
      info.textContent =
        "Original photo pixels are used without sharpening.";
    }
  }

  select.addEventListener("change", sync);
  sync();

  const testContainer = document.createElement("div");
  testContainer.style.marginTop = "12px";

  const testButton = document.createElement("button");
  testButton.type = "button";
  testButton.textContent = "Check offline AI engine";

  testContainer.appendChild(testButton);

  const anchor = parent.closest("fieldset") || parent;
  anchor.insertAdjacentElement("afterend", testContainer);

  testButton.addEventListener("click", async () => {
    if (busy) return;

    testButton.disabled = true;

    const report = (stage, detail = "") => {
      const text = `[AI TEST] ${stage} ${detail}`;
      console.log(text);
      message(text);
    };

    try {
      report("1/4: Button clicked");

      const check = await checkAIModel();

      report(
        "2/4: Model check",
        JSON.stringify(check)
      );

      if (!check.available) {
        throw new Error(check.reason);
      }

      report("3/4: Loading ONNX model");

      const details = await inspectAIModel(
        status => report("Loading", status)
      );

      console.log("Face Studio AI model:", details);

      const input = details.inputMetadata?.[0];
      const output = details.outputMetadata?.[0];

      const compatible =
        details.inputNames?.length === 1 &&
        details.outputNames?.length === 1 &&
        input?.type === "float32" &&
        output?.type === "float32" &&
        Array.isArray(input?.shape) &&
        Array.isArray(output?.shape) &&
        input.shape.length === 4 &&
        output.shape.length === 4 &&
        input.shape[1] === 1 &&
        input.shape[2] === 224 &&
        input.shape[3] === 224 &&
        output.shape[1] === 1 &&
        output.shape[2] === 672 &&
        output.shape[3] === 672;

      if (!compatible) {
        throw new Error(
          "This model does not match the expected " +
          "224×224 to 672×672 single-channel format."
        );
      }

      aiReady = true;
      aiOption.disabled = false;

      report(
        "4/4: Model loaded",
        "AI Enhance is now available."
      );

      sync();
    } catch (error) {
      console.error("[AI TEST] FAILED:", error);

      aiReady = false;
      aiOption.disabled = true;

      if (select.value === "ai") {
        select.value = "original";
        sync();
      }

      report(
        "FAILED:",
        error?.message || String(error)
      );
    } finally {
      testButton.disabled = false;
    }
  });
}

/* ----------------------------------------
 * MediaPipe face detection
 * ---------------------------------------- */

async function getDetector() {
  if (detector) return detector;

  message("Loading local face detector...");

  const vision = await FilesetResolver.forVisionTasks(
    `${BASE}mediapipe/wasm`
  );

  detector = await FaceDetector.createFromOptions(
    vision,
    {
      baseOptions: {
        modelAssetPath:
          `${BASE}models/blaze_face_short_range.tflite`,
        delegate: "CPU"
      },
      runningMode: "IMAGE",
      minDetectionConfidence: 0.5
    }
  );

  return detector;
}

/* ----------------------------------------
 * Crop handling
 * ---------------------------------------- */

function normalizeCrop() {
  if (!crop || !photo) return;

  const w = imageWidth();
  const h = imageHeight();

  crop.size = clamp(
    crop.size,
    24,
    Math.min(w, h)
  );

  crop.x = clamp(crop.x, 0, w - crop.size);
  crop.y = clamp(crop.y, 0, h - crop.size);
}

function updateQualityInfo() {
  const element = $("faceCropQuality");

  if (!element || !crop || !photo) return;

  const pixels = Math.round(crop.size);
  const exportSize = Number(
    $("faceResolution")?.value || 1024
  );

  const scale = exportSize / pixels;

  const rating =
    pixels >= 800 ? "Good" :
    pixels >= 350 ? "Moderate" : "Low";

  element.textContent =
    `Source: ${imageWidth()} × ${imageHeight()} | ` +
    `Crop: ${pixels} × ${pixels} | ` +
    `Export: ${exportSize} × ${exportSize} | ` +
    `Scale: ${scale.toFixed(2)}× | ` +
    `Source detail: ${rating}`;
}

function updateCropUI() {
  const frame = $("faceCropFrame");

  if (!frame || !crop || !photo) return;

  normalizeCrop();

  frame.style.left =
    `${crop.x / imageWidth() * 100}%`;

  frame.style.top =
    `${crop.y / imageHeight() * 100}%`;

  frame.style.width =
    `${crop.size / imageWidth() * 100}%`;

  frame.style.height =
    `${crop.size / imageHeight() * 100}%`;

  updateQualityInfo();
  updateZoomControl();
}

function automaticCrop(index) {
  const box = faces[index]?.boundingBox;

  if (!box || !photo) return;

  const desiredSize = Math.max(
    box.width * 1.45,
    box.height * 1.55
  );

  const size = clamp(
    desiredSize,
    24,
    Math.min(imageWidth(), imageHeight())
  );

  const centerX = box.originX + box.width / 2;
  const centerY = box.originY + box.height * 0.55;

  crop = {
    x: centerX - size / 2,
    y: centerY - size / 2,
    size
  };

  normalizeCrop();
  updateCropUI();
}

function updateZoomControl() {
  const slider = $("faceZoom");

  if (!slider || !crop || !photo) return;

  const max = Math.min(
    imageWidth(),
    imageHeight()
  );

  const denominator = Math.log(max / 24);

  const value = denominator > 0
    ? 100 * Math.log(max / crop.size) / denominator
    : 0;

  slider.value = String(clamp(value, 0, 100));
}

function resizeCrop(factor) {
  if (!crop || !photo) return;

  const centerX = crop.x + crop.size / 2;
  const centerY = crop.y + crop.size / 2;

  crop.size = clamp(
    crop.size * factor,
    24,
    Math.min(imageWidth(), imageHeight())
  );

  crop.x = centerX - crop.size / 2;
  crop.y = centerY - crop.size / 2;

  normalizeCrop();
  updateCropUI();
}

function setZoom(value) {
  if (!crop || !photo) return;

  const max = Math.min(
    imageWidth(),
    imageHeight()
  );

  const size = max / Math.pow(
    max / 24,
    Number(value) / 100
  );

  resizeCrop(size / crop.size);
}

function selectFace(index) {
  if (!faces[index]) return;

  selected = index;
  automaticCrop(index);
  updatePersonPicker();
  clearCards();

  message(
    `Face ${index + 1} selected. Adjust the crop, then generate.`
  );
}

function updatePersonPicker() {
  const host = $("facePersonPicker");
  if (!host) return;

  host.replaceChildren();
  host.hidden = faces.length <= 1;

  if (faces.length <= 1) return;

  faces.forEach((face, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `Face ${index + 1}`;

    button.className =
      index === selected ? "active" : "";

    button.addEventListener("click", () => {
      if (!busy) selectFace(index);
    });

    host.appendChild(button);
  });
}

function installStyles() {
  if ($("faceEditorStyles")) return;

  const style = document.createElement("style");
  style.id = "faceEditorStyles";

  style.textContent = `
    #faceCropFrame {
      position: absolute;
      box-sizing: border-box;
      border: 2px solid #ffcf40;
      background: rgba(255,207,64,.04);
      box-shadow: 0 0 0 1px #0007;
      cursor: move;
      touch-action: none;
      z-index: 10;
    }

    #faceCropHandle {
      position: absolute;
      right: -10px;
      bottom: -10px;
      width: 23px;
      height: 23px;
      border-radius: 50%;
      background: #ffcf40;
      border: 2px solid #26364e;
      box-sizing: border-box;
      touch-action: none;
      cursor: nwse-resize;
    }

    .face-ai-comparison {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin: 12px 0;
      width: 100%;
    }

    .face-ai-comparison figure {
      margin: 0;
      min-width: 0;
    }

    .face-ai-comparison img {
      display: block;
      width: 100%;
      height: auto;
      border-radius: 8px;
    }

    .face-ai-comparison figcaption {
      font-size: .8rem;
      text-align: center;
      margin-top: 5px;
    }
  `;

  document.head.appendChild(style);
}

function installCropEditor() {
  const stage = document.querySelector(
    "#faceSelection .face-stage"
  );

  if (!stage || $("faceCropFrame")) return;

  const frame = document.createElement("div");
  frame.id = "faceCropFrame";

  frame.setAttribute("role", "group");
  frame.setAttribute(
    "aria-label",
    "Adjustable face crop"
  );

  const handle = document.createElement("div");
  handle.id = "faceCropHandle";

  handle.setAttribute(
    "aria-label",
    "Resize face crop"
  );

  frame.appendChild(handle);
  stage.appendChild(frame);

  frame.addEventListener("pointerdown", event => {
    if (!crop || !photo || busy) return;

    if (
      event.button !== undefined &&
      event.button !== 0
    ) return;

    event.preventDefault();

    const rect = stage.getBoundingClientRect();

    drag = {
      id: event.pointerId,
      mode: event.target === handle
        ? "resize"
        : "move",
      startX: event.clientX,
      startY: event.clientY,
      crop: { ...crop },
      scaleX: imageWidth() / rect.width,
      scaleY: imageHeight() / rect.height
    };

    frame.setPointerCapture(event.pointerId);
  });

  frame.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId) {
      return;
    }

    const dx =
      (event.clientX - drag.startX) *
      drag.scaleX;

    const dy =
      (event.clientY - drag.startY) *
      drag.scaleY;

    if (drag.mode === "move") {
      crop.x = drag.crop.x + dx;
      crop.y = drag.crop.y + dy;
      crop.size = drag.crop.size;
    } else {
      const delta = Math.max(dx, dy);

      crop.x = drag.crop.x;
      crop.y = drag.crop.y;

      crop.size = clamp(
        drag.crop.size + delta,
        24,
        Math.min(
          imageWidth() - crop.x,
          imageHeight() - crop.y
        )
      );
    }

    normalizeCrop();
    updateCropUI();
  });

  const finish = event => {
    if (drag?.id === event.pointerId) {
      drag = null;
    }
  };

  frame.addEventListener("pointerup", finish);
  frame.addEventListener("pointercancel", finish);
  frame.addEventListener("lostpointercapture", () => {
    drag = null;
  });
}

/* ----------------------------------------
 * Photo detection
 * ---------------------------------------- */

async function detectFaces() {
  const file = $("faceFile")?.files?.[0];

  if (!file) {
    throw new Error("Choose a photo first.");
  }

  const allowed = [
    "image/jpeg",
    "image/png",
    "image/webp"
  ];

  if (
    !allowed.includes(file.type) ||
    file.size > MAX_FILE_BYTES
  ) {
    throw new Error(
      "Choose a PNG, JPEG or WebP photo under 20 MB."
    );
  }

  reset();

  const currentGeneration = generation;

  sourceURL = URL.createObjectURL(file);
  photo = new Image();
  photo.src = sourceURL;

  const loadedPhoto = photo;
  await loadedPhoto.decode();

  if (currentGeneration !== generation) return;

  sourceInfo.fileName = file.name;
  sourceInfo.fileSize = file.size;

  if (
    imageWidth() * imageHeight() >
    MAX_IMAGE_PIXELS
  ) {
    throw new Error(
      "Photo exceeds the 20-megapixel limit."
    );
  }

  updateSourceDiagnostics();

  console.info("Face Studio diagnostics", {
    version: VERSION,
    fileName: file.name,
    decodedWidth: imageWidth(),
    decodedHeight: imageHeight()
  });

  message("Detecting faces on this device...");

  const localDetector = await getDetector();

  if (currentGeneration !== generation) return;

  const result = localDetector.detect(photo);

  faces = (result.detections || []).filter(
    item =>
      item.boundingBox?.width > 0 &&
      item.boundingBox?.height > 0
  );

  if (!faces.length) {
    message(
      "No faces detected. Try a clearer photograph."
    );
    return;
  }

  $("faceSourcePreview").src = sourceURL;
  $("faceSelection").hidden = false;

  selected = 0;
  $("faceBoxes")?.replaceChildren();

  automaticCrop(0);
  updatePersonPicker();

  message(
    `${faces.length} face(s) detected. Adjust the crop.`
  );
}

/* ----------------------------------------
 * Original image rendering
 * ---------------------------------------- */

function renderWorkingCrop(outputSize) {
  if (!photo || !crop) {
    throw new Error(
      "Detect and select a face first."
    );
  }

  const sourceSize = crop.size;

  if (sourceSize <= outputSize * 2) {
    const output = newCanvas(outputSize);
    const ctx = getContext(output);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.drawImage(
      photo,
      crop.x,
      crop.y,
      sourceSize,
      sourceSize,
      0,
      0,
      outputSize,
      outputSize
    );

    return output;
  }

  let stepSize = Math.min(
    Math.ceil(sourceSize / 2),
    4096
  );

  let current = newCanvas(stepSize);
  let ctx = getContext(current);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  ctx.drawImage(
    photo,
    crop.x,
    crop.y,
    sourceSize,
    sourceSize,
    0,
    0,
    stepSize,
    stepSize
  );

  while (stepSize > outputSize * 2) {
    const nextSize = Math.max(
      outputSize,
      Math.ceil(stepSize / 2)
    );

    const next = drawScaled(current, nextSize);
    releaseCanvas(current);

    current = next;
    stepSize = nextSize;
  }

  if (stepSize === outputSize) return current;

  const output = drawScaled(current, outputSize);
  releaseCanvas(current);

  return output;
}

/* ----------------------------------------
 * Classic sharpening
 * ---------------------------------------- */

function enhanceClassic(canvas, strength) {
  if (strength === "natural" || !strength) {
    return;
  }

  // Preserve existing memory-conscious 4K behavior.
  if (canvas.width > 2048) return;

  const ctx = getContext(canvas, {
    willReadFrequently: true
  });

  const w = canvas.width;
  const h = canvas.height;

  const original = ctx.getImageData(0, 0, w, h);
  const src = original.data;

  const result = ctx.createImageData(w, h);
  const dst = result.data;

  const amount =
    strength === "strong" ? 0.20 : 0.10;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;

      const left =
        (y * w + Math.max(0, x - 1)) * 4;

      const right =
        (y * w + Math.min(w - 1, x + 1)) * 4;

      const up =
        (Math.max(0, y - 1) * w + x) * 4;

      const down =
        (Math.min(h - 1, y + 1) * w + x) * 4;

      for (let c = 0; c < 3; c++) {
        const center = src[i + c];

        const blur = (
          4 * center +
          src[left + c] +
          src[right + c] +
          src[up + c] +
          src[down + c]
        ) / 8;

        dst[i + c] = clamp(
          Math.round(
            center + amount * (center - blur)
          ),
          0,
          255
        );
      }

      dst[i + 3] = src[i + 3];
    }
  }

  ctx.putImageData(result, 0, 0);
}

async function renderStandardBlob(size, strength) {
  const output = renderWorkingCrop(size);

  try {
    enhanceClassic(output, strength);
    return await canvasToBlob(output);
  } finally {
    releaseCanvas(output);
  }
}

/* ----------------------------------------
 * AI inference and comparison
 * ---------------------------------------- */

async function renderAIBlob(size) {
  if (!aiReady) {
    throw new Error(
      "Check offline AI engine before using AI Enhance."
    );
  }

  // The model has a fixed 224 x 224 input.
  const input = renderWorkingCrop(224);

  let enhanced = null;
  let output = null;
  let originalPreview = null;

  try {
    message("Running offline AI enhancement...");

    enhanced = await enhanceFaceCanvas(
      input,
      status => message(status)
    );

    const aiPreviewBlob =
      await canvasToBlob(enhanced);

    originalPreview = renderWorkingCrop(672);

    const originalPreviewBlob =
      await canvasToBlob(originalPreview);

    if (size === 672) {
      output = enhanced;
      enhanced = null;
    } else {
      output = drawScaled(enhanced, size);
    }

    message(
      `Exporting AI-enhanced ${size} × ${size} PNG...`
    );

    const blob = await canvasToBlob(output);

    return {
      blob,
      originalPreviewBlob,
      aiPreviewBlob
    };
  } finally {
    releaseCanvas(input);
    releaseCanvas(enhanced);
    releaseCanvas(output);
    releaseCanvas(originalPreview);
  }
}

function registerBlob(blob) {
  const url = URL.createObjectURL(blob);
  cardURLs.push(url);
  return url;
}

function createComparison(
  originalBlob,
  aiBlob
) {
  const container = document.createElement("div");
  container.className = "face-ai-comparison";

  const items = [
    {
      label: "Original (672px preview)",
      blob: originalBlob
    },
    {
      label: "AI Enhanced (672px)",
      blob: aiBlob
    }
  ];

  for (const item of items) {
    const figure = document.createElement("figure");
    const image = document.createElement("img");
    const caption = document.createElement("figcaption");

    image.src = registerBlob(item.blob);
    image.alt = item.label;
    image.loading = "lazy";

    caption.textContent = item.label;

    figure.append(image, caption);
    container.appendChild(figure);
  }

  return container;
}

/* ----------------------------------------
 * Face card creation
 * ---------------------------------------- */

async function makeCard(index) {
  if (!faces[index]) {
    throw new Error(
      "Select a detected face first."
    );
  }

  if (index !== selected) {
    automaticCrop(index);
  }

  const size = Number(
    $("faceResolution")?.value || 1024
  );

  if (![512, 1024, 2048, 4096].includes(size)) {
    throw new Error("Invalid card resolution.");
  }

  const mode =
    $("faceEnhancementMode")?.value || "original";

  const strength =
    mode === "classic"
      ? ($("faceStrength")?.value || "balanced")
      : "natural";

  message(
    `Rendering ${size} × ${size} face card locally...`
  );

  let blob;
  let comparison = null;

  if (mode === "ai") {
    const result = await renderAIBlob(size);

    blob = result.blob;

    comparison = createComparison(
      result.originalPreviewBlob,
      result.aiPreviewBlob
    );
  } else {
    blob = await renderStandardBlob(
      size,
      strength
    );
  }

  const url = registerBlob(blob);

  const item = document.createElement("div");
  item.className = "face-card-item";

  const preview = document.createElement("img");
  preview.src = url;
  preview.alt = `Face ${index + 1} card`;

  const title = document.createElement("strong");
  title.textContent =
    `Face ${index + 1} — ${size} × ${size}`;

  const download = document.createElement("a");
  download.href = url;

  download.download =
    `protext-face-${index + 1}-${size}-${mode}.png`;

  download.textContent = "Save face card";

  item.append(preview, title);

  if (comparison) {
    item.appendChild(comparison);
  }

  item.appendChild(download);
  $("faceCards").appendChild(item);
}

async function createSelectedCard() {
  if (!faces.length || !crop) {
    throw new Error("Detect a face first.");
  }

  clearCards();

  await makeCard(selected);

  message(
    "Face card generated locally. " +
    "You can adjust the crop and regenerate."
  );
}

async function createAllCards() {
  if (!faces.length) {
    throw new Error("Detect faces first.");
  }

  clearCards();

  const originalSelected = selected;
  const originalCrop = { ...crop };

  try {
    for (let index = 0; index < faces.length; index++) {
      selected = index;

      if (index === originalSelected) {
        crop = { ...originalCrop };
      } else {
        automaticCrop(index);
      }

      await makeCard(index);
    }
  } finally {
    selected = originalSelected;
    crop = originalCrop;

    updateCropUI();
    updatePersonPicker();
  }

  message(
    `${faces.length} face card(s) generated locally.`
  );
}

/* ----------------------------------------
 * Action handling
 * ---------------------------------------- */

async function run(action) {
  if (busy) return;

  busy = true;

  const buttons = [
    $("faceDetectBtn"),
    $("faceCreateBtn"),
    $("faceCreateAllBtn")
  ].filter(Boolean);

  buttons.forEach(button => {
    button.disabled = true;
  });

  try {
    await action();
  } catch (error) {
    console.error("Face Studio:", error);

    message(
      "Face processing failed: " +
      (error?.message || String(error))
    );
  } finally {
    busy = false;

    buttons.forEach(button => {
      button.disabled = false;
    });
  }
}

/* ----------------------------------------
 * Initialization
 * ---------------------------------------- */

function init() {
  if (!$("imageFaceOptions")) return;

  installStyles();
  installCropEditor();
  installEnhancementMode();

  const resolution = $("faceResolution");

  if (resolution) {
    const sizes = [
      ["2048", "2048 × 2048 (2K)"],
      ["4096", "4096 × 4096 (4K, slower)"]
    ];

    for (const [value, label] of sizes) {
      const exists = Array.from(
        resolution.options
      ).some(option => option.value === value);

      if (!exists) {
        resolution.add(new Option(label, value));
      }
    }
  }

  $("faceDetectBtn")?.addEventListener(
    "click",
    () => run(detectFaces)
  );

  $("faceCreateBtn")?.addEventListener(
    "click",
    () => run(createSelectedCard)
  );

  $("faceCreateAllBtn")?.addEventListener(
    "click",
    () => run(createAllCards)
  );

  const fileInput = $("faceFile");
  const choose = $("faceChooseBtn");
  const summary = $("faceFileSummary");
  const thumb = $("faceFileThumb");
  const detect = $("faceDetectBtn");

  function clearUpload() {
    generation++;
    reset();

    if (fileInput) fileInput.value = "";

    if (thumbnailURL) {
      URL.revokeObjectURL(thumbnailURL);
      thumbnailURL = null;
    }

    if (thumb) {
      thumb.removeAttribute("src");
    }

    if (summary) summary.hidden = true;
    if (choose) choose.hidden = false;
    if (detect) detect.disabled = true;
  }

  choose?.addEventListener("click", () => {
    if (!busy) fileInput?.click();
  });

  $("faceReplaceBtn")?.addEventListener(
    "click",
    () => {
      if (!busy) fileInput?.click();
    }
  );

  $("faceRemoveBtn")?.addEventListener(
    "click",
    () => {
      if (!busy) clearUpload();
    }
  );

  fileInput?.addEventListener("change", () => {
    if (busy) return;

    const file = fileInput.files?.[0];
    if (!file) return;

    generation++;
    reset();

    if (thumbnailURL) {
      URL.revokeObjectURL(thumbnailURL);
    }

    thumbnailURL = URL.createObjectURL(file);

    if (thumb) thumb.src = thumbnailURL;

    const name = $("faceFileName");

    if (name) name.textContent = file.name;

    const details = $("faceFileDetails");

    if (details) {
      details.textContent =
        `${(file.size / 1048576).toFixed(1)} MB · Ready to detect`;
    }

    if (summary) summary.hidden = false;
    if (choose) choose.hidden = true;
    if (detect) detect.disabled = false;

    message(
      "Photo attached. Tap Detect faces to begin."
    );
  });

  $("faceZoom")?.addEventListener(
    "input",
    event => {
      if (!busy) setZoom(event.target.value);
    }
  );

  $("faceResetCrop")?.addEventListener(
    "click",
    () => {
      if (!busy) automaticCrop(selected);
    }
  );

  $("faceResolution")?.addEventListener(
    "change",
    updateQualityInfo
  );

  window.addEventListener("pagehide", reset);
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    init,
    { once: true }
  );
} else {
  init();
}
