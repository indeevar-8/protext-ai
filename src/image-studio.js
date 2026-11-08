
// ProText AI Image Studio
// Offline presets + optional Cloudflare AI editing.

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;
const ONLINE_MAX_DIMENSION = 384;
const ONLINE_MAX_BYTES = 1024 * 1024;

const WORKER_URL =
  "https://round-dawn-4989.indeevartummala8.workers.dev/edit";

const SUPPORTED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp"
]);

const $ = (id) => document.getElementById(id);

let originalUrl = null;
let resultUrl = null;
let processing = false;

function status(message) {
  const element = $("imageStatus");
  if (element) element.textContent = message;
}

function releaseResults() {
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  if (resultUrl) URL.revokeObjectURL(resultUrl);

  originalUrl = null;
  resultUrl = null;

  $("imageComparison").hidden = true;
  $("imageDownload").removeAttribute("href");
}

function showResult(original, edited, message) {
  releaseResults();

  originalUrl = URL.createObjectURL(original);
  resultUrl = URL.createObjectURL(edited);

  $("imageOriginal").src = originalUrl;
  $("imageResult").src = resultUrl;

  const download = $("imageDownload");
  download.href = resultUrl;
  download.download = "protext-ai-edited.png";

  $("imageComparison").hidden = false;
  status(message);
}

function requestedPreset(prompt, selected) {
  const p = prompt.toLowerCase().trim();

  if (!p) return selected;

  const rules = [
    [
      /\b(?:black and white|grayscale|greyscale|monochrome)\b/,
      "grayscale"
    ],
    [
      /\b(?:brighten|brighter|lighten|exposure)\b/,
      "bright"
    ],
    [
      /\b(?:contrast|punchier)\b/,
      "contrast"
    ],
    [
      /\b(?:enhance|improve|natural|color|colour|clarity)\b/,
      "auto"
    ]
  ];

  const match = rules.find(([pattern]) => pattern.test(p));

  const unsupported =
    /\b(remove|erase|replace|change background|add person|generate|create|restore face|upscale|sharpen text|fix blur)\b/i.test(p);

  if (unsupported) {
    throw new Error(
      "This prompt needs advanced AI editing. " +
      "Local mode supports only brightness, contrast, " +
      "grayscale, and natural enhancement."
    );
  }

  if (!match && selected === "auto") {
    throw new Error(
      "This prompt cannot be performed accurately " +
      "by local filters. Select a supported preset " +
      "or use online AI."
    );
  }

  return match ? match[1] : selected;
}

function applyPixels(data, preset) {
  const a = data.data;

  for (let i = 0; i < a.length; i += 4) {
    let r = a[i];
    let g = a[i + 1];
    let b = a[i + 2];

    if (preset === "grayscale") {
      const y = .2126 * r + .7152 * g + .0722 * b;
      r = g = b = y;
    } else if (preset === "bright") {
      r = r * 1.08 + 12;
      g = g * 1.08 + 12;
      b = b * 1.08 + 12;
    } else if (preset === "contrast") {
      r = (r - 128) * 1.17 + 128;
      g = (g - 128) * 1.17 + 128;
      b = (b - 128) * 1.17 + 128;
    } else if (preset === "auto") {
      r = (r - 128) * 1.07 + 133;
      g = (g - 128) * 1.07 + 133;
      b = (b - 128) * 1.07 + 133;
    }

    a[i] = Math.max(0, Math.min(255, r));
    a[i + 1] = Math.max(0, Math.min(255, g));
    a[i + 2] = Math.max(0, Math.min(255, b));
  }
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === "function") {
    return await createImageBitmap(file, {
      imageOrientation: "from-image"
    });
  }

  const url = URL.createObjectURL(file);

  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function localEdit(file, prompt, preset) {
  const chosen = requestedPreset(prompt, preset);
  const bitmap = await loadBitmap(file);

  try {
    const w = bitmap.width;
    const h = bitmap.height;

    if (!w || !h || w * h > MAX_PIXELS) {
      throw new Error(
        "Image dimensions are too large. " +
        "Please use an image under 16 megapixels."
      );
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d", {
      willReadFrequently: true
    });

    if (!ctx) {
      throw new Error("Canvas processing is unavailable.");
    }

    ctx.drawImage(bitmap, 0, 0);

    if (chosen !== "original") {
      const pixels = ctx.getImageData(0, 0, w, h);
      applyPixels(pixels, chosen);
      ctx.putImageData(pixels, 0, 0);
    }

    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob
          ? resolve(blob)
          : reject(new Error("Could not export image.")),
        "image/png"
      );
    });
  } finally {
    if (typeof bitmap.close === "function") {
      bitmap.close();
    }
  }
}

