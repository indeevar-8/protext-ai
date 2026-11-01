
import { MLCEngine, prebuiltAppConfig } from "@mlc-ai/web-llm";
import "./style.css";

// Prefer a smaller model for faster mobile inference.
// Actual availability depends on the installed WebLLM version.
const MODEL_CANDIDATES = [
  "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
  "Qwen2.5-0.5B-Instruct-q4f32_1-MLC",
  "Qwen2.5-1.5B-Instruct-q4f16_1-MLC"
];

const $ = (id) => document.getElementById(id);

let engine = null;
let loadingPromise = null;
let lastOutput = "";
let lastRequest = null;
let activeFeature = "rewrite";

const styles = {
  Professional: "Use clear, polished workplace language.",
  Formal: "Use formal, courteous and precise language.",
  Email: "Rewrite as a professional business email body; do not invent a subject or recipient.",
  Polite: "Make the message respectful, tactful and considerate.",
  Concise: "Make the message shorter and clearer while preserving all important points.",
  Executive: "Use concise, confident, executive-level business communication.",
  "Friendly Professional": "Use a warm, approachable and professional tone.",
  "Grammar Only": "Correct grammar, spelling and punctuation only; preserve the original style."
};

function notice(msg = "", kind = "") {
  const n = $("notice");
  n.textContent = msg;
  n.className = `notice ${kind}`;
  n.hidden = !msg;
}

function updateNetwork() {
  $("networkLabel").textContent =
    navigator.onLine ? "Internet available" : "Offline";

  $("networkDot").classList.toggle(
    "offline",
    !navigator.onLine
  );
}

window.addEventListener("online", updateNetwork);
window.addEventListener("offline", updateNetwork);
updateNetwork();

function chooseModel() {
  const available = new Set(
    prebuiltAppConfig.model_list.map((m) => m.model_id)
  );

  const chosen = MODEL_CANDIDATES.find((id) =>
    available.has(id)
  );

  if (!chosen) {
    throw new Error(
      "No compatible Qwen model found in this WebLLM package."
    );
  }

  return chosen;
}

async function getEngine() {
  if (engine) return engine;
  if (loadingPromise) return loadingPromise;

  if (!navigator.gpu) {
    throw new Error(
      "WebGPU is unavailable. Use a supported browser and device."
    );
  }

  const modelId = chooseModel();

  loadingPromise = (async () => {
    const instance = new MLCEngine({
      initProgressCallback: (progress) => {
        $("loadingText").textContent =
          progress.text || "Preparing private AI…";

        const value = Number(progress.progress);

        if (Number.isFinite(value)) {
          $("loadingFill").style.width =
            `${Math.max(0, Math.min(100, Math.round(value * 100)))}%`;
        }
      }
    });

    // Cached models can initialize without internet.
    await instance.reload(modelId);

    engine = instance;
    return instance;
  })();

  try {
    return await loadingPromise;
  } catch (error) {
    engine = null;

    throw new Error(
      `Could not initialize on-device AI: ${error.message}. ` +
      "For first use, connect to Wi-Fi to download the model. " +
      "If this repeats, check WebGPU compatibility."
    );
  } finally {
    loadingPromise = null;
  }
}

function rewritePrompt(raw, mode) {
  return (
    "Edit the text in English. " +
    (styles[mode] || styles.Professional) +
    " Preserve all facts, names, numbers, intent and commitments. " +
    "Be concise without losing meaning. " +
    "Do not invent details or add explanations. " +
    "Output only the improved text.\n\n" +
    "TEXT:\n" + raw
  );
}


