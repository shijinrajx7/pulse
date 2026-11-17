/* PULSE social sign-in enhancement.
 * Uses Supabase Auth PKCE; provider secrets stay in the Supabase dashboard.
 * Existing email/MFA and admin verification flows remain authoritative.
 */
(function () {
  "use strict";

  var supabaseClient = null;
  function byId(id) {
    return document.getElementById(id);
  }

  function status(message) {
    var node = byId("poster-status") || byId("poster-mfa-status");
    if (node) node.textContent = message;
  }

  function client() {
    var config = window.PULSE || {};
    if (supabaseClient) return supabaseClient;
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      return null;
    }
    if (!config.url || !config.key) return null;
    supabaseClient = window.supabase.createClient(config.url, config.key, {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
    return supabaseClient;
  }

  function jwtAal(token) {
    try {
      var payload = String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      while (payload.length % 4) payload += "=";
      return JSON.parse(atob(payload)).aal || "aal1";
    } catch (error) {
      return "aal1";
    }
  }

  function savePosterSession(session) {
    if (!session || !session.access_token) {
      throw new Error("The identity provider did not return a PULSE session.");
    }
    var normalized = Object.assign({}, session, {
      expires_at: Date.now() + Number(session.expires_in || 3600) * 1000,
      aal_level: jwtAal(session.access_token)
    });
    try {
      localStorage.setItem("pulse.poster.session", JSON.stringify(normalized));
    } catch (error) {
      throw new Error("This browser could not save your sign-in session.");
    }
    return normalized;
  }

  function finishOAuthReturn() {
    var params = new URLSearchParams(window.location.search);
    var oauthError = params.get("error_description") || params.get("error");
    if (oauthError) {
      status("Sign-in was not completed: " + oauthError);
      return;
    }
    if (!params.has("code")) return;

    var auth = client();
    if (!auth) {
      status("The secure sign-in library did not load. Reload PULSE and try again.");
      return;
    }

    status("Finishing secure provider sign-in…");
    auth.auth.getSession().then(function (result) {
      if (result.error) throw result.error;
      var session = savePosterSession(result.data && result.data.session);
      if (typeof window.posterBeginMfa !== "function") {
        throw new Error("PULSE sign-in screen is still loading. Reload the Story Posters page.");
      }
      window.posterBeginMfa(session);
      try {
        window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
      } catch (error) {
        /* The session is already stored; URL cleanup is cosmetic. */
      }
    }).catch(function (error) {
      status(error && error.message ? error.message : "Could not finish provider sign-in. Please try again.");
    });
  }

  function providerButton(provider, label, mark, className) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "pulse-provider pulse-provider-" + className;
    button.setAttribute("data-pulse-provider", provider);
    var icon = document.createElement("span");
    icon.className = "pulse-provider-mark";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = mark;
    var text = document.createElement("span");
    text.textContent = label;
    button.appendChild(icon);
    button.appendChild(text);
    return button;
  }

  function startOAuth(provider) {
    var auth = client();
    if (!auth) {
      status("Secure sign-in could not load. Check your connection and reload PULSE.");
      return;
    }
    var buttonList = document.querySelectorAll("[data-pulse-provider]");
    buttonList.forEach(function (button) { button.disabled = true; });
    status("Connecting to " + (provider === "google" ? "Google" : "GitHub") + "…");

    var options = {
      redirectTo: window.location.origin + window.location.pathname + "#posters"
    };
    if (provider === "github") options.scopes = "read:user user:email";

    auth.auth.signInWithOAuth({ provider: provider, options: options }).then(function (result) {
      if (result.error) throw result.error;
      /* Supabase Auth performs the browser redirect. */
    }).catch(function (error) {
      status(error && error.message ? error.message : "Could not start provider sign-in.");
      buttonList.forEach(function (button) { button.disabled = false; });
    });
  }

  function injectProviderOptions() {
    var authPanel = byId("poster-auth");
    var emailForm = byId("poster-user-form");
    if (!authPanel || !emailForm || authPanel.querySelector(".pulse-social-login")) return;

    var emailTab = byId("poster-user-tab");
    var adminTab = byId("poster-admin-tab");
    if (emailTab) emailTab.textContent = "Email";
    if (adminTab) adminTab.textContent = "Admin";

    var section = document.createElement("section");
    section.className = "pulse-social-login";
    section.setAttribute("aria-label", "Other sign-in providers");
    section.hidden = !!(byId("poster-admin-form") && !byId("poster-admin-form").hidden);

    var divider = document.createElement("div");
    divider.className = "pulse-social-divider";
    divider.textContent = "OR CONTINUE WITH";
    section.appendChild(divider);

    var grid = document.createElement("div");
    grid.className = "pulse-provider-grid";
    grid.appendChild(providerButton("github", "Continue with GitHub", "GH", "github"));
    grid.appendChild(providerButton("google", "Continue with Google", "G", "google"));
    section.appendChild(grid);

    var note = document.createElement("p");
    note.className = "pulse-provider-note";
    note.textContent = "Email sign-in uses a secure confirmation link, then an authenticator check. New accounts must confirm their email before setting up an authenticator. GitHub and Google sign-ins also require authenticator verification. Gmail works through Google.";
    section.appendChild(note);

    emailForm.insertAdjacentElement("afterend", section);

    function syncProviderVisibility() {
      section.hidden = !!(byId("poster-admin-form") && !byId("poster-admin-form").hidden);
    }
    document.addEventListener("click", function (event) {
      if (event.target && (event.target.closest("#poster-user-tab") || event.target.closest("#poster-admin-tab"))) {
        window.setTimeout(syncProviderVisibility, 0);
      }
    });

    section.addEventListener("click", function (event) {
      var button = event.target.closest("[data-pulse-provider]");
      if (!button || button.disabled) return;
      var provider = button.getAttribute("data-pulse-provider");
      if (provider === "github" || provider === "google") startOAuth(provider);
    });
  }

  function signOutProviderSession() {
    var auth = client();
    if (auth) auth.auth.signOut({ scope: "local" }).catch(function () {});
  }

  function observePosterLogin() {
    injectProviderOptions();
    var observer = new MutationObserver(function () {
      injectProviderOptions();
    });
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener("click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("#poster-logout, #poster-mfa-cancel") : null;
      if (target) signOutProviderSession();
    }, true);
  }

  function addStyles() {
    if (byId("pulse-social-auth-styles")) return;
    var style = document.createElement("style");
    style.id = "pulse-social-auth-styles";
    style.textContent = [
      ".pulse-social-login{display:grid;gap:11px;margin-top:15px;padding-top:15px;border-top:1px solid #34453d}",
      "#poster-auth{gap:15px}",
      "#poster-auth h3{font:600 25px/1.18 Georgia,serif;letter-spacing:-.025em;color:#f5f0e5}",
      "#poster-auth>.poster-note{max-width:42ch;font-size:12px;line-height:1.6;color:#aab5a9}",
      "#poster-auth .poster-tabs{padding:4px;border:1px solid #35483e;border-radius:10px;background:#0b120e;gap:4px}",
      "#poster-auth .poster-tab{min-height:42px;border:0;border-radius:7px;background:transparent;color:#aab7aa;font:600 13px system-ui;letter-spacing:.02em}",
      "#poster-auth .poster-tab.active{background:#d7a36a;color:#171810;box-shadow:0 2px 10px #0004}",
      "#poster-auth .poster-form label{gap:7px;color:#cbd2c7;font-size:12px;font-weight:600;letter-spacing:.02em}",
      "#poster-auth .poster-form label[hidden]{display:none!important}",
      "#poster-auth .poster-form input{min-height:48px;border:1px solid #3b4b41;border-radius:9px;background:#0a100d;color:#f5f1e7;padding:11px 13px;font-size:15px}",
      "#poster-auth .poster-form input:focus{border-color:#d7a36a;outline:2px solid #d7a36a35;outline-offset:1px}",
      "#poster-auth .poster-actions{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}",
      "#poster-auth .poster-action{min-height:46px;border-radius:9px;background:#d7a36a;border-color:#d7a36a;color:#171810;font-size:13px}",
      "#poster-auth .poster-action.secondary{background:#151e18;border-color:#46584b;color:#e8e9df}",
      ".poster-password-row{align-items:stretch;gap:7px}",
      ".poster-eye{display:grid;place-items:center;min-width:46px;width:46px;min-height:46px;padding:0;border-radius:9px;background:#151e18;border-color:#46584b;color:#d7a36a}",
      ".poster-eye svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}",
      ".poster-eye:hover{border-color:#d7a36a;background:#1b2820}",
      ".pulse-social-divider{display:flex;align-items:center;justify-content:center;color:#aeb7aa;font-size:10px;font-weight:700;letter-spacing:.16em}",
      ".pulse-provider-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}",
      "#poster-auth .poster-form[hidden],#poster-auth [hidden]{display:none!important}",
      "#poster-auth .poster-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}",
      "#poster-auth .poster-tab{width:100%;min-width:0}",
      "#poster-auth .poster-form:not([hidden]){display:grid;grid-template-columns:minmax(0,1fr);width:100%}",
      "#poster-auth .poster-form[hidden]{display:none!important}",
      ".pulse-provider{display:flex;align-items:center;justify-content:center;gap:10px;min-height:48px;padding:11px 14px;border:1px solid #435349;border-radius:9px;background:#141d17;color:#f4f1e7;font:600 13px system-ui,sans-serif;letter-spacing:.01em;cursor:pointer;transition:border-color .18s,background .18s,transform .18s,box-shadow .18s}",
      ".pulse-provider:hover:not(:disabled){border-color:#d7a36a;background:#1c2a20;transform:translateY(-1px);box-shadow:0 7px 20px #0003}",
      ".pulse-provider:disabled{opacity:.42;cursor:not-allowed}",
      ".pulse-provider-mark{display:inline-grid;place-items:center;min-width:25px;height:25px;padding:0 5px;border-radius:7px;background:#e8e8e4;color:#161b17;font-size:12px;font-weight:800}",
      ".pulse-provider-github{background:#d7a36a;border-color:#d7a36a;color:#171810}",
      ".pulse-provider-github .pulse-provider-mark{background:#171d18;color:#f2f1e9}",
      ".pulse-provider-google{background:#f4f4f1;border-color:#e2e3de;color:#242923}",
      ".pulse-provider-google .pulse-provider-mark{background:#fff;color:#4285f4;border:1px solid #e4e5e0}",

      ".pulse-provider-grid-muted{opacity:.8}",
      ".pulse-provider-note{margin:0;color:#9da99e;font-size:11px;line-height:1.6}",
      "@media(max-width:640px){#poster-auth .poster-actions{grid-template-columns:1fr}#poster-auth .poster-action{width:100%}.poster-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.poster-actions .poster-action{width:100%;min-width:0;min-height:46px;padding:10px 8px;font-size:12px}}",
      ".pulse-provider:focus-visible{outline:2px solid #e2a34c;outline-offset:2px}",
      "@media(max-width:380px){.pulse-provider-grid{grid-template-columns:1fr}}"
    ].join("");
    document.head.appendChild(style);
  }

  function boot() {
    addStyles();
    observePosterLogin();
    /* The callback page includes ?code=... and returns to the #posters section. */
    finishOAuthReturn();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
