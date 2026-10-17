(function () {
  "use strict";
  // A single same-origin client keeps REST error handling and CSRF headers consistent.
  const root = "api/index.php";
  let csrf = "";
  async function request(path, options = {}) {
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (options.body && !(options.body instanceof FormData))
      headers["Content-Type"] = "application/json";
    if (csrf && options.method && options.method !== "GET")
      headers["X-CSRF-Token"] = csrf;
    const response = await fetch(`${root}${path}`, {
      credentials: "same-origin",
      ...options,
      headers,
    });
    const payload = await response.json().catch(() => ({
      success: false,
      message: "The server returned an invalid response.",
    }));
    if (!response.ok || payload.success === false) {
      const error = new Error(payload.message || "Request failed.");
      error.status = response.status;
      throw error;
    }
    if (payload.csrf) csrf = payload.csrf;
    return payload;
  }
  const json = (method, body) => ({ method, body: JSON.stringify(body || {}) });
  const maxSourceBytes = 20 * 1024 * 1024;
  const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  let heicConverterPromise;

  function loadHeicConverter() {
    if (window.HeicTo) return Promise.resolve(window.HeicTo);
    if (!heicConverterPromise) {
      heicConverterPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "js/vendor/heic-to.js?v=1.5.2";
        script.onload = () => {
          if (window.HeicTo) resolve(window.HeicTo);
          else {
            script.remove();
            reject(new Error("HEIC converter could not load. Refresh the page and try again."));
          }
        };
        script.onerror = () => {
          script.remove();
          reject(new Error("HEIC converter could not load. Check the connection and try again."));
        };
        document.head.append(script);
      }).catch((error) => {
        heicConverterPromise = null;
        throw error;
      });
    }
    return heicConverterPromise;
  }

  async function prepareImage(file, onProgress) {
    onProgress?.("Checking image", 5);
    if (file.size < 1) throw new Error("The image file is empty.");
    if (file.size > maxSourceBytes)
      throw new Error("The image exceeds the 20 MB source file limit.");

    const type = file.type.toLowerCase();
    const isHeic = type === "image/heic" || /\.heic$/i.test(file.name);
    if (isHeic) {
      onProgress?.("Loading HEIC converter", 10);
      const converter = await loadHeicConverter();
      let converted;
      try {
        onProgress?.("Converting HEIC", 20);
        converted = await converter({ blob: file, type: "image/jpeg", quality: 0.85 });
      } catch (_) {
        throw new Error("HEIC could not be converted. The file may be damaged or use an unsupported HEIC encoding.");
      }
      if (!(converted instanceof Blob) || converted.type !== "image/jpeg")
        throw new Error("HEIC conversion did not produce a valid JPG image.");
      onProgress?.("Checking converted image", 55);
      let bitmap;
      try {
        bitmap = await createImageBitmap(converted);
      } catch (_) {
        throw new Error("The JPG produced from HEIC could not be read.");
      }
      const tooLarge = bitmap.width > 6000 || bitmap.height > 6000 ||
        bitmap.width * bitmap.height > 24000000;
      bitmap.close?.();
      if (tooLarge)
        throw new Error("Image dimensions are too large. Maximum: 6000 pixels per side and 24 million total pixels.");
      const name = file.name.replace(/\.heic$/i, "") + ".jpg";
      const prepared = await compressLargeImage(
        new File([converted], name, { type: "image/jpeg" }),
        onProgress,
        60,
      );
      onProgress?.("Ready to upload", 70);
      return { file: prepared, uploadStart: 70 };
    }

    if (
      (type && !supportedImageTypes.has(type)) ||
      (!type && !/\.(?:jpe?g|png|webp)$/i.test(file.name))
    ) {
      throw new Error("Unsupported image format. Use JPG, PNG, WebP, or HEIC.");
    }
    const prepared = await compressLargeImage(file, onProgress, 20);
    const uploadStart = file.size > 2 * 1024 * 1024 ? 50 : 5;
    onProgress?.("Ready to upload", uploadStart);
    return { file: prepared, uploadStart };
  }

  async function compressLargeImage(file, onProgress, startPercent) {
    if (file.size <= 2 * 1024 * 1024) return file;
    onProgress?.("Compressing image", startPercent);
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch (_) {
      throw new Error("The image could not be read for compression. Check that the file is a valid image.");
    }
    const targetBytes = 950 * 1024,
      initialScale = Math.min(1, 3000 / Math.max(bitmap.width, bitmap.height));
    let result = null;
    for (let attempt = 0; attempt < 9; attempt++) {
      const scale = initialScale * Math.pow(0.84, Math.max(0, attempt - 4)),
        canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d", { alpha: true });
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const quality = Math.max(0.42, 0.84 - attempt * 0.07);
      result = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/webp", quality),
      );
      if (result && result.size < targetBytes) break;
    }
    bitmap.close?.();
    if (!result || result.size >= 1024 * 1024)
      throw new Error("The image exceeds 2 MB and could not be compressed below 1 MB.");
    return new File([result], `${file.name.replace(/\.[^.]+$/, "")}.webp`, {
      type: "image/webp",
      lastModified: Date.now(),
    });
  }
  function uploadImage(data, onProgress, uploadStart) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${root}/admin/uploads`);
      xhr.withCredentials = true;
      xhr.setRequestHeader("Accept", "application/json");
      if (csrf) xhr.setRequestHeader("X-CSRF-Token", csrf);
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable && event.total > 0)
          onProgress?.("Uploading image", uploadStart + Math.min(95 - uploadStart, Math.round((95 - uploadStart) * event.loaded / event.total)));
      });
      xhr.onload = () => {
        let payload;
        try {
          payload = JSON.parse(xhr.responseText);
        } catch (_) {
          payload = { success: false, message: "The server returned an invalid response." };
        }
        if (xhr.status < 200 || xhr.status >= 300 || !payload || payload.success === false) {
          const error = new Error(payload?.message || "Request failed.");
          error.status = xhr.status;
          reject(error);
          return;
        }
        if (payload.csrf) csrf = payload.csrf;
        onProgress?.("Complete", 100);
        resolve(payload);
      };
      xhr.onerror = () => reject(new Error("The upload server could not be reached. Check the connection and try again."));
      xhr.send(data);
    });
  }
  window.AdmissionApi = {
    login: (email, password) =>
      request("/admin/login", json("POST", { email, password })),
    session: () => request("/admin/session"),
    logout: () => request("/admin/session", { method: "DELETE" }),
    publicUnits: () => request("/units"),
    apply: (data) => request("/applications", json("POST", data)),
    previewExam: (data) => request("/exam-preview", json("POST", data)),
    startAttempt: (data) => request("/exam-attempts", json("POST", data)),
    getAttempt: (id) => request(`/exam-attempts/${id}`),
    saveAttempt: (id, data) =>
      request(`/exam-attempts/${id}/save`, json("POST", data)),
    submitAttempt: (id, data) =>
      request(`/exam-attempts/${id}/submit`, json("POST", data)),
    units: () => request("/admin/units"),
    createUnit: (data) => request("/admin/units", json("POST", data)),
    updateUnit: (id, data) =>
      request(`/admin/units/${id}`, json("PATCH", data)),
    deleteUnit: (id) => request(`/admin/units/${id}`, { method: "DELETE" }),
    banks: () => request("/admin/question-banks"),
    bank: (id) => request(`/admin/question-banks/${id}`),
    createBank: (data) => request("/admin/question-banks", json("POST", data)),
    updateBank: (id, data) =>
      request(`/admin/question-banks/${id}`, json("PATCH", data)),
    activateBank: (id) =>
      request(`/admin/question-banks/${id}/activate`, { method: "POST" }),
    inactivateBank: (id) =>
      request(`/admin/question-banks/${id}/inactivate`, { method: "POST" }),
    deleteBank: (id) =>
      request(`/admin/question-banks/${id}`, { method: "DELETE" }),
    createToken: (data) => request("/admin/exam-tokens", json("POST", data)),
    currentToken: () => request("/admin/exam-tokens/current"),
    upload: async (file, onProgress) => {
      const { file: prepared, uploadStart } = await prepareImage(file, onProgress);
      const data = new FormData();
      data.append("image", prepared);
      onProgress?.("Uploading image", uploadStart);
      return uploadImage(data, onProgress, uploadStart);
    },
    results: (params) =>
      request(`/admin/results?${new URLSearchParams(params)}`),
    exportResults: (unitId = "", resultStatus = "all") =>
      request(
        `/admin/results/export?${new URLSearchParams({ unitId, resultStatus })}`,
      ),
    result: (id) => request(`/admin/results/${id}`),
    deleteResult: (id) => request(`/admin/results/${id}`, { method: "DELETE" }),
  };
})();