function promptPrompt(raw) {
  return [
    "Convert the user's idea into a concise, effective English prompt",
    "for another AI model.",
    "",
    "RULES:",
    "1. Preserve the exact objective and all essential requirements.",
    "2. Keep important context, inputs, constraints, and output format.",
    "3. Remove filler, repetition, greetings, and unnecessary wording.",
    "4. Use clear, direct, actionable language.",
    "5. Do not add requirements, technologies, or assumptions.",
    "6. For simple tasks, produce one compact sentence.",
    "7. For complex tasks, use short structured instructions.",
    "8. Avoid generic phrases such as 'Act as an expert'.",
    "9. Use English only.",
    "10. Return only the optimized prompt.",
    "",
    "USER IDEA:",
    raw
  ].join("\n");
}

function showResult(text, label) {
  lastOutput = text;

  $("resultLabel").textContent = label;
  $("resultText").value = text;
  $("resultCard").hidden = false;
  $("emptyResult").hidden = true;

  ["copyBtn", "regenerateBtn"].forEach((id) => {
    $(id).disabled = false;
  });

  $("saveBtn").disabled = activeFeature !== "rewrite";
}

async function generate(kind, again = false) {
  const input = $(
    kind === "rewrite" ? "rawText" : "promptRaw"
  );

  const raw = input.value.trim();

  if (!raw) {
    notice(
      kind === "rewrite"
        ? "Add the text you want to improve."
        : "Describe your task or idea first.",
      "warning"
    );
    return;
  }

  if (raw.length > 12000) {
    notice(
      "Please keep your input under 12,000 characters.",
      "warning"
    );
    return;
  }

  const mode = $("mode").value;

  lastRequest = { kind, raw, mode };

  notice();

  document.querySelectorAll(".generate-btn").forEach((button) => {
    button.disabled = true;
  });

  $("loadingLine").hidden = false;

  $("loadingText").textContent = again
    ? "Generating another version…"
    : "Preparing your private AI…";

  $("loadingFill").style.width = "0%";

  try {
    const ai = await getEngine();

    $("loadingText").textContent =
      "Generating on your device…";

    const content = kind === "rewrite"
      ? rewritePrompt(raw, mode)
      : promptPrompt(raw);

    const result = await ai.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "You are ProText AI, a concise English writing assistant. " +
            "Reply in English only. Follow instructions accurately. " +
            "Never invent requirements. " +
            "Output only the requested text. " +
            "Avoid repetition and unrelated content."
        },
        {
          role: "user",
          content
        }
      ],

      temperature: 0.15,
      top_p: 0.9,

      max_tokens: kind === "rewrite" ? 384 : 256
    });

    const out = result.choices?.[0]?.message?.content?.trim();

    if (!out) {
      throw new Error(
        "The model returned an empty result. Please try again."
      );
    }

    showResult(
      out,
      kind === "rewrite"
        ? "Improved text"
        : "Enhanced prompt"
    );
  } catch (error) {
    console.error("ProText AI generation failed:", error);

    notice(
      error.message || "Something went wrong. Please try again.",
      "error"
    );
  } finally {
    $("loadingLine").hidden = true;

    document.querySelectorAll(".generate-btn").forEach((button) => {
      button.disabled = false;
    });
  }
}

// Generate buttons
$("rewriteBtn").addEventListener("click", () => {
  generate("rewrite");
});

$("enhanceBtn").addEventListener("click", () => {
  generate("prompt");
});

// Regenerate previous request
$("regenerateBtn").addEventListener("click", () => {
  if (!lastRequest) return;

  const inputId = lastRequest.kind === "rewrite"
    ? "rawText"
    : "promptRaw";

  $(inputId).value = lastRequest.raw;
  $("mode").value = lastRequest.mode;

  generate(lastRequest.kind, true);
});

// Copy output
$("copyBtn").addEventListener("click", async () => {
  if (!lastOutput) return;

  try {
    await navigator.clipboard.writeText(lastOutput);

    $("copyBtn").textContent = "✓";

    setTimeout(() => {
      $("copyBtn").textContent = "▢";
    }, 1300);
  } catch {
    $("resultText").select();
    document.execCommand("copy");
  }
});

