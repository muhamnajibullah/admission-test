(function () {
  "use strict";
  // Dashboard sections load only the resource they currently display.
  const api = window.AdmissionApi,
    app = document.querySelector("#app"),
    flash = document.querySelector("#flash"),
    breadcrumb = document.querySelector("#breadcrumb"),
    modal = document.querySelector("#modal"),
    modalContent = document.querySelector("#modalContent"),
    imagePreview = document.querySelector("#adminImagePreview"),
    imagePreviewImage = document.querySelector("#adminImagePreviewImage"),
    latexModal = document.querySelector("#latexModal"),
    latexModalTitle = document.querySelector("#latexModalTitle"),
    latexInput = document.querySelector("#latexInput"),
    latexPreview = document.querySelector("#latexPreview"),
    insertLatexButton = document.querySelector("#insertLatex");
  let section = "units",
    view = "list",
    routeId = 0,
    units = [],
    banks = [],
    questionIndex = 0,
    resultPage = 1,
    resultUnit = "",
    resultStatus = "all",
    resultPageSize = 5,
    resultSearch = "",
    resultSearchTimer = null,
    resultRequestId = 0,
    activeEditor = null,
    activeRange = null,
    activeFormula = null,
    latexScrollPosition = { left: 0, top: 0 },
    confirmationResolve = null,
    tokenCountdownId = null,
    pendingImageUploads = 0,
    imagePreviewTrigger = null;
  const editorSelections = new WeakMap();
  const backChevron = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"></path></svg>';
  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  function message(text, type = "success") {
    flash.textContent = text;
    flash.className = `flash ${type}`;
    setTimeout(() => {
      flash.textContent = "";
    }, 4000);
  }
  function setProfileMenu(open, returnFocus = false) {
    const profileButton = document.querySelector("#adminProfileButton"),
      dropdown = document.querySelector("#adminProfileDropdown");
    dropdown.hidden = !open;
    profileButton.setAttribute("aria-expanded", String(open));
    if (open) {
      requestAnimationFrame(() =>
        dropdown.querySelector('[role="menuitem"]')?.focus(),
      );
    } else if (returnFocus) profileButton.focus();
  }
  function showModal(html) {
    modalContent.innerHTML = html;
    modal.querySelector(".admin-modal").scrollTop = 0;
    modal.hidden = false;
    renderMath(modalContent);
  }
  function closeModal(confirmationResult = false) {
    if (confirmationResolve) {
      const resolve = confirmationResolve;
      confirmationResolve = null;
      resolve(confirmationResult);
    }
    modal.hidden = true;
    modalContent.innerHTML = "";
    modal.querySelector(".admin-modal").scrollTop = 0;
    modal
      .querySelector(".admin-modal")
      ?.classList.remove(
        "result-review-modal",
        "export-dialog-modal",
        "confirm-dialog-modal",
      );
  }
  function confirmAction({
    title,
    message: description,
    confirmLabel,
    danger = false,
  }) {
    showModal(
      `<section class="confirm-dialog"><div class="confirm-dialog-icon" aria-hidden="true">?</div><h2>${escape(title)}</h2><p>${escape(description)}</p><div class="confirm-dialog-actions"><button type="button" class="secondary" data-confirm-cancel>Cancel</button><button type="button" class="primary ${danger ? "is-danger" : ""}" data-confirm-accept>${escape(confirmLabel)}</button></div></section>`,
    );
    modal.querySelector(".admin-modal")?.classList.add("confirm-dialog-modal");
    return new Promise((resolve) => {
      confirmationResolve = resolve;
    });
  }
  function showQuestionBankSaved() {
    showModal(
      '<section class="confirm-dialog"><div class="confirm-dialog-icon" aria-hidden="true">&#10003;</div><h2>Question Bank Saved</h2><p>All question bank settings, questions, and answer choices have been saved.</p><div class="confirm-dialog-actions"><button type="button" class="secondary" data-close-modal>Continue Editing</button><button type="button" class="primary" data-action="back-to-banks">Back to Question Banks</button></div></section>',
    );
    modal.querySelector(".admin-modal")?.classList.add("confirm-dialog-modal");
  }
  function showUploadError(fileName, reason) {
    showModal(
      `<section class="confirm-dialog"><div class="confirm-dialog-icon is-error" aria-hidden="true">!</div><h2>Image Upload Failed</h2><p><strong>${escape(fileName)}</strong>: ${escape(reason)}</p><div class="confirm-dialog-actions"><button type="button" class="primary" data-close-modal>Close</button></div></section>`,
    );
    modal.querySelector(".admin-modal")?.classList.add("confirm-dialog-modal");
    modalContent.querySelector("[data-close-modal]")?.focus();
  }
  function openImagePreview(image) {
    imagePreviewTrigger = image;
    imagePreviewImage.src = image.src;
    imagePreviewImage.alt = image.alt || "Image preview";
    imagePreview.showModal();
    document.querySelector("#adminImagePreviewClose").focus();
  }
  function closeImagePreview() {
    imagePreview.close();
    imagePreviewImage.removeAttribute("src");
    imagePreviewTrigger?.focus({ preventScroll: true });
    imagePreviewTrigger = null;
  }
  function renderMath(root = document) {
    if (window.renderMathInElement)
      window.renderMathInElement(root, {
        delimiters: [
          { left: "\\(", right: "\\)", display: false },
          { left: "\\[", right: "\\]", display: true },
        ],
        throwOnError: false,
      });
  }
  function mathExpression(latex) {
    const node = document.createElement("span");
    node.className = "latex-expression";
    node.contentEditable = "false";
    node.dataset.latex = latex;
    node.setAttribute("aria-label", `Math formula: ${latex}`);
    if (window.katex) {
      window.katex.render(latex, node, {
        throwOnError: false,
        strict: false,
      });
    } else {
      node.textContent = latex;
    }
    return node;
  }
  function openLatexModal() {
    latexScrollPosition = { left: window.scrollX, top: window.scrollY };
    latexModal.hidden = false;
    requestAnimationFrame(() => {
      latexInput.focus({ preventScroll: true });
      window.scrollTo({ ...latexScrollPosition, behavior: "auto" });
    });
  }
  function closeLatexModal() {
    latexModal.hidden = true;
    const position = { ...latexScrollPosition };
    requestAnimationFrame(() =>
      window.scrollTo({ ...position, behavior: "auto" }),
    );
  }
  function hydrateEditorMath(root = document) {
    root.querySelectorAll(".rich-editor").forEach((richEditor) => {
      const walker = document.createTreeWalker(
        richEditor,
        NodeFilter.SHOW_TEXT,
      );
      const textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);
      textNodes.forEach((textNode) => {
        if (textNode.parentElement.closest(".latex-expression")) return;
        const text = textNode.nodeValue,
          pattern = /\\\((.+?)\\\)/g;
        if (!pattern.test(text)) return;
        pattern.lastIndex = 0;
        const fragment = document.createDocumentFragment();
        let cursor = 0;
        for (const match of text.matchAll(pattern)) {
          fragment.append(text.slice(cursor, match.index));
          fragment.append(mathExpression(match[1]));
          cursor = match.index + match[0].length;
        }
        fragment.append(text.slice(cursor));
        textNode.replaceWith(fragment);
      });
    });
  }
  const questionImagePattern =
    /\[\[question-image:(storage\/uploads\/questions\/[a-f0-9]{32}\.(?:jpg|png|webp))\]\]/g;
  const answerImagePattern =
    /\[\[answer-image:(storage\/uploads\/questions\/[a-f0-9]{32}\.(?:jpg|png|webp))\]\]/g;
  function inlineEditorImage(path, markerType = "question") {
    const node = document.createElement("span"),
      image = document.createElement("img"),
      remove = document.createElement("button");
    node.className = "inline-question-image";
    node.contentEditable = "false";
    node.dataset.imageItem = "";
    node.dataset.imagePath = path;
    node.dataset.imageMarker = markerType;
    image.src = path;
    image.alt = markerType === "answer" ? "Answer image preview" : "Question image preview";
    image.dataset.adminImagePreview = "";
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.setAttribute("aria-label", `Preview ${markerType} image`);
    remove.type = "button";
    remove.dataset.removeImage = "";
    remove.setAttribute("aria-label", "Remove this image");
    remove.textContent = "×";
    node.append(image, remove);
    return node;
  }
  function hydrateEditorImages(root = document) {
    root.querySelectorAll(".rich-editor").forEach((richEditor) => {
      const markerType = richEditor.dataset.name === "content" ? "question" : "answer",
        imagePattern = markerType === "question" ? questionImagePattern : answerImagePattern;
      const walker = document.createTreeWalker(richEditor, NodeFilter.SHOW_TEXT),
        textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);
      textNodes.forEach((textNode) => {
        if (textNode.parentElement.closest(".inline-question-image")) return;
        const text = textNode.nodeValue;
        imagePattern.lastIndex = 0;
        if (!imagePattern.test(text)) return;
        imagePattern.lastIndex = 0;
        const fragment = document.createDocumentFragment();
        let cursor = 0;
        for (const match of text.matchAll(imagePattern)) {
          fragment.append(text.slice(cursor, match.index));
          fragment.append(inlineEditorImage(match[1], markerType));
          cursor = match.index + match[0].length;
        }
        fragment.append(text.slice(cursor));
        textNode.replaceWith(fragment);
      });
    });
  }
  function rememberEditorSelection(editor) {
    const selection = window.getSelection();
    activeRange =
      selection.rangeCount && editor.contains(selection.anchorNode)
        ? selection.getRangeAt(0).cloneRange()
        : editorSelections.get(editor) || null;
  }
  function insertMathIntoEditor(editor, latex) {
    const selection = window.getSelection(),
      range = activeRange || document.createRange();
    editor.focus({ preventScroll: true });
    if (!activeRange) {
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    range.deleteContents();
    const formula = mathExpression(latex),
      spacer = document.createTextNode("\u00a0");
    range.insertNode(spacer);
    range.insertNode(formula);
    range.setStartAfter(spacer);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    editorSelections.set(editor, range.cloneRange());
    activeRange = null;
  }
  function insertImageIntoEditor(editor, path, savedRange = null) {
    const selection = window.getSelection(),
      remembered = savedRange || editorSelections.get(editor),
      range = remembered ? remembered.cloneRange() : document.createRange();
    editor.focus();
    if (!remembered) {
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    range.deleteContents();
    const markerType = editor.dataset.name === "content" ? "question" : "answer",
      preview = inlineEditorImage(path, markerType),
      spacer = document.createTextNode("\u00a0");
    range.insertNode(spacer);
    range.insertNode(preview);
    range.setStartAfter(spacer);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    const nextRange = range.cloneRange();
    editorSelections.set(editor, nextRange);
    return nextRange;
  }
  function button(label, action, id = "", disabled = false) {
    const tone = action.startsWith("view-")
      ? " action-view"
      : action.startsWith("edit-")
        ? " action-edit"
        : action.startsWith("activate-")
          ? " action-activate"
          : action.startsWith("inactivate-")
            ? " action-inactivate"
        : action.startsWith("delete-")
          ? " action-delete"
          : "";
    return `<button type="button" class="secondary action-button${tone}" data-action="${action}" ${id ? `data-id="${id}"` : ""} ${disabled ? "disabled" : ""}>${label}</button>`;
  }
  const sectionLabels = {
    units: "Units",
    banks: "Question Banks",
    results: "Test Results",
    tokens: "Exam Token",
  };
  function readRoute() {
    const params = new URLSearchParams(location.search),
      requestedSection = params.get("section") || "units";
    section = sectionLabels[requestedSection] ? requestedSection : "units";
    view = params.get("view") || "list";
    routeId = Math.max(0, Number.parseInt(params.get("id") || "0", 10) || 0);
    const allowedViews = {
      units: ["list", "unit-form"],
      banks: ["list", "bank-form"],
      results: ["list"],
      tokens: ["list"],
    };
    if (!allowedViews[section].includes(view)) view = "list";
  }
  function updateNavigation() {
    document.querySelectorAll("[data-section]").forEach((item) => {
      item.classList.toggle("is-active", item.dataset.section === section);
    });
    document.querySelector("#pageTitle").textContent =
      section === "units" ? "Unit List" : sectionLabels[section];
  }
  function renderBreadcrumb() {
    const current = sectionLabels[section];
    breadcrumb.innerHTML =
      view === "unit-form"
        ? `<a href="dashboard.html">Dashboard</a><span aria-hidden="true">›</span><a href="dashboard.html?section=units">Units</a><span aria-hidden="true">›</span><span aria-current="page">${routeId ? "Edit Unit" : "Create Unit"}</span>`
        : view === "bank-form"
          ? `<a href="dashboard.html">Dashboard</a><span aria-hidden="true">›</span><a href="dashboard.html?section=banks">Question Banks</a><span aria-hidden="true">›</span><span aria-current="page">${routeId ? "Edit Question Bank" : "Create Question Bank"}</span>`
          : `<a href="dashboard.html">Dashboard</a><span aria-hidden="true">›</span><span aria-current="page">${current}</span>`;
  }
  function navigate(nextSection, nextView = "list", id = 0, replace = false) {
    const params = new URLSearchParams();
    params.set("section", nextSection);
    if (nextView !== "list") params.set("view", nextView);
    if (id) params.set("id", String(id));
    history[replace ? "replaceState" : "pushState"](
      {},
      "",
      `dashboard.html?${params.toString()}`,
    );
    renderRoute();
  }
  async function renderRoute() {
    resultRequestId += 1;
    if (resultSearchTimer) {
      clearTimeout(resultSearchTimer);
      resultSearchTimer = null;
    }
    if (tokenCountdownId) {
      clearInterval(tokenCountdownId);
      tokenCountdownId = null;
    }
    readRoute();
    updateNavigation();
    renderBreadcrumb();
    if (section === "units" && view === "unit-form") {
      if (!routeId) {
        unitForm();
        return;
      }
      app.innerHTML = '<div class="loading">Loading...</div>';
      try {
        units = (await api.units()).units;
        const unit = units.find((item) => +item.id === routeId);
        if (!unit) throw new Error("Unit not found.");
        unitForm(unit);
      } catch (error) {
        message(error.message, "error");
        navigate("units", "list", 0, true);
      }
      return;
    }
    if (section === "banks" && view === "bank-form") {
      app.innerHTML = '<div class="loading">Loading...</div>';
      try {
        units = (await api.units()).units;
        if (!units.length) throw new Error("Create a unit before creating a question bank.");
        let bank = null;
        if (routeId) bank = (await api.bank(routeId)).questionBank;
        questionIndex = 0;
        bankForm(bank);
      } catch (error) {
        message(error.message, "error");
        navigate("banks", "list", 0, true);
      }
      return;
    }
    load();
  }
  async function load() {
    app.innerHTML = '<div class="loading">Loading…</div>';
    try {
      if (section === "units") await renderUnits();
      if (section === "banks") await renderBanks();
      if (section === "results") await renderResults();
      if (section === "tokens") await renderTokens();
    } catch (error) {
      if (error.status === 401) {
        location.replace("login.html");
        return;
      }
      app.innerHTML = `<div class="empty">${escape(error.message)}</div>`;
    }
  }
  async function renderUnits() {
    units = (await api.units()).units;
    app.innerHTML = `<div class="section-tools"><div><h2>Unit Management</h2><p>Each unit belongs to Jakarta or Surabaya and can use one active question bank.</p></div><button class="primary" data-action="new-unit">Create Unit</button></div><div class="table-card"><table><thead><tr><th>Unit</th><th>City</th><th>Question Banks</th><th>Status</th><th>Actions</th></tr></thead><tbody>${units.map((unit) => `<tr><td><strong>${escape(unit.name)}</strong><small>${escape(unit.description || "")}</small></td><td>${escape(unit.city)}</td><td>${unit.questionBankCount}</td><td><span class="pill ${+unit.isActive ? "active" : ""}">${+unit.isActive ? "Active" : "Inactive"}</span></td><td>${button("Edit", "edit-unit", unit.id)} ${button("Delete", "delete-unit", unit.id)}</td></tr>`).join("") || '<tr><td colspan="5" class="empty">No units yet.</td></tr>'}</tbody></table></div>`;
  }
  function unitForm(unit = {}) {
    app.innerHTML = `<section class="unit-editor"><form id="unitForm"><input type="hidden" name="id" value="${unit.id || ""}"><header class="unit-editor-header"><div><button class="unit-back" type="button" data-action="back-to-units" aria-label="Back to units">${backChevron}</button><h2>${unit.id ? "Edit" : "Create"} Unit</h2></div><button class="primary unit-save" type="submit">Save Unit <span aria-hidden="true">+</span></button></header><div class="unit-form-row"><div class="unit-field-copy"><strong>Unit Name</strong><span>Enter the school unit name shown to candidates.</span></div><label><span class="sr-only">Unit Name</span><input name="name" maxlength="120" placeholder="Enter the unit name" required value="${escape(unit.name || "")}"><small>Examples: SD Islam Al Azhar 13 Rawamangun, SMP Islam Al Azhar Kelapa Gading</small></label></div><div class="unit-form-row"><div class="unit-field-copy"><strong>City</strong><span>Select the city where this unit is located.</span></div><label><span class="sr-only">City</span><select name="city" required><option value="Jakarta" ${unit.city === "Jakarta" ? "selected" : ""}>Jakarta</option><option value="Surabaya" ${unit.city === "Surabaya" ? "selected" : ""}>Surabaya</option></select></label></div><div class="unit-form-row"><div class="unit-field-copy"><strong>Description</strong><span>Add a short description to help administrators identify this unit.</span></div><label><span class="sr-only">Description</span><textarea name="description" rows="7" placeholder="Enter description for the unit">${escape(unit.description || "")}</textarea></label></div><div class="unit-form-row"><div class="unit-field-copy"><strong>Registration Access</strong><span>Allow candidates to select this unit after an active question bank is available.</span></div><label class="unit-availability"><input name="isActive" type="checkbox" ${unit.id && !+unit.isActive ? "" : "checked"}><span>Available for registration</span></label></div></form></section>`;
    document.querySelector("#unitForm").addEventListener("submit", saveUnit);
  }
  async function saveUnit(event) {
    event.preventDefault();
    event.stopPropagation();
    const form = event.currentTarget,
      idInput = form.querySelector('[name="id"]'),
      submitButton = form.querySelector('[type="submit"]'),
      data = Object.fromEntries(new FormData(form));
    data.isActive = form.querySelector('[name="isActive"]').checked;
    submitButton.disabled = true;
    try {
      idInput.value
        ? await api.updateUnit(idInput.value, data)
        : await api.createUnit(data);
      message("Unit saved.");
      navigate("units", "list", 0, true);
    } catch (error) {
      message(error.message, "error");
      submitButton.disabled = false;
    }
  }
  async function renderBanks() {
    const [unitPayload, bankPayload] = await Promise.all([
      api.units(),
      api.banks(),
    ]);
    units = unitPayload.units;
    banks = bankPayload.questionBanks;
    app.innerHTML = `<div class="section-tools"><div><h2>Question Banks</h2><p>Only one question bank can be active for each unit.</p></div><button class="primary" data-action="new-bank" ${units.length ? "" : "disabled"}>Create Question Bank</button></div><div class="table-card"><table><thead><tr><th>Title</th><th>Unit</th><th>Questions</th><th>Duration</th><th>Status</th><th>Actions</th></tr></thead><tbody>${banks.map((bank) => `<tr><td><strong>${escape(bank.title)}</strong></td><td>${escape(bank.unitName)}<small>${escape(bank.city)}</small></td><td>${bank.questionCount}</td><td>${Math.round(bank.durationSeconds / 60)} min</td><td><span class="pill ${+bank.isActive ? "active" : ""}">${+bank.isActive ? "Active" : "Draft"}</span></td><td>${button("Edit", "edit-bank", bank.id)} ${button("Activate", "activate-bank", bank.id, +bank.isActive)} ${button("Inactivate", "inactivate-bank", bank.id, !+bank.isActive)} ${button("Delete", "delete-bank", bank.id)}</td></tr>`).join("") || '<tr><td colspan="6" class="empty">No question banks yet.</td></tr>'}</tbody></table></div>`;
    app.querySelectorAll(".pill:not(.active)").forEach((pill) => {
      if (pill.textContent === "Draft") pill.textContent = "Inactive";
    });
  }
  const mathPresets = [
    ["a/b", "\\frac{a}{b}"], ["1 ⅔", "1\\frac{2}{3}"],
    ["√x", "\\sqrt{x}"], ["ⁿ√x", "\\sqrt[n]{x}"],
    ["x²", "x^{2}"], ["xⁿ", "x^{n}"],
    ["lim", "\\lim_{x \\to a}"], ["∫", "\\int_{a}^{b} f(x)\\,dx"],
    ["d/dx", "\\frac{d}{dx}"], ["Σ", "\\sum_{i=1}^{n}"],
    ["π", "\\pi"], ["∞", "\\infty"], ["≤", "\\le"],
    ["≥", "\\ge"], ["≠", "\\ne"], ["±", "\\pm"],
    ["θ", "\\theta"], ["→", "\\to"],
  ];
  function mathToolbar() {
    return `<div class="math-toolbar"><strong>MATH</strong>${mathPresets.map(([label, latex]) => `<button type="button" data-math="${escape(latex)}" title="${escape(latex)}">${label}</button>`).join("")}<button type="button" data-open-latex title="Open full LaTeX editor">ƒx</button></div>`;
  }
  function editor(value, name, withMath = false) {
    return `<div class="rich-wrap"><div class="rich-editor" contenteditable="true" data-name="${name}" role="textbox" aria-multiline="true">${value || ""}</div>${withMath ? mathToolbar() : ""}<div class="editor-toolbar"><button type="button" data-format="bold"><b>B</b></button><button type="button" data-format="italic"><i>I</i></button><button type="button" data-format="underline"><u>U</u></button><button type="button" data-format="strikeThrough"><s>S</s></button><button type="button" data-format="insertUnorderedList" aria-label="Bulleted list">• List</button><button type="button" data-format="insertOrderedList" aria-label="Numbered list">1. List</button>${withMath ? '<button type="button" data-open-latex>LaTeX</button>' : ""}</div></div>`;
  }
  function contentWithImageMarkers(content, imagePaths, markerType = "question") {
    const represented = new Set();
    const imagePattern = markerType === "question" ? questionImagePattern : answerImagePattern;
    imagePattern.lastIndex = 0;
    for (const match of String(content || "").matchAll(imagePattern)) represented.add(match[1]);
    let normalized = String(content || "");
    imagePaths.forEach((path) => {
      if (!represented.has(path)) normalized += `[[${markerType}-image:${path}]]`;
    });
    return normalized;
  }
  function questionCard(question = {}, index = 0) {
    const options = question.options || {},
      correct = question.correctOption || "A",
      imagePaths = question.imagePaths?.length
        ? question.imagePaths
        : question.imagePath
          ? [question.imagePath]
          : [];
    const optionImagePaths = question.optionImagePaths || {},
      answers = ["A", "B", "C", "D"]
      .map(
        (key) =>
          `<div class="answer-editor" data-answer-editor="${key}"><input type="radio" name="correct-${index}" value="${key}" data-correct-radio aria-label="Set option ${key} as the correct answer" ${correct === key ? "checked" : ""}><span class="answer-letter">${key}</span>${editor(contentWithImageMarkers(options[key], optionImagePaths[key] || [], "answer"), key, true)}<button type="button" class="answer-editor-toggle" data-toggle-answer-editor aria-expanded="false">Editor: Off</button><label class="image-upload answer-image-upload"><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,.heic" data-answer-image multiple><span>Attach images at cursor</span></label><span class="upload-status answer-upload-status">JPG, PNG, WebP, or HEIC; files above 2 MB are compressed below 1 MB.</span></div>`,
      )
      .join("");
    return `<article class="question-card ${index === questionIndex ? "is-active" : ""}" data-question><div class="bank-form-row question-content-row"><div class="bank-field-copy"><strong>Question</strong><span>Add text, equation symbols, and up to 10 images for this question.</span></div><div class="question-editor-field">${editor(contentWithImageMarkers(question.content, imagePaths), "content", true)}<label class="image-upload question-image-upload"><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,.heic" data-image multiple><span>Attach images at cursor</span></label><span class="upload-status question-upload-status">Place the cursor in the question first. JPG, PNG, WebP, or HEIC; files above 2 MB are compressed below 1 MB.</span></div></div><div class="bank-form-row answer-row"><div class="bank-field-copy"><strong>Answer</strong><span>Select the correct answer. Each option can also contain up to 10 images.</span></div><div class="answer-editor-list">${answers}</div></div></article>`;
  }
  function bankForm(bank = null) {
    const questions = bank?.questions?.length ? bank.questions : [{}];
    app.innerHTML = `<section class="bank-editor"><form id="bankForm"><input type="hidden" name="id" value="${bank?.id || ""}"><header class="bank-editor-header"><div><button class="unit-back" type="button" data-action="back-to-banks" aria-label="Back to question banks">${backChevron}</button><h2>${bank ? "Edit" : "Create"} Question Bank</h2></div><button class="primary bank-publish" type="submit">${bank ? "Save Changes" : "Publish"} <span aria-hidden="true">+</span></button></header><section class="bank-settings"><div class="bank-form-row"><div class="bank-field-copy"><strong>Unit</strong><span>Choose the school unit for this question bank. Moving it to a unit that already has a bank keeps this bank inactive.</span></div><label><span class="sr-only">Unit</span><select name="unitId" required><option value="">Select unit for the question bank</option>${units.map((unit) => `<option value="${unit.id}" ${bank && +bank.unitId === +unit.id ? "selected" : ""}>${escape(unit.name)} - ${escape(unit.city)}</option>`).join("")}</select></label></div><div class="bank-form-row"><div class="bank-field-copy"><strong>Question Bank Title</strong><span>Provide a clear name for this collection of questions.</span></div><label><span class="sr-only">Question Bank Title</span><input name="title" maxlength="160" placeholder="Enter question bank title" required value="${escape(bank?.title || "")}"></label></div><div class="bank-form-row"><div class="bank-field-copy"><strong>Passing Score</strong><span>Set the minimum score required to pass.</span></div><label><span class="sr-only">Passing Score</span><input name="passingScore" type="number" min="0" max="100" placeholder="Enter passing score" required value="${bank?.passingScore ?? 75}"></label></div><div class="bank-form-row"><div class="bank-field-copy"><strong>Exam Duration</strong><span>Set the maximum time available for completing the exam.</span></div><label class="duration-field"><span class="sr-only">Exam Duration in Minutes</span><input name="durationMinutes" type="number" min="1" max="480" required value="${bank ? Math.round(bank.durationSeconds / 60) : 60}"><span>Minutes</span></label></div><div class="bank-form-row"><div class="bank-field-copy"><strong>Randomize</strong><span>Shuffle both questions and answer choices for each participant.</span></div><label class="segmented-toggle"><input name="shuffleQuestions" type="checkbox" ${bank && !bank.shuffleQuestions ? "" : "checked"}><span data-toggle-on>Enable</span><span data-toggle-off>Disable</span></label></div><div class="bank-form-row bulk-row"><div class="bank-field-copy"><strong>Bulk Upload Question Bank <i title="Use the provided Excel template">i</i></strong><span>Upload questions using the provided template, preview them, then publish.</span></div><div class="bulk-upload-box"><div><a class="secondary bulk-download" href="Image/template_bulk_upload_soal.xlsx" download>↓ Download Template</a><label class="primary bulk-upload"><input type="file" accept=".xlsx" data-question-import><span>↑ Bulk Upload</span></label></div><p class="bulk-status">No template uploaded yet.</p><small>Columns: questionText, optionA, optionB, optionC, optionD, correctOption.</small></div></div></section><section class="question-builder"><header><h2>Add Question</h2><div class="question-header-actions"><button class="primary save-question-button" type="submit">Save Question</button><nav class="question-pagination" aria-label="Question pagination"><button type="button" data-question-prev aria-label="Previous question">‹</button><div data-question-pages></div><button type="button" data-add-question aria-label="Add question">+</button><button type="button" class="remove-question" data-remove-question aria-label="Remove current question">−</button><button type="button" data-question-next aria-label="Next question">›</button></nav></div></header><div id="questionList">${questions.map(questionCard).join("")}</div></section></form></section>`;
    const form = document.querySelector("#bankForm"),
      titleInput = form.querySelector('[name="title"]');
    titleInput.type = "hidden";
    titleInput.required = false;
    titleInput.closest(".bank-form-row").hidden = true;
    form.addEventListener("submit", saveQuestionBank);
    renderQuestionPagination();
    hydrateEditorMath(form);
    hydrateEditorImages(form);
  }
  function renderQuestionPagination() {
    const cards = [...document.querySelectorAll("[data-question]")];
    if (!cards.length) return;
    questionIndex = Math.max(0, Math.min(questionIndex, cards.length - 1));
    cards.forEach((card, index) => {
      card.classList.toggle("is-active", index === questionIndex);
      card.querySelectorAll("[data-correct-radio]").forEach((radio) => {
        radio.name = `correct-${index}`;
      });
    });
    const pages = document.querySelector("[data-question-pages]");
    pages.innerHTML = cards
      .map(
        (_, index) =>
          `<button type="button" data-question-page="${index}" class="${index === questionIndex ? "is-active" : ""}" aria-label="Open question ${index + 1}" aria-current="${index === questionIndex ? "page" : "false"}">${index + 1}</button>`,
      )
      .join("");
    document.querySelector("[data-question-prev]").disabled =
      questionIndex === 0;
    document.querySelector("[data-question-next]").disabled =
      questionIndex === cards.length - 1;
    document.querySelector("[data-remove-question]").disabled =
      cards.length === 1;
  }
  async function saveQuestionBank(event) {
    event.preventDefault();
    event.stopPropagation();
    if (pendingImageUploads > 0) {
      message("Wait for image uploads to finish before saving the question bank.", "error");
      return;
    }
    const form = event.currentTarget,
      idInput = form.querySelector('[name="id"]'),
      id = idInput.value,
      stayInEditor = event.submitter?.matches(".save-question-button"),
      submitButtons = [...form.querySelectorAll('[type="submit"]')];
    submitButtons.forEach((button) => (button.disabled = true));
    try {
      const data = bankPayload(form);
      const saved = id
        ? await api.updateBank(id, data)
        : await api.createBank(data);
      message("Question bank saved.");
      if (stayInEditor) {
        const savedId = +(saved.id || id);
        idInput.value = String(savedId);
        routeId = savedId;
        history.replaceState(
          {},
          "",
          `dashboard.html?section=banks&view=bank-form&id=${savedId}`,
        );
        renderBreadcrumb();
        const editorTitle = form.querySelector(".bank-editor-header h2");
        if (editorTitle) editorTitle.textContent = "Edit Question Bank";
        const publishButton = form.querySelector(".bank-publish");
        if (publishButton) publishButton.innerHTML = 'Save Changes <span aria-hidden="true">+</span>';
        submitButtons.forEach((button) => (button.disabled = false));
        showQuestionBankSaved();
      } else {
        navigate("banks", "list", 0, true);
      }
    } catch (error) {
      message(error.message, "error");
      submitButtons.forEach((button) => (button.disabled = false));
    }
  }
  function sanitizeEditor(editor) {
    // This improves pasted content immediately; the server repeats authoritative sanitization.
    const clone = editor.cloneNode(true);
    clone.querySelectorAll(".latex-expression").forEach((formula) => {
      formula.replaceWith(
        document.createTextNode(`\\(${formula.dataset.latex || ""}\\)`),
      );
    });
    clone.querySelectorAll(".inline-question-image").forEach((image) => {
      const markerType = image.dataset.imageMarker === "answer" ? "answer" : "question";
      image.replaceWith(
        document.createTextNode(`[[${markerType}-image:${image.dataset.imagePath || ""}]]`),
      );
    });
    const allowed = new Set([
        "P",
        "DIV",
        "STRONG",
        "B",
        "EM",
        "I",
        "U",
        "S",
        "UL",
        "OL",
        "LI",
        "BR",
      ]);
    (function clean(node) {
      [...node.childNodes].forEach((child) => {
        if (child.nodeType === 1) {
          [...child.attributes].forEach((attr) =>
            child.removeAttribute(attr.name),
          );
          if (!allowed.has(child.tagName)) {
            child.replaceWith(...child.childNodes);
          } else clean(child);
        } else if (child.nodeType !== 3) child.remove();
      });
    })(clone);
    return clone.innerHTML;
  }
  function bankPayload(form) {
    // Question content is serialized as an allowlisted rich-text document, never a browser DOM dump.
    const shuffle = form.querySelector('[name="shuffleQuestions"]').checked,
      unitSelect = form.querySelector('select[name="unitId"]'),
      unitFallback = form.querySelector('input[name="unitId"]');
    return {
      unitId: +(unitSelect.value || unitFallback?.value || 0),
      title:
        form.querySelector('[name="title"]').value.trim() ||
        `${unitSelect.options[unitSelect.selectedIndex]?.text || "Unit"} Question Bank`,
      passingScore: +form.querySelector('[name="passingScore"]').value,
      durationSeconds:
        +form.querySelector('[name="durationMinutes"]').value * 60,
      shuffleQuestions: shuffle,
      shuffleOptions: shuffle,
      questions: [...form.querySelectorAll("[data-question]")].map((card) => {
        const editors = Object.fromEntries(
          [...card.querySelectorAll(".rich-editor")].map((item) => [
            item.dataset.name,
            sanitizeEditor(item),
          ]),
        );
        return {
          content: editors.content,
          imagePaths: [...card.querySelectorAll('.rich-editor[data-name="content"] [data-image-item]')].map(
            (image) => image.dataset.imagePath,
          ),
          correctOption:
            card.querySelector("[data-correct-radio]:checked")?.value || "",
          options: { A: editors.A, B: editors.B, C: editors.C, D: editors.D },
          optionImagePaths: Object.fromEntries(
            ["A", "B", "C", "D"].map((key) => [
              key,
              [...card.querySelectorAll(`.rich-editor[data-name="${key}"] [data-image-item]`)].map(
                (image) => image.dataset.imagePath,
              ),
            ]),
          ),
        };
      }),
    };
  }
  function arrangeResultToolbar() {
    const toolbar = app.querySelector(".result-toolbar"),
      showFilter = app.querySelector(".result-page-size"),
      exportButton = app.querySelector("[data-export-results]"),
      sectionTools = app.querySelector(".section-tools");
    if (!toolbar || !showFilter || !exportButton) return;
    sectionTools.classList.add("result-section-tools");
    const searchField = document.createElement("label"),
      searchInput = document.createElement("input");
    searchField.className = "result-search";
    searchField.innerHTML = '<span class="sr-only">Search test results</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.4A7.75 7.75 0 1 1 3.5 11.25a7.75 7.75 0 0 1 15.5 0Z"></path></svg>';
    searchInput.id = "resultSearch";
    searchInput.type = "search";
    searchInput.placeholder = "Search student or registration number";
    searchInput.autocomplete = "off";
    searchInput.value = resultSearch;
    searchField.appendChild(searchInput);
    toolbar.prepend(searchField);
    sectionTools.append(exportButton, toolbar);
  }
  function resultRowsMarkup(rows) {
    return rows
      .map(
        (row) =>
          `<tr><td><strong>${escape(row.registrationNumber)}</strong></td><td>${escape(row.fullName)}</td><td>${escape(row.birthDate)}</td><td>${escape(row.unitName)}<small>${escape(row.city)}</small></td><td><strong>${row.score}</strong><small>Passing grade: ${row.passingScore}</small></td><td><span class="result-status ${String(row.resultStatus).toLowerCase()}">${escape(row.resultStatus)}</span></td><td>${row.correctCount}/${row.totalQuestions}</td><td>${escape(row.submittedAt)}</td><td>${button("View", "view-result", row.id)} ${button("Delete", "delete-result", row.id)}</td></tr>`,
      )
      .join("") ||
      '<tr><td colspan="9" class="empty">No submitted results match these filters.</td></tr>';
  }
  function resultPaginationMarkup(pagination) {
    return `<button class="secondary" data-result-page="${pagination.page - 1}" ${pagination.page <= 1 ? "disabled" : ""}>Previous</button><span>Page ${pagination.page} of ${pagination.totalPages} · ${pagination.total} results</span><div class="pagination-jump"><label for="resultPageInput">Go to page</label><input id="resultPageInput" type="number" min="1" max="${pagination.totalPages}" value="${pagination.page}" inputmode="numeric"><button class="secondary" type="button" data-go-result-page>Go</button></div><button class="secondary" data-result-page="${pagination.page + 1}" ${pagination.page >= pagination.totalPages ? "disabled" : ""}>Next</button>`;
  }
  function updateResultTable(payload) {
    resultPage = payload.pagination.page;
    const body = app.querySelector(".result-table tbody"),
      pagination = app.querySelector(".pagination");
    if (body) body.innerHTML = resultRowsMarkup(payload.results);
    if (pagination)
      pagination.innerHTML = resultPaginationMarkup(payload.pagination);
  }
  async function refreshResultTable() {
    const requestId = ++resultRequestId,
      card = app.querySelector(".table-card");
    card?.classList.add("is-refreshing");
    card?.setAttribute("aria-busy", "true");
    try {
      const payload = await api.results({
        page: resultPage,
        pageSize: resultPageSize,
        unitId: resultUnit,
        resultStatus,
        search: resultSearch,
      });
      if (requestId !== resultRequestId) return;
      updateResultTable(payload);
    } catch (error) {
      if (requestId === resultRequestId) message(error.message, "error");
    } finally {
      if (requestId === resultRequestId) {
        card?.classList.remove("is-refreshing");
        card?.removeAttribute("aria-busy");
      }
    }
  }
  async function renderResults() {
    const [unitPayload, resultPayload] = await Promise.all([
      api.units(),
      api.results({
        page: resultPage,
        pageSize: resultPageSize,
        unitId: resultUnit,
        resultStatus,
        search: resultSearch,
      }),
    ]);
    units = unitPayload.units;
    const p = resultPayload.pagination;
    resultPage = p.page;
    app.innerHTML = `<div class="section-tools"><div><h2>Test Results</h2><p>Submitted student admission exams.</p></div><div class="result-toolbar"><label class="inline-filter">Unit<select id="resultUnit"><option value="">All Units</option>${units.map((unit) => `<option value="${unit.id}" ${String(unit.id) === String(resultUnit) ? "selected" : ""}>${escape(unit.name)} - ${escape(unit.city)}</option>`).join("")}</select></label><label class="inline-filter">Status<select id="resultStatus"><option value="all" ${resultStatus === "all" ? "selected" : ""}>All Status</option><option value="passed" ${resultStatus === "passed" ? "selected" : ""}>Passed</option><option value="failed" ${resultStatus === "failed" ? "selected" : ""}>Failed</option></select></label><label class="inline-filter result-page-size">Show<select id="resultPageSize">${[5, 10, 25, 50, 100].map((size) => `<option value="${size}" ${size === resultPageSize ? "selected" : ""}>${size}</option>`).join("")}</select></label><button class="primary" type="button" data-export-results>Export Excel</button></div></div><div class="table-card"><table class="result-table"><thead><tr><th>Registration</th><th>Student</th><th>Birth Date</th><th>Unit</th><th>Score</th><th>Status</th><th>Correct</th><th>Submitted</th><th>Actions</th></tr></thead><tbody>${resultPayload.results.map((row) => `<tr><td><strong>${escape(row.registrationNumber)}</strong></td><td>${escape(row.fullName)}</td><td>${escape(row.birthDate)}</td><td>${escape(row.unitName)}<small>${escape(row.city)}</small></td><td><strong>${row.score}</strong><small>Passing grade: ${row.passingScore}</small></td><td><span class="result-status ${String(row.resultStatus).toLowerCase()}">${escape(row.resultStatus)}</span></td><td>${row.correctCount}/${row.totalQuestions}</td><td>${escape(row.submittedAt)}</td><td>${button("View", "view-result", row.id)} ${button("Delete", "delete-result", row.id)}</td></tr>`).join("") || '<tr><td colspan="9" class="empty">No submitted results match these filters.</td></tr>'}</tbody></table><div class="pagination"><button class="secondary" data-result-page="${p.page - 1}" ${p.page <= 1 ? "disabled" : ""}>Previous</button><span>Page ${p.page} of ${p.totalPages} · ${p.total} results</span><div class="pagination-jump"><label for="resultPageInput">Go to page</label><input id="resultPageInput" type="number" min="1" max="${p.totalPages}" value="${p.page}" inputmode="numeric"><button class="secondary" type="button" data-go-result-page>Go</button></div><button class="secondary" data-result-page="${p.page + 1}" ${p.page >= p.totalPages ? "disabled" : ""}>Next</button></div></div>`;
    arrangeResultToolbar();
    updateResultTable(resultPayload);
  }
  async function downloadResultExport(unitId, exportStatus = "all") {
    const payload = await api.exportResults(unitId, exportStatus),
      rows = payload.results.map((row) => ({
        "Registration Number": row.registrationNumber,
        "Student Name": row.fullName,
        "Birth Date": row.birthDate,
        Unit: row.unitName,
        City: row.city,
        Score: +row.score,
        "Passing Grade": +row.passingScore,
        Status: row.resultStatus,
        "Correct Answers": +row.correctCount,
        "Wrong Answers": +row.wrongCount,
        "Total Questions": +row.totalQuestions,
        "Submitted At": row.submittedAt,
      }));
    if (!rows.length) throw new Error("No test results found for the selected filters.");
    const sheet = XLSX.utils.json_to_sheet(rows),
      workbook = XLSX.utils.book_new(),
      unitName = unitId
        ? units.find((unit) => String(unit.id) === String(unitId))?.name || "unit"
        : "all-units",
      slug =
        unitName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "unit";
    sheet["!cols"] = [18, 28, 14, 32, 14, 10, 14, 12, 16, 16, 16, 22].map(
      (wch) => ({ wch }),
    );
    XLSX.utils.book_append_sheet(workbook, sheet, "Test Results");
    XLSX.writeFile(
      workbook,
      `test-results-${slug}-${exportStatus}-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
    return rows.length;
  }
  function renderStoredImageContent(content, paths, markerType = "question") {
    const allowed = new Set(paths), represented = new Set();
    const imagePattern = markerType === "question" ? questionImagePattern : answerImagePattern,
      alt = markerType === "question" ? "Question illustration" : "Answer illustration";
    const imageMarkup = (path) => `<span class="result-inline-image"><img src="${escape(path)}" alt="${alt}" data-admin-image-preview role="button" tabindex="0" aria-label="Preview ${markerType} image"></span>`;
    imagePattern.lastIndex = 0;
    const rendered = String(content || "").replace(imagePattern, (marker, path) => {
      if (!allowed.has(path)) return "";
      represented.add(path);
      return imageMarkup(path);
    });
    return rendered + paths.filter((path) => !represented.has(path)).map(imageMarkup).join("");
  }
  async function viewResult(id) {
    const row = (await api.result(id)).result;
    showModal(
      `<section class="result-review"><header class="result-review-header"><div><button class="unit-back" type="button" data-close-modal aria-label="Back to results">${backChevron}</button><div><h2>Review Exam</h2><p>${escape(row.examTitle || "Admission Test")}</p></div></div><button class="secondary" type="button" data-close-modal>Back to Results</button></header><div class="result-summary-grid"><div><span>Student</span><strong>${escape(row.fullName)}</strong><small>${escape(row.registrationNumber)} · ${escape(row.unitName)}</small></div><div><span>Result Status</span><strong><span class="result-status ${String(row.resultStatus).toLowerCase()}">${escape(row.resultStatus)}</span></strong><small>${escape(row.submittedAt || "")}</small></div><div><span>Current Score</span><strong>${row.score} / 100</strong><small>Passing grade: ${row.passingScore}</small></div><div><span>Correct Answers</span><strong>${row.correctCount} / ${row.totalQuestions}</strong><small>${row.wrongCount} incorrect</small></div></div><div class="result-question-list">${row.questions.map((question) => { const paths = question.imagePaths?.length ? question.imagePaths : question.imagePath ? [question.imagePath] : []; const selected = question.options.find((option) => option.selected); return `<article class="result-question-card"><header><span>Question ${question.number} · Multiple Choice</span></header><div class="result-question-copy">${renderStoredImageContent(question.content, paths)}</div><h3>Student Answer</h3>${selected ? "" : '<p class="result-unanswered">No answer submitted.</p>'}<div class="result-choice-list">${question.options.map((option) => `<div class="result-choice ${option.correct ? "is-correct" : option.selected ? "is-wrong" : ""}"><span>${option.label}</span><div>${renderStoredImageContent(option.content, option.imagePaths || [], "answer")}</div>${option.selected ? '<b>Selected</b>' : ""}${option.correct ? '<em>Correct answer</em>' : ""}</div>`).join("")}</div></article>`; }).join("")}</div></section>`,
    );
    const dialog = modal.querySelector(".admin-modal"),
      scrollTopButton = document.createElement("button");
    dialog?.classList.add("result-review-modal");
    scrollTopButton.type = "button";
    scrollTopButton.className = "result-scroll-top";
    scrollTopButton.dataset.resultScrollTop = "";
    scrollTopButton.setAttribute("aria-label", "Back to top of result review");
    scrollTopButton.title = "Back to top";
    scrollTopButton.hidden = true;
    scrollTopButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 15 7-7 7 7"></path></svg>';
    modalContent.append(scrollTopButton);
  }
  function formatTokenDate(value) {
    const normalized = String(value || "").replace(" ", "T"),
      date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return String(value || "–");
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: "Asia/Jakarta",
    }).format(date);
  }
  function formatTokenCountdown(totalSeconds) {
    const seconds = Math.max(0, Math.ceil(totalSeconds));
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }
  function startTokenCountdown(expiresAt, serverNow) {
    if (tokenCountdownId) clearInterval(tokenCountdownId);
    const expiresTime = Date.parse(String(expiresAt || "").replace(" ", "T")),
      parsedServerTime = Date.parse(String(serverNow || "").replace(" ", "T")),
      serverTime = Number.isFinite(parsedServerTime) ? parsedServerTime : Date.now(),
      remainingAtLoad = expiresTime - serverTime,
      clientDeadline = Date.now() + Math.max(0, remainingAtLoad);
    function updateCountdown() {
      const countdown = document.querySelector("#tokenCountdown");
      if (!countdown) {
        clearInterval(tokenCountdownId);
        tokenCountdownId = null;
        return;
      }
      const remaining = Math.max(0, Math.ceil((clientDeadline - Date.now()) / 1000));
      countdown.textContent = formatTokenCountdown(remaining);
      countdown.classList.toggle("is-expiring", remaining <= 60);
      if (remaining > 0) return;
      document.querySelector("#tokenStatus")?.classList.remove("is-active");
      const status = document.querySelector("#tokenStatus"),
        tokenValue = document.querySelector("#tokenValue"),
        currentTitle = document.querySelector("#tokenCurrentTitle"),
        expiry = document.querySelector("#tokenExpiry");
      if (status) status.textContent = "Expired";
      if (tokenValue) tokenValue.textContent = "----";
      if (currentTitle) currentTitle.textContent = "No active token yet";
      if (expiry) expiry.textContent = "–";
      clearInterval(tokenCountdownId);
      tokenCountdownId = null;
    }
    if (
      !Number.isFinite(expiresTime) ||
      !Number.isFinite(serverTime) ||
      remainingAtLoad <= 0
    ) {
      const countdown = document.querySelector("#tokenCountdown");
      if (countdown) countdown.textContent = "0s";
      return;
    }
    updateCountdown();
    tokenCountdownId = setInterval(updateCountdown, 1000);
  }
  async function renderTokens() {
    if (tokenCountdownId) {
      clearInterval(tokenCountdownId);
      tokenCountdownId = null;
    }
    const payload = await api.currentToken(),
      token = payload.token;
    app.innerHTML = `<section class="token-card"><header class="token-card-header"><div><h2>Exam Token</h2><span class="token-status ${token ? "is-active" : ""}" id="tokenStatus">${token ? "Active" : "Not generated"}</span></div><button class="primary token-generate-button" type="submit" form="tokenForm"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7"></path></svg>Generate Token</button></header><div class="token-card-body"><div class="token-code-panel"><strong class="token-value" id="tokenValue">${token ? escape(token.value) : "----"}</strong></div><div class="token-information"><span>Current active token</span><strong id="tokenCurrentTitle">${token ? escape(token.value) : "No active token yet"}</strong><span>Expires at</span><strong id="tokenExpiry">${token ? escape(formatTokenDate(token.expiresAt)) : "–"}</strong><div class="token-countdown-box"><span>Time left</span><strong class="${token ? "" : "is-expiring"}" id="tokenCountdown" aria-live="polite">0s</strong></div></div><form id="tokenForm" class="token-duration-form"><label>Duration<input name="durationValue" type="number" min="10" max="86400" value="10" inputmode="numeric" required></label><label>Unit<select name="durationUnit"><option value="seconds" selected>Seconds</option><option value="minutes">Minutes</option></select></label><p>Set how long this access token remains valid. Exam duration is configured separately in the question bank.</p></form></div></section>`;
    if (token) startTokenCountdown(token.expiresAt, payload.serverNow);
  }
  document.querySelectorAll("[data-section]").forEach((item) =>
    item.addEventListener("click", () => {
      resultPage = 1;
      navigate(item.dataset.section);
    }),
  );
  window.addEventListener("popstate", renderRoute);
  document.querySelector("#adminProfileButton").addEventListener("click", () => {
    setProfileMenu(document.querySelector("#adminProfileDropdown").hidden);
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest?.(".admin-profile-menu")) setProfileMenu(false);
  });
  document.addEventListener("click", (event) => {
    const image = event.target.closest?.("img[data-admin-image-preview]");
    if (image) openImagePreview(image);
  });
  document.addEventListener("keydown", (event) => {
    if (!event.target.matches?.("img[data-admin-image-preview]")) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openImagePreview(event.target);
  });
  document.querySelector("#adminImagePreviewClose").addEventListener("click", closeImagePreview);
  imagePreview.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeImagePreview();
  });
  imagePreview.addEventListener("click", (event) => {
    if (event.target === imagePreview) closeImagePreview();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.querySelector("#adminProfileDropdown").hidden) {
      event.preventDefault();
      setProfileMenu(false, true);
    }
  });
  ["#logoutButton", "#profileLogoutButton"].forEach((selector) =>
    document.querySelector(selector).addEventListener("click", async (event) => {
      event.currentTarget.disabled = true;
      try {
        await api.logout();
        location.replace("login.html");
      } catch (error) {
        event.currentTarget.disabled = false;
        message(error.message, "error");
      }
    }),
  );
  document.addEventListener("click", async (event) => {
    const target =
      event.target instanceof Element
        ? event.target.closest("button,[data-action],.latex-expression")
        : null;
    if (!target) return;
    if (target.matches("[data-result-scroll-top]")) {
      modal.querySelector(".admin-modal")?.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (target.matches("[data-close-modal]")) {
      closeModal();
      return;
    }
    if (target.matches("[data-confirm-cancel]")) {
      closeModal(false);
      return;
    }
    if (target.matches("[data-confirm-accept]")) {
      closeModal(true);
      return;
    }
    if (target.dataset.action === "new-unit") {
      navigate("units", "unit-form");
      return;
    }
    if (target.dataset.action === "edit-unit") {
      navigate("units", "unit-form", +target.dataset.id);
      return;
    }
    if (target.dataset.action === "back-to-units") {
      navigate("units");
      return;
    }
    if (target.dataset.action === "delete-unit") {
      if (
        !(await confirmAction({
          title: "Delete this unit?",
          message:
            "This unit will be permanently removed if it is not used by existing data.",
          confirmLabel: "Delete Unit",
          danger: true,
        }))
      )
        return;
      try {
        await api.deleteUnit(target.dataset.id);
        message("Unit deleted.");
        load();
      } catch (e) {
        message(e.message, "error");
      }
    }
    if (target.dataset.action === "new-bank") {
      navigate("banks", "bank-form");
      return;
    }
    if (target.dataset.action === "edit-bank") {
      navigate("banks", "bank-form", +target.dataset.id);
      return;
    }
    if (target.dataset.action === "back-to-banks") {
      if (target.closest("#modalContent")) closeModal();
      navigate("banks");
      return;
    }
    if (target.dataset.action === "activate-bank") {
      if (
        !(await confirmAction({
          title: "Activate question bank?",
          message:
            "This question bank will become the active exam for its unit.",
          confirmLabel: "Activate",
        }))
      )
        return;
      try {
        await api.activateBank(target.dataset.id);
        message("Question bank activated.");
        load();
      } catch (e) {
        message(e.message, "error");
      }
    }
    if (target.dataset.action === "inactivate-bank") {
      if (
        !(await confirmAction({
          title: "Inactivate question bank?",
          message:
            "Students will not be able to start an exam for this unit until a question bank is activated.",
          confirmLabel: "Inactivate",
          danger: true,
        }))
      )
        return;
      try {
        await api.inactivateBank(target.dataset.id);
        message("Question bank inactivated.");
        load();
      } catch (e) {
        message(e.message, "error");
      }
    }
    if (target.dataset.action === "delete-bank") {
      if (
        !(await confirmAction({
          title: "Delete question bank?",
          message:
            "Questions and answer choices in this inactive bank will be permanently removed.",
          confirmLabel: "Delete Bank",
          danger: true,
        }))
      )
        return;
      try {
        await api.deleteBank(target.dataset.id);
        message("Question bank deleted.");
        load();
      } catch (e) {
        message(e.message, "error");
      }
    }
    if (target.dataset.action === "view-result")
      await viewResult(target.dataset.id);
    if (target.matches("[data-export-results]") && !target.disabled) {
      showModal(
        `<section class="export-dialog"><p class="eyebrow">Test Results</p><h2>Export Excel</h2><p>Choose the unit and result status to include in the Excel file.</p><form id="exportForm"><label>Unit<select name="unitId"><option value="">All Units</option>${units.map((unit) => `<option value="${unit.id}" ${String(unit.id) === String(resultUnit) ? "selected" : ""}>${escape(unit.name)} - ${escape(unit.city)}</option>`).join("")}</select></label><label>Status<select name="resultStatus"><option value="all" ${resultStatus === "all" ? "selected" : ""}>All Status</option><option value="passed" ${resultStatus === "passed" ? "selected" : ""}>Passed</option><option value="failed" ${resultStatus === "failed" ? "selected" : ""}>Failed</option></select></label><div class="modal-actions"><button type="button" class="secondary" data-close-modal>Cancel</button><button type="submit" class="primary">Download Excel</button></div></form></section>`,
      );
      modal.querySelector(".admin-modal")?.classList.add("export-dialog-modal");
    }
    if (target.dataset.action === "delete-result") {
      if (
        !(await confirmAction({
          title: "Delete test result?",
          message:
            "The student's submitted answers and score will be permanently removed.",
          confirmLabel: "Delete Result",
          danger: true,
        }))
      )
        return;
      await api.deleteResult(target.dataset.id);
      message("Test result deleted.");
      refreshResultTable();
    }
    if (target.matches("[data-add-question]")) {
      const list = document.querySelector("#questionList");
      list.insertAdjacentHTML(
        "beforeend",
        questionCard({}, list.children.length),
      );
      questionIndex = list.children.length - 1;
      renderQuestionPagination();
    }
    if (target.matches("[data-remove-question]")) {
      const cards = [...document.querySelectorAll("[data-question]")];
      if (cards.length > 1) {
        cards[questionIndex].remove();
        questionIndex = Math.min(questionIndex, cards.length - 2);
        renderQuestionPagination();
      }
    }
    if (target.matches("[data-remove-image]")) {
      const question = target.closest("[data-question]");
      const answerEditor = target.closest("[data-answer-editor]"),
        item = target.closest("[data-image-item]"), next = item.nextSibling;
      item.remove();
      if (next?.nodeType === Node.TEXT_NODE && next.nodeValue === "\u00a0") next.remove();
      const status = answerEditor
          ? answerEditor.querySelector(".answer-upload-status")
          : question.querySelector(".question-upload-status"),
        editor = answerEditor
          ? answerEditor.querySelector(".rich-editor")
          : question.querySelector('.rich-editor[data-name="content"]');
      status.textContent = `${editor.querySelectorAll("[data-image-item]").length} image(s) attached.`;
    }
    if (target.matches("[data-question-page]")) {
      questionIndex = +target.dataset.questionPage;
      renderQuestionPagination();
    }
    if (target.matches("[data-question-prev]") && !target.disabled) {
      questionIndex -= 1;
      renderQuestionPagination();
    }
    if (target.matches("[data-question-next]") && !target.disabled) {
      questionIndex += 1;
      renderQuestionPagination();
    }
    if (target.matches("[data-toggle-answer-editor]")) {
      const richWrap = target.closest("[data-answer-editor]")?.querySelector(".rich-wrap"),
        enabled = !richWrap?.classList.contains("is-editor-enabled");
      richWrap?.classList.toggle("is-editor-enabled", enabled);
      target.classList.toggle("is-active", enabled);
      target.setAttribute("aria-expanded", String(enabled));
      target.textContent = `Editor: ${enabled ? "On" : "Off"}`;
      return;
    }
    if (target.matches("[data-format]")) {
      activeEditor = target.closest(".rich-wrap").querySelector(".rich-editor");
      activeEditor.focus();
      document.execCommand(target.dataset.format, false);
    }
    if (target.matches("[data-math]")) {
      activeEditor = target.closest(".rich-wrap").querySelector(".rich-editor");
      rememberEditorSelection(activeEditor);
      activeFormula = null;
      latexModalTitle.textContent = "Insert Math Formula";
      insertLatexButton.textContent = "Insert";
      latexInput.value = target.dataset.math;
      latexInput.dispatchEvent(new Event("input"));
      openLatexModal();
    }
    if (target.matches("[data-open-latex]")) {
      activeEditor = target.closest(".rich-wrap").querySelector(".rich-editor");
      rememberEditorSelection(activeEditor);
      activeFormula = null;
      latexModalTitle.textContent = "Insert Math Formula";
      insertLatexButton.textContent = "Insert";
      latexInput.value = "\\frac{a}{b}";
      latexInput.dispatchEvent(new Event("input"));
      openLatexModal();
    }
    if (target.matches("[data-latex-preset]")) {
      const snippet = target.dataset.latexPreset.replace(/\\\\(?=[A-Za-z])/g, "\\");
      const start = latexInput.selectionStart;
      const end = latexInput.selectionEnd;
      latexInput.setRangeText(snippet, start, end, "end");
      latexInput.dispatchEvent(new Event("input"));
      latexInput.focus({ preventScroll: true });
    }
    if (target.matches(".latex-expression")) {
      activeEditor = target.closest(".rich-editor");
      activeFormula = target;
      latexModalTitle.textContent = "Edit Math Formula";
      insertLatexButton.textContent = "Save";
      latexInput.value = target.dataset.latex || "";
      latexInput.dispatchEvent(new Event("input"));
      openLatexModal();
    }
    if (target.matches("[data-close-latex]")) {
      closeLatexModal();
      activeFormula = null;
    }
    if (target.matches("[data-result-page]") && !target.disabled) {
      resultPage = +target.dataset.resultPage;
      refreshResultTable();
    }
    if (target.matches("[data-go-result-page]")) {
      const input = document.querySelector("#resultPageInput"),
        requestedPage = Math.trunc(Number(input?.value));
      if (!Number.isFinite(requestedPage) || requestedPage < 1) {
        message("Enter a valid page number.", "error");
        input?.focus();
        return;
      }
      resultPage = Math.min(requestedPage, +(input?.max || requestedPage));
      refreshResultTable();
    }
  });
  document.addEventListener("change", async (event) => {
    if (event.target.id === "resultUnit") {
      resultUnit = event.target.value;
      resultPage = 1;
      refreshResultTable();
    }
    if (event.target.id === "resultStatus") {
      resultStatus = event.target.value;
      resultPage = 1;
      refreshResultTable();
    }
    if (event.target.id === "resultPageSize") {
      resultPageSize = +event.target.value;
      resultPage = 1;
      refreshResultTable();
    }
    if (event.target.matches("[data-image], [data-answer-image]")) {
      const question = event.target.closest("[data-question]"),
        answerEditor = event.target.closest("[data-answer-editor]"),
        uploadLabel = event.target.closest(".image-upload"),
        status = answerEditor
          ? answerEditor.querySelector(".answer-upload-status")
          : question.querySelector(".question-upload-status"),
        editor = answerEditor
          ? answerEditor.querySelector(".rich-editor")
          : question.querySelector('.rich-editor[data-name="content"]'),
        files = [...event.target.files];
      if (!files.length) return;
      if (editor.querySelectorAll("[data-image-item]").length + files.length > 10) {
        const reason = `${answerEditor ? "An answer option" : "A question"} can contain at most 10 images.`;
        status.textContent = reason;
        showUploadError("Selected images", reason);
        event.target.value = "";
        return;
      }
      let uploadingFile = files[0];
      const progress = document.createElement("span"),
        progressValue = document.createElement("span");
      progress.className = "upload-progress";
      progress.setAttribute("role", "progressbar");
      progress.setAttribute("aria-label", "Image upload progress");
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", "100");
      progress.setAttribute("aria-valuenow", "0");
      progressValue.textContent = "0%";
      progress.append(progressValue);
      uploadLabel.append(progress);
      uploadLabel.classList.add("is-uploading");
      uploadLabel.setAttribute("aria-busy", "true");
      event.target.disabled = true;
      status.setAttribute("role", "status");
      pendingImageUploads += 1;
      let completed = false;
      try {
        let insertionRange = editorSelections.get(editor)?.cloneRange() || null;
        for (const [fileIndex, file] of files.entries()) {
          uploadingFile = file;
          const payload = await api.upload(file, (stage, percent) => {
            const overall = Math.round(((fileIndex + percent / 100) / files.length) * 100),
              description = `${stage} ${fileIndex + 1} of ${files.length}...`;
            progress.style.setProperty("--upload-progress", `${overall}%`);
            progress.setAttribute("aria-valuenow", String(overall));
            progressValue.textContent = `${overall}%`;
            if (status.textContent !== description) status.textContent = description;
          });
          insertionRange = insertImageIntoEditor(editor, payload.path, insertionRange);
        }
        completed = true;
        status.textContent = `${editor.querySelectorAll("[data-image-item]").length} image(s) attached.`;
      } catch (e) {
        const reason = e.message || "The image could not be uploaded. Please try again.";
        status.textContent = reason;
        showUploadError(uploadingFile.name, reason);
      } finally {
        if (completed) await new Promise((resolve) => setTimeout(resolve, 350));
        progress.remove();
        uploadLabel.classList.remove("is-uploading");
        uploadLabel.removeAttribute("aria-busy");
        event.target.disabled = false;
        pendingImageUploads -= 1;
        event.target.value = "";
      }
    }
    if (
      event.target.matches("[data-question-import]") &&
      event.target.files[0]
    ) {
      try {
        const buffer = await event.target.files[0].arrayBuffer();
        const workbook = XLSX.read(buffer);
        const rows = XLSX.utils.sheet_to_json(
          workbook.Sheets[workbook.SheetNames[0]],
          { defval: "" },
        );
        const imported = rows
          .map((row) => ({
            content: escape(row.questionText),
            options: {
              A: escape(row.optionA),
              B: escape(row.optionB),
              C: escape(row.optionC),
              D: escape(row.optionD),
            },
            correctOption: String(row.correctOption).trim().toUpperCase(),
          }))
          .filter(
            (row) =>
              row.content && ["A", "B", "C", "D"].includes(row.correctOption),
          );
        if (!imported.length)
          throw new Error("No valid rows found in the spreadsheet.");
        document.querySelector("#questionList").innerHTML = imported
          .map(questionCard)
          .join("");
        questionIndex = 0;
        renderQuestionPagination();
        hydrateEditorMath(document.querySelector("#questionList"));
        hydrateEditorImages(document.querySelector("#questionList"));
        document.querySelector(".bulk-status").textContent =
          `${event.target.files[0].name} - ${imported.length} questions ready`;
        message(`${imported.length} questions imported.`);
      } catch (e) {
        message(e.message, "error");
      }
    }
  });
  document.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target,
      idInput = form.querySelector('[name="id"]');
    try {
      if (form.id === "exportForm") {
        const submitButton = form.querySelector('[type="submit"]'),
          formData = new FormData(form),
          unitId = String(formData.get("unitId") || ""),
          exportStatus = String(formData.get("resultStatus") || "all");
        submitButton.disabled = true;
        try {
          const exported = await downloadResultExport(unitId, exportStatus);
          closeModal();
          message(`${exported} test result(s) exported.`);
        } catch (error) {
          message(error.message, "error");
          submitButton.disabled = false;
        }
        return;
      }
      if (form.id === "tokenForm") {
        const submitButton = document.querySelector(
          '.token-generate-button[form="tokenForm"]',
        );
        if (submitButton) submitButton.disabled = true;
        try {
          const data = Object.fromEntries(new FormData(form));
          const payload = await api.createToken(data);
          message(`Token ${payload.token.value} generated.`);
          await load();
        } finally {
          if (submitButton?.isConnected) submitButton.disabled = false;
        }
      }
    } catch (e) {
      message(e.message, "error");
    }
  });
  latexInput.addEventListener("input", () => {
    try {
      window.katex.render(latexInput.value, latexPreview, {
        throwOnError: true,
      });
    } catch (e) {
      latexPreview.textContent = e.message;
    }
  });
  insertLatexButton.addEventListener("click", () => {
    if (!activeEditor) return;
    const latex = latexInput.value.trim();
    if (!latex) return;
    if (activeFormula) {
      activeFormula.dataset.latex = latex;
      activeFormula.setAttribute("aria-label", `Math formula: ${latex}`);
      activeFormula.replaceChildren();
      window.katex.render(latex, activeFormula, {
        throwOnError: false,
        strict: false,
      });
      activeFormula = null;
    } else {
      insertMathIntoEditor(activeEditor, latex);
    }
    closeLatexModal();
  });
  modal.addEventListener("click", (event) => {
    if (
      event.target === modal &&
      modal.querySelector(".admin-modal")?.classList.contains("result-review-modal")
    ) {
      closeModal();
    }
  });
  modal.querySelector(".admin-modal").addEventListener("scroll", (event) => {
    const scrollTopButton = modal.querySelector("[data-result-scroll-top]");
    if (scrollTopButton) scrollTopButton.hidden = event.currentTarget.scrollTop < 360;
  });
  document.addEventListener("input", (event) => {
    if (event.target.id !== "resultSearch") return;
    const nextSearch = event.target.value;
    if (resultSearchTimer) clearTimeout(resultSearchTimer);
    resultSearchTimer = setTimeout(() => {
      resultSearch = nextSearch.trim();
      resultPage = 1;
      resultSearchTimer = null;
      if (section === "results") refreshResultTable();
    }, 350);
  });
  document.addEventListener("keydown", (event) => {
    if (event.target.id !== "resultPageInput" || event.key !== "Enter") return;
    event.preventDefault();
    document.querySelector("[data-go-result-page]")?.click();
  });
  document.addEventListener("change", (event) => {
    if (!event.target.matches('#tokenForm [name="durationUnit"]')) return;
    const duration = document.querySelector('#tokenForm [name="durationValue"]'),
      seconds = event.target.value === "seconds";
    if (!duration) return;
    duration.min = seconds ? "10" : "1";
    duration.max = seconds ? "86400" : "1440";
    if (+duration.value < +duration.min) duration.value = duration.min;
    if (+duration.value > +duration.max) duration.value = duration.max;
  });
  document.addEventListener("pointerdown", (event) => {
    const button = event.target.closest?.("[data-math], [data-open-latex], .image-upload");
    if (!button) return;
    const editor = button.matches(".image-upload")
      ? button.closest("[data-answer-editor]")?.querySelector(".rich-editor") ||
        button.closest("[data-question]")?.querySelector('.rich-editor[data-name="content"]')
      : button.closest(".rich-wrap")?.querySelector(".rich-editor");
    if (editor) rememberEditorSelection(editor);
  });
  document.addEventListener("selectionchange", () => {
    const selection = window.getSelection(),
      editor = document.activeElement?.closest?.(".rich-editor");
    if (
      editor &&
      selection.rangeCount &&
      editor.contains(selection.anchorNode)
    ) {
      editorSelections.set(editor, selection.getRangeAt(0).cloneRange());
    }
  });
  api
    .session()
    .then((payload) => {
      if (!payload.authenticated) {
        location.replace("login.html");
        return;
      }
      const adminName = String(payload.admin.name || "Administrator").trim(),
        nameParts = adminName.split(/\s+/).filter(Boolean),
        initials = (nameParts.length > 1
          ? nameParts.slice(0, 2).map((part) => part[0]).join("")
          : adminName.slice(0, 2)
        ).toUpperCase();
      document.querySelector("#adminName").textContent = adminName;
      document.querySelector(".admin-avatar").textContent = initials || "AD";
      renderRoute();
    })
    .catch(() => location.replace("login.html"));
})();
