import { useEffect, useRef, useState } from "react";
import { API_ORIGIN, api } from "./api";
import { schoolLogoSource } from "./branding";
import "./home.css";

type SchoolIdentity = {
  schoolName: string; shortName: string; monogram: string; cycleSubtitle: string;
  ministry: string; regionalDirectorate: string; inspection: string; republicName: string;
  republicMotto: string; schoolMotto: string; address: string; phone: string; email: string;
  secretariatHours: string; headName: string; headMessage: string;
  collegePresentation: string; lyceePresentation: string; directionsUrl: string;
  logoUrl: string | null; photoUrl: string | null;
};
type PublicAnnouncement = { id: string; title: string; summary: string; category: string; eventAt: string | null };
type PublicSite = { identity: SchoolIdentity; announcements: PublicAnnouncement[] };

type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>> };
type WindowWithBarcodeDetector = Window & { BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike };
type InstallPromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }> };

const cacheKey = "public-site-cache-v1";
const fallback: SchoolIdentity = {
  schoolName: "LYCÉE AKONDA GNAWEME", shortName: "Akonda", monogram: "AG",
  cycleSubtitle: "Collège et Lycée", ministry: "Ministère des Enseignements Primaire et Secondaire (MEPS)",
  regionalDirectorate: "DRE-Maritime", inspection: "IESG-Vogan", republicName: "République Togolaise",
  republicMotto: "Travail - Liberté - Patrie", schoolMotto: "Discipline - Travail - Succès",
  address: "", phone: "", email: "", secretariatHours: "", headName: "",
  headMessage: "", collegePresentation: "", lyceePresentation: "", directionsUrl: "",
  logoUrl: "/assets/etablissement/logo-128.webp", photoUrl: null,
};

const schoolPhotos = [
  { src: "/assets/ecole/IMG_6466-960.webp", label: "Vie au lycée" },
  { src: "/assets/ecole/IMG_6467-960.webp", label: "Étude et partage" },
  { src: "/assets/ecole/IMG_6464-960.webp", label: "Laboratoire" },
  { src: "/assets/ecole/IMG_6458-960.webp", label: "Secrétariat" },
];

const profileData = [
  { id: "family", index: "01", label: "Parents et élèves", title: "Suivre chaque réussite", text: "Consultez les notes vérifiées, les bulletins publiés et les informations utiles à l’élève.", action: "Accéder à mon dossier", icon: "person" },
  { id: "staff", index: "02", label: "Enseignants et titulaires", title: "Organiser les apprentissages", text: "Saisissez les évaluations, suivez les classes et consultez les feuilles de notes vérifiables.", action: "Ouvrir mes outils", icon: "book" },
  { id: "office", index: "03", label: "Administration", title: "Piloter avec justesse", text: "Gérez les dossiers, les documents officiels, les finances et les décisions selon vos habilitations.", action: "Entrer dans l’administration", icon: "grid" },
] as const;

const timeline = [
  ["Septembre", "Rentrée"], ["Octobre", "1er trimestre"], ["Novembre", "Compositions"],
  ["Décembre", "Conseils de classe"], ["Janvier", "Examens blancs"],
  ["Février", "BEPC / BAC"], ["Mars", "Examens blancs"], ["Avril", "Compositions"],
  ["Mai", "Conseils"], ["Juin", "Examens"], ["Juillet", "Bulletins"],
];

function Icon({ name }: { name: string }) {
  if (name === "person") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 21c.6-4.1 3-6.2 7.5-6.2s6.9 2.1 7.5 6.2" /></svg>;
  if (name === "book") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 5.5c3.5-1.1 6.2-.5 8.5 1.5v13c-2.3-2-5-2.6-8.5-1.5v-13ZM20.5 5.5c-3.5-1.1-6.2-.5-8.5 1.5v13c2.3-2 5-2.6 8.5-1.5v-13Z" /></svg>;
  if (name === "grid") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4L19 6" /></svg>;
}

function readCache(): PublicSite | null {
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) ?? "null");
    return cached?.site?.identity && Array.isArray(cached.site.announcements) ? cached.site : null;
  } catch { return null; }
}