// Clear input fields
$("clearRewrite").addEventListener("click", () => {
  $("rawText").value = "";
  $("rewriteCount").textContent = "0 characters";
});

$("clearPrompt").addEventListener("click", () => {
  $("promptRaw").value = "";
  $("promptCount").textContent = "0 characters";
});

// Character counters
$("rawText").addEventListener("input", () => {
  $("rewriteCount").textContent =
    `${$("rawText").value.length} characters`;
});

$("promptRaw").addEventListener("input", () => {
  $("promptCount").textContent =
    `${$("promptRaw").value.length} characters`;
});

// Local saved rewrites
function history() {
  try {
    return JSON.parse(
      localStorage.getItem("protext-history") || "[]"
    );
  } catch {
    return [];
  }
}

function renderHistory() {
  const list = $("historyList");
  list.replaceChildren();

  const items = history();

  if (!items.length) {
    const p = document.createElement("p");

    p.className = "muted small";
    p.textContent = "No saved rewrites yet.";

    list.append(p);
    return;
  }

  items.slice(0, 20).forEach((item) => {
    const b = document.createElement("button");
    b.className = "history-entry";

    const strong = document.createElement("strong");

    strong.textContent =
      `${item.mode || "Rewrite"} · ` +
      new Date(item.date).toLocaleDateString();

    const span = document.createElement("span");
    span.textContent = item.text;

    b.append(strong, span);

    b.addEventListener("click", () => {
      showFeature("rewrite");
      showResult(item.text, "Improved text");
    });

    list.append(b);
  });
}

// Save result
$("saveBtn").addEventListener("click", () => {
  if (!lastOutput || activeFeature !== "rewrite") return;

  const items = history();

  items.unshift({
    text: lastOutput,
    mode: $("mode").value,
    date: Date.now()
  });

  localStorage.setItem(
    "protext-history",
    JSON.stringify(items.slice(0, 30))
  );

  renderHistory();

  $("saveBtn").textContent = "♥";

  setTimeout(() => {
    $("saveBtn").textContent = "♡";
  }, 1200);
});

// Clear history
$("clearHistoryBtn").addEventListener("click", () => {
  if (confirm("Delete all saved rewrites on this device?")) {
    localStorage.removeItem("protext-history");
    renderHistory();
  }
});

// Feature navigation
function showFeature(f) {
  activeFeature = f;

  $("rewriteView").hidden = f !== "rewrite";
  $("promptView").hidden = f !== "prompt";
  $("historyView").hidden = f !== "history";

  $("pageTitle").textContent =
    f === "rewrite"
      ? "Improve your writing"
      : f === "prompt"
        ? "AI Prompt Enhancer"
        : "Saved rewrites";

  $("pageSubtitle").textContent =
    f === "rewrite"
      ? "Clear, polished writing that keeps your meaning."
      : f === "prompt"
        ? "Turn a rough idea into a concise prompt for any AI tool."
        : "Your saved rewrites stay on this device.";

  $("menuPanel").hidden = true;

  notice();

  document.querySelectorAll("[data-feature]").forEach((b) => {
    b.classList.toggle(
      "active",
      b.dataset.feature === f
    );
  });

  if (f !== "rewrite") {
    $("saveBtn").disabled = true;
  }
}

document.querySelectorAll("[data-feature]").forEach((b) => {
  b.addEventListener("click", () => {
    showFeature(b.dataset.feature);
  });
});

$("menuButton").addEventListener("click", () => {
  $("menuPanel").hidden = !$("menuPanel").hidden;
});

$("closeMenu").addEventListener("click", () => {
  $("menuPanel").hidden = true;
});

// Initial state
renderHistory();

if (!navigator.gpu) {
  notice(
    "WebGPU is not available in this browser. " +
    "The AI runs locally and has no cloud fallback.",
    "warning"
  );
}

// Register offline service worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .catch((error) => {
        console.warn(
          "Service worker registration failed:",
          error
        );
      });
  });
}
