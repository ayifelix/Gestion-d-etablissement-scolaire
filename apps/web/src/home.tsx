import { useEffect, useRef, useState } from "react";
import { API_ORIGIN, api } from "./api";
import { ArmoiriesTogo, schoolLogoSource } from "./branding";
import "./home.css";

type SchoolIdentity = {
  schoolName: string;
  shortName: string;
  monogram: string;
  cycleSubtitle: string;
  ministry: string;
  regionalDirectorate: string;
  inspection: string;
  republicName: string;
  republicMotto: string;
  schoolMotto: string;
  address: string;
  phone: string;
  email: string;
  secretariatHours: string;
  headName: string;
  headMessage: string;
  collegePresentation: string;
  lyceePresentation: string;
  directionsUrl: string;
  logoUrl: string | null;
  photoUrl: string | null;
};

type PublicAnnouncement = {
  id: string;
  title: string;
  summary: string;
  category: string;
  eventAt: string | null;
};

type PublicSite = {
  identity: SchoolIdentity;
  announcements: PublicAnnouncement[];
};

type BarcodeDetectorLike = {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
};
type WindowWithBarcodeDetector = Window & {
  BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike;
};
type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const publicSiteCacheKey = "public-site-cache-v1";
const fallbackIdentity: SchoolIdentity = {
  schoolName: "LYCÉE AKONDA GNAWEME",
  shortName: "Akonda",
  monogram: "AG",
  cycleSubtitle: "Collège et Lycée",
  ministry: "Ministère des Enseignements Primaire et Secondaire (MEPS)",
  regionalDirectorate: "DRE-Maritime",
  inspection: "IESG-Vogan",
  republicName: "République Togolaise",
  republicMotto: "Travail - Liberté - Patrie",
  schoolMotto: "Discipline - Travail - Succès",
  address: "",
  phone: "",
  email: "",
  secretariatHours: "",
  headName: "",
  headMessage: "",
  collegePresentation: "",
  lyceePresentation: "",
  directionsUrl: "",
  logoUrl: "/assets/etablissement/logo-128.webp",
  photoUrl: null,
};

function readCachedSite(): PublicSite | null {
  try {
    const raw = localStorage.getItem(publicSiteCacheKey);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { savedAt: number; site: PublicSite };
    if (!cached.site?.identity || !Array.isArray(cached.site.announcements)) return null;
    return cached.site;
  } catch {
    return null;
  }
}

function safeMediaUrl(value: string | null) {
  if (!value || !/^\/api\/public\/media\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(value)) return null;
  return `${API_ORIGIN}${value}`;
}

function safeDirectionsUrl(value: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function displayDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(value))
    : "Date à confirmer";
}

