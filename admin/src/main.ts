const AUTH_TOKEN_KEY = "lumelier_admin_auth";

function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function setAuthToken(value: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, value);
}

function renderGate(app: HTMLElement): void {
  app.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:80vh;gap:1rem;">
      <p>Admin panel</p>
      <button type="button" id="proceed">Proceed</button>
    </div>
  `;
  const btn = document.getElementById("proceed");
  if (btn) {
    btn.addEventListener("click", () => {
      setAuthToken("true");
      render();
    });
  }
}

function renderDashboard(app: HTMLElement): void {
  app.innerHTML = `
    <div style="padding:1.5rem;">
      <h1>Dashboard</h1>
      <p>Admin dashboard (placeholder)</p>
    </div>
  `;
}

function render(): void {
  const app = document.getElementById("app");
  if (!app) return;
  if (getAuthToken()) {
    renderDashboard(app);
  } else {
    renderGate(app);
  }
}

render();
