
/*
 * ProText AI — Face Studio 1.3
 *
 * Fully offline face card processing.
 *
 * Features:
 * - Local MediaPipe face detection
 * - Multiple-face selection
 * - Single adjustable square crop
 * - Drag to move crop
 * - Drag corner handle to resize
 * - Zoom slider and crop reset
 * - Photo thumbnail, replace and remove
 * - Source-resolution quality indicator
 * - Progressive image resizing
 * - Memory-conscious sharpening
 * - 512, 1024, 2048 and 4096 PNG export
 *
 * MediaPipe model and WASM files must be hosted locally.
 */

import {
  FaceDetector,
  FilesetResolver
} from "@mediapipe/tasks-vision";

const $ = id => document.getElementById(id);

const BASE = import.meta.env.BASE_URL;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 20_000_000;

let detector = null;
let photo = null;
let sourceURL = null;
let thumbnailURL = null;
let faceGeneration = 0;

let faces = [];
let selected = 0;
let crop = null;

let cardURLs = [];
let busy = false;
let drag = null;

function message(text) {
  const el = $("faceStatus");
  if (el) el.textContent = text;
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

/*
 * Crop coordinates are stored in original
 * image pixels to preserve source quality.
 */

function normalizeCrop() {
  if (!crop || !photo) return;

  const w = imageWidth();
  const h = imageHeight();

  crop.size = clamp(
    crop.size,
    24,
    Math.min(w, h)
  );

  crop.x = clamp(
    crop.x,
    0,
    w - crop.size
  );

  crop.y = clamp(
    crop.y,
    0,
    h - crop.size
  );
}

function automaticCrop(faceIndex) {
  const box = faces[faceIndex]?.boundingBox;

  if (!box || !photo) return;

  const w = imageWidth();
  const h = imageHeight();

  const desiredSize = Math.max(
    box.width * 1.45,
    box.height * 1.55
  );

  const size = clamp(
    desiredSize,
    24,
    Math.min(w, h)
  );

  const centerX =
    box.originX + box.width / 2;

  const centerY =
    box.originY + box.height * 0.55;

  crop = {
    x: centerX - size / 2,
    y: centerY - size / 2,
    size
  };

  normalizeCrop();
  updateCropUI();
}

function selectFace(index) {
  if (!faces[index]) return;

  selected = index;

  automaticCrop(index);
  drawFaceBoxes();
  updatePersonPicker();
  clearCards();

  message(
    `Face ${index + 1} selected. Adjust the crop, then generate the card.`
  );
}

function drawFaceBoxes() {
  // Only the editable crop frame is displayed.
  $("faceBoxes")?.replaceChildren();
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

    button.addEventListener(
      "click",
      () => selectFace(index)
    );

    host.appendChild(button);
  });
}

function updateQualityInfo() {
  const el = $("faceCropQuality");

  if (!el || !crop) return;

  const pixels = Math.round(crop.size);

  let rating;
  let explanation;

  if (pixels >= 800) {
    rating = "Good source resolution";
    explanation =
      "The selected crop contains substantial source detail.";
  } else if (pixels >= 350) {
    rating = "Moderate source resolution";
    explanation =
      "Some enlargement is needed for larger cards.";
  } else {
    rating = "Low source resolution";
    explanation =
      "Enlargement cannot recover missing facial details.";
  }

  el.textContent =
    `${rating} — ${pixels} × ${pixels} source pixels. ${explanation}`;
}

function updateCropUI() {
  const frame = $("faceCropFrame");

  if (!frame || !crop || !photo) return;

  normalizeCrop();

  const w = imageWidth();
  const h = imageHeight();

  frame.style.left =
    `${crop.x / w * 100}%`;

  frame.style.top =
    `${crop.y / h * 100}%`;

  frame.style.width =
    `${crop.size / w * 100}%`;

  frame.style.height =
    `${crop.size / h * 100}%`;

  updateQualityInfo();
  updateZoomControl();
}

function moveCrop(dx, dy) {
  if (!crop) return;

  crop.x += dx;
  crop.y += dy;

  normalizeCrop();
  updateCropUI();
}