// Prepare a smaller image entirely on the device.
// Only the resized JPEG is uploaded.
async function prepareOnlineImage(file) {
  const bitmap = await loadBitmap(file);

  try {
    const width = bitmap.width;
    const height = bitmap.height;

    if (!width || !height) {
      throw new Error("Could not read image dimensions.");
    }

    const scale = Math.min(
      1,
      ONLINE_MAX_DIMENSION / Math.max(width, height)
    );

    const newWidth = Math.max(1, Math.round(width * scale));
    const newHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = newWidth;
    canvas.height = newHeight;

    const ctx = canvas.getContext("2d");

    if (!ctx) {
      throw new Error("Image resizing is unavailable.");
    }

    ctx.drawImage(
      bitmap,
      0,
      0,
      newWidth,
      newHeight
    );

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => result
          ? resolve(result)
          : reject(new Error("Could not prepare image.")),
        "image/jpeg",
        0.85
      );
    });

    if (blob.size > ONLINE_MAX_BYTES) {
      throw new Error(
        "Prepared image exceeds the online size limit."
      );
    }

    return new File(
      [blob],
      "protext-upload.jpg",
      { type: "image/jpeg" }
    );
  } finally {
    if (typeof bitmap.close === "function") {
      bitmap.close();
    }
  }
}

async function onlineEdit(file, prompt) {
  if (!navigator.onLine) {
    throw new Error(
      "You appear to be offline. " +
      "Switch to local mode or connect to the internet."
    );
  }

  if (!prompt.trim()) {
    throw new Error(
      "Enter instructions for the AI image edit."
    );
  }

  if (prompt.length > 1000) {
    throw new Error(
      "Online prompts must be 1000 characters or fewer."
    );
  }

  // Private testing only. Never hardcode this key.
  const accessKey = window.prompt(
    "Enter your private Image Studio access key.\n" +
    "It will be used for this request only."
  );

  if (accessKey === null) {
    throw new Error("Online image editing cancelled.");
  }

  if (!accessKey.trim()) {
    throw new Error("An access key is required.");
  }

  status("Preparing image securely on your device...");

  const prepared = await prepareOnlineImage(file);

  const form = new FormData();
  form.append("image", prepared);
  form.append("prompt", prompt.trim());

  status("Uploading approved image for AI editing...");

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    120000
  );

  try {
    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: {
        "X-Image-Access-Key": accessKey
      },
      body: form,
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      let message = `Online editing failed (HTTP ${response.status}).`;

      try {
        const error = await response.json();
        if (error?.error) {
          message += ` ${error.error}`;
        }
        if (error?.detail) {
          message += ` ${error.detail}`;
        }
      } catch {
        // Keep the HTTP error message.
      }

      throw new Error(message);
    }

    const contentType =
      response.headers.get("Content-Type") || "";

    if (!contentType.startsWith("image/")) {
      throw new Error(
        "The AI service did not return an image."
      );
    }

    const result = await response.blob();

    if (!result.size) {
      throw new Error("The AI returned an empty image.");
    }

    return result;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        "The AI request timed out. Please try again."
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function initImageStudio() {
  const mode = $("imageMode");
  const fileInput = $("imageFile");
  const process = $("imageProcess");

  if (!mode || !fileInput || !process) return;

  mode.addEventListener("change", () => {
    $("imageLocalOptions").hidden =
      mode.value !== "local";

    $("imageOnlineOptions").hidden =
      mode.value !== "online";

    $("imageConsent").checked = false;

    releaseResults();
    status("");
  });

  fileInput.addEventListener("change", () => {
    releaseResults();
    status("");
  });

  process.addEventListener("click", async () => {
    if (processing) return;

    const file = fileInput.files?.[0];

    if (!file) {
      return status("Choose an image first.");
    }

    if (!SUPPORTED.has(file.type)) {
      return status("Choose a PNG, JPEG, or WebP image.");
    }

    if (file.size > MAX_BYTES) {
      return status("Choose an image smaller than 20 MB.");
    }

    const isOnline = mode.value === "online";

    if (isOnline && !$("imageConsent").checked) {
      return status(
        "Approve online processing before continuing."
      );
    }

    processing = true;
    process.disabled = true;

    try {
      let blob;

      if (isOnline) {
        blob = await onlineEdit(
          file,
          $("imagePrompt").value
        );

        showResult(
          file,
          blob,
          "AI editing complete. Review the result before saving."
        );
      } else {
        status(
          "Processing locally. Your image is not uploaded."
        );

        blob = await localEdit(
          file,
          $("imagePrompt").value,
          $("imagePreset").value
        );

        showResult(
          file,
          blob,
          "Processed locally. Review the result before saving."
        );
      }
    } catch (error) {
      status(
        error.message || "Image processing failed."
      );
    } finally {
      processing = false;
      process.disabled = false;
    }
  });

  window.addEventListener("pagehide", releaseResults);
}
