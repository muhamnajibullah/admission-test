(function () {
  "use strict";
  // The opaque attempt ID enables safe refresh/resume without exposing sequential database IDs.
  const api = window.AdmissionApi,
    pages = [
      "registrationPage",
      "tokenPage",
      "previewPage",
      "examPage",
      "reviewPage",
      "completePage",
    ],
    storageKey = "admission.exam.attempt";
  let application = null,
    preview = null,
    pendingToken = "",
    attempt = null,
    availableUnits = [],
    index = 0,
    timerId = null,
    saveTimer = null,
    submitting = false,
    examConfirmationResolve = null,
    examConfirmationTrigger = null,
    imagePreviewTrigger = null,
    activeImageLoads = 0,
    loadedImageBytes = 0;
  const $ = (selector) => document.querySelector(selector);
  const imageRecords = new Map(),
    imageQueue = [],
    maxConcurrentImageLoads = 2,
    maxImageCacheBytes = 32 * 1024 * 1024,
    imageRetryDelays = [800, 2000];
  function normalizeAttemptState(value) {
    if (!value || typeof value !== "object") return value;
    value.answers = Object.fromEntries(Object.entries(value.answers || {}));
    value.flagged = Array.isArray(value.flagged) ? value.flagged : [];
    return value;
  }
  function currentAnswerPayload() {
    const answers = {};
    let answerCount = 0;
    (attempt?.questions || []).forEach((question) => {
      const answer = String(attempt.answers[question.id] || "");
      answers[question.id] = answer;
      if (answer) answerCount += 1;
    });
    return { answers, answerCount };
  }
  function unitDisplayName(unit) {
    return unit.city ? `${unit.name} — ${unit.city}` : unit.name;
  }
  function renderUnitOptions(query = "") {
    const options = $("#unitOptions"),
      selectedValue = $("#unitSelect").value,
      normalizedQuery = query.trim().toLocaleLowerCase(),
      filteredUnits = availableUnits.filter((unit) =>
        unitDisplayName(unit).toLocaleLowerCase().includes(normalizedQuery),
      );
    options.replaceChildren();
    filteredUnits.forEach((unit) => {
      const option = document.createElement("button"),
        name = document.createElement("strong"),
        city = document.createElement("small");
      option.type = "button";
      option.className = "searchable-select-option";
      option.dataset.value = String(unit.id);
      option.setAttribute("role", "option");
      option.setAttribute(
        "aria-selected",
        String(String(unit.id) === selectedValue),
      );
      name.textContent = unit.name;
      option.appendChild(name);
      if (unit.city) {
        city.textContent = unit.city;
        option.appendChild(city);
      }
      options.appendChild(option);
    });
    $("#unitEmpty").hidden = filteredUnits.length > 0;
  }
  function closeUnitSelect(returnFocus = false) {
    const control = $("#unitSelectControl"),
      trigger = $("#unitSelectButton");
    control.classList.remove("is-open");
    $("#unitSelectMenu").hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (returnFocus) trigger.focus();
  }
  function openUnitSelect() {
    const trigger = $("#unitSelectButton");
    if (trigger.disabled) return;
    $("#unitSelectControl").classList.add("is-open");
    $("#unitSelectMenu").hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    $("#unitSearch").value = "";
    renderUnitOptions();
    requestAnimationFrame(() => $("#unitSearch").focus());
  }
  function selectUnit(value) {
    const unit = availableUnits.find((item) => String(item.id) === value);
    if (!unit) return;
    $("#unitSelect").value = String(unit.id);
    $("#unitSelectText").textContent = unitDisplayName(unit);
    closeUnitSelect(true);
  }
  function show(id) {
    if (id !== "examPage" && $("#examImagePreview").open) {
      imagePreviewTrigger = null;
      $("#examImagePreview").close();
    }
    pages.forEach(
      (page) => (document.getElementById(page).hidden = page !== id),
    );
    scrollTo(0, 0);
  }
  function error(form, message) {
    form.querySelector(".form-error").textContent = message;
  }
  function birthDateFromForm(data) {
    const day = Number(data.birthDay),
      month = Number(data.birthMonth),
      year = Number(data.birthYear),
      today = new Date(),
      candidate = new Date(Date.UTC(year, month - 1, day)),
      todayUtc = Date.UTC(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
      );
    if (
      !Number.isInteger(day) ||
      !Number.isInteger(month) ||
      !Number.isInteger(year) ||
      year < 1900 ||
      year > today.getFullYear() ||
      candidate.getUTCFullYear() !== year ||
      candidate.getUTCMonth() !== month - 1 ||
      candidate.getUTCDate() !== day ||
      candidate.getTime() > todayUtc
    )
      throw new Error("Enter a valid date of birth.");
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  function math(root = document) {
    if (window.renderMathInElement)
      window.renderMathInElement(root, {
        delimiters: [
          { left: "\\(", right: "\\)", display: false },
          { left: "\\[", right: "\\]", display: true },
        ],
        throwOnError: false,
      });
  }
  async function initialize() {
    // Question image markers are converted into safe DOM images only when the path
    // also belongs to the current attempt snapshot.
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        attempt = normalizeAttemptState((await api.getAttempt(saved)).attempt);
        if (attempt.status === "submitted") {
          complete();
          return;
        }
        show("examPage");
        render();
        startTimer();
        return;
      } catch (e) {
        localStorage.removeItem(storageKey);
      }
    }
    try {
      const units = (await api.publicUnits()).units;
      availableUnits = Array.isArray(units) ? units : [];
      $("#unitSelectText").textContent = availableUnits.length
        ? "Select a unit"
        : "No units available";
      $("#unitSelectButton").disabled = availableUnits.length === 0;
      renderUnitOptions();
    } catch (e) {
      $("#unitSelectText").textContent = "Units are currently unavailable";
      $("#unitSelectButton").disabled = true;
      error($("#registrationForm"), e.message);
    }
  }
  $("#unitSelectButton").addEventListener("click", () => {
    if ($("#unitSelectMenu").hidden) openUnitSelect();
    else closeUnitSelect();
  });
  $("#unitSearch").addEventListener("input", (event) =>
    renderUnitOptions(event.currentTarget.value),
  );
  $("#unitOptions").addEventListener("click", (event) => {
    const option = event.target.closest(".searchable-select-option");
    if (option) selectUnit(option.dataset.value);
  });
  $("#unitSelectControl").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeUnitSelect(true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if ($("#unitSelectMenu").hidden) {
      openUnitSelect();
      return;
    }
    const options = Array.from(
        $("#unitOptions").querySelectorAll(".searchable-select-option"),
      ),
      currentIndex = options.indexOf(document.activeElement),
      offset = event.key === "ArrowDown" ? 1 : -1,
      nextIndex =
        currentIndex < 0
          ? offset > 0
            ? 0
            : options.length - 1
          : Math.min(
              Math.max(currentIndex + offset, 0),
              options.length - 1,
            );
    if (options[nextIndex]) options[nextIndex].focus();
  });
  document.addEventListener("click", (event) => {
    if (!$("#unitSelectControl").contains(event.target)) closeUnitSelect();
  });
  $("#registrationForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    error(form, "");
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      if (!data.unitId) {
        openUnitSelect();
        throw new Error("Select a unit.");
      }
      data.birthDate = birthDateFromForm(data);
      delete data.birthDay;
      delete data.birthMonth;
      delete data.birthYear;
      application = (await api.apply(data)).application;
      $("#registrationNumber").textContent = application.registrationNumber;
      show("tokenPage");
    } catch (e) {
      error(form, e.message);
    } finally {
      button.disabled = false;
    }
  });
  $("#tokenForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    error(form, "");
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      pendingToken = String(new FormData(form).get("token") || "");
      preview = (
        await api.previewExam({
          registrationNumber: application.registrationNumber,
          token: pendingToken,
        })
      ).preview;
      $("#previewDuration").textContent = `${Math.ceil(preview.durationSeconds / 60)} minutes`;
      $("#previewQuestionCount").textContent = preview.questionCount;
      $("#previewError").textContent = "";
      show("previewPage");
    } catch (e) {
      error(form, e.message);
    } finally {
      button.disabled = false;
    }
  });
  $("#tokenBackButton").addEventListener("click", () => show("registrationPage"));
  $("#startTestButton").addEventListener("click", async () => {
    const button = $("#startTestButton");
    button.disabled = true;
    $("#previewError").textContent = "";
    try {
      attempt = normalizeAttemptState((
        await api.startAttempt({
          registrationNumber: application.registrationNumber,
          token: pendingToken,
        })
      ).attempt);
      localStorage.setItem(storageKey, attempt.id);
      show("examPage");
      render();
      startTimer();
    } catch (e) {
      $("#previewError").textContent = e.message;
      button.disabled = false;
    }
  });
  function render() {
    if (!attempt) return;
    const question = attempt.questions[index],
      answer = attempt.answers[question.id] || "",
      flagged = attempt.flagged.includes(question.id);
    $("#candidateName").textContent = attempt.fullName;
    $("#unitLine").textContent = attempt.unitName;
    $("#questionLabel").textContent = `QUESTION ${index + 1}`;
    $("#reloadQuestionImages").disabled = questionImagePaths(question).length === 0;
    renderQuestionContent(question);
    $("#flagButton").classList.toggle("active", flagged);
    $("#flagButton").textContent = flagged ? "★ Flagged" : "☆ Flag";
    $("#answerOptions").innerHTML = question.options
      .map(
        (option, optionIndex) =>
          `<label class="answer-option"><input type="radio" name="answer" value="${option.id}" ${answer === option.id ? "checked" : ""}><span class="option-letter">${String.fromCharCode(65 + optionIndex)}</span><span class="answer-content" data-option-index="${optionIndex}">${option.content}</span></label>`,
      )
      .join("");
    question.options.forEach((option, optionIndex) => {
      renderStoredImages(
        $(`[data-option-index="${optionIndex}"]`),
        option.imagePaths || [],
        answerImagePattern,
        "Answer illustration",
      );
    });
    $("#progressText").textContent =
      `${index + 1} of ${attempt.questions.length}`;
    $("#previousButton").disabled = index === 0;
    $("#nextButton").hidden = index === attempt.questions.length - 1;
    $("#submitButton").hidden = index !== attempt.questions.length - 1;
    renderNavigation();
    math($("#examPage"));
    scheduleImageLoads();
    pruneImageCache();
  }
  function renderNavigation() {
    const answered = Object.values(attempt.answers).filter(Boolean).length;
    $("#answeredCount").textContent =
      `${answered} of ${attempt.questions.length} answered`;
    $("#numberGrid").innerHTML = attempt.questions
      .map(
        (question, i) =>
          `<button data-index="${i}" class="${i === index ? "current " : ""}${attempt.flagged.includes(question.id) ? "flagged" : attempt.answers[question.id] ? "answered" : ""}">${i + 1}</button>`,
      )
      .join("");
  }
  function scheduleSave() {
    // Debouncing keeps navigation responsive while still persisting every answer to the server.
    if (submitting) return;
    clearTimeout(saveTimer);
    $("#saveState").textContent = "Saving…";
    saveTimer = setTimeout(async () => {
      try {
        await api.saveAttempt(attempt.id, {
          ...currentAnswerPayload(),
          flagged: attempt.flagged,
        });
        $("#saveState").textContent = "Saved to server";
      } catch (e) {
        $("#saveState").textContent = "Not saved — retrying";
        if (!submitting) scheduleSave();
      }
    }, 500);
  }
  $("#answerOptions").addEventListener("change", (event) => {
    if (event.target.name !== "answer") return;
    attempt.answers[attempt.questions[index].id] = event.target.value;
    scheduleSave();
    renderNavigation();
  });
  $("#flagButton").addEventListener("click", () => {
    const id = attempt.questions[index].id,
      pos = attempt.flagged.indexOf(id);
    pos >= 0 ? attempt.flagged.splice(pos, 1) : attempt.flagged.push(id);
    scheduleSave();
    render();
  });
  $("#previousButton").addEventListener("click", () => {
    if (index > 0) {
      index--;
      render();
    }
  });
  $("#nextButton").addEventListener("click", () => {
    if (index < attempt.questions.length - 1) {
      index++;
      render();
    }
  });
  $("#numberGrid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-index]");
    if (button) {
      index = +button.dataset.index;
      render();
      setMobileNavigation(false);
    }
  });
  function firstQuestionToReview() {
    const found = attempt.questions.findIndex(
      (q) => attempt.flagged.includes(q.id) || !attempt.answers[q.id],
    );
    return found >= 0 ? found : 0;
  }
  function setMobileNavigation(open) {
    const navigation = $("#questionNavigation"),
      toggle = $("#mobileNavigationToggle"),
      backdrop = $("#mobileNavigationBackdrop"),
      mobile = window.matchMedia("(max-width: 900px)").matches,
      expanded = mobile && open;
    navigation.classList.toggle("is-open", expanded);
    navigation.toggleAttribute("inert", mobile && !expanded);
    navigation.setAttribute("aria-hidden", String(mobile && !expanded));
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute(
      "aria-label",
      expanded ? "Close question navigation" : "Open question navigation",
    );
    backdrop.classList.toggle("is-visible", expanded);
    document.body.classList.toggle("mobile-navigation-open", expanded);
  }
  function closeExamConfirmation(result = false) {
    $("#examConfirmDialog").hidden = true;
    if (examConfirmationResolve) {
      const resolve = examConfirmationResolve;
      examConfirmationResolve = null;
      resolve(result);
    }
    examConfirmationTrigger?.focus();
    examConfirmationTrigger = null;
  }
  function confirmExamAction({ title, message, confirmLabel }) {
    examConfirmationTrigger = document.activeElement;
    $("#examConfirmTitle").textContent = title;
    $("#examConfirmMessage").textContent = message;
    $("#examConfirmAccept").textContent = confirmLabel;
    $("#examConfirmDialog").hidden = false;
    $("#examConfirmAccept").focus();
    return new Promise((resolve) => {
      examConfirmationResolve = resolve;
    });
  }
  const questionImagePattern =
    /\[\[question-image:(storage\/uploads\/questions\/[a-f0-9]{32}\.(?:jpg|png|webp))\]\]/g;
  const answerImagePattern =
    /\[\[answer-image:(storage\/uploads\/questions\/[a-f0-9]{32}\.(?:jpg|png|webp))\]\]/g;
  function questionImagePaths(question) {
    const paths = question.imagePaths?.length
      ? question.imagePaths
      : question.imagePath
        ? [question.imagePath]
        : [];
    return [...new Set([
      ...paths,
      ...question.options.flatMap((option) => option.imagePaths || []),
    ])];
  }
  function imageRecord(path) {
    if (!imageRecords.has(path)) {
      imageRecords.set(path, {
        path,
        state: "idle",
        objectUrl: "",
        size: 0,
        retries: 0,
        forceReload: false,
        queued: false,
        priority: Infinity,
        lastUsed: 0,
      });
    }
    return imageRecords.get(path);
  }
  function updateImageSlot(slot, record) {
    const image = slot.querySelector("img.exam-inline-image"),
      status = slot.querySelector(".exam-image-state"),
      message = slot.querySelector(".exam-image-message");
    if (record.objectUrl) {
      if (image.src !== record.objectUrl) image.src = record.objectUrl;
      image.hidden = false;
      status.hidden = true;
      record.lastUsed = Date.now();
      return;
    }
    image.hidden = true;
    status.hidden = false;
    status.classList.toggle("is-error", record.state === "failed");
    message.textContent = record.state === "failed"
      ? "Image could not be loaded. Use Reload Image above."
      : record.state === "retrying"
        ? "Retrying image..."
        : "Loading image...";
  }
  function updateImageSlots(record) {
    $("#examPage").querySelectorAll(".exam-image-slot").forEach((slot) => {
      if (slot.dataset.imagePath === record.path) updateImageSlot(slot, record);
    });
  }
  function pruneImageCache() {
    if (loadedImageBytes <= maxImageCacheBytes || !attempt) return;
    const protectedPaths = new Set([
      ...questionImagePaths(attempt.questions[index]),
      ...(attempt.questions[index + 1] ? questionImagePaths(attempt.questions[index + 1]) : []),
    ]);
    const candidates = [...imageRecords.values()]
      .filter((record) => record.state === "loaded" && !protectedPaths.has(record.path))
      .sort((a, b) => a.lastUsed - b.lastUsed);
    for (const record of candidates) {
      if (loadedImageBytes <= maxImageCacheBytes) break;
      URL.revokeObjectURL(record.objectUrl);
      loadedImageBytes -= record.size;
      record.objectUrl = "";
      record.size = 0;
      record.state = "idle";
    }
  }
  async function loadImage(record) {
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 20000);
    let objectUrl = "";
    try {
      const response = await fetch(record.path, {
        cache: record.forceReload || record.retries ? "reload" : "force-cache",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      if (record.objectUrl) {
        URL.revokeObjectURL(record.objectUrl);
        loadedImageBytes -= record.size;
      }
      record.objectUrl = objectUrl;
      record.size = blob.size;
      record.state = "loaded";
      loadedImageBytes += blob.size;
      updateImageSlots(record);
      pruneImageCache();
    } catch (_) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (record.retries < imageRetryDelays.length) {
        const delay = imageRetryDelays[record.retries++];
        record.state = "retrying";
        updateImageSlots(record);
        setTimeout(() => {
          record.state = "idle";
          scheduleImageLoads();
        }, delay);
      } else {
        record.state = record.objectUrl ? "loaded" : "failed";
        updateImageSlots(record);
      }
    } finally {
      clearTimeout(timeout);
      activeImageLoads -= 1;
      pumpImageQueue();
    }
  }
  function pumpImageQueue() {
    imageQueue.sort((a, b) => a.priority - b.priority);
    while (activeImageLoads < maxConcurrentImageLoads && imageQueue.length) {
      const record = imageQueue.shift();
      record.queued = false;
      if (record.state !== "idle") continue;
      record.state = "loading";
      updateImageSlots(record);
      activeImageLoads += 1;
      loadImage(record);
    }
  }
  function scheduleImageLoads() {
    if (!attempt) return;
    imageQueue.forEach((record) => { record.priority = Infinity; });
    const positions = attempt.questions.map((_, position) => position);
    const order = [
      index,
      ...positions.filter((position) => position > index),
      ...positions.filter((position) => position < index),
    ];
    order.forEach((position, priority) => {
      questionImagePaths(attempt.questions[position]).forEach((path) => {
        const record = imageRecord(path);
        if (record.state !== "idle") return;
        record.priority = Math.min(record.priority, priority);
        if (!record.queued) {
          record.queued = true;
          imageQueue.push(record);
        }
      });
    });
    pumpImageQueue();
  }
  function reloadImage(path) {
    const record = imageRecord(path);
    if (record.state !== "failed" && record.state !== "loaded") return;
    record.retries = 0;
    record.forceReload = true;
    record.state = "idle";
    record.priority = -1;
    record.queued = true;
    imageQueue.unshift(record);
    updateImageSlots(record);
    pumpImageQueue();
  }
  $("#reloadQuestionImages").addEventListener("click", () => {
    questionImagePaths(attempt.questions[index]).forEach(reloadImage);
  });
  function storedImage(path, alt) {
    const slot = document.createElement("span"),
      image = document.createElement("img"),
      status = document.createElement("span"),
      message = document.createElement("span");
    slot.className = "exam-image-slot";
    slot.dataset.imagePath = path;
    image.className = "exam-inline-image";
    image.alt = alt;
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.setAttribute("aria-label", `${alt}. View larger image`);
    status.className = "exam-image-state";
    status.setAttribute("role", "status");
    message.className = "exam-image-message";
    status.append(message);
    slot.append(image, status);
    updateImageSlot(slot, imageRecord(path));
    return slot;
  }
  function renderQuestionContent(question) {
    const container = $("#questionContent"),
      paths = question.imagePaths?.length
        ? question.imagePaths
        : question.imagePath
          ? [question.imagePath]
          : [];
    container.innerHTML = question.content;
    renderStoredImages(container, paths, questionImagePattern, "Question illustration");
  }
  function renderStoredImages(container, paths, imagePattern, alt) {
    const allowed = new Set(paths),
      represented = new Set();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT),
      textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach((textNode) => {
      const text = textNode.nodeValue;
      imagePattern.lastIndex = 0;
      if (!imagePattern.test(text)) return;
      imagePattern.lastIndex = 0;
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      for (const match of text.matchAll(imagePattern)) {
        fragment.append(text.slice(cursor, match.index));
        if (allowed.has(match[1])) {
          fragment.append(storedImage(match[1], alt));
          represented.add(match[1]);
        }
        cursor = match.index + match[0].length;
      }
      fragment.append(text.slice(cursor));
      textNode.replaceWith(fragment);
    });
    paths.filter((path) => !represented.has(path)).forEach((path) => {
      container.append(storedImage(path, alt));
    });
  }
  function openImagePreview(image) {
    imagePreviewTrigger = image;
    const preview = $("#examImagePreview");
    const previewImage = $("#examImagePreviewImage");
    previewImage.src = image.currentSrc || image.src;
    previewImage.alt = image.alt;
    preview.showModal();
    document.body.classList.add("image-preview-open");
    $("#examImagePreviewClose").focus();
  }
  $("#examPage").addEventListener("click", (event) => {
    const image = event.target.closest("img.exam-inline-image");
    if (!image) return;
    event.preventDefault();
    event.stopPropagation();
    openImagePreview(image);
  });
  $("#examPage").addEventListener("keydown", (event) => {
    if ((event.key !== "Enter" && event.key !== " ") ||
        !event.target.matches("img.exam-inline-image")) return;
    event.preventDefault();
    event.stopPropagation();
    openImagePreview(event.target);
  });
  $("#examImagePreviewClose").addEventListener("click", () =>
    $("#examImagePreview").close(),
  );
  $("#examImagePreview").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  $("#examImagePreview").addEventListener("close", () => {
    $("#examImagePreviewImage").removeAttribute("src");
    document.body.classList.remove("image-preview-open");
    if (imagePreviewTrigger?.isConnected) imagePreviewTrigger.focus();
    imagePreviewTrigger = null;
  });
  function renderReview() {
    const total = attempt.questions.length,
      answered = attempt.questions.filter((q) => attempt.answers[q.id]).length,
      unanswered = total - answered,
      percent = total ? Math.round((answered / total) * 100) : 0;
    $("#reviewExamTitle").textContent = attempt.title;
    $("#reviewAnswered").textContent = answered;
    $("#reviewUnanswered").textContent = unanswered;
    $("#reviewFlagged").textContent = attempt.flagged.length;
    $("#reviewTotal").textContent = total;
    $("#reviewPercent").textContent = `${percent}%`;
    $("#reviewProgressBar").style.width = `${percent}%`;
    $("#reviewWarning").hidden = unanswered === 0;
    $("#reviewQuestionGrid").innerHTML = attempt.questions
      .map(
        (question, questionIndex) =>
          `<button type="button" data-review-index="${questionIndex}" class="${attempt.flagged.includes(question.id) ? "flagged" : attempt.answers[question.id] ? "answered" : ""}">${questionIndex + 1}</button>`,
      )
      .join("");
    show("reviewPage");
  }
  $("#reviewButton").addEventListener("click", () => {
    setMobileNavigation(false);
    renderReview();
  });
  $("#reviewBackButton").addEventListener("click", () => {
    show("examPage");
    render();
  });
  $("#reviewAgainButton").addEventListener("click", () => {
    index = firstQuestionToReview();
    show("examPage");
    render();
  });
  $("#reviewQuestionGrid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-review-index]");
    if (!button) return;
    index = +button.dataset.reviewIndex;
    show("examPage");
    render();
  });
  function startTimer() {
    // The browser renders the server deadline; the API remains authoritative at submission time.
    clearInterval(timerId);
    tick();
    timerId = setInterval(tick, 1000);
  }
  function tick() {
    const remaining = Math.max(
      0,
      Math.ceil(
        (new Date(attempt.expiresAt.replace(" ", "T") + "+07:00") -
          Date.now()) /
          1000,
      ),
    );
    const minutes = Math.floor(remaining / 60),
      seconds = remaining % 60;
    $("#timer").textContent =
      `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    $("#timer").classList.toggle("warning", remaining <= 300);
    if (!remaining) {
      clearInterval(timerId);
      submit(true);
    }
  }
  async function submit(automatic = false) {
    if (!automatic) {
      const confirmed = await confirmExamAction({
        title: "Ready to submit?",
        message:
          "Your answers will be submitted permanently and cannot be changed afterward.",
        confirmLabel: "Submit Answers",
      });
      if (!confirmed) return;
    }
    $("#submitButton").disabled = true;
    $("#confirmSubmitButton").disabled = true;
    submitting = true;
    clearTimeout(saveTimer);
    try {
      await api.submitAttempt(attempt.id, currentAnswerPayload());
      complete();
    } catch (e) {
      submitting = false;
      alert(e.message);
      $("#submitButton").disabled = false;
      $("#confirmSubmitButton").disabled = false;
      scheduleSave();
    }
  }
  $("#submitButton").addEventListener("click", renderReview);
  $("#confirmSubmitButton").addEventListener("click", () => submit(false));
  $("#mobileNavigationToggle").addEventListener("click", () => {
    setMobileNavigation(
      $("#mobileNavigationToggle").getAttribute("aria-expanded") !== "true",
    );
  });
  $("#mobileNavigationClose").addEventListener("click", () =>
    setMobileNavigation(false),
  );
  $("#mobileNavigationBackdrop").addEventListener("click", () =>
    setMobileNavigation(false),
  );
  $("#examConfirmClose").addEventListener("click", () =>
    closeExamConfirmation(false),
  );
  $("#examConfirmCancel").addEventListener("click", () =>
    closeExamConfirmation(false),
  );
  $("#examConfirmAccept").addEventListener("click", () =>
    closeExamConfirmation(true),
  );
  window.addEventListener("resize", () => setMobileNavigation(false));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if ($("#examImagePreview").open) return;
    if (!$("#examConfirmDialog").hidden) closeExamConfirmation(false);
    else setMobileNavigation(false);
  });
  function complete() {
    clearInterval(timerId);
    localStorage.removeItem(storageKey);
    $("#completeRegistration").textContent =
      attempt?.registrationNumber || application?.registrationNumber || "";
    show("completePage");
  }
  setMobileNavigation(false);
  initialize();
})();
