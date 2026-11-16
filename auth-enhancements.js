/* PULSE social sign-in enhancement.
 * Uses Supabase Auth PKCE; provider secrets stay in the Supabase dashboard.
 * Existing email/MFA and admin verification flows remain authoritative.
 */
(function () {
  "use strict";

  var supabaseClient = null;
  var PROVIDER_INFO = {
    google: { label: "Continue with Google", mark: "G", className: "google" },
    github: { label: "Continue with GitHub", mark: "GH", className: "github" },
    gmail: { label: "Continue with Gmail", mark: "M", className: "gmail" }
  };

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
    status("Connecting to " + (provider === "github" ? "GitHub" : "Google") + "…");

    var options = {
      redirectTo: window.location.origin + window.location.pathname + "#posters"
    };
    if (provider === "google") {
      options.scopes = "openid email profile";
      options.queryParams = { prompt: "select_account" };
    } else {
      options.scopes = "read:user user:email";
    }

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
    grid.appendChild(providerButton("google", "Google", "G", "google"));
    grid.appendChild(providerButton("github", "GitHub", "GH", "github"));
    grid.appendChild(providerButton("gmail", "Gmail", "M", "gmail"));
    section.appendChild(grid);

    var unavailable = document.createElement("div");
    unavailable.className = "pulse-provider-grid pulse-provider-grid-muted";
    var chatgpt = providerButton("unavailable", "ChatGPT", "AI", "unavailable");
    var claude = providerButton("unavailable", "Claude", "AI", "unavailable");
    chatgpt.disabled = true;
    claude.disabled = true;
    chatgpt.title = "ChatGPT does not currently provide a general-purpose Supabase social-login provider.";
    claude.title = "Claude does not currently provide a general-purpose Supabase social-login provider.";
    unavailable.appendChild(chatgpt);
    unavailable.appendChild(claude);
    section.appendChild(unavailable);

    var note = document.createElement("p");
    note.className = "pulse-provider-note";
    note.textContent = "Google and Gmail use the same Google account sign-in. ChatGPT and Claude sign-in are not currently available as standard Supabase providers.";
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
      if (provider === "gmail") provider = "google";
      if (provider === "google" || provider === "github") startOAuth(provider);
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
      ".pulse-social-login{display:grid;gap:10px;margin-top:15px;padding-top:13px;border-top:1px solid #47564a}",
      ".pulse-social-divider{display:flex;align-items:center;justify-content:center;color:#aeb7aa;font-size:10px;font-weight:700;letter-spacing:.16em}",
      ".pulse-provider-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}",
      ".pulse-provider{display:flex;align-items:center;justify-content:center;gap:9px;min-height:44px;padding:9px 10px;border:1px solid #526253;border-radius:9px;background:#121c16;color:#f3f0e3;font:600 13px system-ui,sans-serif;cursor:pointer;transition:border-color .18s,background .18s,transform .18s}",
      ".pulse-provider:hover:not(:disabled){border-color:#d9a05d;background:#1c2a20;transform:translateY(-1px)}",
      ".pulse-provider:disabled{opacity:.42;cursor:not-allowed}",
      ".pulse-provider-mark{display:inline-grid;place-items:center;min-width:23px;height:23px;padding:0 4px;border-radius:6px;background:#27362a;color:#f2c17e;font-size:11px;font-weight:800}",
      ".pulse-provider-github .pulse-provider-mark{background:#e8e8e4;color:#161b17}",
      ".pulse-provider-gmail .pulse-provider-mark{background:#3b2921;color:#ffb17c}",
      ".pulse-provider-grid-muted{opacity:.8}",
      ".pulse-provider-note{margin:0;color:#aeb7aa;font-size:11px;line-height:1.5}",
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
