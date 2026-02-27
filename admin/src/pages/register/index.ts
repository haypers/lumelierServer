import "../login/styles.css";

const API_BASE = "";

export function render(container: HTMLElement): void {
  container.innerHTML = `
    <div class="auth-page">
      <div class="auth-card">
        <h1>Create an account</h1>
        <form id="register-form">
          <div id="register-error" class="auth-error" hidden></div>
          <label for="register-username">Username</label>
          <input id="register-username" type="text" name="username" autocomplete="username" required />
          <label for="register-password">Password</label>
          <input id="register-password" type="password" name="password" autocomplete="new-password" required />
          <label for="register-confirm">Confirm password</label>
          <input id="register-confirm" type="password" name="confirm" autocomplete="new-password" required />
          <button type="submit" class="btn-primary" id="register-submit">Register</button>
        </form>
        <p class="auth-footer">
          <a href="/login" id="register-to-login">Already have an account? Log in</a>
        </p>
      </div>
    </div>
  `;

  const form = document.getElementById("register-form");
  const errorEl = document.getElementById("register-error") as HTMLElement;
  const submitBtn = document.getElementById("register-submit") as HTMLButtonElement;
  const link = document.getElementById("register-to-login");

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
    const username = (document.getElementById("register-username") as HTMLInputElement).value.trim();
    const password = (document.getElementById("register-password") as HTMLInputElement).value;
    const confirm = (document.getElementById("register-confirm") as HTMLInputElement).value;
    if (!username || !password) {
      showError("Please enter username and password.");
      return;
    }
    if (password !== confirm) {
      showError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      showError("Password should be at least 8 characters.");
      return;
    }
    submitBtn.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        window.location.href = "/login";
        return;
      }
      if (res.status === 409) {
        showError("Username unavailable. Try another.");
        return;
      }
      showError("Registration failed. Please try again.");
    } catch {
      showError("Network error. Please try again.");
    } finally {
      submitBtn.disabled = false;
    }
  });

  link?.addEventListener("click", (e) => {
    e.preventDefault();
    window.history.pushState(null, "", "/login");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}
