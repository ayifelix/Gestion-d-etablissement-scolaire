import { useEffect, useState } from "react";
import { API_ORIGIN, api } from "./api";

type SchoolIdentity = {
  schoolName: string;
  cycleSubtitle: string;
  ministry: string;
  regionalDirectorate: string;
  inspection: string;
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

type AnnouncementCategory =
  | "RENTREE"
  | "COMPOSITIONS"
  | "CONSEIL"
  | "EXAMEN_BLANC_BEPC"
  | "EXAMEN_BLANC_BAC_I"
  | "EXAMEN_BLANC_BAC_II"
  | "REMISE_BULLETINS"
  | "AUTRE";
type Announcement = {
  id: string;
  title: string;
  summary: string;
  category: AnnouncementCategory;
  eventAt: string | null;
  published: boolean;
};
type SiteContentResponse = { identity: SchoolIdentity; announcements: Announcement[] };

const blankAnnouncement = {
  title: "",
  summary: "",
  category: "AUTRE" as AnnouncementCategory,
  eventAt: "",
  published: true,
};

const identityFields: Array<{ key: keyof SchoolIdentity; label: string; multiline?: boolean }> = [
  { key: "schoolName", label: "Nom officiel de l'établissement" },
  { key: "cycleSubtitle", label: "Libellé des cycles" },
  { key: "ministry", label: "Ministère" },
  { key: "regionalDirectorate", label: "Direction régionale" },
  { key: "inspection", label: "Inspection" },
  { key: "republicMotto", label: "Devise de la République" },
  { key: "schoolMotto", label: "Devise de l'établissement" },
  { key: "address", label: "Adresse" },
  { key: "phone", label: "Téléphone" },
  { key: "email", label: "E-mail" },
  { key: "secretariatHours", label: "Horaires du secrétariat" },
  { key: "headName", label: "Nom du chef d'établissement" },
  { key: "directionsUrl", label: "Lien d'itinéraire" },
  { key: "headMessage", label: "Mot du chef d'établissement", multiline: true },
  { key: "collegePresentation", label: "Présentation du Collège", multiline: true },
  { key: "lyceePresentation", label: "Présentation du Lycée", multiline: true },
];

const categoryLabels: Record<AnnouncementCategory, string> = {
  RENTREE: "Rentrée",
  COMPOSITIONS: "Compositions",
  CONSEIL: "Conseil de classe",
  EXAMEN_BLANC_BEPC: "Examen blanc BEPC",
  EXAMEN_BLANC_BAC_I: "Examen blanc BAC I",
  EXAMEN_BLANC_BAC_II: "Examen blanc BAC II",
  REMISE_BULLETINS: "Remise des bulletins",
  AUTRE: "Autre",
};

function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function SiteContentWorkspace() {
  const [identity, setIdentity] = useState<SchoolIdentity | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcement, setAnnouncement] = useState({ ...blankAnnouncement });
  const [editingId, setEditingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setError("");
    try {
      const result = await api<SiteContentResponse>("/site-content");
      setIdentity(result.identity);
      setAnnouncements(result.announcements);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Le contenu de l'accueil est indisponible.");
    }
  };

  useEffect(() => { void refresh(); }, []);

  const saveIdentity = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!identity) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await api<SchoolIdentity>("/site-content/identity", {
        method: "PUT",
        body: JSON.stringify(Object.fromEntries(
          identityFields.map(({ key }) => [key, identity[key] ?? ""]),
        )),
      });
      setIdentity(saved);
      setNotice("Identité enregistrée et modification journalisée.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  };

  const uploadMedia = async (kind: "logo" | "photo", file?: File) => {
    if (!file) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body = new FormData();
      body.append("kind", kind);
      body.append("image", file);
      const result = await api<{ url: string }>("/site-content/media", { method: "POST", body });
      setIdentity((current) => current
        ? { ...current, [kind === "logo" ? "logoUrl" : "photoUrl"]: result.url }
        : current);
      setNotice("Image enregistrée et modification journalisée.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Téléversement impossible.");
    } finally {
      setBusy(false);
    }
  };

  const saveAnnouncement = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const data = {
      title: announcement.title,
      summary: announcement.summary,
      category: announcement.category,
      eventAt: announcement.eventAt ? new Date(announcement.eventAt).toISOString() : null,
      published: announcement.published,
    };
    try {
      await api(`/site-content/announcements${editingId ? `/${editingId}` : ""}`, {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify(data),
      });
      setAnnouncement({ ...blankAnnouncement });
      setEditingId("");
      await refresh();
      setNotice(editingId ? "Annonce modifiée et journalisée." : "Annonce créée et journalisée.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Enregistrement de l'annonce impossible.");
    } finally {
      setBusy(false);
    }
  };

  const editAnnouncement = (item: Announcement) => {
    setEditingId(item.id);
    setAnnouncement({
      title: item.title,
      summary: item.summary,
      category: item.category,
      eventAt: localDateTime(item.eventAt),
      published: item.published,
    });
  };

  const archiveAnnouncement = async (id: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`/site-content/announcements/${id}`, { method: "DELETE" });
      await refresh();
      setNotice("Annonce archivée et journalisée.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Archivage impossible.");
    } finally {
      setBusy(false);
    }
  };

  const mediaUrl = (value: string | null) =>
    value && /^\/api\/public\/media\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(value) ? `${API_ORIGIN}${value}` : "";

  return (
    <section className="site-content-workspace">
      <p className="eyebrow">Permission site.gerer_contenu</p>
      <h2>Contenu de l'accueil</h2>
      {error && <div className="alert" role="alert">{error}</div>}
      {notice && <div className="notice" role="status">{notice}</div>}
      {!identity && !error && <p role="status">Chargement du contenu…</p>}
      {identity && (
        <>
          <form className="site-identity-form" onSubmit={(event) => void saveIdentity(event)}>
            <h3>Identité de l'établissement</h3>
            <p className="help">Le nom est modifiable ; son orthographe reste à confirmer par la direction. Les champs non renseignés restent vides sur le site.</p>
            <div className="site-identity-grid">
              {identityFields.map(({ key, label, multiline }) => (
                <label key={key} className={multiline ? "wide-field" : ""}>{label}
                  {multiline
                    ? <textarea rows={4} value={String(identity[key] ?? "")} onChange={(event) => setIdentity({ ...identity, [key]: event.target.value })} />
                    : <input type={key === "email" ? "email" : key === "directionsUrl" ? "url" : "text"} value={String(identity[key] ?? "")} onChange={(event) => setIdentity({ ...identity, [key]: event.target.value })} />}
                </label>
              ))}
            </div>
            <div className="site-media-grid">
              <label>Logo (PNG, JPEG ou WebP, 5 Mo maximum)
                {identity.logoUrl && <img src={mediaUrl(identity.logoUrl)} alt="Logo actuel de l'établissement" />}
                <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => void uploadMedia("logo", event.target.files?.[0])} />
              </label>
              <label>Photo de l'établissement
                {identity.photoUrl && <img src={mediaUrl(identity.photoUrl)} alt="Photo actuelle de l'établissement" />}
                <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => void uploadMedia("photo", event.target.files?.[0])} />
              </label>
            </div>
            <button type="submit" disabled={busy}>Enregistrer l'identité</button>
          </form>

          <form className="announcement-editor" onSubmit={(event) => void saveAnnouncement(event)}>
            <h3>{editingId ? "Modifier une annonce ou une date" : "Ajouter une annonce ou une date"}</h3>
            <p className="help wide-field">Ces informations sont publiques. Ne publiez aucun nom, matricule, résultat individuel, téléphone personnel ni autre donnée privée.</p>
            <label>Titre<input value={announcement.title} onChange={(event) => setAnnouncement({ ...announcement, title: event.target.value })} minLength={3} maxLength={160} required /></label>
            <label>Type
              <select value={announcement.category} onChange={(event) => setAnnouncement({ ...announcement, category: event.target.value as AnnouncementCategory })}>
                {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>Date et heure (facultatif)<input type="datetime-local" value={announcement.eventAt} onChange={(event) => setAnnouncement({ ...announcement, eventAt: event.target.value })} /></label>
            <label className="wide-field">Résumé<textarea rows={3} value={announcement.summary} onChange={(event) => setAnnouncement({ ...announcement, summary: event.target.value })} minLength={3} maxLength={1200} required /></label>
            <label className="publish-control"><input type="checkbox" checked={announcement.published} onChange={(event) => setAnnouncement({ ...announcement, published: event.target.checked })} />Publier sur la page d'accueil</label>
            <div className="actions">
              <button type="submit" disabled={busy}>{editingId ? "Enregistrer l'annonce" : "Créer l'annonce"}</button>
              {editingId && <button type="button" className="secondary" onClick={() => { setEditingId(""); setAnnouncement({ ...blankAnnouncement }); }}>Annuler la modification</button>}
            </div>
          </form>

          <div className="site-announcements">
            <h3>Annonces et calendrier</h3>
            {announcements.map((item) => (
              <article key={item.id}>
                <div><strong>{item.title}</strong><span>{categoryLabels[item.category]} · {item.eventAt ? new Date(item.eventAt).toLocaleString("fr-FR") : "Sans date"} · {item.published ? "Publiée" : "Brouillon"}</span><p>{item.summary}</p></div>
                <div className="actions"><button type="button" className="secondary" onClick={() => editAnnouncement(item)}>Modifier</button><button type="button" className="danger-button" disabled={busy} onClick={() => void archiveAnnouncement(item.id)}>Archiver</button></div>
              </article>
            ))}
            {!announcements.length && <p className="empty">Aucune annonce enregistrée.</p>}
          </div>
        </>
      )}
    </section>
  );
}
