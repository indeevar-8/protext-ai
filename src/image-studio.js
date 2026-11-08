// Local-first Image Studio. No network requests are made in this module.
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;
const SUPPORTED = new Set(["image/jpeg", "image/png", "image/webp"]);
const $ = (id) => document.getElementById(id);
let originalUrl = null;
let resultUrl = null;

function status(message) { $("imageStatus").textContent = message; }
function releaseResults() {
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  originalUrl = resultUrl = null;
  $("imageComparison").hidden = true;
  $("imageDownload").removeAttribute("href");
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
  // Reject tasks that local deterministic filters cannot perform.
  const unsupported = /\b(remove|erase|replace|change background|add person|generate|create|restore face|upscale|sharpen text|fix blur)\b/i.test(p);
  if (unsupported) throw new Error("This prompt needs advanced AI editing. Local mode supports only brightness, contrast, grayscale, and natural enhancement.");
  if (!match && selected === "auto") throw new Error("This prompt cannot be performed accurately by local filters. Select a supported preset or use online AI once configured.");
  return match ? match[1] : selected;
}
function applyPixels(data, preset) {
  const a = data.data;
  for (let i=0;i<a.length;i+=4) {
    let r=a[i], g=a[i+1], b=a[i+2];
    if (preset === "grayscale") { const y=.2126*r+.7152*g+.0722*b; r=g=b=y; }
    else if (preset === "bright") { r=r*1.08+12; g=g*1.08+12; b=b*1.08+12; }
    else if (preset === "contrast") { r=(r-128)*1.17+128; g=(g-128)*1.17+128; b=(b-128)*1.17+128; }
    else if (preset === "auto") { r=(r-128)*1.07+133; g=(g-128)*1.07+133; b=(b-128)*1.07+133; }
    a[i]=Math.max(0,Math.min(255,r)); a[i+1]=Math.max(0,Math.min(255,g)); a[i+2]=Math.max(0,Math.min(255,b));
  }
}
async function loadBitmap(file) {
  if (typeof createImageBitmap === "function") return await createImageBitmap(file, {imageOrientation:"from-image"});
  const url=URL.createObjectURL(file);
  try { const img=new Image(); img.src=url; await img.decode(); return img; }
  finally { URL.revokeObjectURL(url); }
}
async function localEdit(file, prompt, preset) {
  const chosen=requestedPreset(prompt,preset);
  const bitmap=await loadBitmap(file);
  try {
    const w=bitmap.width, h=bitmap.height;
    if (!w || !h || w*h>MAX_PIXELS) throw new Error("Image dimensions are too large. Please use an image under 16 megapixels.");
    const canvas=document.createElement("canvas"); canvas.width=w; canvas.height=h;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    if (!ctx) throw new Error("Canvas processing is unavailable.");
    ctx.drawImage(bitmap,0,0);
    if (chosen !== "original") { const pixels=ctx.getImageData(0,0,w,h); applyPixels(pixels,chosen); ctx.putImageData(pixels,0,0); }
    return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("Could not export image.")),"image/png"));
  } finally { if (typeof bitmap.close === "function") bitmap.close(); }
}
export function initImageStudio() {
  const mode=$("imageMode"), fileInput=$("imageFile"), process=$("imageProcess");
  if (!mode || !fileInput || !process) return;
  mode.addEventListener("change",()=>{
    $("imageLocalOptions").hidden=mode.value!=="local";
    $("imageOnlineOptions").hidden=mode.value!=="online";
    $("imageConsent").checked=false;
    status("");
  });
  fileInput.addEventListener("change",()=>{releaseResults();status("");});
  process.addEventListener("click",async()=>{
    const file=fileInput.files?.[0];
    if (!file) return status("Choose an image first.");
    if (!SUPPORTED.has(file.type)) return status("Choose a PNG, JPEG, or WebP image.");
    if (file.size>MAX_BYTES) return status("Choose an image smaller than 20 MB.");
    if (mode.value==="online") {
      if (!$("imageConsent").checked) return status("Approve online processing before continuing.");
      return status("Online AI editing is not configured. No image has been uploaded. A secure server-side provider integration is required.");
    }
    process.disabled=true;status("Processing locally. Your image is not uploaded.");
    try {
      const blob=await localEdit(file,$("imagePrompt").value,$("imagePreset").value);
      releaseResults();originalUrl=URL.createObjectURL(file);resultUrl=URL.createObjectURL(blob);
      $("imageOriginal").src=originalUrl;$("imageResult").src=resultUrl;
      $("imageDownload").href=resultUrl;$("imageComparison").hidden=false;
      status("Processed locally. Review the result before saving.");
    } catch(err) {status(err.message||"Image processing failed.");}
    finally {process.disabled=false;}
  });
  window.addEventListener("pagehide",releaseResults);
}
