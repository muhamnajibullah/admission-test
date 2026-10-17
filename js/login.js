(function () {
  "use strict";
  const form = document.querySelector("#loginForm"),
    error = document.querySelector("#loginError"),
    button = form.querySelector("button[type=submit]");
  window.AdmissionApi.session()
    .then((payload) => {
      if (payload.authenticated) location.replace("dashboard.html");
    })
    .catch(() => {});
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      await window.AdmissionApi.login(data.email, data.password);
      location.replace("dashboard.html");
    } catch (requestError) {
      error.textContent = requestError.message;
      button.disabled = false;
    }
  });
  document
    .querySelector("#passwordToggle")
    .addEventListener("click", (event) => {
      const input = document.querySelector("#password"),
        visible = input.type === "password";
      input.type = input.type === "password" ? "text" : "password";
      event.currentTarget.classList.toggle("is-visible", visible);
      event.currentTarget.setAttribute("aria-pressed", String(visible));
      event.currentTarget.setAttribute(
        "aria-label",
        visible ? "Hide password" : "Show password",
      );
    });
})();
