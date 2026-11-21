import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api";

type TwoFactorSetup = { secret: string; otpauthUri: string };

export function SecurityWorkspace() {
  const [active, setActive] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ twoFactorActive: boolean }>("/me")
      .then((user) => setActive(user.twoFactorActive))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "État de sécurité indisponible."));
  }, []);

  const startSetup = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<TwoFactorSetup>("/auth/totp/setup", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setSetup(result);
      setCode("");
      setNotice("Ajoutez ce compte à votre application d'authentification, puis saisissez le code à 6 chiffres.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Configuration impossible.");
    } finally {
      setBusy(false);
    }
  };

  const enable = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/auth/totp/enable", { method: "POST", body: JSON.stringify({ code }) });
      setActive(true);
      setSetup(null);
      setPassword("");
      setCode("");
      setNotice("La double authentification est activée pour ce compte.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Activation impossible.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/auth/totp/disable", { method: "POST", body: JSON.stringify({ password, code }) });
      setActive(false);
      setPassword("");
      setCode("");
      setNotice("La double authentification est désactivée.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Désactivation impossible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="security-workspace">
      <p className="eyebrow">Protection du compte</p>
      <h2>Double authentification</h2>
      <p>Un code temporaire protège votre compte après la saisie du mot de passe. Conservez votre application d'authentification.</p>
      {error && <div className="alert" role="alert">{error}</div>}
      {notice && <div className="notice" role="status">{notice}</div>}
      <p className="security-status"><strong>État :</strong> {active ? "activée" : "désactivée"}</p>
      {active ? (
        <form className="assessment-form" onSubmit={(event) => void disable(event)}>
          <label>Mot de passe actuel<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <label>Code de l'application<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required /></label>
          <button type="submit" className="danger-button" disabled={busy}>Désactiver la double authentification</button>
        </form>
      ) : setup ? (
        <form className="assessment-form" onSubmit={(event) => void enable(event)}>
          <p className="security-secret"><strong>Clé de configuration :</strong> <code>{setup.secret}</code></p>
          <p className="help">Dans votre application, choisissez l'ajout manuel et utilisez cette clé. Ne la communiquez à personne.</p>
          <label>Code à 6 chiffres<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required /></label>
          <button type="submit" disabled={busy}>Confirmer l'activation</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => { setSetup(null); setCode(""); }}>Annuler</button>
        </form>
      ) : (
        <form className="assessment-form" onSubmit={(event) => void startSetup(event)}>
          <label>Mot de passe actuel<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <button type="submit" disabled={busy}>Configurer une application d'authentification</button>
        </form>
      )}
    </section>
  );
}