function phoneLogoUrl(value: string | null) {
  if (!value) return "/assets/etablissement/logo-128.webp";
  const source = schoolLogoSource(value);
  return source ?? "/assets/etablissement/logo-128.webp";
}

export function HomePage({ onLogin }: { onLogin: () => void }) {
  const [site, setSite] = useState<PublicSite | null>(() => readCache());
  const [profile, setProfile] = useState(0);
  const [parentStep, setParentStep] = useState(0);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyResult, setVerifyResult] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [authenticated, setAuthenticated] = useState(Boolean(localStorage.getItem("token")));
  const [compactHeader, setCompactHeader] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(() => localStorage.getItem("reduce-motion") === "true");
  const [scanError, setScanError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanFrameRef = useRef<number | null>(null);

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = reduceMotion ? "true" : "false";
    localStorage.setItem("reduce-motion", String(reduceMotion));
  }, [reduceMotion]);

  useEffect(() => {
    let active = true;
    if (navigator.onLine) {
      void api<PublicSite>("/public/site")
        .then((fresh) => {
          if (!active) return;
          setSite(fresh);
          localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), site: fresh }));
        })
        .catch(() => {});
    }
    const onScroll = () => setCompactHeader(window.scrollY > 34);
    const onInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("beforeinstallprompt", onInstall);
    onScroll();
    return () => { active = false; window.removeEventListener("scroll", onScroll); window.removeEventListener("beforeinstallprompt", onInstall); };
  }, []);

  useEffect(() => {
    const nodes = document.querySelectorAll("[data-reveal]");
    if (reduceMotion || !("IntersectionObserver" in window)) {
      nodes.forEach((node) => node.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add("is-visible"); observer.unobserve(entry.target); }
    }), { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [reduceMotion]);

  useEffect(() => () => {
    if (scanFrameRef.current !== null) cancelAnimationFrame(scanFrameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const stopScanner = () => {
    if (scanFrameRef.current !== null) cancelAnimationFrame(scanFrameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null; setScanning(false);
  };

  const startScanner = async () => {
    setScanError("");
    const Detector = (window as WindowWithBarcodeDetector).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setScanError("Caméra indisponible. Saisissez le numéro imprimé.");
      return;
    }
    try {
      const detector = new Detector({ formats: ["qr_code"] });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream; setScanning(true);
      if (!videoRef.current) return stopScanner();
      videoRef.current.srcObject = stream; await videoRef.current.play();
      const scan = async () => {
        if (!videoRef.current || !streamRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes[0]?.rawValue) { setVerifyCode(codes[0].rawValue); stopScanner(); return; }
        } catch { setScanError("Ce QR n’a pas pu être lu."); stopScanner(); return; }
        scanFrameRef.current = requestAnimationFrame(() => { void scan(); });
      };
      void scan();
    } catch { setScanError("Accès à la caméra refusé. Saisissez le numéro."); stopScanner(); }
  };

  const verifyDocument = async (event: React.FormEvent) => {
    event.preventDefault();
    setVerifying(true); setVerifyResult("");
    try {
      let code = verifyCode.trim();
      try { const url = new URL(code); code = url.searchParams.get("code") ?? url.searchParams.get("verify") ?? code; } catch {}
      const result = await api<{ status: "AUTHENTIQUE" | "ANNULE" | "INTROUVABLE" }>(`/public/verify?code=${encodeURIComponent(code)}`);
      setVerifyResult({ AUTHENTIQUE: "Document authentique", ANNULE: "Document annulé", INTROUVABLE: "Document introuvable" }[result.status]);
    } catch (reason) { setVerifyResult(reason instanceof Error ? reason.message : "Vérification indisponible"); }
    finally { setVerifying(false); }
  };

  const identity = site?.identity ?? fallback;
  const logo = phoneLogoUrl(identity.logoUrl);
  const directions = (() => { try { return identity.directionsUrl ? new URL(identity.directionsUrl).href : ""; } catch { return ""; } })();
  const activeProfile = profileData[profile];
  const parentScreens = [
    { eyebrow: "Message reçu", title: "Bulletin prêt", text: "Votre établissement vous a envoyé une information." },
    { eyebrow: "Connexion sécurisée", title: "Mon espace", text: "Lycée Akonda Gnaweme · Profil parent" },
    { eyebrow: "Notes vérifiées", title: "Période validée", text: "Bulletin publié · SPÉCIMEN" },
  ];
  const parentScreen = parentScreens[parentStep];

  return (
    <main className={`public-site${reduceMotion ? " reduce-motion" : ""}`}>
      <div className="national-weave" aria-hidden="true"><span /><span /><span /><span /><span /></div>
      <div className="admin-ribbon">
        <strong>République Togolaise</strong><span>Travail · Liberté · Patrie</span>
        <span>{identity.ministry.replace(" (MEPS)", " · MEPS")}</span>
        <span>{identity.regionalDirectorate}</span><span>{identity.inspection}</span>
      </div>

      <header className={`public-header${compactHeader ? " is-compact" : ""}`}>
        <a className="school-brand" href="#accueil" aria-label={`Accueil ${identity.schoolName}`}>
          <picture><source media="(max-width: 560px)" srcSet="/assets/etablissement/logo-compact.webp" /><img src={logo} alt={`Logo du ${identity.schoolName}`} /></picture>
          <span><strong>{identity.shortName || identity.schoolName}</strong><small>{identity.cycleSubtitle}</small></span>
        </a>
        <nav className="public-nav" aria-label="Navigation principale">
          <a href="#profils">Profils</a><a href="#dates">Calendrier</a><a href="#presentation">L’établissement</a>
        </nav>
        <button className="header-login" onClick={onLogin}>{authenticated ? "Mon espace" : "Se connecter"} <span aria-hidden="true">→</span></button>
      </header>

      <section className="hero" id="accueil">
        <div className="hero-copy" data-reveal>
          <p className="eyebrow">Établissement public · Togo</p>
          <h1><span>Apprendre.</span><span>Avancer.</span><em>Réussir ensemble.</em></h1>
          <p className="hero-motto">{identity.schoolMotto}</p>
          <p className="hero-summary">Un suivi scolaire clair pour les familles, les équipes pédagogiques et l’administration.</p>
          <div className="hero-actions">
            <button className="primary-button" onClick={onLogin}>Accéder à mon espace <span aria-hidden="true">→</span></button>
            <a className="text-button" href="#verifier">Vérifier un document</a>
          </div>
        </div>
        <div className="hero-visual" data-reveal>
          <div className="weave-lines" aria-hidden="true"><span /><span /><span /></div>
          <img className="hero-photo" src="/assets/ecole/IMG_6466-960.webp" alt="Élèves du Lycée Akonda Gnaweme en discussion autour de leurs travaux" width="960" height="640" fetchPriority="high" />
          <div className="hero-seal"><img src={logo} alt="" /><span>SPÉCIMEN</span></div>
        </div>
      </section>

      <section className="trust-band" aria-label="Garanties de la plateforme" data-reveal>
        <article><Icon name="check" /><div><strong>Notes vérifiées</strong><span>Contrôle et visa avant publication</span></div></article>
        <article><Icon name="grid" /><div><strong>QR authentifiable</strong><span>Référence unique sur chaque document</span></div></article>
        <article><Icon name="person" /><div><strong>Accès par profil</strong><span>Habilitations adaptées et tracées</span></div></article>
      </section>

      <section className="profiles-section" id="profils">
        <div className="section-heading" data-reveal><p className="eyebrow">Votre espace</p><h2>Qui êtes-vous&nbsp;?</h2></div>
        <div className="profile-selector" role="tablist" aria-label="Choisir un profil" data-reveal>
          {profileData.map((item, index) => (
            <button key={item.id} role="tab" aria-selected={profile === index} className={profile === index ? "active" : ""} onClick={() => setProfile(index)}>
              <span>{item.index}</span>{item.label}
            </button>
          ))}
        </div>
        <div className={`profile-panel profile-${activeProfile.id}`} role="tabpanel" data-reveal>
          <div className="profile-copy">
            <Icon name={activeProfile.icon} />
            <p className="eyebrow">Accès {activeProfile.label.toLowerCase()}</p>
            <h3>{activeProfile.title}</h3><p>{activeProfile.text}</p>
            <button className="primary-button" onClick={onLogin}>{activeProfile.action} <span aria-hidden="true">→</span></button>
          </div>
          <div className="interface-preview" aria-label="Aperçu illustratif de l’interface">
            <div className="preview-bar"><span /><span /><span /></div>
            <div className="preview-grid"><aside><b>AG</b><i /><i /><i /></aside><div><small>DÉMO · DONNÉES FICTIVES</small><strong>{activeProfile.title}</strong><div className="preview-line"><span /><span /></div><div className="preview-cards"><i /><i /><i /></div></div></div>
          </div>
        </div>
      </section>

      <section className="calendar-section sand-section" id="dates">
        <div className="section-heading" data-reveal><p className="eyebrow">Année scolaire</p><h2>Le calendrier en un regard</h2></div>
        <div className="year-timeline" data-reveal aria-label="Repères de l’année scolaire">
          {timeline.map(([month, label], index) => <div key={`${month}-${label}`} className={index % 3 === 0 ? "major" : ""}><span>{month}</span><i /><strong>{label}</strong></div>)}
        </div>
        {site?.announcements.length ? <div className="announcement-editorial" data-reveal>{site.announcements.map((item) => <article key={item.id}><time>{item.eventAt ? new Date(item.eventAt).toLocaleDateString("fr-FR") : "À venir"}</time><h3>{item.title}</h3><p>{item.summary}</p></article>)}</div>
          : <div className="empty-calendar" data-reveal><Icon name="check" /><p><strong>Les prochaines dates seront publiées ici.</strong><span>L’année scolaire reste disponible ci-dessus.</span></p></div>}
      </section>

      <section className="parent-section">
        <div className="section-heading" data-reveal><p className="eyebrow">Pour les parents</p><h2>Trois gestes, toute l’année</h2></div>
        <div className="parent-layout">
          <ol className="parent-stepper" data-reveal>
            {["Recevoir le SMS", "Se connecter", "Consulter les résultats"].map((title, index) => (
              <li key={title}><button className={parentStep === index ? "active" : ""} onClick={() => setParentStep(index)}><span>{index + 1}</span><div><strong>{title}</strong><p>{["Une information claire arrive sur votre téléphone.", "Vos identifiants ouvrent l’espace correspondant.", "Les notes affichées ont été vérifiées et publiées."][index]}</p></div></button></li>
            ))}
          </ol>
          <div className="phone-stage" data-reveal>
            <div className="phone-mock">
              <div className="phone-speaker" /><div className="phone-screen" key={parentStep}><small>{parentScreen.eyebrow}</small><img src={logo} alt="" /><strong>{parentScreen.title}</strong><p>{parentScreen.text}</p><button>{parentStep === 2 ? "Voir le bulletin" : "Continuer"} <span>→</span></button></div>
            </div>
          </div>
        </div>
      </section>

      <section className="verify-section" id="verifier">
        <div className="verify-copy" data-reveal><p className="eyebrow">Authenticité</p><h2>Vérifier un document</h2><p>Numéro imprimé ou lecture QR. Aucun dossier individuel n’est affiché publiquement.</p></div>
        <form className="verify-form" onSubmit={(event) => void verifyDocument(event)} data-reveal>
          <label htmlFor="document-code">Référence du document</label>
          <div><input id="document-code" value={verifyCode} onChange={(event) => setVerifyCode(event.target.value)} placeholder="Ex. DOC-2026-…" maxLength={120} required /><button type="submit" disabled={verifying}>{verifying ? "Vérification…" : "Vérifier"}</button></div>
          <button type="button" className="qr-button" onClick={() => scanning ? stopScanner() : void startScanner()}><Icon name="grid" />{scanning ? "Arrêter la caméra" : "Lire un QR avec la caméra"}</button>
          <video ref={videoRef} className={scanning ? "qr-video active" : "qr-video"} muted playsInline aria-label="Caméra de lecture QR" />
          {scanError && <p className="form-error" role="status">{scanError}</p>}
          {verifyResult && <p className={`stamp-result ${verifyResult.includes("authentique") ? "authentic" : ""}`} role="status">{verifyResult}</p>}
        </form>
      </section>

      <section className="institution-section" id="presentation">
        <div className="head-message" data-reveal><p className="eyebrow">Le mot de la direction</p><h2>{identity.headName ? `Mot de ${identity.headName}` : "Un établissement engagé"}</h2><blockquote>{identity.headMessage || "Bienvenue à toutes les familles et à toute la communauté éducative. Ensemble, donnons à chaque élève les moyens d’apprendre, de grandir et de réussir."}</blockquote></div>
        <div className="cycle-panels" data-reveal>
          <article className="college-panel"><p>COLLÈGE · CYCLE 4</p><h3>Construire les bases</h3><span>Niveaux du collège</span><b>Collège</b></article>
          <article className="lycee-panel"><p>LYCÉE · ORIENTATION</p><h3>Approfondir et choisir</h3><span>Filières académiques</span><div>{["S", "A4", "C", "D"].map((item) => <b key={item} title={{ S: "Scientifique", A4: "Arts & lettres", C: "Scientifique", D: "Scientifique" }[item]}>{item}</b>)}</div></article>
        </div>
        <div className="gallery" data-reveal>{schoolPhotos.map((photo, index) => <figure className={index === 0 ? "feature" : ""} key={photo.src}><img src={photo.src} alt={photo.label} loading="lazy" /><figcaption>{photo.label}</figcaption></figure>)}</div>
      </section>

      <section className="faq-section" id="aide">
        <div className="section-heading" data-reveal><p className="eyebrow">Besoin d’aide</p><h2>Questions fréquentes</h2></div>
        <div className="faq-list" data-reveal>
          <details><summary>J’ai oublié mon mot de passe</summary><p>Contactez le secrétariat pour une réinitialisation après vérification de votre identité.</p></details>
          <details><summary>Un parent n’a pas de smartphone</summary><p>Le secrétariat peut convenir d’un autre moyen de consultation adapté.</p></details>
          <details><summary>Comment justifier une absence</summary><p>Prévenez le titulaire ou le secrétariat et transmettez le justificatif selon les consignes de l’établissement.</p></details>
        </div>
      </section>

      <section className="contact-section" id="contact">
        <div><p className="eyebrow">Nous trouver</p><h2>Contact et localisation</h2></div>
        <address>{identity.address && <p>{identity.address}</p>}{identity.phone && <p><a href={`tel:${identity.phone.replace(/[^\d+]/g, "")}`}>{identity.phone}</a></p>}{identity.email && <p><a href={`mailto:${identity.email}`}>{identity.email}</a></p>}{identity.secretariatHours && <p>Secrétariat : {identity.secretariatHours}</p>}{directions && <a className="directions-link" href={directions} target="_blank" rel="noreferrer">Ouvrir l’itinéraire →</a>}</address>
      </section>

      <footer className="public-footer">
        <div className="footer-brand"><img src={logo} alt={`Logo du ${identity.schoolName}`} /><div><strong>{identity.schoolName}</strong><span>{identity.cycleSubtitle}</span></div></div>
        <div className="footer-links"><a href="#contact">Contact</a><a href="#aide">Aide</a><a href="#protection">Protection des données</a><button type="button" onClick={() => setReduceMotion((value) => !value)}>{reduceMotion ? "Réactiver les animations" : "Réduire les animations"}</button></div>
        <p id="protection">Les pages publiques ne publient aucune donnée personnelle d’élève, de parent ou d’enseignant.</p>
      </footer>
      {installPrompt && <button className="pwa-install" onClick={async () => { await installPrompt.prompt(); await installPrompt.userChoice; setInstallPrompt(null); }}>Installer l’application</button>}
    </main>
  );
}
