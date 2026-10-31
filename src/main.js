import {
  MLCEngine,
  prebuiltAppConfig
} from "@mlc-ai/web-llm";
import "./style.css";

const MODEL_ID = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
const $ = (id) => document.getElementById(id);

let engine = null;
let isLoading = false;
let lastOutput = "";

function setStatus(message, kind = "") {
  $("status").textContent = message;
  $("status").className = `status ${kind}`;
}
function updateConnection() {
  const online = navigator.onLine;
  $("connectionPill").textContent = online ? "Internet available" : "Offline";
  $("connectionPill").className = `pill ${online ? "online" : "offline"}`;
}
window.addEventListener("online", updateConnection);
window.addEventListener("offline", updateConnection);
updateConnection();

$("rawText").addEventListener("input", () => {
  $("charCount").textContent = `${$("rawText").value.length} characters`;
});
$("clearBtn").addEventListener("click", () => {
  $("rawText").value = "";
  $("charCount").textContent = "0 characters";
  $("rawText").focus();
});

function checkCapability() {
  const supported = !!navigator.gpu;
  if (supported) {
    setStatus("WebGPU detected. The local AI model can be initialized.", "good");
  } else {
    setStatus("WebGPU is unavailable in this browser. Update iOS/Safari and try again. No cloud fallback is used.", "warn");
  }
  return supported;
}

async function loadEngine() {
  if (engine) return engine;

  if (isLoading) {
    throw new Error("Model is already loading.");
  }

  if (!navigator.gpu) {
    throw new Error(
      "WebGPU is not supported in this browser."
    );
  }

  if (!navigator.onLine) {
    throw new Error(
      "Connect to Wi-Fi for the initial model download."
    );
  }

  const model = prebuiltAppConfig.model_list.find(
    item => item.model_id === MODEL_ID
  );

  if (!model) {
    throw new Error("Model not found in WebLLM.");
  }

  isLoading = true;

  try {
    const candidate = new MLCEngine({
      initProgressCallback: (progress) => {
        const percentage = Math.round(
          (progress.progress || 0) * 100
        );

        $("progressBar").style.width =
          percentage + "%";

        $("progressLabel").textContent =
          progress.text || "Loading " + percentage + "%";
      }
    });

    // Explicitly load the model before generating text.
    await candidate.reload(MODEL_ID);

    engine = candidate;

    setStatus("AI model loaded successfully!", "good");

    return engine;

  } catch (error) {
    engine = null;

    throw new Error(
      "AI model loading failed: " + error.message
    );

  } finally {
    isLoading = false;
  }
}

function makePrompt(raw, mode) {
  const instructions = {
    "Professional": "Use clear, polished workplace language.",
    "Formal": "Use formal, courteous and precise language suitable for official communication.",
    "Email": "Rewrite as a professional business email body. Do not invent a subject, recipient or facts.",
    "Polite": "Make the message respectful, tactful and considerate without sounding weak.",
    "Concise": "Make the message shorter and clearer while preserving every important point.",
    "Executive": "Use concise, confident, executive-level business communication.",
    "Friendly Professional": "Use a warm, approachable and professional tone.",
    "Grammar Only": "Correct grammar, spelling and punctuation only. Preserve the wording and style as much as possible."
  }[mode] || "Use clear, polished workplace language.";

  return `You are an expert professional editor. Rewrite the user's text according to this style: ${mode}.
${instructions}

Rules:
- Preserve the exact intent and meaning.
- Do not invent facts, names, dates, deadlines, promises, reasons or commitments.
- Keep all factual details unchanged.
- Improve grammar, spelling, punctuation, clarity and sentence flow.
- Do not add commentary, headings, quotation marks or explanations.
- Return only the rewritten text.

USER TEXT:
${raw}`;
}

$("rewriteBtn").addEventListener("click", async () => {
  const raw = $("rawText").value.trim();
  if (!raw) { setStatus("Please enter some text first.", "warn"); $("rawText").focus(); return; }
  if (raw.length > 5000) { setStatus("Please keep the first version under 5,000 characters.", "warn"); return; }

  const button = $("rewriteBtn");
  button.disabled = true;
  button.textContent = "Preparing your rewrite…";
  try {
    const ai = await loadEngine();
    setStatus("Rewriting locally on your iPhone…", "busy");
    const response = await ai.chat.completions.create({
      messages: [{ role: "user", content: makePrompt(raw, $("mode").value) }],
      temperature: 0.25,
      max_tokens: 700
    });
    lastOutput = response.choices?.[0]?.message?.content?.trim() || "";
    if (!lastOutput) throw new Error("The model returned an empty response. Please try again.");
    $("resultText").value = lastOutput;
    $("emptyState").hidden = true;
    $("resultText").classList.add("has-result");
    $("copyBtn").disabled = false;
    $("saveBtn").disabled = false;
    setStatus("Done. Rewritten entirely on your device.", "good");
  } catch (err) {
    setStatus(err.message || "Something went wrong while loading the local model.", "error");
  } finally {
    button.disabled = false;
    button.innerHTML = "✦ &nbsp; Professionalize text";
  }
});

$("copyBtn").addEventListener("click", async () => {
  if (!lastOutput) return;
  try {
    await navigator.clipboard.writeText(lastOutput);
    setStatus("Copied to clipboard.", "good");
  } catch {
    $("resultText").readOnly = false;
    $("resultText").select();
    document.execCommand("copy");
    $("resultText").readOnly = true;
    setStatus("Select and copy the text if automatic copying is unavailable.", "warn");
  }
});

function getHistory() {
  try { return JSON.parse(localStorage.getItem("protext-history") || "[]"); }
  catch { return []; }
}
function renderHistory() {
  const items = getHistory();
  $("historyList").innerHTML = "";
  if (!items.length) {
    $("historyList").innerHTML = '<div class="history-empty">Your saved rewrites will appear here.</div>';
    return;
  }
  items.slice(0, 10).forEach((item) => {
    const el = document.createElement("button");
    el.className = "history-item";
    const title = document.createElement("strong");
    title.textContent = item.mode + " · " + new Date(item.date).toLocaleDateString();
    const body = document.createElement("span");
    body.textContent = item.text;
    el.append(title, body);
    el.addEventListener("click", () => {
      $("resultText").value = item.text;
      lastOutput = item.text;
      $("emptyState").hidden = true;
      $("resultText").classList.add("has-result");
      $("copyBtn").disabled = false;
      $("saveBtn").disabled = false;
    });
    $("historyList").append(el);
  });
}
$("saveBtn").addEventListener("click", () => {
  if (!lastOutput) return;
  const items = getHistory();
  items.unshift({ text: lastOutput, mode: $("mode").value, date: Date.now() });
  localStorage.setItem("protext-history", JSON.stringify(items.slice(0, 30)));
  renderHistory();
  setStatus("Saved on this device.", "good");
});
$("clearHistoryBtn").addEventListener("click", () => {
  if (confirm("Delete all saved rewrites on this device?")) {
    localStorage.removeItem("protext-history");
    renderHistory();
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
renderHistory();
checkCapability();