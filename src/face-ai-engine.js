
/*
 * ProText AI — Face Studio 1.5.1
 * Offline AI engine foundation
 *
 * This module loads a locally hosted ONNX model
 * and reports its inputs and outputs.
 *
 * It does not yet perform image enhancement.
 */

import * as ort from "onnxruntime-web";

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
      cache: "no-store"
    });

    if (!response.ok) {
      return {
        available: false,
        reason:
          `Model unavailable (HTTP ${response.status})`
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

    ort.env.wasm.wasmPaths =
      `${BASE}onnx/`;

    ort.env.wasm.numThreads = 1;

    onProgress("Loading AI model into memory...");

    const modelResponse = await fetch(MODEL_URL);

    if (!modelResponse.ok) {
      throw new Error(
        `Model download failed: ${modelResponse.status}`
      );
    }

    const modelBytes =
      await modelResponse.arrayBuffer();

    session =
      await ort.InferenceSession.create(
        modelBytes,
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
