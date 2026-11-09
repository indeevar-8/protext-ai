
/*
 * ProText AI — Face Studio 1.5.2
 * Offline ONNX AI super-resolution engine.
 */

import * as ort from "onnxruntime-web/wasm";

const BASE = import.meta.env.BASE_URL;
const MODEL_URL =
  `${BASE}models/face-super-resolution.onnx`;

let session = null;
let loadingPromise = null;

export function getAIStatus() {
  return {
    runtime: "ONNX Runtime Web",
    loaded: session !== null,
    model: MODEL_URL,
    executionProvider: "wasm"
  };
}

export async function checkAIModel() {
  try {
    const response = await fetch(MODEL_URL, {
      method: "GET",
      cache: "default"
    });

    if (!response.ok) {
      return {
        available: false,
        reason: `Model unavailable (HTTP ${response.status})`
      };
    }

    const contentType =
      response.headers.get("content-type") || "";

    if (contentType.includes("text/html")) {
      return {
        available: false,
        reason: "Model URL returned HTML."
      };
    }

    return {
      available: true,
      reason: "Model file is accessible."
    };
  } catch (error) {
    return {
      available: false,
      reason: error.message
    };
  }
}

export async function loadAIModel(
  onProgress = () => {}
) {
  if (session) return session;

  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    onProgress("Checking local AI model...");

    const check = await checkAIModel();

    if (!check.available) {
      throw new Error(check.reason);
    }

    onProgress("Initializing offline AI runtime...");

    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;

    // Preserve the working runtime configuration.
    ort.env.wasm.wasmPaths = {
      wasm: `${BASE}onnx/ort-wasm-simd-threaded.wasm`
    };

    onProgress("Loading AI model into memory...");

    const response = await fetch(MODEL_URL);

    if (!response.ok) {
      throw new Error(
        `Model download failed: ${response.status}`
      );
    }

    const bytes = await response.arrayBuffer();

    session = await ort.InferenceSession.create(
      bytes,
      {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all"
      }
    );

    onProgress("AI model loaded successfully.");

    return session;
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

export async function inspectAIModel(
  onProgress = () => {}
) {
  const model = await loadAIModel(onProgress);

  return {
    inputNames: model.inputNames,
    outputNames: model.outputNames,
    inputMetadata: model.inputMetadata,
    outputMetadata: model.outputMetadata
  };
}

export async function releaseAIModel() {
  if (loadingPromise) {
    throw new Error(
      "Cannot release the model while it is loading."
    );
  }

  if (session) {
    await session.release();
    session = null;
  }
}

/*
 * Experimental 3x super-resolution:
 * Input:  224 x 224 luminance
 * Output: 672 x 672 luminance
 */
export async function enhanceFaceCanvas(
  sourceCanvas,
  onProgress = () => {}
) {
  const model = await loadAIModel(onProgress);

  const names = model.inputNames;
  const outputs = model.outputNames;

  if (
    names.length !== 1 ||
    outputs.length !== 1 ||
    model.inputMetadata[0]?.type !== "float32"
  ) {
    throw new Error(
      "Unexpected super-resolution model format."
    );
  }

  const input = document.createElement("canvas");
  input.width = 224;
  input.height = 224;

  const inputCtx = input.getContext("2d", {
    willReadFrequently: true
  });

  if (!inputCtx) {
    throw new Error("Canvas input unavailable.");
  }

  inputCtx.drawImage(
    sourceCanvas,
    0, 0,
    224, 224
  );

  const rgba = inputCtx.getImageData(
    0, 0, 224, 224
  ).data;

  const yData = new Float32Array(224 * 224);

  for (let i = 0; i < yData.length; i++) {
    const p = i * 4;

    yData[i] = (
      0.299 * rgba[p] +
      0.587 * rgba[p + 1] +
      0.114 * rgba[p + 2]
    ) / 255;
  }

  onProgress("Running 3x AI super-resolution...");

  const tensor = new ort.Tensor(
    "float32",
    yData,
    [1, 1, 224, 224]
  );

  const result = await model.run({
    [names[0]]: tensor
  });

  const outputTensor = result[outputs[0]];

  if (
    !outputTensor ||
    outputTensor.type !== "float32" ||
    outputTensor.data.length !== 672 * 672
  ) {
    throw new Error(
      "Unexpected AI output dimensions or type."
    );
  }

  const enhancedY = outputTensor.data;

  // Preserve original color while enhancing luminance.
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = 672;
  colorCanvas.height = 672;

  const colorCtx = colorCanvas.getContext("2d", {
    willReadFrequently: true
  });

  if (!colorCtx) {
    throw new Error(
      "Canvas color processing unavailable."
    );
  }

  colorCtx.imageSmoothingEnabled = true;
  colorCtx.imageSmoothingQuality = "high";

  colorCtx.drawImage(
    input,
    0, 0,
    672, 672
  );

  const image = colorCtx.getImageData(
    0, 0, 672, 672
  );

  const data = image.data;

  for (let i = 0; i < enhancedY.length; i++) {
    const p = i * 4;

    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];

    const oldY =
      0.299 * r +
      0.587 * g +
      0.114 * b;

    const newY = enhancedY[i] * 255;

    if (!Number.isFinite(newY)) {
      throw new Error(
        "AI produced invalid pixels."
      );
    }

    const delta = newY - oldY;

    data[p] = Math.max(
      0, Math.min(255, Math.round(r + delta))
    );

    data[p + 1] = Math.max(
      0, Math.min(255, Math.round(g + delta))
    );

    data[p + 2] = Math.max(
      0, Math.min(255, Math.round(b + delta))
    );
  }

  colorCtx.putImageData(image, 0, 0);

  input.width = 0;
  input.height = 0;

  return colorCanvas;
}