function resizeCrop(factor) {
  if (!crop) return;

  const centerX =
    crop.x + crop.size / 2;

  const centerY =
    crop.y + crop.size / 2;

  const newSize = clamp(
    crop.size * factor,
    24,
    Math.min(imageWidth(), imageHeight())
  );

  crop.size = newSize;
  crop.x = centerX - newSize / 2;
  crop.y = centerY - newSize / 2;

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

  const value =
    100 *
    Math.log(max / crop.size) /
    Math.log(max / 24);

  slider.value = String(
    clamp(value, 0, 100)
  );
}

function setZoom(value) {
  if (!crop || !photo) return;

  const max = Math.min(
    imageWidth(),
    imageHeight()
  );

  const size =
    max /
    Math.pow(
      max / 24,
      Number(value) / 100
    );

  resizeCrop(size / crop.size);
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

  frame.addEventListener(
    "pointerdown",
    event => {
      if (!crop || !photo) return;

      if (
        event.button !== undefined &&
        event.button !== 0
      ) {
        return;
      }

      event.preventDefault();

      const rect =
        stage.getBoundingClientRect();

      drag = {
        id: event.pointerId,
        mode:
          event.target === handle
            ? "resize"
            : "move",
        startX: event.clientX,
        startY: event.clientY,
        crop: { ...crop },
        scaleX:
          imageWidth() / rect.width,
        scaleY:
          imageHeight() / rect.height
      };

      frame.setPointerCapture(
        event.pointerId
      );
    }
  );

  frame.addEventListener(
    "pointermove",
    event => {
      if (
        !drag ||
        drag.id !== event.pointerId
      ) {
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
    }
  );

  const finishDrag = event => {
    if (drag?.id === event.pointerId) {
      drag = null;
    }
  };

  frame.addEventListener(
    "pointerup",
    finishDrag
  );

  frame.addEventListener(
    "pointercancel",
    finishDrag
  );

  frame.addEventListener(
    "lostpointercapture",
    () => {
      drag = null;
    }
  );
}

async function detectFaces() {
  const file =
    $("faceFile")?.files?.[0];

  if (!file) {
    throw new Error(
      "Choose a photo first."
    );
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

  const generation = faceGeneration;

  sourceURL =
    URL.createObjectURL(file);

  photo = new Image();
  photo.src = sourceURL;

  const loadedPhoto = photo;

  await loadedPhoto.decode();

  if (generation !== faceGeneration) {
    return;
  }

  if (
    imageWidth() * imageHeight() >
    MAX_IMAGE_PIXELS
  ) {
    throw new Error(
      "Photo exceeds the 20-megapixel limit."
    );
  }

  message(
    "Detecting faces on this device..."
  );

  const localDetector =
    await getDetector();

  if (generation !== faceGeneration) {
    return;
  }

  const result =
    localDetector.detect(photo);

  faces = (
    result.detections || []
  ).filter(
    detection =>
      detection.boundingBox?.width > 0 &&
      detection.boundingBox?.height > 0
  );

  if (!faces.length) {
    message(
      "No faces detected. Try a clearer photo with visible faces."
    );
    return;
  }

  $("faceSourcePreview").src =
    sourceURL;

  $("faceSelection").hidden = false;

  selected = 0;

  drawFaceBoxes();
  automaticCrop(0);
  updatePersonPicker();

  message(
    `${faces.length} face(s) detected. Select a face and adjust its crop.`
  );
}

/*
 * Face Studio 1.3 rendering.
 *
 * Work at a maximum of 2048 pixels.
 * Apply sharpening before final 4K enlargement.
 *
 * This avoids creating several full-resolution
 * 4096px processing buffers.
 */

function newCanvas(size) {
  const canvas =
    document.createElement("canvas");

  canvas.width = size;
  canvas.height = size;

  return canvas;
}

function drawScaled(source, size) {
  const next = newCanvas(size);

  const ctx = next.getContext(
    "2d",
    { alpha: false }
  );

  if (!ctx) {
    throw new Error(
      "Canvas processing is unavailable."
    );
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  ctx.drawImage(
    source,
    0,
    0,
    size,
    size
  );

  return next;
}

function renderWorkingCrop(outputSize) {
  if (!photo || !crop) {
    throw new Error("Detect and select a face first.");
  }

  const sourceSize = crop.size;

  // Draw directly from the original photo when possible.
  // This preserves detail for 512, 1024, 2048 and 4096.
  if (sourceSize <= outputSize * 2) {
    const output = newCanvas(outputSize);
    const ctx = output.getContext("2d");

    if (!ctx) {
      throw new Error("Canvas processing is unavailable.");
    }

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

  // Progressive downscaling for large source crops.
  let stepSize = Math.min(
    Math.ceil(sourceSize / 2),
    4096
  );

  let current = newCanvas(stepSize);
  let ctx = current.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas processing is unavailable.");
  }

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

    current.width = 0;
    current.height = 0;

    current = next;
    stepSize = nextSize;
  }

  if (stepSize === outputSize) {
    return current;
  }

  const output = drawScaled(current, outputSize);

  current.width = 0;
  current.height = 0;

  return output;
}

/*
 * Tile-based sharpening.
 *
 * Reads only a small image strip at a time,
 * rather than a complete 4K RGBA pixel array.
 */

function enhance(canvas, strength) {
  if (strength === "natural" || !strength) {
    return;
  }

  // Preserve full 4K detail.
  // Avoid a forced 2K sharpening/downscaling stage.
  if (canvas.width > 2048) {
    return;
  }

  const ctx = canvas.getContext("2d", {
    willReadFrequently: true
  });

  if (!ctx) {
    throw new Error("Image enhancement is unavailable.");
  }

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

function canvasToBlob(canvas) {
  return new Promise(
    (resolve, reject) => {
      canvas.toBlob(
        blob => {
          if (blob) {
            resolve(blob);
          } else {
            reject(
              new Error(
                "PNG export failed."
              )
            );
          }
        },
        "image/png"
      );
    }
  );
}

async function renderCardBlob(size, strength) {
  const output = renderWorkingCrop(size);

  try {
    enhance(output, strength);

    return await canvasToBlob(output);
  } finally {
    output.width = 0;
    output.height = 0;
  }
}

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
    $("faceResolution")?.value ||
    1024
  );

  if (
    ![
      512,
      1024,
      2048,
      4096
    ].includes(size)
  ) {
    throw new Error(
      "Invalid card resolution."
    );
  }

  const strength =
    $("faceStrength")?.value ||
    "balanced";

  message(
    `Rendering ${size} × ${size} face card locally...`
  );

  const blob =
    await renderCardBlob(
      size,
      strength
    );

  const url =
    URL.createObjectURL(blob);

  cardURLs.push(url);

  const item =
    document.createElement("div");

  item.className =
    "face-card-item";

  const preview =
    document.createElement("img");

  preview.src = url;
  preview.alt =
    `Face ${index + 1} card`;

  const title =
    document.createElement("strong");

  title.textContent =
    `Face ${index + 1} — ${size} × ${size}`;

  const download =
    document.createElement("a");

  download.href = url;

  download.download =
    `protext-face-${index + 1}-${size}.png`;

  download.textContent =
    "Save face card";

  item.append(
    preview,
    title,
    download
  );

  $("faceCards").appendChild(
    item
  );
}

async function createSelectedCard() {
  if (!faces.length || !crop) {
    throw new Error(
      "Detect a face first."
    );
  }

  clearCards();

  await makeCard(selected);

  message(
    "Face card generated locally. You can adjust the crop and regenerate it."
  );
}

async function createAllCards() {
  if (!faces.length) {
    throw new Error(
      "Detect faces first."
    );
  }

  clearCards();

  const originalSelected =
    selected;

  const originalCrop =
    { ...crop };

  try {
    for (
      let index = 0;
      index < faces.length;
      index++
    ) {
      selected = index;

      if (
        index === originalSelected
      ) {
        crop = {
          ...originalCrop
        };
      } else {
        automaticCrop(index);
      }

      await makeCard(index);
    }
  } finally {
    selected =
      originalSelected;

    crop =
      originalCrop;

    drawFaceBoxes();
    updateCropUI();
    updatePersonPicker();
  }

  message(
    `${faces.length} face card(s) generated locally.`
  );
}

async function run(action) {
  if (busy) return;

  busy = true;

  const buttons = [
    $("faceDetectBtn"),
    $("faceCreateBtn"),
    $("faceCreateAllBtn")
  ].filter(Boolean);

  buttons.forEach(
    button => {
      button.disabled = true;
    }
  );

  try {
    await action();
  } catch (error) {
    console.error(
      "Face Cards:",
      error
    );

    message(
      "Face processing failed: " +
      (
        error?.message ||
        String(error)
      )
    );
  } finally {
    busy = false;

    buttons.forEach(
      button => {
        button.disabled = false;
      }
    );
  }
}

function init() {
  if (!$("imageFaceOptions")) {
    return;
  }

  installStyles();
  installCropEditor();

  const resolution =
    $("faceResolution");

  // Preserve existing export options.
  // Add 2K and 4K if not already present.

  if (resolution) {
    const sizes = [
      [
        "2048",
        "2048 × 2048 (2K)"
      ],
      [
        "4096",
        "4096 × 4096 (4K, slower)"
      ]
    ];

    for (
      const [value, label]
      of sizes
    ) {
      const exists =
        Array.from(
          resolution.options
        ).some(
          option =>
            option.value === value
        );

      if (!exists) {
        const option =
          document.createElement(
            "option"
          );

        option.value = value;
        option.textContent = label;

        resolution.appendChild(
          option
        );
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

  const fileInput =
    $("faceFile");

  const choose =
    $("faceChooseBtn");

  const summary =
    $("faceFileSummary");

  const thumb =
    $("faceFileThumb");

  const detect =
    $("faceDetectBtn");

  function clearUpload() {
    faceGeneration++;

    reset();

    if (fileInput) {
      fileInput.value = "";
    }

    if (thumbnailURL) {
      URL.revokeObjectURL(
        thumbnailURL
      );
    }

    thumbnailURL = null;

    if (thumb) {
      thumb.removeAttribute(
        "src"
      );
    }

    if (summary) {
      summary.hidden = true;
    }

    if (choose) {
      choose.hidden = false;
    }

    if (detect) {
      detect.disabled = true;
    }
  }

  choose?.addEventListener(
    "click",
    () => fileInput?.click()
  );

  $("faceReplaceBtn")?.addEventListener(
    "click",
    () => fileInput?.click()
  );

  $("faceRemoveBtn")?.addEventListener(
    "click",
    clearUpload
  );

  fileInput?.addEventListener(
    "change",
    () => {
      const file =
        fileInput.files?.[0];

      if (!file) return;

      faceGeneration++;

      reset();

      if (thumbnailURL) {
        URL.revokeObjectURL(
          thumbnailURL
        );
      }

      thumbnailURL =
        URL.createObjectURL(
          file
        );

      if (thumb) {
        thumb.src =
          thumbnailURL;
      }

      const name =
        $("faceFileName");

      if (name) {
        name.textContent =
          file.name;
      }

      const details =
        $("faceFileDetails");

      if (details) {
        details.textContent =
          `${(
            file.size /
            1024 /
            1024
          ).toFixed(1)} MB · Ready to detect`;
      }

      if (summary) {
        summary.hidden = false;
      }

      if (choose) {
        choose.hidden = true;
      }

      if (detect) {
        detect.disabled = false;
      }

      message(
        "Photo attached. Tap Detect faces to begin."
      );
    }
  );

  $("faceZoom")?.addEventListener(
    "input",
    event => {
      setZoom(
        event.target.value
      );
    }
  );

  $("faceResetCrop")?.addEventListener(
    "click",
    () => automaticCrop(selected)
  );

  window.addEventListener(
    "pagehide",
    reset
  );
}

if (
  document.readyState ===
  "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    init,
    { once: true }
  );
} else {
  init();
}
