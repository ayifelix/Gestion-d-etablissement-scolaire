import React, { Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api";
import { ArmoiriesTogo, schoolLogoSource } from "./branding";
import { HomePage } from "./home";
import "./styles.css";

type LoginRole = { code: string };
type LoginResponse = {
  token?: string;
  roles?: LoginRole[];
  requiresTwoFactor?: boolean;
};
type PublicIdentity = {
  schoolName: string;
  shortName: string;
  monogram: string;
  cycleSubtitle: string;
  ministry: string;
  regionalDirectorate: string;
  inspection: string;
  republicName: string;
  republicMotto: string;
  phone: string;
  email: string;
  logoUrl: string | null;
};

const DashboardApp = lazy(() =>
  import("./dashboard").then((module) => ({ default: module.DashboardApp })),
);

function chooseInitialTab(roles: string[]) {
  if (roles.includes("PROF")) return "notes";
  if (roles.includes("TIT")) return "ma classe";
  if (roles.some((role) => ["CEN", "VERIFICATEUR", "SUPPLEANT_VERIF"].includes(role))) return "vérification";
  if (roles.includes("ECO")) return "finances";
  return "tableau de bord";
}

function Login({ onLogin }: { onLogin: (roles: string[]) => void }) {
  const [identity, setIdentity] = useState<PublicIdentity | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [otpRequired, setOtpRequired] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    void api<{ identity: PublicIdentity }>("/public/site")
      .then((site) => { if (active) setIdentity(site.identity); })
      .catch(() => {
        try {
          const cached = JSON.parse(localStorage.getItem("public-site-cache-v1") ?? "null");
          if (active && cached?.site?.identity) setIdentity(cached.site.identity as PublicIdentity);
        } catch {
          if (active) setIdentity(null);
        }
      });
    return () => { active = false; };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await api<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier, password, ...(otpRequired ? { otp } : {}) }),
      });
      if (result.requiresTwoFactor) {
        setOtpRequired(true);
        return;
      }
      if (!result.token || !result.roles) throw new Error("Connexion indisponible. Réessayez.");
      localStorage.setItem("token", result.token);
      onLogin(result.roles.map((role) => role.code));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Connexion impossible");
    } finally {
      setSubmitting(false);
    }
  };

  const logo = schoolLogoSource(identity?.logoUrl);

  return (
    <main className="login-page">
      <div className="national-bar" aria-hidden="true"><span /><span /></div>
      <header className="login-header">
        <a className="school-brand" href="/" aria-label="Retour à l'accueil">
          {logo
            ? <img className="school-logo" src={logo} alt={`Logo du ${identity?.schoolName ?? "l'établissement"}`} />
            : <span className="school-monogram" aria-hidden="true">{identity?.monogram ?? "AG"}</span>}
          <span><ArmoiriesTogo size="small" className="login-arms" /><strong>{identity?.schoolName ?? "Établissement scolaire"}</strong><small>{identity?.cycleSubtitle ?? "Espace officiel"}</small></span>
        </a>
        <a href="/">Accueil</a>
      </header>
      <section className="login-panel">
        <p className="public-eyebrow">{identity?.ministry ?? "Espace sécurisé"}</p>
        <h1>Connexion à mon espace</h1>
        <p>Accédez aux informations correspondant à votre rôle dans l'établissement.</p>
        <form onSubmit={(event) => void submit(event)}>
          <label>Identifiant
            <input autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required disabled={otpRequired} />
          </label>
          <label>Mot de passe
            <input autoComplete={otpRequired ? "current-password" : "current-password"} type="password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={otpRequired} />
          </label>
          {otpRequired && <label>Code de vérification à 6 chiffres
            <input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} required />
          </label>}
          {error && <p className="login-error" role="alert">{error}</p>}
          {otpRequired && <p className="login-help" role="status">Saisissez le code de votre application d'authentification.</p>}
          <button type="submit" disabled={submitting}>{submitting ? "Vérification…" : otpRequired ? "Vérifier et continuer" : "Se connecter"}</button>
        </form>
        {!otpRequired && <a className="forgot-password-link" href="#aide-mot-de-passe">Mot de passe oublié ?</a>}
        {otpRequired && <button className="text-button" onClick={() => { setOtpRequired(false); setOtp(""); setError(""); }}>Utiliser un autre compte</button>}
        <div className="forgot-password" id="aide-mot-de-passe">
          <strong>Mot de passe oublié ?</strong>
          <p>Contactez le secrétariat pour réinitialiser vos accès{identity?.phone ? ` au ${identity.phone}` : ""}{identity?.email ? ` ou par e-mail à ${identity.email}` : ""}.</p>
        </div>
      </section>
      <footer className="login-footer">{identity?.schoolName ?? "Établissement scolaire"} · {identity?.regionalDirectorate ?? ""}</footer>
    </main>
  );
}

function Root() {
  const [route, setRoute] = useState(window.location.pathname);
  const [dashboardTab, setDashboardTab] = useState("tableau de bord");
  const authenticated = Boolean(localStorage.getItem("token"));

  const navigate = (nextRoute: string) => {
    window.history.pushState({}, "", nextRoute);
    setRoute(nextRoute);
  };

  useEffect(() => {
    const onPopState = () => setRoute(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/service-worker.js")
        .catch((reason) => console.warn("Service worker indisponible", reason));
    }
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (route === "/app" && !authenticated) navigate("/connexion");
    if (route === "/connexion" && authenticated) navigate("/app");
  }, [route, authenticated]);

  if (route === "/connexion") {
    return <Login onLogin={(roles) => {
      setDashboardTab(chooseInitialTab(roles));
      navigate("/app");
    }} />;
  }
  if (route === "/app" && authenticated) {
    return <Suspense fallback={<main className="route-loading" role="status">Ouverture de votre espace…</main>}>
      <DashboardApp initialTab={dashboardTab} onLogout={() => navigate("/")} />
    </Suspense>;
  }
  return <HomePage onLogin={() => navigate(authenticated ? "/app" : "/connexion")} />;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><Root /></React.StrictMode>,
);
