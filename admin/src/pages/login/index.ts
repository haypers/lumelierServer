import "./styles.css";

const API_BASE = "";

export function render(container: HTMLElement): void {
  container.innerHTML = `
    <div class="auth-page">
      <div class="auth-card">
        <h1>Log in</h1>
        <form id="login-form">
          <div id="login-error" class="auth-error" hidden></div>
          <label for="login-username">Username</label>
          <input id="login-username" type="text" name="username" autocomplete="username" required />
          <label for="login-password">Password</label>
          <input id="login-password" type="password" name="password" autocomplete="current-password" required />
          <button type="submit" class="btn-primary" id="login-submit">Log in</button>
        </form>
        <p class="auth-footer">
          <a href="/register" id="login-to-register">Create an account</a>
        </p>
      </div>
    </div>
  `;

  const form = document.getElementById("login-form");
  const errorEl = document.getElementById("login-error") as HTMLElement;
  const submitBtn = document.getElementById("login-submit") as HTMLButtonElement;
  const link = document.getElementById("login-to-register");

  function showError(msg: string): void {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  function clearError(): void {
    errorEl.textContent = "";
    errorEl.hidden = true;
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();
    const username = (document.getElementById("login-username") as HTMLInputElement).value.trim();
    const password = (document.getElementById("login-password") as HTMLInputElement).value;
    if (!username || !password) {
      showError("Please enter username and password.");
      return;
    }
    submitBtn.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        const redirect = new URLSearchParams(window.location.search).get("redirect") || "/timeline";
        window.location.href = redirect;
        return;
      }
      if (res.status === 401) {
        showError("Invalid username or password.");
        return;
      }
      showError("Something went wrong. Please try again.");
    } catch {
      showError("Network error. Please try again.");
    } finally {
      submitBtn.disabled = false;
    }
  });

  link?.addEventListener("click", (e) => {
    e.preventDefault();
    window.history.pushState(null, "", "/register");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}