export function HomePage({ onLogin }: { onLogin: () => void }) {
  const [site, setSite] = useState<PublicSite | null>(() => readCachedSite());
  const [siteError, setSiteError] = useState("");
  const [verifyCode, setVerifyCode] = useState(() => new URLSearchParams(location.search).get("verify") ?? "");
  const [verifyResult, setVerifyResult] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [scanError, setScanError] = useState("");
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [authenticated, setAuthenticated] = useState(Boolean(localStorage.getItem("token")));
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    if (!navigator.onLine) {
      if (!readCachedSite()) setSiteError("Le contenu de l'accueil n'a pas encore été mis en cache sur cet appareil.");
      return () => { active = false; };
    }
    void api<PublicSite>("/public/site")
      .then((fresh) => {
        if (!active) return;
        setSite(fresh);
        setSiteError("");
        localStorage.setItem(publicSiteCacheKey, JSON.stringify({ savedAt: Date.now(), site: fresh }));
      })
      .catch((reason) => {
        if (active && !readCachedSite()) {
          setSiteError(reason instanceof Error ? reason.message : "Le contenu de l'établissement est indisponible.");
        }
      });
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === "token") setAuthenticated(Boolean(event.newValue));
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    window.addEventListener("storage", onStorage);
    return () => {
      active = false;
      window.removeEventListener("beforeinstallprompt", onInstall);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => () => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const stopScanner = () => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  };

  const startScanner = async () => {
    setScanError("");
    const Detector = (window as WindowWithBarcodeDetector).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setScanError("La lecture caméra n'est pas disponible sur cet appareil. Vous pouvez saisir le code imprimé.");
      return;
    }
    try {
      const detector = new Detector({ formats: ["qr_code"] });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      setScanning(true);
      if (!videoRef.current) return stopScanner();
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      const scan = async () => {
        if (!videoRef.current || !streamRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes[0]?.rawValue) {
            setVerifyCode(codes[0].rawValue);
            stopScanner();
            return;
          }
        } catch {
          setScanError("Impossible de lire ce code QR. Saisissez le numéro imprimé.");
          stopScanner();
          return;
        }
        animationRef.current = requestAnimationFrame(() => { void scan(); });
      };
      void scan();
    } catch {
      setScanError("Caméra inaccessible. Vérifiez l'autorisation du navigateur ou saisissez le numéro imprimé.");
      stopScanner();
    }
  };

  const verifyDocument = async (event: React.FormEvent) => {
    event.preventDefault();
    setVerifying(true);
    setVerifyResult("");
    try {
      let code = verifyCode.trim();
      try {
        const url = new URL(code);
        code = url.searchParams.get("code") ?? url.searchParams.get("verify") ?? code;
      } catch {
        code = code.replace(/^.*\/verify\//, "");
      }
      const result = await api<{ status: "AUTHENTIQUE" | "ANNULE" | "INTROUVABLE"; type: string | null; reference: string | null }>(
        `/public/verify?code=${encodeURIComponent(code)}`,
      );
      const labels = {
        AUTHENTIQUE: "Document authentique",
        ANNULE: "Document annulé",
        INTROUVABLE: "Document introuvable",
      };
      setVerifyResult(labels[result.status]);
    } catch (reason) {
      setVerifyResult(reason instanceof Error ? reason.message : "Vérification indisponible");
    } finally {
      setVerifying(false);
    }
  };

  const identity = site?.identity ?? fallbackIdentity;
  const logo = schoolLogoSource(identity?.logoUrl) ?? "/assets/etablissement/logo-128.webp";
  const photo = safeMediaUrl(identity?.photoUrl ?? null);
  const directions = safeDirectionsUrl(identity?.directionsUrl ?? "");

  useEffect(() => {
    if (identity?.schoolName) document.title = `${identity.schoolName} | Gestion scolaire`;
  }, [identity?.schoolName]);

  return (
    <main className="public-site">
      <div className="national-bar" aria-hidden="true"><span /><span /></div>
      <div className="administrative-ribbon">
        <ArmoiriesTogo size="screen" className="public-ribbon-arms" />
        <span>République Togolaise · {identity?.republicMotto ?? "…"}</span>
        <span>{identity?.ministry ?? "…"}</span>
        <span>{identity?.regionalDirectorate ?? "…"}</span>
        <span>{identity?.inspection ?? "…"}</span>
      </div>

      <header className="public-header">
        <a className="school-brand" href="#accueil" aria-label={identity ? `Accueil ${identity.schoolName}` : "Accueil établissement"}>
          {logo
            ? <picture>
                {identity?.logoUrl === "/assets/etablissement/logo-128.webp" &&
                  <source media="(max-width: 560px)" srcSet="/assets/etablissement/logo-compact.webp" />}
                <img className="school-logo" src={logo} alt={`Logo du ${identity?.schoolName ?? "l'établissement"}`} fetchPriority="high" />
              </picture>
            : <span className="school-monogram" aria-hidden="true">{identity?.monogram ?? "AG"}</span>}
          <span><strong>{identity?.schoolName ?? "Établissement scolaire"}</strong><small>{identity?.cycleSubtitle ?? "Espace officiel"}</small></span>
        </a>
        <nav className="public-nav" aria-label="Navigation du site">
          <a href="#dates">Dates</a><a href="#presentation">Présentation</a><a href="#contact">Contact</a>
        </nav>
        <button className="public-login-link" onClick={onLogin}>
          {authenticated ? "Continuer vers mon espace" : "Se connecter"}
        </button>
      </header>

      {siteError && !site && <div className="public-error" role="alert">{siteError}</div>}

      <section className={`public-hero${photo ? " has-photo" : ""}`} id="accueil">
        {photo && <img className="hero-photo" src={photo} alt="" fetchPriority="high" />}
        <div className="hero-weave" aria-hidden="true" />
        <div className="hero-copy">
          <p className="public-eyebrow">Établissement public · Togo</p>
          <h1>{identity?.schoolName ?? "Établissement scolaire"}</h1>
          <p className="hero-subtitle">{identity?.cycleSubtitle ?? "Espace éducatif"}</p>
          {identity?.schoolMotto && <p className="hero-motto">{identity.schoolMotto}</p>}
          <p className="hero-summary">Un espace de suivi scolaire clair, sûr et proche des familles.</p>
          <button className="hero-button" onClick={onLogin}>Accéder à mon espace <span aria-hidden="true">→</span></button>
        </div>
      </section>

      <div className="woven-divider" aria-hidden="true" />

      <section className="audience-section" aria-labelledby="audience-title">
        <p className="public-eyebrow">Un accès adapté à chacun</p>
        <h2 id="audience-title">Qui êtes-vous ?</h2>
        <div className="audience-list">
          <button className="audience-entry audience-family" onClick={onLogin}>
            <span className="audience-index">01</span><strong>Parents et élèves</strong>
            <span>Retrouvez les informations scolaires et les bulletins vérifiés.</span><b>Ouvrir mon espace →</b>
          </button>
          <button className="audience-entry audience-teaching" onClick={onLogin}>
            <span className="audience-index">02</span><strong>Enseignants et titulaires</strong>
            <span>Suivez les classes, les notes et les activités pédagogiques.</span><b>Accéder aux outils →</b>
          </button>
          <button className="audience-entry audience-office" onClick={onLogin}>
            <span className="audience-index">03</span><strong>Administration</strong>
            <span>Gérez les services de l'établissement selon vos habilitations.</span><b>Connexion du personnel →</b>
          </button>
        </div>
      </section>

      <div className="woven-divider" aria-hidden="true" />

      <section className="dates-section" id="dates">
        <div className="section-heading">
          <div><p className="public-eyebrow">Informations officielles</p><h2>Annonces et calendrier</h2></div>
          <span className="section-mark">Vie scolaire</span>
        </div>
        {site?.announcements.length
          ? <ol className="announcement-list">
            {site.announcements.map((announcement) => (
              <li key={announcement.id}>
                <time dateTime={announcement.eventAt ?? undefined}>{displayDate(announcement.eventAt)}</time>
                <div><span className="announcement-category">{announcement.category.replaceAll("_", " ").toLowerCase()}</span><h3>{announcement.title}</h3><p>{announcement.summary}</p></div>
              </li>
            ))}
          </ol>
          : <p className="empty-public">Aucune date à venir n'est publiée pour le moment.</p>}
      </section>

      <div className="woven-divider" aria-hidden="true" />

      <section className="verify-section" aria-labelledby="verify-title">
        <div>
          <ArmoiriesTogo size="screen" />
          <p className="public-eyebrow">Contrôle de document</p>
          <h2 id="verify-title">Vérifier un document</h2>
          <p>Entrez la référence imprimée ou lisez le QR code. Aucune information personnelle n'est affichée.</p>
        </div>
        <form className="verify-form" onSubmit={(event) => void verifyDocument(event)}>
          <label htmlFor="document-code">Numéro du document ou code QR</label>
          <div className="verify-controls">
            <input id="document-code" value={verifyCode} onChange={(event) => setVerifyCode(event.target.value)} autoComplete="off" maxLength={120} required />
            <button type="submit" disabled={verifying}>{verifying ? "Vérification…" : "Vérifier"}</button>
          </div>
          <div className="verify-controls">
            <button type="button" className="secondary-public-button" onClick={() => scanning ? stopScanner() : void startScanner()}>
              {scanning ? "Arrêter la caméra" : "Lire un QR avec la caméra"}
            </button>
          </div>
          <video ref={videoRef} className={scanning ? "qr-video active" : "qr-video"} muted playsInline aria-label="Aperçu de la caméra pour lire le QR code" />
          {scanError && <p className="public-error" role="status">{scanError}</p>}
          {verifyResult && <p className={`verification-result ${verifyResult.includes("authentique") ? "is-valid" : "is-other"}`} role="status">{verifyResult}</p>}
        </form>
      </section>

      <div className="woven-divider" aria-hidden="true" />

      <section className="parent-steps" aria-labelledby="steps-title">
        <p className="public-eyebrow">Un suivi simple</p>
        <h2 id="steps-title">Comment ça marche pour les parents ?</h2>
        <ol>
          <li><span>1</span><strong>Recevoir le SMS</strong><p>Les informations utiles sont envoyées au numéro communiqué au secrétariat.</p></li>
          <li><span>2</span><strong>Se connecter</strong><p>Utilisez les identifiants transmis par l'établissement. En cas de difficulté, contactez le secrétariat.</p></li>
          <li><span>3</span><strong>Consulter les résultats</strong><p>Les notes affichées sont des notes vérifiées ; les bulletins sont publiés par l'établissement.</p></li>
        </ol>
      </section>

      <div className="woven-divider" aria-hidden="true" />

      <section className="presentation-section" id="presentation">
        <div className="head-message">
          <p className="public-eyebrow">Le mot de la direction</p>
          <h2>{identity?.headName ? `Mot de ${identity.headName}` : "Un établissement engagé"}</h2>
          <p>{identity?.headMessage || "La direction souhaite la bienvenue aux familles et à l'ensemble de la communauté éducative."}</p>
        </div>
        <div className="cycle-presentations">
          <article className="college-presentation">
            <span className="cycle-label">Collège</span><h3>Grandir et apprendre</h3>
            <p>{identity?.collegePresentation || "Un parcours de formation générale pour construire les bases et accompagner chaque élève."}</p>
          </article>
          <article className="lycee-presentation">
            <span className="cycle-label">Lycée</span><h3>Approfondir et s'orienter</h3>
            <p>{identity?.lyceePresentation || "Un parcours qui développe les compétences et prépare aux examens et à la poursuite d'études."}</p>
          </article>
        </div>
        <div className="pathway-line"><span>Filières</span>{["S", "A4", "C", "D"].map((item) => <b key={item}>{item}</b>)}</div>
      </section>

      <div className="woven-divider" aria-hidden="true" />

      <section className="contact-section" id="contact">
        <div><p className="public-eyebrow">Nous trouver</p><h2>Contact et localisation</h2></div>
        <address>
          {identity?.address && <p>{identity.address}</p>}
          {identity?.phone && <p><a href={`tel:${identity.phone.replace(/[^\d+]/g, "")}`}>{identity.phone}</a></p>}
          {identity?.email && <p><a href={`mailto:${identity.email}`}>{identity.email}</a></p>}
          {identity?.secretariatHours && <p>Secrétariat : {identity.secretariatHours}</p>}
          {directions && <p><a className="directions-link" href={directions} target="_blank" rel="noreferrer">Ouvrir l'itinéraire →</a></p>}
          {!identity?.address && !identity?.phone && !identity?.email && !identity?.secretariatHours && <p>Les coordonnées seront publiées après validation par l'établissement.</p>}
        </address>
      </section>

      <div className="woven-divider" aria-hidden="true" />

      <section className="faq-section">
        <p className="public-eyebrow">Besoin d'aide ?</p><h2>Questions fréquentes</h2>
        <details><summary>J'ai oublié mon mot de passe. Que faire ?</summary><p>Contactez le secrétariat aux coordonnées indiquées ci-dessus pour demander une réinitialisation.</p></details>
        <details><summary>Un parent sans smartphone peut-il être informé ?</summary><p>Oui. Contactez le secrétariat pour convenir d'un moyen de consultation adapté.</p></details>
        <details><summary>Comment justifier une absence ?</summary><p>Prévenez le titulaire ou le secrétariat et transmettez le justificatif selon les consignes de l'établissement.</p></details>
      </section>

      <footer className="public-footer">
        <span>{identity?.schoolName ?? "Établissement scolaire"}{identity?.schoolMotto ? ` · ${identity.schoolMotto}` : ""}</span>
        <div><a href="#contact">Contact</a><a href="#protection">Protection des données</a><button onClick={onLogin}>Aide et connexion</button></div>
        <p id="protection">Les pages publiques ne publient aucune donnée personnelle d'élève, de parent ou d'enseignant.</p>
      </footer>

      {installPrompt && <button className="pwa-install" onClick={async () => {
        await installPrompt.prompt();
        await installPrompt.userChoice;
        setInstallPrompt(null);
      }}>Installer l'application</button>}
    </main>
  );
}
